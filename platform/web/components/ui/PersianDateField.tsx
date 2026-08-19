"use client";

import { useEffect, useRef } from "react";
import { isoToJalaliSlash, jalaliSlashToIso } from "@/lib/jalali";
import { ensureJalaliDatepicker } from "@/lib/jalali-datepicker";
import "@majidh1/jalalidatepicker/dist/jalalidatepicker.min.css";

type Props = {
  value: string;
  onChange: (iso: string) => void;
  label?: string;
};

export function PersianDateField({ value, onChange, label = "سررسید" }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const display = isoToJalaliSlash(value);

  useEffect(() => {
    void ensureJalaliDatepicker();
  }, []);

  async function openPicker() {
    const api = await ensureJalaliDatepicker();
    const el = inputRef.current;
    if (api && el) api.show(el);
  }

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    if (el.value !== display) el.value = display;
  }, [display]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const input = el;

    function emit() {
      const raw = input.value.trim();
      onChangeRef.current(raw ? jalaliSlashToIso(raw) : "");
    }

    input.addEventListener("jdp:change", emit);
    input.addEventListener("change", emit);
    input.addEventListener("input", emit);
    return () => {
      input.removeEventListener("jdp:change", emit);
      input.removeEventListener("change", emit);
      input.removeEventListener("input", emit);
      window.jalaliDatepicker?.hide();
    };
  }, []);

  return (
    <label className="persian-date-field">
      {label}
      <div className="persian-date-row">
        <input
          ref={inputRef}
          data-jdp
          data-jdp-only-date
          className="persian-date-input"
          dir="ltr"
          placeholder="1404/05/22"
          defaultValue={display}
          autoComplete="off"
          readOnly
          onFocus={() => {
            void openPicker();
          }}
        />
      </div>
    </label>
  );
}
