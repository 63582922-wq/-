#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
性格编码：公历生日 → 三角形九进制推算 → 外侧三组融合码 + 讲义/板书依据摘录。
"""

from __future__ import annotations

import argparse
import calendar
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path


def digital_root(n: int) -> int:
    """数位根 1–9；n 必须为正整数。"""
    if n <= 0:
        raise ValueError("digital_root 仅适用于正整数")
    r = n % 9
    return 9 if r == 0 else r


def add_nine(a: int, b: int) -> int:
    """两位数字相加后的九进制归约（等价于反复数位和直至 1–9）。"""
    return digital_root(a + b)


def validate_date(y: int, m: int, d: int) -> None:
    if not (1 <= m <= 12):
        raise ValueError(f"月份无效：{m}")
    _, max_day = calendar.monthrange(y, m)
    if not (1 <= d <= max_day):
        raise ValueError(f"日期无效：{y}-{m:02d}-{d:02d}")


def eight_boxes_dd_mm_yyyy(y: int, m: int, d: int) -> list[int]:
    """底部八格：日十、日个、月十、月个、年千、年百、年十、年个（与您提供的三角稿一致）。"""
    return [
        d // 10,
        d % 10,
        m // 10,
        m % 10,
        y // 1000,
        (y // 100) % 10,
        (y // 10) % 10,
        y % 10,
    ]


@dataclass(frozen=True)
class TriangleResult:
    boxes8: tuple[int, ...]
    inner_bottom: tuple[int, int, int, int]
    inner_ml: int
    inner_mr: int
    inner_top: int
    # 外圈左列：下层两格 B₁+M左、B₂+M左，再向上归约
    outer_left_lower: int
    outer_left_upper: int
    outer_left_top: int
    # 外圈右列：B₃+M右、B₄+M右，再向上归约
    outer_right_lower: int
    outer_right_upper: int
    outer_right_top: int
    # 顶端交叉：纸面左侧旁为 M右+顶，纸面右侧旁为 M左+顶，最顶为二者归约和
    cross_page_left: int
    cross_page_right: int
    apex_outer: int

    def fusion_top_cross(self) -> tuple[int, int, int]:
        return (self.cross_page_left, self.cross_page_right, self.apex_outer)

    def fusion_outer_left_col(self) -> tuple[int, int, int]:
        return (
            self.outer_left_lower,
            self.outer_left_upper,
            self.outer_left_top,
        )

    def fusion_outer_right_col(self) -> tuple[int, int, int]:
        return (
            self.outer_right_lower,
            self.outer_right_upper,
            self.outer_right_top,
        )


def triangle_from_birth(y: int, m: int, d: int) -> TriangleResult:
    validate_date(y, m, d)
    bx = eight_boxes_dd_mm_yyyy(y, m, d)
    b = tuple(add_nine(bx[i], bx[i + 1]) for i in range(0, 8, 2))
    ml = add_nine(b[0], b[1])
    mr = add_nine(b[2], b[3])
    top = add_nine(ml, mr)

    oll = add_nine(b[0], ml)
    olu = add_nine(b[1], ml)
    olt = add_nine(oll, olu)

    orl = add_nine(b[2], mr)
    oru = add_nine(b[3], mr)
    ort = add_nine(orl, oru)

    cpl = add_nine(mr, top)
    cpr = add_nine(ml, top)
    apx = add_nine(cpl, cpr)

    return TriangleResult(
        boxes8=tuple(bx),
        inner_bottom=b,
        inner_ml=ml,
        inner_mr=mr,
        inner_top=top,
        outer_left_lower=oll,
        outer_left_upper=olu,
        outer_left_top=olt,
        outer_right_lower=orl,
        outer_right_upper=oru,
        outer_right_top=ort,
        cross_page_left=cpl,
        cross_page_right=cpr,
        apex_outer=apx,
    )


def fusion_codes_outer(tr: TriangleResult) -> list[tuple[int, int, int]]:
    """外侧三组融合码：顺序为左列｜右列｜顶端交叉，对应对外｜对内｜对下。"""
    return [
        tr.fusion_outer_left_col(),
        tr.fusion_outer_right_col(),
        tr.fusion_top_cross(),
    ]


def fusion_codes_inner(tr: TriangleResult) -> list[tuple[int, int, int]]:
    """内圈三组融合码：三角形内左下（底层左二格+M左）｜内右下（底层右二格+M右）｜顶点（M左+M右+顶）。"""
    b = tr.inner_bottom
    return [
        (b[0], b[1], tr.inner_ml),
        (b[2], b[3], tr.inner_mr),
        (tr.inner_ml, tr.inner_mr, tr.inner_top),
    ]


def pair_key(a: int, b: int) -> str:
    return f"{a}{b}"


def pair_root(a: int, b: int) -> int:
    return digital_root(a + b)


def load_knowledge(path: Path) -> dict:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def format_digit_block(kn: dict, d: int) -> list[str]:
    block = kn["digits"][str(d)]
    return [
        f"卦象·节气·时辰：{block['卦象节气时辰']}",
        f"核心物理属性：{block['核心物理属性']}",
        "阳面：" + "；".join(block["阳面"]),
        "阴面：" + "；".join(block["阴面"]),
    ]


def format_pair_block(kn: dict, a: int, b: int) -> list[str] | None:
    root = str(pair_root(a, b))
    key = pair_key(a, b)
    bucket = kn["pairs_by_root"].get(root)
    if not bucket or key not in bucket:
        return None
    info = bucket[key]
    return [
        f"两位数 {key} → 根数字 {root}（板书细分路径）",
        f"数位标签：{' / '.join(info['digit_labels'])}",
        "倾向摘录：" + "；".join(info["traits"]),
    ]


def extract_date_candidates(text: str) -> list[str]:
    """从自然语言中提取可能的 YYYY-MM-DD，按出现顺序去重。"""
    seen: set[str] = set()
    out: list[str] = []
    for m in re.finditer(
        r"\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b", text
    ):
        s = f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
        if s not in seen:
            seen.add(s)
            out.append(s)
    for m in re.finditer(r"(?<!\d)(\d{8})(?!\d)", text):
        raw = m.group(1)
        s = f"{raw[:4]}-{raw[4:6]}-{raw[6:8]}"
        if s not in seen:
            seen.add(s)
            out.append(s)
    for m in re.finditer(
        r"(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?", text
    ):
        s = f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
        if s not in seen:
            seen.add(s)
            out.append(s)
    return out


def digit_record(kn: dict, digit: int) -> dict:
    block = kn["digits"][str(digit)]
    return {
        "digit": digit,
        "卦象节气时辰": block["卦象节气时辰"],
        "核心物理属性": block["核心物理属性"],
        "阳面": block["阳面"],
        "阴面": block["阴面"],
    }


def pair_record(kn: dict, a: int, b: int) -> dict:
    """板书路径 + 是否命中九图。"""
    key = pair_key(a, b)
    root = pair_root(a, b)
    pb = format_pair_block(kn, a, b)
    if pb:
        return {"pair": key, "root": root, "lines": pb, "in_chart": True}
    return {
        "pair": key,
        "root": root,
        "lines": [
            f"相邻两位 {key} → 根数字 {root}；九张板书未单列该路径。",
            "可综合下列单数字讲义条目口述整合。",
        ],
        "in_chart": False,
        "fallback_digits": [
            digit_record(kn, a),
            digit_record(kn, b),
            digit_record(kn, root),
        ],
    }


def _zhi_preview_sentence(kn: dict, a: int, b: int) -> str:
    """后两位（质）的一句可读摘要。"""
    pb = format_pair_block(kn, a, b)
    if pb and len(pb) >= 3:
        t = pb[-1]
        return t[5:] if t.startswith("倾向摘录：") else t
    r = pair_root(a, b)
    return (
        f"路径 {pair_key(a, b)} 归约为根 {r}；板书未单列时可对照讲义数字 "
        f"{a}、{b}、{r} 三条目的阴阳面自行串联。"
    )


def compose_personality_synthesis(
    kn: dict,
    tr: TriangleResult,
    codes: list[tuple[int, int, int]],
    y: int,
    m: int,
    d: int,
) -> str:
    """
    性格编码咨询报告（简版）：咨询文书结构 + 知识库原文串联，不臆测素材外内容。
    """
    base = kn["digits"][str(tr.inner_top)]
    code_strs = [f"{a}{b}{c}" for a, b, c in codes]
    inner_codes = fusion_codes_inner(tr)
    inner_strs = [f"{a}{b}{c}" for a, b, c in inner_codes]

    lines: list[str] = []
    lines.append("性格编码咨询报告（简版）")
    lines.append("")
    lines.append("一、测评基本信息")
    lines.append(
        f"测评所用历法：公历（阳历）。出生日期：{y} 年 {m} 月 {d} 日。"
    )
    lines.append(
        f"外侧三组融合码（板书外圈；常对应不同社会角色下的外显面貌）："
        f"① {code_strs[0]}（对外 · 左列外圈）· "
        f"② {code_strs[1]}（对内 · 右列外圈）· "
        f"③ {code_strs[2]}（对下 · 顶端交叉）。"
    )
    lines.append(
        f"内圈三组融合码（三角形内部左下与右下两组融合码不可忽视）："
        f"① {inner_strs[0]}（三角形内左下融合码：底层左二格+M左）· "
        f"② {inner_strs[1]}（三角形内右下融合码：底层右二格+M右）· "
        f"③ {inner_strs[2]}（顶点融合码 M左+M右+顶——最真实、最内在）。"
    )
    lines.append(
        f"三角形内部顶点数字（常作为「底色」参考）：{tr.inner_top}。"
    )
    lines.append("")
    lines.append(
        "解读立场（板书「六、性格解码」）：外圈左 / 右 / 上三组，多理解为初入陌生场域、亲友家人场域、"
        "面向后辈或下属等情境中较易出现的社会面具或外显策略；内圈三组均为真实自我的核心结构——其中"
        "三角形内左下、右下两组融合码分别锚定基底两翼，解读时勿略过；"
        "顶点融合码（M左+M右+顶）往往最能指向最深处与亲密关系里的关键样貌，宜与左下、右下两组对照阅读。"
    )
    lines.append("")
    lines.append("二、方法与依据说明")
    lines.append(
        "本案采用课堂三角形九进制稿规则完成数位推演；文字解读仅摘录与整合《性格编码原理》"
        "讲义中之单数字阴阳面，以及九张板书所载之两位数细分路径（若有）。"
        "若某两位数路径未在板书单列，则退回至对应单数字条目作整合阅读。"
    )
    lines.append("")
    lines.append("三、核心画像（底色 · 三角形顶点）")
    lines.append(
        f"顶点数字 {tr.inner_top}，对应 {base['卦象节气时辰']}。"
        f"自然取义侧重：{base['核心物理属性']}"
    )
    lines.append("可能向外显现的资源面（讲义「阳面」摘要）：")
    for s in base["阳面"]:
        lines.append(f"　· {s}")
    lines.append("在压力或失衡时易出现的表现张力（讲义「阴面」摘要）：")
    for s in base["阴面"]:
        lines.append(f"　· {s}")
    lines.append("")
    lines.append(
        "四、内圈三组核心（真实自我：三角形内左下 / 右下两组融合码 + 顶点融合码 · 形 / 质）"
    )
    inner_titles = [
        "（1）三角形内左下融合码（底层左二格+M左）",
        "（2）三角形内右下融合码（底层右二格+M右）",
        "（3）顶点融合码（M左+M右+顶；最真实、最内在；亲密关系关键参照）",
    ]
    for title, tri in zip(inner_titles, inner_codes):
        code_s = f"{tri[0]}{tri[1]}{tri[2]}"
        x = kn["digits"][str(tri[0])]
        zhi = _zhi_preview_sentence(kn, tri[1], tri[2])
        bridge = format_pair_block(kn, tri[0], tri[1])
        lines.append(f"{title}")
        lines.append(f"　融合码：{code_s}（首位为「形」，后两位为「质」之入门读法）。")
        lines.append(
            f"　形（数字 {tri[0]}，{x['卦象节气时辰']}）："
            f"资源面含「{'；'.join(x['阳面'][:2])}」等；"
            f"张力面含「{'；'.join(x['阴面'][:2])}」等。"
        )
        lines.append(f"　质（后两位 {pair_key(tri[1], tri[2])}）：{zhi}")
        if bridge:
            lines.append(
                f"　形质联结补充（前两位 {pair_key(tri[0], tri[1])}）："
                f"{bridge[-1][5:] if bridge[-1].startswith('倾向摘录：') else bridge[-1]}"
            )
        lines.append("")

    lines.append("五、外圈三组（社会情境中的外显面貌 · 融合码形 / 质）")
    titles = [
        "（1）对外情境——左列外圈（初入陌生 / 对外交往）",
        "（2）对内情境——右列外圈（家人亲友）",
        "（3）对下情境——顶端交叉（后辈、学生或相对低位情境）",
    ]
    for idx, (title, tri) in enumerate(zip(titles, codes), start=1):
        code_s = f"{tri[0]}{tri[1]}{tri[2]}"
        x = kn["digits"][str(tri[0])]
        zhi = _zhi_preview_sentence(kn, tri[1], tri[2])
        bridge = format_pair_block(kn, tri[0], tri[1])
        lines.append(f"{title}")
        lines.append(f"　融合码：{code_s}（首位为「形」，后两位为「质」之入门读法）。")
        lines.append(
            f"　形（数字 {tri[0]}，{x['卦象节气时辰']}）："
            f"资源面含「{'；'.join(x['阳面'][:2])}」等；"
            f"张力面含「{'；'.join(x['阴面'][:2])}」等。"
        )
        lines.append(f"　质（后两位 {pair_key(tri[1], tri[2])}）：{zhi}")
        if bridge:
            lines.append(
                f"　形质联结补充（前两位 {pair_key(tri[0], tri[1])}）："
                f"{bridge[-1][5:] if bridge[-1].startswith('倾向摘录：') else bridge[-1]}"
            )
        lines.append("")

    # 六、优势 / 七、张力：从底色与内外圈「形」汇总，去重保序
    def _uniq(seq: list[str]) -> list[str]:
        seen: set[str] = set()
        out: list[str] = []
        for item in seq:
            if item not in seen:
                seen.add(item)
                out.append(item)
        return out

    adv: list[str] = []
    adv.extend(base["阳面"])
    for tri in inner_codes:
        x = kn["digits"][str(tri[0])]
        adv.extend(x["阳面"][:1])
    for tri in codes:
        x = kn["digits"][str(tri[0])]
        adv.extend(x["阳面"][:1])
    adv = _uniq(adv)
    tens: list[str] = []
    tens.extend(base["阴面"])
    for tri in inner_codes:
        x = kn["digits"][str(tri[0])]
        tens.extend(x["阴面"][:1])
    for tri in codes:
        x = kn["digits"][str(tri[0])]
        tens.extend(x["阴面"][:1])
    tens = _uniq(tens)

    lines.append("六、整合观察：可利用的心理资源（汇总提要）")
    lines.append(
        "下列条目均摘自讲义「阳面」，仅供咨询师梳理资源语言时参照，不代表已发生的客观事实。"
    )
    for s in adv:
        lines.append(f"　· {s}")
    lines.append("")
    lines.append("七、整合观察：建议在关系中留意的张力（汇总提要）")
    lines.append(
        "下列条目均摘自讲义「阴面」，用于邀请来访者自我辨认与调节，不作病理化标签。"
    )
    for s in tens:
        lines.append(f"　· {s}")
    lines.append("")
    lines.append("八、使用说明与伦理边界")
    lines.append(
        "本报告为文化隐喻框架下的自我觉察工具，供文化语境下的性格隐喻讨论参考。"
        "解读时应结合来访者自述与生活情境；数字与词条无优劣之分，阴面亦仅代表失衡时的倾向。"
    )
    lines.append(
        f"依据文献：{'；'.join(kn['meta']['sources'])}。"
    )
    return "\n".join(lines)


def finalize_report_body(core: str, appendix: str) -> str:
    """正文 + 可选附录 + 报告结束标记。"""
    if appendix.strip():
        return core + appendix + "\n—— 报告结束 ——"
    return core + "\n\n—— 报告结束 ——"


EXTENSIONS_FILE = "local_extensions.json"


def resolve_extensions_file(explicit: Path | None) -> Path | None:
    """优先使用命令行指定路径；否则使用与本模块同目录下的 local_extensions.json（若存在）。"""
    if explicit is not None:
        return explicit if explicit.is_file() else None
    default = Path(__file__).resolve().parent / EXTENSIONS_FILE
    return default if default.is_file() else None


def load_extensions_bundle(explicit: Path | None = None) -> tuple[dict, Path | None]:
    path = resolve_extensions_file(explicit)
    if path is None:
        return {}, None
    with path.open(encoding="utf-8") as f:
        raw = json.load(f)
    return (raw if isinstance(raw, dict) else {}), path


def build_fusion_group(
    kn: dict, label: str, tri: tuple[int, int, int]
) -> dict:
    """单组融合码的结构化摘录（形 / 质 / 可选形质联结）。"""
    item: dict = {
        "label": label,
        "code": f"{tri[0]}{tri[1]}{tri[2]}",
        "digits": list(tri),
        "形": digit_record(kn, tri[0]),
        "质_后两位": pair_record(kn, tri[1], tri[2]),
    }
    bridge = format_pair_block(kn, tri[0], tri[1])
    if bridge:
        item["形质联结"] = {
            "pair": pair_key(tri[0], tri[1]),
            "lines": bridge,
        }
    return item


def format_extensions_appendix(
    ext: dict,
    y: int,
    m: int,
    d: int,
    tr: TriangleResult,
    codes: list[tuple[int, int, int]],
    source_path: Path | None,
) -> tuple[str, dict]:
    """个人札记 / 案例附录；不参与改写讲义与算法。"""
    meta: dict = {"used": False, "source_path": str(source_path) if source_path else None}
    birth_iso = f"{y}-{m:02d}-{d:02d}"
    fc = [f"{a}{b}{c}" for a, b, c in codes]
    sections: list[str] = []

    gn = ext.get("general_notes") or []
    if isinstance(gn, list) and gn:
        meta["used"] = True
        sections.append("【通用手记】")
        for x in gn:
            if isinstance(x, str) and x.strip():
                sections.append(f"　· {x.strip()}")

    ll = ext.get("learning_log") or []
    if isinstance(ll, list) and ll:
        meta["used"] = True
        sections.append("")
        sections.append("【学习 / 核对日志】")
        entries: list[tuple[str, str]] = []
        for item in ll:
            if isinstance(item, dict) and item.get("text"):
                entries.append(
                    (str(item.get("date") or "").strip(), str(item["text"]).strip())
                )
            elif isinstance(item, str) and item.strip():
                entries.append(("", item.strip()))
        entries.sort(key=lambda x: x[0])
        for dt, tx in entries:
            if not tx:
                continue
            sections.append(f"　· [{dt}] {tx}" if dt else f"　· {tx}")

    digits_needed: set[int] = {tr.inner_top}
    for tri in fusion_codes_inner(tr):
        digits_needed.update(tri)
    for tri in codes:
        digits_needed.update(tri)
    dn = ext.get("digit_notes") or {}
    if isinstance(dn, dict):
        buf: list[str] = []
        for dig in sorted(digits_needed):
            notes = dn.get(str(dig))
            if isinstance(notes, list) and notes:
                buf.append(f"　数字 {dig}：")
                for note in notes:
                    if isinstance(note, str) and note.strip():
                        buf.append(f"　　— {note.strip()}")
        if buf:
            meta["used"] = True
            sections.append("")
            sections.append("【单数字补充札记】")
            sections.extend(buf)

    pairs_needed: set[str] = set()
    for tri in fusion_codes_inner(tr):
        pairs_needed.add(pair_key(tri[0], tri[1]))
        pairs_needed.add(pair_key(tri[1], tri[2]))
    for tri in codes:
        pairs_needed.add(pair_key(tri[0], tri[1]))
        pairs_needed.add(pair_key(tri[1], tri[2]))
    pn = ext.get("pair_notes") or {}
    if isinstance(pn, dict):
        buf2: list[str] = []
        for pk in sorted(pairs_needed):
            notes = pn.get(pk)
            if isinstance(notes, list) and notes:
                buf2.append(f"　路径 {pk}：")
                for note in notes:
                    if isinstance(note, str) and note.strip():
                        buf2.append(f"　　— {note.strip()}")
        if buf2:
            meta["used"] = True
            sections.append("")
            sections.append("【两位数路径补充札记】")
            sections.extend(buf2)

    raw_cases = ext.get("cases") or []
    if isinstance(raw_cases, list):
        matched: list[dict] = []
        for case in raw_cases:
            if not isinstance(case, dict):
                continue
            ok = False
            if case.get("birth") == birth_iso:
                ok = True
            elif case.get("fusion_codes") == fc:
                ok = True
            if ok:
                matched.append(case)
        if matched:
            meta["used"] = True
            sections.append("")
            sections.append("【匹配案例档案】（阳历生日或三组融合码一致即展示）")
            for case in matched:
                title = case.get("title") or "（无标题）"
                refl = str(case.get("reflection") or "").strip()
                sections.append(f"　· {title}")
                if refl:
                    for line in refl.split("\n"):
                        sections.append(f"　　 {line}")

    if not meta["used"]:
        return "", meta

    header = (
        "\n\n附录 · 本地累积（个人札记 / 案例）\n"
        "说明：以下内容来自 local_extensions.json，非《性格编码原理》原文；"
        "用于沉淀例子与口述心得，不参与改写三角形算法与官方词条。\n"
    )
    body = "\n".join(sections)
    return header + body + "\n", meta


def build_web_payload(y: int, m: int, d: int, kn: dict) -> dict:
    """供 Web / 智能体调用的结构化结果（含三角形、三组码、分项释义）。"""
    tr = triangle_from_birth(y, m, d)
    codes = fusion_codes_outer(tr)
    inner_codes = fusion_codes_inner(tr)
    ctx_labels = [
        "对外（左列外圈）",
        "对内（右列外圈）",
        "对下（顶端交叉）",
    ]
    inner_labels = [
        "内圈·左下融合码（底层左二格+M左）",
        "内圈·右下融合码（底层右二格+M右）",
        "内圈·顶点融合码（M左+M右+顶·最真实内在）",
    ]
    groups = [build_fusion_group(kn, ctx_labels[i], codes[i]) for i in range(3)]
    inner_groups = [
        build_fusion_group(kn, inner_labels[i], inner_codes[i]) for i in range(3)
    ]

    syn_core = compose_personality_synthesis(kn, tr, codes, y, m, d)
    ext, ext_path = load_extensions_bundle(None)
    appx, ext_meta = format_extensions_appendix(ext, y, m, d, tr, codes, ext_path)
    synthesis = finalize_report_body(syn_core, appx)

    assistant_reply = (
        f"已根据阳历 {y} 年 {m} 月 {d} 日完成三角形九进制推算。\n\n"
        f"三角形顶点（底色）：{tr.inner_top}\n"
        f"内圈三组（含三角形内左下、右下与顶点三组融合码；第三组为最内在）：① {inner_groups[0]['code']} · "
        f"② {inner_groups[1]['code']} · ③ {inner_groups[2]['code']}\n"
        f"外圈三组（社会情境外显）：① {groups[0]['code']}（对外）· "
        f"② {groups[1]['code']}（对内）· ③ {groups[2]['code']}（对下）\n\n"
        "释义来源：《性格编码原理》单数字阴阳面 + 板书两位数细分表。\n\n"
        + synthesis
    )

    return {
        "birth": {"y": y, "m": m, "d": d},
        "triangle": {
            "boxes8": list(tr.boxes8),
            "inner_bottom": list(tr.inner_bottom),
            "inner_mid_lr": [tr.inner_ml, tr.inner_mr],
            "inner_top": tr.inner_top,
            "outer_left_col": [
                tr.outer_left_lower,
                tr.outer_left_upper,
                tr.outer_left_top,
            ],
            "outer_right_col": [
                tr.outer_right_lower,
                tr.outer_right_upper,
                tr.outer_right_top,
            ],
            "top_cross_page_lr": [tr.cross_page_left, tr.cross_page_right],
            "apex_outer": tr.apex_outer,
        },
        "fusion_codes_outer3": [
            groups[0]["code"],
            groups[1]["code"],
            groups[2]["code"],
        ],
        "fusion_codes_inner3": [
            inner_groups[0]["code"],
            inner_groups[1]["code"],
            inner_groups[2]["code"],
        ],
        "fusion_labels": ctx_labels,
        "fusion_inner_labels": inner_labels,
        "inner_top_digit": digit_record(kn, tr.inner_top),
        "fusion_groups": groups,
        "inner_fusion_groups": inner_groups,
        "interpretation_frame": (
            "外圈左 / 右 / 上（对外 / 对内 / 对下）多为社会角色下的外显面貌。"
            "内圈三组均为真实自我核心：三角形内左下、右下两组融合码分别对应底层左二格+M左、底层右二格+M右，解读时勿忽略；"
            "顶点融合码（M左+M右+顶）最接近最深处，常为亲密关系解读的关键参照，宜与左下、右下两组对照。"
        ),
        "sources": kn["meta"]["sources"],
        "algorithm_note": kn["meta"]["algorithm_note"],
        "disclaimer": kn["meta"]["disclaimer"],
        "personality_synthesis": synthesis,
        "assistant_reply": assistant_reply,
        "local_extensions": {
            "loaded": bool(ext_meta.get("used")),
            "source_path": ext_meta.get("source_path"),
        },
    }


def build_report(
    kn: dict,
    y: int,
    m: int,
    d: int,
    json_out: bool = False,
    extensions_explicit: Path | None = None,
) -> str | dict:
    tr = triangle_from_birth(y, m, d)
    codes = fusion_codes_outer(tr)

    if json_out:
        return {
            "birth": {"y": y, "m": m, "d": d},
            "triangle": {
                "boxes8": list(tr.boxes8),
                "inner_bottom": list(tr.inner_bottom),
                "inner_mid_lr": [tr.inner_ml, tr.inner_mr],
                "inner_top": tr.inner_top,
                "outer_left_col": [
                    tr.outer_left_lower,
                    tr.outer_left_upper,
                    tr.outer_left_top,
                ],
                "outer_right_col": [
                    tr.outer_right_lower,
                    tr.outer_right_upper,
                    tr.outer_right_top,
                ],
                "top_cross_page_lr": [tr.cross_page_left, tr.cross_page_right],
                "apex_outer": tr.apex_outer,
            },
            "fusion_codes_outer3": [
                "".join(map(str, codes[0])),
                "".join(map(str, codes[1])),
                "".join(map(str, codes[2])),
            ],
            "fusion_labels": [
                "对外（左列外圈）",
                "对内（右列外圈）",
                "对下（顶端交叉）",
            ],
            "fusion_codes_inner3": [
                "".join(map(str, x))
                for x in fusion_codes_inner(tr)
            ],
            "fusion_inner_labels": [
                "内圈·左下融合码（底层左二格+M左）",
                "内圈·右下融合码（底层右二格+M右）",
                "内圈·顶点融合码（M左+M右+顶·最真实内在）",
            ],
            "sources": kn["meta"]["sources"],
            "algorithm_note": kn["meta"]["algorithm_note"],
        }

    lines: list[str] = []
    lines.append("══ 性格编码测算（三角形九进制稿）══")
    lines.append(f"出生日期：{y} 年 {m} 月 {d} 日（公历）")
    lines.append("")
    lines.append("── 依据来源 ──")
    for s in kn["meta"]["sources"]:
        lines.append(f"• {s}")
    lines.append(f"• {kn['meta']['algorithm_note']}")
    lines.append("")
    lines.append("── 底部八位（日日月月年年年年，从左到右）──")
    lines.append(" ".join(str(x) for x in tr.boxes8))
    lines.append("")
    lines.append("── 三角形内部（两两相加并九进制归约）──")
    lines.append(
        f"底层（四格）：{' '.join(str(x) for x in tr.inner_bottom)}"
        f"  （由相邻两格相加）"
    )
    lines.append(f"中层（两格）：{tr.inner_ml} {tr.inner_mr}")
    lines.append(f"顶点（一格）：{tr.inner_top}")
    lines.append("")
    lines.append("── 三角形外圈（九进制）──")
    lines.append(
        f"左列（先 B₁+M左→{tr.outer_left_lower}，再 B₂+M左→{tr.outer_left_upper}，"
        f"二者相加→{tr.outer_left_top}）"
    )
    lines.append(
        f"右列（先 B₃+M右→{tr.outer_right_lower}，再 B₄+M右→{tr.outer_right_upper}，"
        f"二者相加→{tr.outer_right_top}）"
    )
    lines.append(
        f"顶端交叉（纸左旁 M右+顶→{tr.cross_page_left}，纸右旁 M左+顶→{tr.cross_page_right}，"
        f"最顶→{tr.apex_outer}）"
    )
    inner_cli = fusion_codes_inner(tr)
    marks_i = ["①", "②", "③"]
    inner_tags = [
        "三角形内左下融合码（底层左二格+M左）",
        "三角形内右下融合码（底层右二格+M右）",
        "顶点融合码（M左+M右+顶）",
    ]
    lines.append("")
    lines.append("── 内圈三组融合码（真实自我 · 亲密关系主轴）──")
    for i, tri in enumerate(inner_cli):
        lines.append(
            f"{marks_i[i]} {inner_tags[i]}：{tri[0]}-{tri[1]}-{tri[2]} "
            f"（写作 {tri[0]}{tri[1]}{tri[2]}）"
        )
    lines.append("")
    lines.append("── 外圈三组融合码（社会情境中的外显面貌）──")
    outer_tags = [
        "左列外圈（对外）",
        "右列外圈（对内）",
        "顶端交叉（对下）",
    ]
    for i, tri in enumerate(codes):
        lines.append(
            f"{marks_i[i]} {outer_tags[i]}：{tri[0]}-{tri[1]}-{tri[2]} "
            f"（写作 {tri[0]}{tri[1]}{tri[2]}）"
        )

    lines.append("")
    lines.append("── 性格编码咨询报告（简版） ──")
    syn_core = compose_personality_synthesis(kn, tr, codes, y, m, d)
    ext, ext_path = load_extensions_bundle(extensions_explicit)
    appx, _ext_meta = format_extensions_appendix(ext, y, m, d, tr, codes, ext_path)
    lines.append(finalize_report_body(syn_core, appx))
    lines.append("")
    lines.append("── 结论（结构化摘录，便于复述给来访者） ──")

    lines.append("【总体底色】")
    lines.extend(format_digit_block(kn, tr.inner_top))
    lines.append(
        f"依据：《性格编码原理》三角形顶点数字 {tr.inner_top} 的阴阳两面与自然取义。"
    )

    lines.append("")
    inner_triples = fusion_codes_inner(tr)
    inner_ctx = [
        "内圈·左下融合码（底层左二格+M左）",
        "内圈·右下融合码（底层右二格+M右）",
        "内圈·顶点融合码（M左+M右+顶·最真实内在）",
    ]
    lines.append("【内圈三组：真实自我 · 亲密关系主轴】")
    for i in range(3):
        tri = inner_triples[i]
        lines.append(f"— {inner_ctx[i]}：融合码 {tri[0]}{tri[1]}{tri[2]} —")
        lines.append(f"形（首位 {tri[0]}）— 《性格编码原理》摘录：")
        lines.extend(format_digit_block(kn, tri[0]))
        lines.append("质（后两位动机关联，板书两位数路径）：")
        pb = format_pair_block(kn, tri[1], tri[2])
        if pb:
            lines.extend(pb)
            lines.append(
                f"依据：板书根数字 {pair_root(tri[1], tri[2])} 路径 {pair_key(tri[1], tri[2])}。"
            )
        else:
            pr = pair_root(tri[1], tri[2])
            lines.append(
                f"相邻两位 {pair_key(tri[1], tri[2])} → 根数字 {pr}。"
                "九张板书未单独列出该两位数路径；依据来源仍为《性格编码原理》单数字条目，可作整合口径："
            )
            lines.append(
                f"  • {tri[1]}：{kn['digits'][str(tri[1])]['卦象节气时辰']}"
            )
            lines.append(
                f"  • {tri[2]}：{kn['digits'][str(tri[2])]['卦象节气时辰']}"
            )
            lines.append(f"  • 根 {pr}：{kn['digits'][str(pr)]['卦象节气时辰']}")
        pa = format_pair_block(kn, tri[0], tri[1])
        if pa:
            lines.append(
                f"补充：前两位 {pair_key(tri[0], tri[1])}（形与质首位联结，板书路径）"
            )
            lines.extend(pa)

    lines.append("")
    lines.append("【外圈三组：对外 / 对内 / 对下（面具与外显策略参考）】")
    lines.append(
        "说明：① 三角左侧外缘列自下而上归约（对外）；"
        "② 三角右侧外缘列自下而上归约（对内）；"
        "③ 顶端交叉三位（对下）。与您手绘大图步骤一致。"
    )
    ctx = [
        "对外（左列外圈）",
        "对内（右列外圈）",
        "对下（顶端交叉）",
    ]
    for i in range(3):
        tri = codes[i]
        lines.append(f"— {ctx[i]}：融合码 {tri[0]}{tri[1]}{tri[2]} —")
        lines.append(f"形（首位 {tri[0]}）— 《性格编码原理》摘录：")
        lines.extend(format_digit_block(kn, tri[0]))
        lines.append("质（后两位动机关联，板书两位数路径）：")
        pb = format_pair_block(kn, tri[1], tri[2])
        if pb:
            lines.extend(pb)
            lines.append(
                f"依据：板书根数字 {pair_root(tri[1], tri[2])} 路径 {pair_key(tri[1], tri[2])}。"
            )
        else:
            pr = pair_root(tri[1], tri[2])
            lines.append(
                f"相邻两位 {pair_key(tri[1], tri[2])} → 根数字 {pr}。"
                "九张板书未单独列出该两位数路径；依据来源仍为《性格编码原理》单数字条目，可作整合口径："
            )
            lines.append(
                f"  • {tri[1]}：{kn['digits'][str(tri[1])]['卦象节气时辰']}"
            )
            lines.append(
                f"  • {tri[2]}：{kn['digits'][str(tri[2])]['卦象节气时辰']}"
            )
            lines.append(f"  • 根 {pr}：{kn['digits'][str(pr)]['卦象节气时辰']}")
        pa = format_pair_block(kn, tri[0], tri[1])
        if pa:
            lines.append(
                f"补充：前两位 {pair_key(tri[0], tri[1])}（形与质首位联结，板书路径）"
            )
            lines.extend(pa)

    lines.append("")
    lines.append(f"── {kn['meta']['disclaimer']} ──")

    return "\n".join(lines)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="公历生日 → 三角形九进制 → 外侧三组融合码")
    p.add_argument("date", help="生日：YYYY-MM-DD 或 YYYYMMDD")
    p.add_argument("--json", action="store_true", help="输出 JSON")
    p.add_argument(
        "--knowledge",
        type=Path,
        default=Path(__file__).resolve().parent / "knowledge.json",
        help="知识库路径",
    )
    p.add_argument(
        "--extensions",
        type=Path,
        default=None,
        help="本地札记 JSON；不设则自动读取同目录 local_extensions.json（若存在）",
    )
    p.add_argument(
        "--narrate",
        action="store_true",
        help="在全文末尾追加 AI 口述分析（需环境变量 PERSONALITY_AI_API_KEY 等）",
    )
    p.add_argument(
        "--ai-report-only",
        action="store_true",
        help="仅输出 AI 口述分析，不打印模版全文（需 API Key；与 --json 互斥）",
    )
    return p.parse_args()


def _generate_ai_narrative(payload: dict) -> str:
    try:
        from personality_encoder.ai_narrative import generate_ai_narrative
    except ImportError:
        from ai_narrative import generate_ai_narrative
    return generate_ai_narrative(payload)


def parse_date(s: str) -> tuple[int, int, int]:
    s = s.strip().replace("/", "-")
    if len(s) == 8 and s.isdigit():
        y, m, d = int(s[:4]), int(s[4:6]), int(s[6:8])
        return y, m, d
    parts = s.split("-")
    if len(parts) != 3:
        raise ValueError("日期格式应为 YYYY-MM-DD 或 YYYYMMDD")
    y, m, d = int(parts[0]), int(parts[1]), int(parts[2])
    return y, m, d


def main() -> None:
    args = parse_args()
    if args.narrate and args.ai_report_only:
        print(
            "错误：请勿同时使用 --narrate 与 --ai-report-only",
            file=sys.stderr,
        )
        sys.exit(2)
    if args.ai_report_only and args.json:
        print(
            "错误：--ai-report-only 与 --json 不能同时使用",
            file=sys.stderr,
        )
        sys.exit(2)
    try:
        y, m, d = parse_date(args.date)
        kn = load_knowledge(args.knowledge)
    except Exception as e:
        print(f"错误：{e}", file=sys.stderr)
        sys.exit(1)

    if args.ai_report_only:
        payload = build_web_payload(y, m, d, kn)
        try:
            print(_generate_ai_narrative(payload))
        except ImportError as e:
            print(f"错误：{e}", file=sys.stderr)
            sys.exit(1)
        except Exception as e:
            print(f"错误：{e}", file=sys.stderr)
            sys.exit(1)
        return

    try:
        out = build_report(
            kn,
            y,
            m,
            d,
            json_out=args.json,
            extensions_explicit=args.extensions,
        )
        if args.json:
            print(json.dumps(out, ensure_ascii=False, indent=2))
        else:
            print(out)
        if args.narrate:
            try:
                payload = build_web_payload(y, m, d, kn)
                print("\n\n── AI 口述分析报告 ──\n")
                print(_generate_ai_narrative(payload))
            except ImportError as e:
                print(f"\n（AI 口述不可用：{e}）", file=sys.stderr)
            except Exception as e:
                print(f"\n（AI 口述生成失败：{e}）", file=sys.stderr)
    except Exception as e:
        print(f"错误：{e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
