import type { Locale } from "./i18n";
import * as LunarApi from "lunar-javascript";

type LunarI18n = {
  getLanguage(): string;
  setLanguage(lang: string): void;
};

const I18n = (LunarApi as unknown as { I18n: LunarI18n }).I18n;

/** lunar-javascript 全局语言；调用前后恢复，避免影响其它渲染。 */
export function runWithLunarLang<T>(locale: Locale, fn: () => T): T {
  const prev = I18n.getLanguage();
  I18n.setLanguage(locale === "en" ? "en" : "chs");
  try {
    return fn();
  } finally {
    I18n.setLanguage(prev);
  }
}

const MONTH_ORDINAL_EN = [
  "",
  "1st",
  "2nd",
  "3rd",
  "4th",
  "5th",
  "6th",
  "7th",
  "8th",
  "9th",
  "10th",
  "11th",
  "12th",
];

/** 农历月份一行（英文滚轮 / 预览）：闰月为 “Leap 5th month”，普通月为 “5th month”。 */
export function englishLunarMonthRowLabel(lm: {
  getMonth(): number;
  isLeap(): boolean;
}): string {
  const abs = Math.abs(lm.getMonth());
  const ord = MONTH_ORDINAL_EN[abs] ?? `${abs}th`;
  return lm.isLeap() ? `Leap ${ord} month` : `${ord} month`;
}

/** 公历反查后的整行英文农历说明（与滚轮用词一致）。 */
export function formatEnglishLunarDateLine(lunar: {
  getYear(): number;
  getMonth(): number;
  getDay(): number;
}): string {
  const lm = {
    getMonth: () => lunar.getMonth(),
    isLeap: () => lunar.getMonth() < 0,
  };
  return `Lunar year ${lunar.getYear()} · ${englishLunarMonthRowLabel(lm)} · day ${lunar.getDay()}`;
}
