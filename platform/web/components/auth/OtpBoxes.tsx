"use client";

import { useEffect, useRef } from "react";

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
  const digits = value.replace(/\D/g, "").slice(0, length).padEnd(length, " ").split("");

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);

  function setAt(index: number, char: string) {
    const clean = value.replace(/\D/g, "").slice(0, length).split("");
    while (clean.length < length) clean.push("");
    clean[index] = char;
    const next = clean.join("").replace(/\s/g, "");
    onChange(next.slice(0, length));
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
            const v = e.target.value.replace(/\D/g, "").slice(-1);
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
            const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
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
