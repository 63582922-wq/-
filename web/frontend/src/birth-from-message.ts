/**
 * 从用户消息（含语音转写）解析生日：说「阴历」按农历换算公历；说「阳历」或仅日期则按公历。
 */
import { Lunar } from "lunar-javascript";
import { parseSolarIso } from "./date-parse";

export type CalendarMode = "lunar" | "solar";

export type ResolvedBirth = {
  iso: string;
  mode: CalendarMode;
  /** 农历口播原文摘要（仅 lunar） */
  lunarNote?: string;
};

function normalizeSpeechText(text: string): string {
  return text
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[／．]/g, (c) => (c === "／" ? "/" : "."))
    .trim();
}

export function detectCalendarMode(text: string): CalendarMode {
  const t = text;
  if (/(阴历|农历|\blunar\b)/i.test(t)) return "lunar";
  if (/(阳历|公历|西历|\bsolar\b|\bgregorian\b)/i.test(t)) return "solar";
  return "solar";
}

function formatIso(y: number, m: number, d: number): string | null {
  const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return parseSolarIso(iso) ? iso : null;
}

const CN_DIGIT: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

function parseCnNumber(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t);
  if (t === "十") return 10;
  if (t.startsWith("十") && t.length === 2) return 10 + (CN_DIGIT[t[1]] ?? 0);
  if (t.endsWith("十") && t.length === 2) return (CN_DIGIT[t[0]] ?? 0) * 10;
  if (t.includes("十")) {
    const [a, b] = t.split("十");
    const hi = a ? (CN_DIGIT[a] ?? 0) : 1;
    const lo = b ? (CN_DIGIT[b] ?? 0) : 0;
    return hi * 10 + lo;
  }
  if (t.length === 1 && t in CN_DIGIT) return CN_DIGIT[t];
  return null;
}

const CN_MONTH: Record<string, number> = {
  正: 1,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
  十一: 11,
  冬: 11,
  腊: 12,
  十二: 12,
};

function parseLunarMonthToken(raw: string, leap: boolean): number | null {
  const s = raw.replace(/月$/, "").trim();
  let n: number | null = null;
  if (/^\d+$/.test(s)) n = Number(s);
  else n = CN_MONTH[s] ?? parseCnNumber(s);
  if (!n || n < 1 || n > 12) return null;
  return leap ? -n : n;
}

function parseLunarDayToken(raw: string): number | null {
  let s = raw.replace(/[日号]$/, "").trim();
  if (/^\d+$/.test(s)) return Number(s);
  if (s.startsWith("初")) s = s.slice(1);
  if (s.startsWith("廿")) {
    const rest = s.slice(1);
    const n = parseCnNumber(rest);
    return n != null ? 20 + n : null;
  }
  if (s === "三十") return 30;
  if (s === "二十") return 20;
  if (s.startsWith("二十")) {
    const n = parseCnNumber(s.slice(2));
    return n != null ? 20 + n : null;
  }
  return parseCnNumber(s);
}

function lunarToSolarIso(y: number, lunarMonth: number, day: number): string | null {
  try {
    const solar = Lunar.fromYmd(y, lunarMonth, day).getSolar();
    const iso = solar.toYmd();
    return parseSolarIso(iso) ? iso : null;
  } catch {
    return null;
  }
}

function extractLunarParts(text: string): { y: number; month: number; d: number } | null {
  let t = text.replace(/(阴历|农历|\blunar\b)/gi, " ");
  t = t.replace(/(阳历|公历|西历|\bsolar\b|\bgregorian\b)/gi, " ");

  let m = t.match(/(\d{4})\s*年\s*(闰)?\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/);
  if (m) {
    const leap = Boolean(m[2]);
    const month = parseLunarMonthToken(m[3], leap);
    const d = Number(m[4]);
    if (month != null && d >= 1 && d <= 30) return { y: Number(m[1]), month, d };
  }

  m = t.match(
    /(\d{4})\s*年\s*(闰)?\s*([正一二三四五六七八九十冬腊]+)\s*月\s*([初廿卅\d一二三四五六七八九十]+)\s*[日号]?/,
  );
  if (m) {
    const leap = Boolean(m[2]);
    const month = parseLunarMonthToken(m[3], leap);
    const d = parseLunarDayToken(m[4]);
    if (month != null && d != null && d >= 1 && d <= 30) return { y: Number(m[1]), month, d };
  }

  return null;
}

function extractSolarIso(text: string): string | null {
  const t = normalizeSpeechText(text);
  let m = t.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (m) return formatIso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = t.match(/(?<!\d)(\d{8})(?!\d)/);
  if (m) {
    const r = m[1];
    return formatIso(Number(r.slice(0, 4)), Number(r.slice(4, 6)), Number(r.slice(6, 8)));
  }
  m = t.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/);
  if (m) return formatIso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = t.match(/\b(\d{4})\s+(\d{1,2})\s+(\d{1,2})\b/);
  if (m) return formatIso(Number(m[1]), Number(m[2]), Number(m[3]));
  return null;
}

/** 解析消息中的生日；阴历口播会换算为公历 ISO。 */
export function resolveBirthFromMessage(text: string): ResolvedBirth | null {
  const t = normalizeSpeechText(text);
  if (!t) return null;
  const mode = detectCalendarMode(t);

  if (mode === "lunar") {
    const parts = extractLunarParts(t);
    if (!parts) return null;
    const iso = lunarToSolarIso(parts.y, parts.month, parts.d);
    if (!iso) return null;
    const lunarNote = `农历 ${parts.y}年${Math.abs(parts.month)}月${parts.d}日`;
    return { iso, mode: "lunar", lunarNote };
  }

  const iso = extractSolarIso(t);
  if (iso) return { iso, mode: "solar" };
  return null;
}

export function messageHasResolvableBirth(text: string): boolean {
  return Boolean(resolveBirthFromMessage(text));
}
