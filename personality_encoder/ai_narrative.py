"""
调用 OpenAI 兼容接口，基于结构化测算 JSON 生成连贯的性格解读口述（以描述为主，不要求分段推演拆解）。
不参与改写数字与推演；仅基于给定 JSON 组织语言。
"""

from __future__ import annotations

import json
import logging
import os
import urllib.parse
import ssl
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict

logger = logging.getLogger(__name__)


class MissingAiApiKeyError(ValueError):
    """未设置可用的 API Key（见下方读取顺序）。"""


def normalize_openai_compatible_base(raw: str) -> str:
    """
    OpenAI 兼容接口的最终路径为 {base}/chat/completions，故 base 必须含版本前缀（通常为 /v1）。

    DeepSeek 文档示例多为 https://api.deepseek.com/v1；若只写根域名 https://api.deepseek.com，
    会变成请求 …/chat/completions（缺 /v1），易 404。
    """
    s = (raw or "").strip().rstrip("/")
    if not s:
        return "https://api.openai.com/v1"
    if "://" not in s:
        s = "https://" + s
    parsed = urllib.parse.urlsplit(s)
    scheme = parsed.scheme or "https"
    netloc = parsed.netloc
    path = (parsed.path or "").rstrip("/")
    host = netloc.lower().split("@")[-1]
    if host == "api.deepseek.com" and path in ("", "/"):
        return f"{scheme}://{netloc}/v1"
    return s


def _ensure_dotenv_loaded() -> None:
    """从项目根或当前目录加载 .env（需安装 python-dotenv）。"""
    if getattr(_ensure_dotenv_loaded, "_done", False):
        return
    setattr(_ensure_dotenv_loaded, "_done", True)
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    repo_root = Path(__file__).resolve().parents[1]
    here = Path(__file__).resolve().parent
    for base in (repo_root, here, Path.cwd()):
        env_path = base / ".env"
        if env_path.is_file():
            load_dotenv(env_path, override=False)
            return


def compact_payload_for_llm(payload: dict) -> Dict[str, Any]:
    """压缩传给模型的上下文，减少 token。"""
    def _groups(gs):
        return [
            {
                "label": g.get("label"),
                "code": g.get("code"),
                "形": g.get("形"),
                "质_后两位": g.get("质_后两位"),
                "形质联结": g.get("形质联结"),
            }
            for g in gs or []
        ]

    return {
        "birth": payload.get("birth"),
        "triangle_inner_top": payload.get("triangle", {}).get("inner_top"),
        "triangle_boxes8": payload.get("triangle", {}).get("boxes8"),
        "fusion_codes_outer": payload.get("fusion_codes_outer3"),
        "fusion_labels_outer": payload.get("fusion_labels"),
        "fusion_codes_inner": payload.get("fusion_codes_inner3"),
        "fusion_labels_inner": payload.get("fusion_inner_labels"),
        "interpretation_frame": payload.get("interpretation_frame"),
        "inner_top_digit": payload.get("inner_top_digit"),
        "inner_fusion_groups": _groups(payload.get("inner_fusion_groups")),
        "outer_fusion_groups": _groups(payload.get("fusion_groups")),
        "fusion_groups": _groups(payload.get("fusion_groups")),
        "algorithm_note": payload.get("algorithm_note"),
        "disclaimer": payload.get("disclaimer"),
        "official_template_report": payload.get("personality_synthesis"),
    }


FULL_REPORT_SYSTEM_PROMPT = """你是资深性格隐喻取向工作坊里的「口述报告撰写助手」。输出一整篇给用户阅读的性格解读（不要用 JSON、不要用 Markdown 代码块）。

硬性规则（违反视为严重错误）：
1. 所有阳历生日年月日、三角形顶点底色数字、底部八位数字序列（若材料中有 triangle_boxes8）、外圈三组融合码与内圈三组融合码（每组三位）必须与输入 JSON 完全一致；禁止改任何一个数字。
2. 性格描述只能依据 JSON 里的 inner_top_digit、inner_fusion_groups、outer_fusion_groups（讲义字段：卦象节气时辰、核心物理属性、阳面、阴面）以及质_后两位里的板书摘录；禁止编造新的卦名或课堂未出现的术语。
3. 叙事层级须尊重 interpretation_frame：外圈三组多对应社会情境中的外显面貌；内圈三组均为真实自我核心——前两组为三角形内左下与右下融合码，第三组为顶点融合码（最内在）；亲密关系常以第三组为关键参照，但必须同时呼应前两组讲义内涵，不可只写第三组。
4. 可以把讲义语言转写成更易懂的口语与比喻，但不得与讲义阴阳面的基本含义相冲突。

输出结构（必须严格遵守）：
• 不要使用「1 · 纯逻辑推演」「2 · 综合性格分析」等分段标题，也不要按步骤拆解三角形、九进制算法或 boxes8 推导链路；禁止用小标题、条目清单式的「结构逻辑拆解」。
• 开头最多用 1～2 句自然叙述点明：阳历生日与顶点底色、内外圈三组码（须带上 fusion_labels / fusion_inner_labels 对应的中文情境标签），数字与码与 JSON 完全一致即可，点到为止。
• 正文为主体：用连贯散文写性格倾向、情绪与人际模式、内在张力与可能的成长线索；内外圈含义自然交织融入叙述，不要单独再开一章讲「推算逻辑」。多用「往往会」「有时会」「也可能」等弹性表述。
• 结尾单独 1～2 句：此为文化隐喻与自我觉察工具，非心理咨询诊断或命运断言。

文风：全文简体中文；温暖、克制；像面谈纪要而不是说明书。

篇幅建议：全文约 900～1400 字（开头锚定信息控制在约 80～150 字内）。"""


def generate_full_ai_report(payload: dict) -> str:
    """
    调用 OpenAI 兼容 Chat Completions API。
    环境变量（密钥按顺序取第一个非空的）：
      PERSONALITY_AI_API_KEY、OPENAI_API_KEY、DEEPSEEK_API_KEY
      PERSONALITY_AI_BASE_URL（须含路径前缀，默认 https://api.openai.com/v1）
        DeepSeek 兼容调用请用：https://api.deepseek.com/v1（代码会再拼 /chat/completions）
      PERSONALITY_AI_MODEL（默认 gpt-4o-mini；DeepSeek V4 Pro 示例：deepseek-v4-pro）

    若在仓库根目录放置 .env（已 gitignore），后端启动时会加载。
    """
    _ensure_dotenv_loaded()
    api_key = (
        os.environ.get("PERSONALITY_AI_API_KEY")
        or os.environ.get("OPENAI_API_KEY")
        or os.environ.get("DEEPSEEK_API_KEY")
    )
    if not api_key or not api_key.strip():
        raise MissingAiApiKeyError(
            "未配置 API Key：请在仓库根目录 .env 设置 PERSONALITY_AI_API_KEY、OPENAI_API_KEY 或 DEEPSEEK_API_KEY 之一"
        )

    base = normalize_openai_compatible_base(
        os.environ.get("PERSONALITY_AI_BASE_URL", "https://api.openai.com/v1")
    ).rstrip("/")
    model = os.environ.get("PERSONALITY_AI_MODEL", "gpt-4o-mini")

    compact = compact_payload_for_llm(payload)
    user_content = (
        "以下为本次测算的结构化事实（含讲义摘录与咨询报告模版正文；数字与码不可改动）：\n\n"
        + json.dumps(compact, ensure_ascii=False, indent=2)
        + "\n\n请严格按照系统提示输出：无推演分段标题、无结构逻辑拆解；以性格描述为主的连贯口述。"
        "不要输出原始 JSON。"
        "可把 official_template_report 当作素材吸收其含义，但不要照搬其条目或小标题结构。"
        "若模版与 inner_fusion_groups / outer_fusion_groups 讲义有重叠，以讲义字段为准展开细节。"
    )

    body = json.dumps(
        {
            "model": model,
            "temperature": 0.68,
            "max_tokens": 4096,
            "messages": [
                {"role": "system", "content": FULL_REPORT_SYSTEM_PROMPT},
                {"role": "user", "content": user_content},
            ],
        },
        ensure_ascii=False,
    ).encode("utf-8")

    url = f"{base}/chat/completions"
    host = urllib.parse.urlparse(base if "://" in base else f"https://{base}").netloc
    logger.info(
        "OpenAI-compatible POST %s model=%s host=%s",
        "/chat/completions",
        model,
        host or "?",
    )

    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key.strip()}",
        },
        method="POST",
    )

    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, timeout=120, context=ctx) as resp:
            raw = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"模型接口 HTTP {e.code}: {err_body}") from e
    except urllib.error.URLError as e:
        raise RuntimeError(f"模型接口网络错误：{e}") from e

    try:
        choice = raw["choices"][0]
        message = choice["message"]
    except (KeyError, IndexError, TypeError) as e:
        raise RuntimeError(f"模型返回格式异常：{raw!r}") from e

    text = _extract_assistant_text(message)
    if not text:
        raise RuntimeError(f"模型返回空正文：{raw!r}") from None
    return text


def _extract_assistant_text(message: Any) -> str:
    """兼容字符串 content、多段 content、部分厂商额外字段。"""
    if not isinstance(message, dict):
        return ""
    content = message.get("content")
    if isinstance(content, str) and content.strip():
        return content.strip()
    if isinstance(content, list):
        parts: list[str] = []
        for part in content:
            if isinstance(part, str):
                parts.append(part)
            elif isinstance(part, dict):
                if part.get("type") == "text" and isinstance(part.get("text"), str):
                    parts.append(part["text"])
                elif isinstance(part.get("content"), str):
                    parts.append(part["content"])
        joined = "".join(parts).strip()
        if joined:
            return joined
    for key in ("reasoning_content", "reasoning"):
        val = message.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    return ""


def generate_ai_narrative(payload: dict) -> str:
    """兼容旧调用：与 generate_full_ai_report 相同。"""
    return generate_full_ai_report(payload)
