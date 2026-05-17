/**
 * 三角图点击 → 看板：与 encode.build_visualization_payload 逐步融合一致。
 * 术语与 fusion-terms.ts、GroupCard（质_前两位 / 形）相同，勿另造「来源/演化」标题。
 */
import type { TriangleData } from "./TriangleVisualizer";
import staticDigitLexicon from "./digit-lexicon.json";
import { fusionClickHint, type FusionLocale } from "./fusion-terms";

/** 与 personality_encoder/knowledge.json digits 1–9 同步；看板「N核心」始终可查 */
const STATIC_DIGIT_LEXICON: Map<number, DigitLecture> = new Map(
  Object.entries(staticDigitLexicon as Record<string, DigitLecture>).map(([k, v]) => [
    Number(k),
    { ...v, digit: Number(k) },
  ]),
);

export type TriangleNodePart = "result" | "a" | "b";

export type TriangleNodeSelection = {
  nodeId: string;
  part: TriangleNodePart;
};

export type DigitLecture = {
  digit: number;
  卦象节气时辰?: string;
  核心物理属性?: string;
  阳面?: string[];
  阴面?: string[];
};

/** 看板「N核心」：讲义原文连贯展示，不再重复「卦象·节气·时辰」等字段名 */
export function formatDigitCoreProse(block: DigitLecture): string {
  const chunks: string[] = [];
  if (block.卦象节气时辰?.trim()) chunks.push(block.卦象节气时辰.trim());
  if (block.核心物理属性?.trim()) chunks.push(block.核心物理属性.trim());
  const yang = (block.阳面 ?? []).map((s) => s.trim()).filter(Boolean);
  const yin = (block.阴面 ?? []).map((s) => s.trim()).filter(Boolean);
  if (yang.length) chunks.push(yang.join("；"));
  if (yin.length) chunks.push(yin.join("；"));
  if (!chunks.length) return "";
  const body = chunks.join("。");
  return /[。；！？.!?]$/.test(body) ? body : `${body}。`;
}

export function hasDigitCoreContent(block: DigitLecture | undefined | null): boolean {
  if (!block) return false;
  return Boolean(
    block.卦象节气时辰?.trim() ||
      block.核心物理属性?.trim() ||
      (block.阳面?.length ?? 0) > 0 ||
      (block.阴面?.length ?? 0) > 0,
  );
}

export function pickDigitBlock(
  digit: number,
  block: DigitLecture | undefined,
  lexicon: Map<number, DigitLecture>,
): DigitLecture | undefined {
  if (hasDigitCoreContent(block)) return block;
  const fromLex = lexicon.get(digit) ?? STATIC_DIGIT_LEXICON.get(digit);
  if (hasDigitCoreContent(fromLex)) return fromLex;
  return block ?? fromLex;
}

function collectVisualizationNodes(data: TriangleData): VisualPairDetail[] {
  return [
    ...data.inner_bottom,
    ...data.inner_mid,
    data.inner_top,
    ...data.outer_left,
    ...data.outer_right,
    ...data.top_cross,
    data.apex_outer,
  ].filter(Boolean) as VisualPairDetail[];
}

/** 从 payload 汇总 1–9 单数字讲义，供看板在旧缓存缺字段时回退 */
export function buildDigitLexicon(payload: {
  digit_lexicon?: Record<string, DigitLecture>;
  inner_top_digit?: DigitLecture;
  fusion_groups?: Array<{
    形?: DigitLecture;
    质_a?: DigitLecture;
    质_b?: DigitLecture;
    质_前两位?: { fallback_digits?: DigitLecture[] };
  }>;
  inner_fusion_groups?: Array<{
    形?: DigitLecture;
    质_a?: DigitLecture;
    质_b?: DigitLecture;
    质_前两位?: { fallback_digits?: DigitLecture[] };
  }>;
  visualization?: TriangleData | null;
} | null): Map<number, DigitLecture> {
  const map = new Map<number, DigitLecture>(STATIC_DIGIT_LEXICON);
  if (!payload) return map;
  const put = (block?: DigitLecture | null) => {
    if (!block || typeof block.digit !== "number") return;
    if (hasDigitCoreContent(block)) map.set(block.digit, block);
  };
  if (payload.digit_lexicon) {
    for (const block of Object.values(payload.digit_lexicon)) put(block);
  }
  put(payload.inner_top_digit);
  for (const g of [
    ...(payload.fusion_groups ?? []),
    ...(payload.inner_fusion_groups ?? []),
  ]) {
    put(g.形);
    put(g.质_a);
    put(g.质_b);
    g.质_前两位?.fallback_digits?.forEach(put);
  }
  if (payload.visualization) {
    for (const node of collectVisualizationNodes(payload.visualization)) {
      put(node.result_record);
      node.source_records?.forEach(put);
    }
  }
  return map;
}

type VisualPairDetail = NonNullable<TriangleData["inner_top"]>;

export type FusionTripleView = {
  zhiA: number;
  zhiB: number;
  xing: number;
  code: string;
  blockA?: DigitLecture;
  blockB?: DigitLecture;
  blockXing?: DigitLecture;
  board: VisualPairDetail;
};

export function selectionEquals(
  a: TriangleNodeSelection | null | undefined,
  b: TriangleNodeSelection | null | undefined,
): boolean {
  if (!a || !b) return !a && !b;
  return a.nodeId === b.nodeId && a.part === b.part;
}

/** 再点同一格则取消选中 */
export function toggleTriangleSelection(
  current: TriangleNodeSelection | null,
  next: TriangleNodeSelection,
): TriangleNodeSelection | null {
  if (selectionEquals(current, next)) return null;
  return next;
}

export function nodePositionLabel(
  nodeId: string,
  locale: "zh" | "en",
  part?: TriangleNodePart,
): string {
  if (nodeId === "ol") {
    if (part === "a") return locale === "zh" ? "对外 · 分母左来源" : "Outward · left source";
    if (part === "b") return locale === "zh" ? "对外 · 分母右来源" : "Outward · right source";
    return locale === "zh" ? "对外 · 顶端" : "Outward · top";
  }
  if (nodeId === "or") {
    if (part === "a") return locale === "zh" ? "对内 · 分母左来源" : "Inward · left source";
    if (part === "b") return locale === "zh" ? "对内 · 分母右来源" : "Inward · right source";
    return locale === "zh" ? "对内 · 顶端" : "Inward · top";
  }
  if (nodeId === "down") {
    if (part === "a") return locale === "zh" ? "对下 · 分母左来源" : "Downward · left source";
    if (part === "b") return locale === "zh" ? "对下 · 分母右来源" : "Downward · right source";
    return locale === "zh" ? "对下 · 顶端" : "Downward · top";
  }
  const zh: Record<string, string> = {
    ib0: "内底 · 左一",
    ib1: "内底 · 左二",
    ib2: "内底 · 右一",
    ib3: "内底 · 右二",
    ml: "内中层 · 左",
    mr: "内中层 · 右",
    top: "内顶点",
  };
  const en: Record<string, string> = {
    ib0: "Inner base · left 1",
    ib1: "Inner base · left 2",
    ib2: "Inner base · right 1",
    ib3: "Inner base · right 2",
    ml: "Inner mid · left",
    mr: "Inner mid · right",
    top: "Inner apex",
  };
  const map = locale === "zh" ? zh : en;
  return map[nodeId] ?? nodeId;
}

/**
 * 由点击格解析应展示的融合节点。
 * 外圈分数式：分子=本层形；分母左右=各自上一层融合来源（ol0/ol1、or0/or1、down0/down1）。
 */
export function resolveSelectionDetail(
  data: TriangleData,
  selection: TriangleNodeSelection,
): VisualPairDetail | undefined {
  const { nodeId, part } = selection;

  if (nodeId === "ol") {
    if (part === "a") return data.outer_left[0];
    if (part === "b") return data.outer_left[1];
    return data.outer_left[2];
  }
  if (nodeId === "or") {
    if (part === "a") return data.outer_right[0];
    if (part === "b") return data.outer_right[1];
    return data.outer_right[2];
  }
  if (nodeId === "down") {
    if (part === "a") return data.top_cross[0];
    if (part === "b") return data.top_cross[1];
    return data.apex_outer;
  }

  const nodeMap: Record<string, VisualPairDetail | undefined> = {
    ib0: data.inner_bottom[0],
    ib1: data.inner_bottom[1],
    ib2: data.inner_bottom[2],
    ib3: data.inner_bottom[3],
    ml: data.inner_mid[0],
    mr: data.inner_mid[1],
    top: data.inner_top,
  };
  return nodeMap[nodeId];
}

/** 单步融合 → 质（前两位）+ 形（末位）+ 字典块 */
export function fusionFromDetail(
  detail: VisualPairDetail,
  lexicon: Map<number, DigitLecture> = new Map(),
): FusionTripleView | null {
  if (!detail?.source_digits || detail.source_digits.length < 2) return null;
  const zhiA = detail.source_digits[0];
  const zhiB = detail.source_digits[1];
  const xing = detail.result_digit;
  return {
    zhiA,
    zhiB,
    xing,
    code: `${zhiA}${zhiB}${xing}`,
    blockA: pickDigitBlock(zhiA, detail.source_records?.[0], lexicon),
    blockB: pickDigitBlock(zhiB, detail.source_records?.[1], lexicon),
    blockXing: pickDigitBlock(xing, detail.result_record, lexicon),
    board: detail,
  };
}

const ORIGIN_ZH: Record<string, string> = {
  ib0: "内底 · 左一（日期日十位+个位）",
  ib1: "内底 · 左二（日期月十位+个位）",
  ib2: "内底 · 右一（日期年千+百位）",
  ib3: "内底 · 右二（日期年十+个位）",
  ml: "内中层 · 左",
  mr: "内中层 · 右",
  top: "内顶点",
  ol0: "对外 · 左支",
  ol1: "对外 · 右支",
  ol2: "对外 · 顶端",
  or0: "对内 · 左支",
  or1: "对内 · 右支",
  or2: "对内 · 顶端",
  down0: "对下 · 左支",
  down1: "对下 · 右支",
  down2: "对下 · 顶端",
  pair0: "底层 · 日",
  pair1: "底层 · 月",
  pair2: "底层 · 年（前）",
  pair3: "底层 · 年（后）",
};

const ORIGIN_EN: Record<string, string> = {
  ib0: "Inner base L1 (day digits)",
  ib1: "Inner base L2 (month digits)",
  ib2: "Inner base R1 (year thousands/hundreds)",
  ib3: "Inner base R2 (year tens/ones)",
  ml: "Inner mid · left",
  mr: "Inner mid · right",
  top: "Inner apex",
  ol0: "Outward · left branch",
  ol1: "Outward · right branch",
  ol2: "Outward · top",
  or0: "Inward · left branch",
  or1: "Inward · right branch",
  or2: "Inward · top",
  down0: "Downward · left branch",
  down1: "Downward · right branch",
  down2: "Downward · top",
  pair0: "Base · day",
  pair1: "Base · month",
  pair2: "Base · year (high)",
  pair3: "Base · year (low)",
};

export function fusionOriginLabel(detail: VisualPairDetail, locale: "zh" | "en"): string {
  const map = locale === "zh" ? ORIGIN_ZH : ORIGIN_EN;
  return map[detail.id] ?? detail.id;
}

function boardTraitLines(detail: VisualPairDetail): string[] {
  if (detail.traits?.length) return detail.traits;
  return (detail.lines ?? []).filter((line) => {
    const t = line.trim();
    return t && !t.startsWith("两位数") && !t.startsWith("数位标签");
  });
}

export function clickedDigitHint(
  selection: TriangleNodeSelection,
  fusion: FusionTripleView,
  locale: FusionLocale,
): string {
  return fusionClickHint(
    {
      nodeId: selection.nodeId,
      part: selection.part,
      code: fusion.code,
      zhiA: fusion.zhiA,
      zhiB: fusion.zhiB,
      xing: fusion.xing,
    },
    locale,
  );
}

export function boardFeatureText(detail: VisualPairDetail, locale: "zh" | "en"): string[] {
  const out: string[] = [];
  const traits = boardTraitLines(detail);
  if (detail.in_chart) {
    out.push(
      locale === "zh"
        ? `两位数 ${detail.source_pair} → 根数字 ${detail.result_digit}（九张板书）`
        : `Pair ${detail.source_pair} → root ${detail.result_digit} (9 boards)`,
    );
    if (detail.digit_labels?.length) {
      out.push(
        (locale === "zh" ? "数位标签：" : "Labels: ") +
          detail.digit_labels.join(" / "),
      );
    }
    for (const t of traits) out.push(t);
  } else if (traits.length) {
    for (const t of traits) out.push(t);
  } else if (detail.lines?.length) {
    for (const line of detail.lines) out.push(line);
  } else {
    out.push(
      locale === "zh"
        ? "该两位数路径未在九张板书单列，可对照上方质、形单数字核心整合理解。"
        : "This pair path is not on the nine boards; use the digit cores above.",
    );
  }
  return out;
}
