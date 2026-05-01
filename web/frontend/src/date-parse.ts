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
