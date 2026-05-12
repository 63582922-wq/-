"""
调用 OpenAI 兼容接口，基于结构化测算 JSON 生成连贯的性格解读口述（以描述为主，不要求分段推演拆解）。
不参与改写数字与推演；仅基于给定 JSON 组织语言。
"""

from __future__ import annotations

import json
import logging
import os
import re
import urllib.parse
import ssl
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List

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


def compact_payload_for_llm(
    payload: dict, *, include_official_template: bool = True
) -> Dict[str, Any]:
    """压缩传给模型的上下文，减少 token。"""
    def _short_label(x: Any) -> Any:
        if not isinstance(x, str):
            return x
        s = x.strip()
        if "（" in s:
            s = s.split("（", 1)[0].strip()
        if "(" in s:
            s = s.split("(", 1)[0].strip()
        return s

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

    outer_labels = [_short_label(x) for x in (payload.get("fusion_labels") or [])]
    inner_labels = ["内核一", "内核二", "内核三"]

    out: Dict[str, Any] = {
        "birth": payload.get("birth"),
        "triangle_inner_top": payload.get("triangle", {}).get("inner_top"),
        "triangle_boxes8": payload.get("triangle", {}).get("boxes8"),
        "fusion_codes_outer": payload.get("fusion_codes_outer3"),
        "fusion_labels_outer": outer_labels,
        "fusion_codes_inner": payload.get("fusion_codes_inner3"),
        "fusion_labels_inner": inner_labels,
        "interpretation_frame": payload.get("interpretation_frame"),
        "inner_top_digit": payload.get("inner_top_digit"),
        "inner_fusion_groups": _groups(payload.get("inner_fusion_groups")),
        "outer_fusion_groups": _groups(payload.get("fusion_groups")),
        "fusion_groups": _groups(payload.get("fusion_groups")),
        "disclaimer": payload.get("disclaimer"),
    }
    if include_official_template:
        out["official_template_report"] = payload.get("personality_synthesis")
    return out


FULL_REPORT_SYSTEM_PROMPT = """
你是一名在线心理咨询的“咨询师助理”。输出对象是咨询师本人：帮助咨询师快速理解本系统的测算结果与结构化含义，用于辅助评估与沟通（不是长篇故事、不是科普、不要赘述）。

【绝对禁令】
1) 绝对不要出现任何“左圈、右圈、内圈、顶点、底色、形质、数位、九进制、归约、三角”等算法或排布词。
2) 不要把 JSON 字段名、snake_case、英文键名写进正文；不要输出 Markdown 或代码块。
3) 不要写成文学散文或长篇心理小作文；不做诊断、不贴病理标签，用“可能/常见/在压力下容易”等表述。

【输出格式（按以下顺序；不要用 A/B/C；不要写“咨询师该怎么问”）】
1) 一句话总览（30–60 字）：概括此人的核心动力与常见风格。
2) 对外（工作/陌生社交）：
   - 顺的时候：2–3 句（可观察行为）
   - 紧的时候（压力大时）：1–2 句（容易走偏到哪里）
   - 例子（工作场景）：用 4 句写清楚【触发情境→典型反应→他人感受/误会点→更顺的替代表现】。
3) 对内（伴侣/家人/亲密关系）：同上（含 1 个家庭/亲密场景例子）。
4) 对下（带新人/下属/孩子/后辈）：同上（含 1 个带人场景例子）。
5) 三组内核对照（短语版）：用 3 行列出“内核一/内核二/内核三”各自的关键词（每行 ≤ 10 字）。
6) 优势（好用的长处）：3–5 条（每条一句，偏行为与沟通层面的可用点）。
7) 容易卡住的点（踩坑点）：3–5 条（每条一句，偏行为与关系层面的风险点）。
8) 结语一句（≤ 20 字）：温和收束。

【篇幅与语言】
总字数控制在 600–900 字；分段清楚，句子短，信息密度高，适合在线咨询快速阅读与复述。
"""


FOLLOWUP_SYSTEM_PROMPT = """你是在线心理咨询的“咨询师助理”。用户已看过首轮的「咨询速用稿」，现在继续追问。

【事实约束】
系统消息里的测算材料中的生日、融合码、中文标签须保持一致，不得编造新材料或改码。

【回答方式】
只针对用户最后一条里的问题作答，默认 4–10 句以内，给结构化解释与要点归纳，可用 1 个小例子帮助理解，但不要长篇赘述。
不要整篇重写首轮速用稿，除非用户明确要求再总结一遍；不要输出写作计划、字数说明或对系统说明的复述；不要输出 Markdown 或代码块。

【材料使用】
材料仅供核对事实；用你自己的话简要回应，不要把材料整段贴回。"""


FULL_REPORT_SYSTEM_PROMPT_EN = """You are a writing assistant for a metaphor-based personality encoding workshop. Using the structured materials provided next, write a short **personality sketch** for the reader, entirely in **English**.

【What to write】
Clear, readable prose (one or a few short paragraphs; not a numbered checklist). Summarize temperament and relational tendencies. The Gregorian birth date, triangle apex fill digit, outer-ring three fusion codes with their **exact English labels** from the JSON, and inner-ring three codes with labels must appear **naturally in the text and must match the materials exactly** (digits and codes cannot change; copy labels verbatim from the JSON). You may weave in “bright side / shadow side” meanings from the lecture notes without mechanically labeling every line. If an interpretation-frame paragraph exists, absorb it into prose—do not paste it wholesale. Do **not** insert extra Chinese labels beyond what already appears inside quoted lecture excerpts, if any.

【Do not】
Put raw JSON keys, snake_case identifiers, or English field names in the user-facing text; no Markdown or code blocks; no “according to the prompt” meta; no invented codes; no numbered lists like 1.2.3.

【Length & tone】
About 300–600 English words; warm and measured; use “often / sometimes / may” when uncertain. Close naturally; no mandatory stock closing line."""


FOLLOWUP_SYSTEM_PROMPT_EN = """You are the same workshop’s dialogue assistant. The user has read an initial personality sketch; they are asking follow-up questions.

【Facts】
Birth date, fusion codes, and labels in the materials must stay consistent; do not invent new codes or change the birth date.

【How to answer】
Respond only to the user’s latest message, in natural spoken English—usually a few sentences to a short paragraph unless they ask for more.
Do not rewrite the entire first sketch unless they explicitly ask for a recap. No planning meta, word counts, or Markdown.

【Language】
Earlier chat turns may be in Chinese; **your reply must be in English only.**

【Materials】
Use them to check facts; do not dump the raw JSON back to the user—answer in your own words."""


def _openai_compatible_chat(
    *,
    messages: List[Dict[str, Any]],
    max_tokens: int,
    temperature: float,
) -> str:
    """调用 OpenAI 兼容 Chat Completions，返回 assistant 正文。"""
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

    body = json.dumps(
        {
            "model": model,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "messages": messages,
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


def _remove_ascii_parentheticals(text: str) -> str:
    """去掉含英文或下划线的全角/半角括号说明。"""
    t = text or ""
    for _ in range(32):
        n = re.sub(r"（[^）]*[A-Za-z_][^）]*）", "", t)
        n = re.sub(r"\([^)]*[A-Za-z_][^)]*\)", "", n)
        if n == t:
            break
        t = n
    return t


def _drop_meta_instruction_lines(text: str) -> str:
    """去掉模型误输出的「教案目录」行（勿误删含码的要点行）。"""
    skip_starts = (
        "第二至四行",
        "第五至七行",
        "然后，若",
        "然后若",
        "每行格式",
        "倾向需要从",
        "倾向提取",
        "外圈标签和码",
        "内圈标签和码",
        "注意要",
        "若有interpretation",
        "材料中有较长",
    )
    out: list[str] = []
    for ln in (text or "").splitlines():
        s = ln.strip()
        if not s:
            continue
        if s.startswith("最后一行") and "此为文化隐喻与自我觉察参考" in s:
            i = s.find("此为文化隐喻与自我觉察参考")
            out.append(s[i:].rstrip())
            continue
        if s.startswith("最后一行") and "此为文化隐喻与自我觉察参考" not in s:
            continue
        if any(s.startswith(p) for p in skip_starts):
            continue
        if re.match(r"^对于\d{3}", s):
            continue
        out.append(ln.rstrip())
    return "\n".join(out).strip()


def _prefer_clean_first_sentence_block(text: str) -> str:
    """若出现「所以第…行：」后接正常要点，优先保留从该要点起的内容。"""
    t = (text or "").strip()
    if not t:
        return t
    m = re.search(r"所以第[一二三四五六七八九十\d]+行[：:]\s*(\d{4}年)", t)
    if m:
        return t[m.start(1) :].strip()
    return t


def _strip_leading_cot_from_report(text: str) -> str:
    """从首处完整公历「YYYY年M月D日」起截断（去掉其前的元叙述）。"""
    t = (text or "").strip()
    if not t:
        return t
    m = re.search(r"\d{4}年\d{1,2}月\d{1,2}日", t)
    if m:
        return t[m.start() :].strip()
    m2 = re.search(r"\d{4}[-/.．]\s*\d{1,2}[-/.．]\s*\d{1,2}", t)
    if m2:
        return t[m2.start() :].strip()
    return t


def _sanitize_full_report_output(text: str) -> str:
    """首轮个性简述：去英文括注、删明显教案式行；若有固定收束句则截断其后。"""
    t = _remove_ascii_parentheticals(text)
    t = _drop_meta_instruction_lines(t)
    t = _prefer_clean_first_sentence_block(t)
    t = _strip_leading_cot_from_report(t)
    if "此为文化隐喻与自我觉察参考" in t:
        t = _strip_trailing_after_disclaimer_line(t)
    return t.strip()


def _strip_trailing_after_disclaimer_line(text: str) -> str:
    """收束句之后若模型继续推演，一律截断。"""
    lines = text.splitlines()
    out: list[str] = []
    for ln in lines:
        out.append(ln)
        if "此为文化隐喻与自我觉察参考" in ln:
            break
    return "\n".join(out).strip() if out else text.strip()


def generate_full_ai_report(payload: dict, *, locale: str = "zh") -> str:
    """
    调用 OpenAI 兼容 Chat Completions API。
    环境变量（密钥按顺序取第一个非空的）：
      PERSONALITY_AI_API_KEY、OPENAI_API_KEY、DEEPSEEK_API_KEY
      PERSONALITY_AI_BASE_URL（须含路径前缀，默认 https://api.openai.com/v1）
        DeepSeek 兼容调用请用：https://api.deepseek.com/v1（代码会再拼 /chat/completions）
      PERSONALITY_AI_MODEL（默认 gpt-4o-mini；DeepSeek V4 Pro 示例：deepseek-v4-pro）

    若在仓库根目录放置 .env（已 gitignore），后端启动时会加载。
    """
    is_en = (locale or "zh").lower().startswith("en")
    compact = compact_payload_for_llm(payload, include_official_template=False)
    if is_en:
        user_content = (
            "Structured facts for this reading (digits, codes, and labels must not be changed):\n\n"
            + json.dumps(compact, ensure_ascii=False, indent=2)
            + "\n\nFollow the system prompt and write the personality sketch in **English only**."
            " Do not echo JSON field names; no meta preface."
        )
        system = FULL_REPORT_SYSTEM_PROMPT_EN
    else:
        user_content = (
            "以下为本次测算的结构化事实（数字、码、中文标签不可改动）：\n\n"
            + json.dumps(compact, ensure_ascii=False, indent=2)
            + "\n\n请只按系统提示写一段「个性简述」正文；不要复述本段里的英文键名，不要任何说明性前缀。"
        )
        system = FULL_REPORT_SYSTEM_PROMPT
    raw = _openai_compatible_chat(
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user_content},
        ],
        max_tokens=1200,
        temperature=0.45,
    )
    return _sanitize_full_report_output(raw) if not is_en else _sanitize_full_report_output_en(raw)


def _sanitize_full_report_output_en(text: str) -> str:
    """English sketch: strip ASCII parenthetical junk; keep body (Chinese disclaimer unlikely)."""
    t = _remove_ascii_parentheticals(text)
    return t.strip()


def generate_followup_reply(
    payload: dict,
    history: List[Dict[str, str]],
    user_message: str,
    *,
    locale: str = "zh",
) -> str:
    """
    多轮追问：history 为不含当前句的 prior 对话（user/assistant 交替内容）；
    user_message 为当前用户输入。测算 JSON 放在 system 内，避免与首轮「user+JSON」雷同诱发复读。
    """
    is_en = (locale or "zh").lower().startswith("en")
    compact = compact_payload_for_llm(payload, include_official_template=False)
    facts_json = json.dumps(compact, ensure_ascii=False, indent=2)
    if is_en:
        system_block = (
            FOLLOWUP_SYSTEM_PROMPT_EN
            + "\n\n[Internal reference materials only; do not paste as a report or repeat the first sketch verbatim.]\n"
            + facts_json
        )
    else:
        system_block = (
            FOLLOWUP_SYSTEM_PROMPT
            + "\n\n【以下为仅供你内部参照的测算材料；勿照抄成报告体，勿整篇重复首轮个性简述】\n"
            + facts_json
        )
    msgs: List[Dict[str, Any]] = [{"role": "system", "content": system_block}]
    max_hist = 24
    tail = history[-max_hist:] if len(history) > max_hist else history
    for turn in tail:
        role = turn.get("role")
        content = (turn.get("content") or "").strip()
        if role not in ("user", "assistant") or not content:
            continue
        msgs.append({"role": role, "content": content})
    um = (user_message or "").strip()
    if not um:
        raise ValueError("follow-up user_message 为空")
    msgs.append({"role": "user", "content": um})
    raw = _openai_compatible_chat(
        messages=msgs,
        max_tokens=900,
        temperature=0.72,
    )
    return _sanitize_full_report_output_en(raw) if is_en else raw.strip()


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
