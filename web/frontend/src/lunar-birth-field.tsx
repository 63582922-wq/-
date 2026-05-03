import { useMemo, useState } from "react";
import { Solar } from "lunar-javascript";
import { parseSolarIso } from "./date-parse";
import type { Locale } from "./i18n";
import { t } from "./i18n";
import { formatEnglishLunarDateLine, runWithLunarLang } from "./lunar-locale";
import LunarPickerSheet from "./lunar-picker-sheet";

function solarIsoToLunarLine(iso: string, locale: Locale): string | null {
  const p = parseSolarIso(iso);
  if (!p) return null;
  try {
    const lunar = Solar.fromYmd(p.y, p.m, p.d).getLunar();
    if (locale === "en") {
      return formatEnglishLunarDateLine(lunar);
    }
    return runWithLunarLang(locale, () => lunar.toString());
  } catch {
    return null;
  }
}

export default function LunarBirthField({
  value,
  onChange,
  locale,
}: {
  value: string;
  onChange: (solarIso: string) => void;
  locale: Locale;
}) {
  const [open, setOpen] = useState(false);

  const lunarLine = useMemo(
    () => (value ? solarIsoToLunarLine(value, locale) : null),
    [value, locale],
  );

  return (
    <div className="lunar-birth-field">
      <button
        type="button"
        className="lunar-field-trigger"
        onClick={() => setOpen(true)}
      >
        {value && lunarLine ? (
          <span className="lunar-field-trigger-text">
            <span className="lunar-field-line">
              {t(locale, "lunarLineLunar")}
              {lunarLine}
            </span>
            <span className="lunar-field-line lunar-field-line--sub">
              {t(locale, "lunarLineSolar")}
              {value}
            </span>
          </span>
        ) : (
          <span>{t(locale, "lunarTriggerEmpty")}</span>
        )}
      </button>

      <LunarPickerSheet
        locale={locale}
        open={open}
        initialSolarIso={value}
        onClose={() => setOpen(false)}
        onConfirm={(iso) => {
          onChange(iso);
          setOpen(false);
        }}
      />
    </div>
  );
}
