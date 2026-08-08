"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, saveSession } from "@/lib/api";
import { AuthLayout, AuthStepHeader } from "@/components/auth/AuthLayout";
import { OtpBoxes, ResendCountdown } from "@/components/auth/OtpBoxes";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

type Step = "phone" | "otp";
const OTP_TTL = 60;

export default function BusinessLoginPage() {
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [exists, setExists] = useState<boolean | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [shake, setShake] = useState(false);
  const autoSubmitRef = useRef("");
  const verifyingRef = useRef(false);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const t = window.setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => window.clearTimeout(t);
  }, [secondsLeft]);

  useEffect(() => {
    const clean = code.replace(/\D/g, "");
    if (clean.length < 6) {
      autoSubmitRef.current = "";
      return;
    }
    if (busy || step !== "otp" || verifyingRef.current) return;
    if (autoSubmitRef.current === clean) return;
    autoSubmitRef.current = clean;
    const t = window.setTimeout(() => {
      void verifyOtp(clean);
    }, 120);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, step]);

  function bumpShake() {
    setShake(true);
    window.setTimeout(() => setShake(false), 450);
  }

  async function requestOtp() {
    const normalized = phone.trim();
    if (normalized.length < 8) {
      toast.push("شماره موبایل معتبر وارد کنید", "err");
      bumpShake();
      return;
    }
    setBusy(true);
    try {
      const res = await api<{
        ok: boolean;
        exists?: boolean;
      }>("/auth/otp/request", {
        method: "POST",
        auth: false,
        body: JSON.stringify({ phone: normalized })
      });
      setExists(!!res.exists);
      setCode("");
      autoSubmitRef.current = "";
      setStep("otp");
      setSecondsLeft(OTP_TTL);
      toast.push(res.exists ? "کد ورود پیامک شد" : "کد ثبت‌نام پیامک شد", "ok");
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
      bumpShake();
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp(overrideCode?: string) {
    const finalCode = (overrideCode ?? code).replace(/\D/g, "");
    if (finalCode.length < 6) {
      toast.push("کد ۶ رقمی را کامل وارد کنید", "err");
      bumpShake();
      return;
    }
    if (verifyingRef.current) return;
    verifyingRef.current = true;
    setBusy(true);
    try {
      const tok = await api<{
        access_token: string;
        refresh_token: string;
        user_id: string;
        org_id: string;
        role: string;
        is_new?: boolean;
        onboarding_step?: string;
      }>("/auth/otp/verify", {
        method: "POST",
        auth: false,
        body: JSON.stringify({ phone: phone.trim(), code: finalCode })
      });
      saveSession(tok);
      const stepNow = tok.onboarding_step || "done";
      if (tok.is_new || stepNow !== "done") {
        toast.push(
          tok.is_new ? "خوش آمدید — پروفایل را تکمیل کنید" : "ادامه راه‌اندازی",
          "ok"
        );
        router.replace("/onboarding");
      } else {
        toast.push("وارد پنل شدید", "ok");
        router.replace("/home");
      }
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
      bumpShake();
      // Keep autoSubmitRef = failed code so the same digits are not re-submitted
      // automatically; clear inputs so the user can type again.
      autoSubmitRef.current = finalCode;
      setCode("");
    } finally {
      setBusy(false);
      verifyingRef.current = false;
    }
  }

  return (
    <AuthLayout
      variant="business"
      brand="پنل کسب‌وکار"
      tagline="ورود سریع با شماره موبایل — اگر تازه باشید، بعد از OTP وارد ویزارد راه‌اندازی می‌شوید."
    >
      <div key={step} className={`auth-flow ${shake ? "is-shake" : ""}`}>
        {step === "phone" ? (
          <>
            <AuthStepHeader
              step={1}
              title="شماره موبایل"
              sub="همان شماره‌ای که با آن کسب‌وکار را مدیریت می‌کنید."
            />
            <label className="auth-field">
              <span>موبایل</span>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="0912xxxxxxx"
                inputMode="tel"
                autoComplete="tel"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") requestOtp();
                }}
              />
            </label>
            <Button className="auth-submit" loading={busy} onClick={requestOtp}>
              دریافت کد تأیید
            </Button>
          </>
        ) : (
          <>
            <AuthStepHeader
              step={2}
              title="کد تأیید"
              sub={`کد به ${phone} ارسال شد${
                exists === false ? " · ثبت‌نام جدید" : exists ? " · ورود" : ""
              }`}
            />
            <OtpBoxes value={code} onChange={setCode} disabled={busy} autoFocus />
            <ResendCountdown
              secondsLeft={secondsLeft}
              busy={busy}
              onResend={requestOtp}
            />
            <Button className="auth-submit" loading={busy} onClick={() => verifyOtp()}>
              تأیید و ورود
            </Button>
            <button
              type="button"
              className="auth-link-btn"
              onClick={() => {
                setStep("phone");
                setCode("");
                setSecondsLeft(0);
                autoSubmitRef.current = "";
              }}
            >
              تغییر شماره
            </button>
          </>
        )}
      </div>
    </AuthLayout>
  );
}
