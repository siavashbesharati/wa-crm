"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, savePlatformSession } from "@/lib/api";
import { AuthLayout, AuthStepHeader } from "@/components/auth/AuthLayout";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

export default function SuperLoginPage() {
  const router = useRouter();
  const toast = useToast();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);

  async function login() {
    if (!phone.trim() || !password.trim()) {
      toast.push("شماره و رمز را وارد کنید", "err");
      setShake(true);
      window.setTimeout(() => setShake(false), 450);
      return;
    }
    setBusy(true);
    try {
      const tok = await api<{
        access_token: string;
        refresh_token: string;
        user_id: string;
        role: string;
        scope: "platform";
      }>("/admin/login", {
        method: "POST",
        auth: false,
        body: JSON.stringify({ phone: phone.trim(), password })
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
      setShake(true);
      window.setTimeout(() => setShake(false), 450);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      variant="platform"
      brand="سوپر ادمین"
      tagline="کنسول مالک پلتفرم برای مدیریت کسب‌وکارها، پلن‌ها و تنظیمات سراسری AI."
    >
      <div className={`auth-flow ${shake ? "is-shake" : ""}`}>
        <AuthStepHeader
          step={1}
          total={1}
          title="ورود پلتفرم"
          sub="دسترسی محدود به مالک سیستم — از رمز قوی در production استفاده کنید."
        />
        <label className="auth-field">
          <span>شماره سوپر ادمین</span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="شماره تعریف‌شده در env"
            autoComplete="username"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") document.getElementById("super-pass")?.focus();
            }}
          />
        </label>
        <label className="auth-field">
          <span>رمز عبور</span>
          <div className="auth-pass-row">
            <input
              id="super-pass"
              type={showPass ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              onKeyDown={(e) => {
                if (e.key === "Enter") login();
              }}
            />
            <button
              type="button"
              className="auth-eye"
              onClick={() => setShowPass((v) => !v)}
              aria-label={showPass ? "مخفی کردن رمز" : "نمایش رمز"}
            >
              {showPass ? "مخفی" : "نمایش"}
            </button>
          </div>
        </label>
        <Button className="auth-submit" loading={busy} onClick={login}>
          ورود به کنسول پلتفرم
        </Button>
      </div>
    </AuthLayout>
  );
}
