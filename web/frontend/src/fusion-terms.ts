/**
 * 全项目统一：融合码三位语义（与 zl2.0、《融合码的理解》、encode.py、knowledge.json 一致）
 *
 * - 质：融合码前两位（基底 / 动机路径；对应 build_fusion_group 的 质_a、质_b、质_前两位）
 * - 形：融合码末位（前两位九进制归约和，外显结果位）
 * - N核心：单数字 1–9 的讲义（digit_record / digit_lexicon）
 * - 特征：两位数路径板书（质_前两位 / visualization traits，非单数字核心）
 *
 * 三角图每一格 = 一步融合：source_digits[0]+source_digits[1] → result_digit，即质+质→形。
 * 外圈点分母：展示该「质位数字」由上一步如何融合而来（仍为本步的质·形·特征，名称不变）。
 */

export const FUSION_ENCODE_SCHEMA_VERSION = 2;

export type FusionLocale = "zh" | "en";

export function labelSubstanceHeading(a: number, b: number, locale: FusionLocale): string {
  return locale === "zh" ? `质：${a}和${b}` : `Substance (first two): ${a} & ${b}`;
}

export function labelDigitCore(digit: number, locale: FusionLocale): string {
  return locale === "zh" ? `${digit}核心：` : `Core of ${digit}:`;
}

export function labelFormHeading(digit: number, locale: FusionLocale): string {
  return locale === "zh" ? `形：${digit}` : `Form (last digit): ${digit}`;
}

export function labelTraitsHeading(locale: FusionLocale): string {
  return locale === "zh" ? "特征：" : "Traits (pair path):";
}

export function panelEmptyHint(locale: FusionLocale): string {
  return locale === "zh"
    ? "点击三角图中的数字，按「质 → 形 → 特征」查看本步融合；再点同一格可取消。"
    : "Tap a digit to view substance, form, and pair traits for that fusion step.";
}

export function schemaStaleHint(locale: FusionLocale): string {
  return locale === "zh"
    ? "当前结果为旧版格式，请重新发送生日以刷新「质/形」讲义。"
    : "This result uses an older schema — send the birth date again to refresh.";
}

export type ClickHintInput = {
  nodeId: string;
  part: "result" | "a" | "b";
  code: string;
  zhiA: number;
  zhiB: number;
  xing: number;
};

export function fusionClickHint(sel: ClickHintInput, locale: FusionLocale): string {
  const outer = sel.nodeId === "ol" || sel.nodeId === "or" || sel.nodeId === "down";

  if (outer && (sel.part === "a" || sel.part === "b")) {
    const slot =
      sel.part === "a"
        ? locale === "zh"
          ? "分母左（质位）"
          : "denominator left (substance)"
        : locale === "zh"
          ? "分母右（质位）"
          : "denominator right (substance)";
    return locale === "zh"
      ? `当前：${slot} 数字 ${sel.xing} · 上一步融合码 ${sel.code}（${sel.zhiA}+${sel.zhiB} 归约）`
      : `${slot}: digit ${sel.xing} · prior fusion ${sel.code} (${sel.zhiA}+${sel.zhiB})`;
  }

  if (outer && sel.part === "result") {
    return locale === "zh"
      ? `当前：形 ${sel.xing} · 融合码 ${sel.code}`
      : `Form ${sel.xing} · fusion code ${sel.code}`;
  }

  return locale === "zh"
    ? `当前：形 ${sel.xing} · 融合码 ${sel.code}（质 ${sel.zhiA}+${sel.zhiB}）`
    : `Form ${sel.xing} · fusion ${sel.code} (substance ${sel.zhiA}+${sel.zhiB})`;
}
