/** 解析 YYYY-MM-DD 公历字符串 */

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function daysInMonthSolar(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

export function parseSolarIso(iso: string): { y: number; m: number; d: number } | null {
  const m = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || mo < 1 || mo > 12 || d < 1) return null;
  const dim = daysInMonthSolar(y, mo);
  if (d > dim) return null;
  return { y, m: mo, d };
}

/**
 * 与 personality_encoder.encode.extract_date_candidates 的正则一致：
 * 正文里若出现可抽取的阳历片段，请求应不传 birth_date，由后端从 message 解析，
 * 避免仍带上日历选择框里的旧 ISO。
 */
function normalizeSpeechText(text: string): string {
  return text
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[／．]/g, (c) => (c === "／" ? "/" : "."))
    .trim();
}

/** @deprecated 请用 birth-from-message 的 messageHasResolvableBirth */
export function messageHasExtractableBirthDate(text: string): boolean {
  // 保留导出以免旧引用报错；逻辑与阳历分支一致
  const t = normalizeSpeechText(text);
  if (!t) return false;
  if (/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/.test(t)) return true;
  if (/(?<!\d)(\d{8})(?!\d)/.test(t)) return true;
  if (/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/.test(t)) return true;
  if (/\b(\d{4})\s+(\d{1,2})\s+(\d{1,2})\b/.test(t)) return true;
  if (/(19|20)\d{2}\s*年/.test(t) && /\d{1,2}\s*月/.test(t)) return true;
  return false;
}
