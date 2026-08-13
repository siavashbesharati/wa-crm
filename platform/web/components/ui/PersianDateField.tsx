"use client";

import { useMemo } from "react";
import {
  PERSIAN_MONTHS,
  isoToJalali,
  jalaliMonthLength,
  jalaliToIso,
  todayJalali
} from "@/lib/jalali";

type Props = {
  value: string;
  onChange: (iso: string) => void;
  label?: string;
};

export function PersianDateField({ value, onChange, label = "سررسید" }: Props) {
  const today = useMemo(() => todayJalali(), []);
  const selected = isoToJalali(value);
  const jy = selected?.[0] ?? 0;
  const jm = selected?.[1] ?? 0;
  const jd = selected?.[2] ?? 0;
  const year = jy || today[0];
  const month = jm || today[1];
  const years = Array.from({ length: 8 }, (_, i) => today[0] + i - 1);
  const days = jalaliMonthLength(year, month);

  function setPart(nextY: number, nextM: number, nextD: number) {
    const max = jalaliMonthLength(nextY, nextM);
    onChange(jalaliToIso(nextY, nextM, Math.min(nextD || 1, max)));
  }

  return (
    <label className="persian-date-field">
      {label}
      <div className="persian-date-row">
        <select
          value={jy ? String(jd) : ""}
          onChange={(e) => {
            const d = Number(e.target.value);
            if (!d) {
              onChange("");
              return;
            }
            setPart(year, month, d);
          }}
          aria-label="روز"
        >
          <option value="">روز</option>
          {Array.from({ length: days }, (_, i) => i + 1).map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <select
          value={jy ? String(jm) : ""}
          onChange={(e) => {
            const m = Number(e.target.value);
            if (!m) {
              onChange("");
              return;
            }
            setPart(year, m, jd || 1);
          }}
          aria-label="ماه"
        >
          <option value="">ماه</option>
          {PERSIAN_MONTHS.map((name, i) => (
            <option key={name} value={i + 1}>
              {name}
            </option>
          ))}
        </select>
        <select
          value={jy ? String(jy) : ""}
          onChange={(e) => {
            const y = Number(e.target.value);
            if (!y) {
              onChange("");
              return;
            }
            setPart(y, month, jd || 1);
          }}
          aria-label="سال"
        >
          <option value="">سال</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        {value ? (
          <button type="button" className="persian-date-clear" onClick={() => onChange("")}>
            پاک
          </button>
        ) : null}
      </div>
    </label>
  );
}
