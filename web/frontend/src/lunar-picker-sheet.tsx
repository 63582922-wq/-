import { useEffect, useMemo, useState } from "react";
import { Lunar, LunarYear, Solar } from "lunar-javascript";
import { parseSolarIso } from "./date-parse";
import type { Locale } from "./i18n";
import { t } from "./i18n";
import {
  englishLunarMonthRowLabel,
  formatEnglishLunarDateLine,
  runWithLunarLang,
} from "./lunar-locale";
import { VIEW_H, WheelColumn } from "./wheel-column";

const MIN_LUNAR_YEAR = 1936;
const MAX_LUNAR_YEAR = 2036;

/** 农历月份传统称谓（一至十二月 → 正腊） */
const MONTH_CN = [
  "",
  "正",
  "二",
  "三",
  "四",
  "五",
  "六",
  "七",
  "八",
  "九",
  "十",
  "冬",
  "腊",
];

function formatLunarMonthLabel(
  lm: { getMonth(): number; isLeap(): boolean },
  _lunarYear: number,
  locale: Locale,
): string {
  if (locale === "zh") {
    const abs = Math.abs(lm.getMonth());
    const name = MONTH_CN[abs] ?? `${abs}`;
    return (lm.isLeap() ? "闰" : "") + name + "月";
  }
  return englishLunarMonthRowLabel(lm);
}

function tryLunarToSolar(
  lunarYear: number,
  monthSlotIndex: number,
  lunarDay: number,
  locale: Locale,
): { iso: string; lunarDesc: string } | null {
  try {
    const months = LunarYear.fromYear(lunarYear).getMonthsInYear();
    const lm = months[monthSlotIndex];
    if (!lm) return null;
    const lunar = Lunar.fromYmd(lunarYear, lm.getMonth(), lunarDay);
    const solar = lunar.getSolar();
    const lunarDesc =
      locale === "en"
        ? formatEnglishLunarDateLine(lunar)
        : runWithLunarLang(locale, () => lunar.toString());
    return { iso: solar.toYmd(), lunarDesc };
  } catch {
    return null;
  }
}

function initFromSolarIso(iso: string): {
  lunarYear: number;
  monthSlotIndex: number;
  lunarDay: number;
} {
  const parsed = parseSolarIso(iso);
  const solar = parsed
    ? Solar.fromYmd(parsed.y, parsed.m, parsed.d)
    : Solar.fromYmd(1990, 6, 15);
  const lunar = solar.getLunar();
  const ly = lunar.getYear();
  const lmNum = lunar.getMonth();
  const ld = lunar.getDay();
  const months = LunarYear.fromYear(ly).getMonthsInYear();
  let slot = months.findIndex((x) => x.getMonth() === lmNum);
  if (slot < 0) slot = 0;
  const dim = months[slot].getDayCount();
  return {
    lunarYear: ly,
    monthSlotIndex: slot,
    lunarDay: Math.min(ld, dim),
  };
}

export default function LunarPickerSheet({
  locale,
  open,
  onClose,
  initialSolarIso,
  onConfirm,
}: {
  locale: Locale;
  open: boolean;
  onClose: () => void;
  initialSolarIso: string;
  onConfirm: (solarIso: string) => void;
}) {
  const [lunarYear, setLunarYear] = useState(MIN_LUNAR_YEAR);
  const [monthSlotIndex, setMonthSlotIndex] = useState(0);
  const [lunarDay, setLunarDay] = useState(1);

  useEffect(() => {
    if (!open) return;
    const init = initFromSolarIso(initialSolarIso);
    setLunarYear(init.lunarYear);
    setMonthSlotIndex(init.monthSlotIndex);
    setLunarDay(init.lunarDay);
  }, [open, initialSolarIso]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const years = useMemo(
    () =>
      Array.from(
        { length: MAX_LUNAR_YEAR - MIN_LUNAR_YEAR + 1 },
        (_, i) => MIN_LUNAR_YEAR + i
      ),
    []
  );

  const monthsInYear = useMemo(
    () => LunarYear.fromYear(lunarYear).getMonthsInYear(),
    [lunarYear]
  );

  useEffect(() => {
    setMonthSlotIndex((prev) =>
      Math.min(prev, Math.max(0, monthsInYear.length - 1))
    );
  }, [lunarYear, monthsInYear.length]);

  const lunarMonthObj = monthsInYear[monthSlotIndex];

  useEffect(() => {
    if (!lunarMonthObj) return;
    const dim = lunarMonthObj.getDayCount();
    setLunarDay((d) => Math.min(d, dim));
  }, [lunarMonthObj]);

  const monthSlots = useMemo(
    () => monthsInYear.map((_, i) => i),
    [monthsInYear]
  );

  const days = useMemo(() => {
    const dim = lunarMonthObj?.getDayCount() ?? 30;
    return Array.from({ length: dim }, (_, i) => i + 1);
  }, [lunarMonthObj]);

  const preview = useMemo(
    () => tryLunarToSolar(lunarYear, monthSlotIndex, lunarDay, locale),
    [lunarYear, monthSlotIndex, lunarDay, locale],
  );

  if (!open) return null;

  return (
    <div
      className="lunar-sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lunar-sheet-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="lunar-sheet-panel" onMouseDown={(e) => e.stopPropagation()}>
        <h2 id="lunar-sheet-title" className="lunar-sheet-title">
          {t(locale, "sheetTitle")}
        </h2>
        <p className="lunar-sheet-desc">{t(locale, "sheetDesc")}</p>

        <div className="wheel-date-labels lunar-sheet-labels">
          <span>{t(locale, "colYear")}</span>
          <span>{t(locale, "colMonth")}</span>
          <span>{t(locale, "colDay")}</span>
        </div>
        <div className="wheel-date lunar-sheet-wheel" style={{ height: VIEW_H }}>
          <div className="wheel-highlight" aria-hidden />
          <WheelColumn
            listKey="lun-col-year"
            items={years}
            value={lunarYear}
            format={(y) => `${y}${t(locale, "yearWheelSuffix")}`}
            onPick={setLunarYear}
          />
          <WheelColumn
            listKey={`m-${lunarYear}`}
            items={monthSlots}
            value={monthSlotIndex}
            format={(slot) =>
              monthsInYear[slot]
                ? formatLunarMonthLabel(monthsInYear[slot], lunarYear, locale)
                : ""
            }
            onPick={setMonthSlotIndex}
          />
          <WheelColumn
            listKey={`d-${lunarYear}-${monthSlotIndex}`}
            items={days}
            value={lunarDay}
            format={(d) => `${d}${t(locale, "dayWheelSuffix")}`}
            onPick={setLunarDay}
          />
        </div>

        <div className="lunar-sheet-preview">
          {preview ? (
            <>
              <div className="lunar-sheet-preview-line">
                {t(locale, "previewLunar")}
                <strong>{preview.lunarDesc}</strong>
              </div>
              <div className="lunar-sheet-preview-line">
                {t(locale, "previewSolar")}
                <strong>{preview.iso}</strong>
              </div>
            </>
          ) : (
            <div className="lunar-sheet-preview-line text-warn">
              {t(locale, "previewInvalid")}
            </div>
          )}
        </div>

        <div className="lunar-sheet-actions">
          <button type="button" className="lunar-sheet-btn lunar-sheet-btn--ghost" onClick={onClose}>
            {t(locale, "cancel")}
          </button>
          <button
            type="button"
            className="lunar-sheet-btn lunar-sheet-btn--primary"
            disabled={!preview}
            onClick={() => {
              if (!preview) return;
              onConfirm(preview.iso);
              onClose();
            }}
          >
            {t(locale, "confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
