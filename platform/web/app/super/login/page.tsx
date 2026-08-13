"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, clearPlatformSession, getPlatformSession, savePlatformSession } from "@/lib/api";
import { loadPlatformMe } from "@/lib/me-cache";
import { AuthLayout, AuthStepHeader } from "@/components/auth/AuthLayout";
import { OtpBoxes, ResendCountdown } from "@/components/auth/OtpBoxes";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

type Step = "phone" | "otp";
const OTP_TTL = 60;

export default function SuperLoginPage() {
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [shake, setShake] = useState(false);
  const autoSubmitRef = useRef("");
  const verifyingRef = useRef(false);

  useEffect(() => {
    const session = getPlatformSession();
    if (!session) return;
    let cancelled = false;
    loadPlatformMe(true)
      .then(() => {
        if (!cancelled) router.replace("/super");
      })
      .catch(() => {
        clearPlatformSession();
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

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
    if (phone.trim().length < 8) {
      toast.push("شماره سوپر ادمین را وارد کنید", "err");
      bumpShake();
      return;
    }
    setBusy(true);
    try {
      await api("/admin/otp/request", {
        method: "POST",
        auth: false,
        body: JSON.stringify({ phone: phone.trim() })
      });
      setCode("");
      autoSubmitRef.current = "";
      setStep("otp");
      setSecondsLeft(OTP_TTL);
      toast.push("کد ورود پیامک شد", "ok");
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
        role: string;
        scope: "platform";
      }>("/admin/otp/verify", {
        method: "POST",
        auth: false,
        body: JSON.stringify({ phone: phone.trim(), code: finalCode })
      });
      savePlatformSession({
        access_token: tok.access_token,
        refresh_token: tok.refresh_token,
        user_id: tok.user_id,
        role: tok.role || "super_admin",
        scope: "platform"
      });
      toast.push("وارد پنل پلتفرم شدید", "ok");
      router.replace("/super/businesses");
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
      bumpShake();
      autoSubmitRef.current = finalCode;
      setCode("");
    } finally {
      setBusy(false);
      verifyingRef.current = false;
    }
  }

  return (
    <AuthLayout
      variant="platform"
      brand="سوپر ادمین"
      tagline="ورود با پیامک به کنسول مالک پلتفرم."
    >
      <div key={step} className={`auth-flow ${shake ? "is-shake" : ""}`}>
        {step === "phone" ? (
          <>
            <AuthStepHeader
              step={1}
              title="شماره سوپر ادمین"
              sub="همان شماره‌ای که در SUPER_ADMIN_PHONE تنظیم شده است."
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
              sub={`کد به ${phone} ارسال شد`}
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
