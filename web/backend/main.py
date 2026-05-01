"""
性格编码智能体 API：供 Web 前端调用，解读逻辑全部来自 personality_encoder（确定性知识库）。

手机访问同一 Wi‑Fi：勿仅用 --host 127.0.0.1（外网设备连不上）。
请使用 --host 0.0.0.0，或运行仓库根目录 scripts/serve-lan.sh。
"""

from __future__ import annotations

import logging
import os
import sys
import time
import urllib.parse
from pathlib import Path
from typing import Any, Dict, Literal, Optional

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

logger = logging.getLogger(__name__)


def _load_root_dotenv() -> None:
    """从仓库根目录 `.env` 加载密钥（不把密钥写进代码或前端）。"""
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    path = ROOT / ".env"
    if path.is_file():
        load_dotenv(path, override=False)


_load_root_dotenv()


from personality_encoder.encode import (
    build_web_payload,
    extract_date_candidates,
    load_knowledge,
    parse_date,
)

KNOWLEDGE_PATH = ROOT / "personality_encoder" / "knowledge.json"

# 用于自检：若 GET /api/status 的 build_mark 不是此值，说明浏览器连上的仍是旧进程或未部署新代码。
API_BUILD_MARK = "reply-source-v6"

app = FastAPI(title="性格编码智能体", version="1.0.0")


@app.on_event("startup")
async def _startup_log_build_mark() -> None:
    logger.warning(
        "xgbm backend started build_mark=%s cwd=%s repo_root=%s",
        API_BUILD_MARK,
        Path.cwd(),
        ROOT,
    )


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Reply-Source"],
)


@app.middleware("http")
async def _no_store_index(request: Request, call_next):
    """避免手机浏览器长期缓存页面与接口（旧 JS / 旧 JSON 会表现为秒出）。"""
    response = await call_next(request)
    path = request.url.path
    if path.startswith("/api"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
        response.headers["Pragma"] = "no-cache"
    elif path == "/" or path == "/index.html" or path.startswith("/assets/"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
        response.headers["Pragma"] = "no-cache"
    return response


def _knowledge() -> dict:
    return load_knowledge(KNOWLEDGE_PATH)


class EncodeBody(BaseModel):
    birth_date: str = Field(..., description="YYYY-MM-DD 或 YYYYMMDD")
    narrative: Optional[bool] = Field(
        None,
        description="已废弃：服务端始终生成综合性格分析（口述）；传入值将被忽略。",
    )


class ChatBody(BaseModel):
    message: str = ""
    birth_date: Optional[str] = Field(None, description="可选，直接指定阳历生日")
    narrative: Optional[bool] = Field(
        None,
        description="已废弃：始终生成综合性格分析；传入值将被忽略。",
    )


class ComputeResponse(BaseModel):
    """仅本地推演结构化结果，不调大模型（供前端先展示第一步）。"""

    payload: Dict[str, Any]


class ChatResponse(BaseModel):
    """reply 为主展示正文。reply_source 标明是否为大模型生成。"""
    reply: str
    payload: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    reply_source: Optional[Literal["model", "fallback"]] = Field(
        None,
        description="model=大模型全文；fallback=模型失败时的本地讲义整合",
    )
    model_warning: Optional[str] = Field(
        None,
        description="仅在 fallback 时出现，提示正文非模型生成",
    )
    generation_meta: Optional[Dict[str, Any]] = Field(
        None,
        description="仅成功走模型时返回：elapsed_seconds、model、api_host（便于核对确实请求过大模型）",
    )


def _payload_for_chat_client(payload: Dict[str, Any]) -> Dict[str, Any]:
    """发给浏览器时不要带上 assistant_reply，避免与模型正文混淆（推演明细仍在）。"""
    out = dict(payload)
    out.pop("assistant_reply", None)
    return out


def _api_host_hint() -> str:
    from personality_encoder.ai_narrative import normalize_openai_compatible_base

    base = normalize_openai_compatible_base(
        os.environ.get("PERSONALITY_AI_BASE_URL", "https://api.openai.com/v1")
    ).strip().rstrip("/")
    if "://" not in base:
        base = "https://" + base
    try:
        return urllib.parse.urlparse(base).netloc or "(unknown)"
    except Exception:
        return "(unknown)"


def _resolve_date(message: str, birth_date: Optional[str]) -> tuple[int, int, int]:
    if birth_date:
        try:
            return parse_date(birth_date.strip())
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
    cands = extract_date_candidates(message)
    if not cands:
        raise HTTPException(
            status_code=400,
            detail="未识别到阳历生日。请发送如 1994-01-15、19940115 或 1994年1月15日。",
        )
    if len(cands) > 1:
        raise HTTPException(
            status_code=400,
            detail=f"识别到多个日期 {cands}，请在消息里只保留一个，或通过 birth_date 指定。",
        )
    try:
        return parse_date(cands[0])
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.get("/favicon.ico")
def favicon_ico():
    """浏览器默认请求 favicon.ico；重定向到前端打包的 SVG，避免控制台 404。"""
    return RedirectResponse(url="/favicon.svg", status_code=307)


@app.get("/api/health")
def health():
    """存活探测；含 build_mark，便于在无法访问 /api/status（旧进程）时对照."""
    return {
        "ok": True,
        "service": "personality-agent",
        "build_mark": API_BUILD_MARK,
    }


@app.get("/api/status")
def api_status():
    """局域网调试：不含密钥，仅确认当前进程已加载新路由与 .env。"""
    key_ok = bool(
        (os.environ.get("PERSONALITY_AI_API_KEY") or "").strip()
        or (os.environ.get("OPENAI_API_KEY") or "").strip()
        or (os.environ.get("DEEPSEEK_API_KEY") or "").strip()
    )
    return {
        "ok": True,
        "build_mark": API_BUILD_MARK,
        "ai_key_configured": key_ok,
        "repo_root": str(ROOT),
        "process_cwd": str(Path.cwd()),
        "hint": "代码或 .env 变更后必须重启 uvicorn；手机请访问 http://<本机局域网IP>:8000 并必要时关掉后台 Tab。",
    }


@app.post("/api/encode")
def encode(body: EncodeBody):
    try:
        y, m, d = parse_date(body.birth_date.strip())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    payload = build_web_payload(y, m, d, _knowledge())
    try:
        from personality_encoder.ai_narrative import generate_full_ai_report

        payload["full_ai_report"] = generate_full_ai_report(payload)
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=f"模型完整报告生成失败：{e}",
        ) from e
    return payload


def _http_detail(exc: HTTPException) -> str:
    d = exc.detail
    if isinstance(d, str):
        return d
    return str(d)


@app.post("/api/compute", response_model=ComputeResponse)
def compute_only(body: ChatBody):
    """第一步：根据生日完成本地三角形与融合码推演（秒级），不调用模型。"""
    y, m, d = _resolve_date(body.message, body.birth_date)
    payload = build_web_payload(y, m, d, _knowledge())
    return ComputeResponse(payload=_payload_for_chat_client(payload))


@app.post("/api/chat", response_model=ChatResponse)
def chat(body: ChatBody, response: Response):
    try:
        y, m, d = _resolve_date(body.message, body.birth_date)
    except HTTPException as e:
        response.headers["X-Reply-Source"] = "bad_request"
        return ChatResponse(reply="", payload=None, error=_http_detail(e))
    payload = build_web_payload(y, m, d, _knowledge())
    try:
        from personality_encoder.ai_narrative import (
            MissingAiApiKeyError,
            generate_full_ai_report,
        )

        t0 = time.perf_counter()
        report = generate_full_ai_report(payload)
        elapsed = time.perf_counter() - t0
        model_name = os.environ.get("PERSONALITY_AI_MODEL", "gpt-4o-mini")
        logger.info(
            "chat reply_source=model birth=%s elapsed=%.2fs chars=%s model=%s host=%s",
            payload.get("birth"),
            elapsed,
            len(report),
            model_name,
            _api_host_hint(),
        )
    except MissingAiApiKeyError:
        logger.warning(
            "chat aborted: missing AI API key (set OPENAI_API_KEY in repo root .env and restart)"
        )
        response.headers["X-Reply-Source"] = "no_key"
        return ChatResponse(
            reply="",
            payload=_payload_for_chat_client(payload),
            error=(
                "大模型未调用：未检测到 API Key。"
                "请在仓库根目录 `.env` 写入 DEEPSEEK_API_KEY 或 OPENAI_API_KEY（以及正确的 PERSONALITY_AI_BASE_URL，DeepSeek 须含 /v1），"
                "保存后重启 uvicorn。"
                "页面下方仍会展示本地讲义整合正文供阅读。"
            ),
        )
    except Exception:
        logger.exception("generate_full_ai_report failed")
        response.headers["X-Reply-Source"] = "upstream_error"
        return ChatResponse(
            reply="",
            payload=_payload_for_chat_client(payload),
            error=(
                "大模型请求失败：请看运行 uvicorn 的终端里的报错（常见：密钥无效、Base URL 缺 /v1、网络或额度）。"
                "页面下方仍会展示本地讲义整合正文；修好接口后可再点发送。"
            ),
        )
    response.headers["X-Reply-Source"] = "model"
    return ChatResponse(
        reply=report,
        payload=_payload_for_chat_client(payload),
        reply_source="model",
        generation_meta={
            "elapsed_seconds": round(elapsed, 2),
            "model": model_name,
            "api_host": _api_host_hint(),
        },
    )


# 生产环境：先 npm run build。切勿 mount("/", StaticFiles(html=True))，否则会吞掉 GET /api/*（表现为 /api/status 404）。
_FRONT_DIST = ROOT / "web" / "frontend" / "dist"
if _FRONT_DIST.is_dir():
    from fastapi.staticfiles import StaticFiles

    _assets_dir = _FRONT_DIST / "assets"
    if _assets_dir.is_dir():
        app.mount(
            "/assets",
            StaticFiles(directory=str(_assets_dir)),
            name="vite_assets",
        )

    @app.get("/")
    def _spa_root():
        return FileResponse(_FRONT_DIST / "index.html")

    @app.get("/index.html")
    def _spa_index_document():
        return FileResponse(_FRONT_DIST / "index.html")

    @app.get("/favicon.svg")
    def _favicon_svg_file():
        p = _FRONT_DIST / "favicon.svg"
        if p.is_file():
            return FileResponse(p)
        raise HTTPException(status_code=404, detail="Not Found")

