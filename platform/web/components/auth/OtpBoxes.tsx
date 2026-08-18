"use client";

import { useEffect, useRef } from "react";

const FA = "۰۱۲۳۴۵۶۷۸۹";
const AR = "٠١٢٣٤٥٦٧٨٩";

function asciiDigitChar(ch: string): string {
  const i = FA.indexOf(ch);
  if (i >= 0) return String(i);
  const j = AR.indexOf(ch);
  if (j >= 0) return String(j);
  return /\d/.test(ch) ? ch : "";
}

function onlyDigits(raw: string, max: number): string {
  let out = "";
  for (const ch of raw) {
    const d = asciiDigitChar(ch);
    if (d) out += d;
    if (out.length >= max) break;
  }
  return out;
}

export function OtpBoxes({
  length = 6,
  value,
  onChange,
  disabled,
  autoFocus
}: {
  length?: number;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = onlyDigits(value, length).padEnd(length, " ").split("");

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);

  function setAt(index: number, char: string) {
    const clean = onlyDigits(value, length).split("");
    while (clean.length < length) clean.push("");
    clean[index] = asciiDigitChar(char) || char;
    const next = onlyDigits(clean.join(""), length);
    onChange(next);
  }

  return (
    <div className="otp-boxes" dir="ltr">
      {Array.from({ length }).map((_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          className="otp-box"
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={1}
          disabled={disabled}
          value={digits[i] === " " ? "" : digits[i]}
          onChange={(e) => {
            const v = onlyDigits(e.target.value, 1);
            setAt(i, v);
            if (v && i < length - 1) refs.current[i + 1]?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !digits[i]?.trim() && i > 0) {
              refs.current[i - 1]?.focus();
            }
            if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1]?.focus();
            if (e.key === "ArrowRight" && i < length - 1) refs.current[i + 1]?.focus();
          }}
          onPaste={(e) => {
            e.preventDefault();
            const pasted = onlyDigits(e.clipboardData.getData("text"), length);
            if (!pasted) return;
            onChange(pasted);
            const focusAt = Math.min(pasted.length, length - 1);
            refs.current[focusAt]?.focus();
          }}
          aria-label={`رقم ${i + 1}`}
        />
      ))}
    </div>
  );
}

export function ResendCountdown({
  secondsLeft,
  onResend,
  busy
}: {
  secondsLeft: number;
  onResend: () => void;
  busy?: boolean;
}) {
  const ready = secondsLeft <= 0;
  const mm = String(Math.floor(Math.max(0, secondsLeft) / 60)).padStart(2, "0");
  const ss = String(Math.max(0, secondsLeft) % 60).padStart(2, "0");

  return (
    <div className="otp-resend">
      {ready ? (
        <button type="button" className="auth-link-btn" disabled={busy} onClick={onResend}>
          ارسال مجدد کد
        </button>
      ) : (
        <p>
          ارسال مجدد تا{" "}
          <strong className="otp-timer" aria-live="polite">
            {mm}:{ss}
          </strong>
        </p>
      )}
      <div className="otp-countdown-bar" aria-hidden>
        <i style={{ width: `${Math.max(0, Math.min(100, (secondsLeft / 60) * 100))}%` }} />
      </div>
    </div>
  );
}
