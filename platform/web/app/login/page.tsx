"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, saveSession } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState("09120000000");
  const [code, setCode] = useState("123456");
  const [orgName, setOrgName] = useState("");
  const [step, setStep] = useState<"request" | "verify">("request");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);

  async function requestOtp() {
    setLoading(true);
    setError("");
    try {
      const res = await api<{ message: string; dev_code?: string }>("/auth/otp/request", {
        method: "POST",
        body: JSON.stringify({ phone }),
        auth: false
      });
      setInfo(res.dev_code ? `کد mock: ${res.dev_code}` : res.message);
      setStep("verify");
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطا");
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp() {
    setLoading(true);
    setError("");
    try {
      const res = await api<{
        access_token: string;
        refresh_token: string;
        user_id: string;
        org_id: string;
        role: string;
      }>("/auth/otp/verify", {
        method: "POST",
        body: JSON.stringify({ phone, code, org_name: orgName }),
        auth: false
      });
      saveSession(res);
      router.replace("/leads");
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطا");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="card login-card">
        <h1 className="page-title">ورود با پیامک</h1>
        <p className="hint">OTP فعلاً mock است — کد پیش‌فرض ۱۲۳۴۵۶</p>
        <div className="form-grid" style={{ gridTemplateColumns: "1fr", marginTop: 16 }}>
          <label className="full">
            موبایل
            <input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
          {step === "verify" && (
            <>
              <label className="full">
                کد تأیید
                <input value={code} onChange={(e) => setCode(e.target.value)} />
              </label>
              <label className="full">
                نام سازمان (فقط اولین ورود)
                <input
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="مثلاً آژانس نمونه"
                />
              </label>
            </>
          )}
        </div>
        {info && <p className="hint">{info}</p>}
        {error && <p className="error">{error}</p>}
        <div className="row-actions" style={{ marginTop: 12 }}>
          {step === "request" ? (
            <button className="btn" disabled={loading} onClick={requestOtp}>
              دریافت کد
            </button>
          ) : (
            <button className="btn" disabled={loading} onClick={verifyOtp}>
              ورود
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
