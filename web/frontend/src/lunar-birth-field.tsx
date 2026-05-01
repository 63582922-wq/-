import { useMemo, useState } from "react";
import { Solar } from "lunar-javascript";
import { parseSolarIso } from "./date-parse";
import LunarPickerSheet from "./lunar-picker-sheet";

function solarIsoToLunarLine(iso: string): string | null {
  const p = parseSolarIso(iso);
  if (!p) return null;
  try {
    return Solar.fromYmd(p.y, p.m, p.d).getLunar().toString();
  } catch {
    return null;
  }
}

export default function LunarBirthField({
  value,
  onChange,
}: {
  value: string;
  onChange: (solarIso: string) => void;
}) {
  const [open, setOpen] = useState(false);

  const lunarLine = useMemo(() => (value ? solarIsoToLunarLine(value) : null), [value]);

  return (
    <div className="lunar-birth-field">
      <button
        type="button"
        className="lunar-field-trigger"
        onClick={() => setOpen(true)}
      >
        {value && lunarLine ? (
          <span className="lunar-field-trigger-text">
            <span className="lunar-field-line">阴历：{lunarLine}</span>
            <span className="lunar-field-line lunar-field-line--sub">
              已换算公历：{value}
            </span>
          </span>
        ) : (
          <span>点击选择阴历生日（将自动换算为公历用于测算）</span>
        )}
      </button>

      <LunarPickerSheet
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
