"use client";

import Link from "next/link";

export function AuthLayout({
  variant = "business",
  brand,
  tagline,
  children,
  footer
}: {
  variant?: "business" | "platform";
  brand: string;
  tagline: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const points =
    variant === "business"
      ? ["ورود و ثبت‌نام فقط با موبایل", "چند کانال واتساپ و دیوار", "تیم و کانال‌های سرور"]
      : ["مدیریت همه کسب‌وکارها", "پلن، AI سراسری و سیستم", "ورود پشتیبانی به پنل مشتری"];

  return (
    <div className={`auth-screen auth-${variant}`}>
      <div className="auth-ambient" aria-hidden>
        <span className="auth-glow auth-glow-a" />
        <span className="auth-glow auth-glow-b" />
        <span className="auth-glow auth-glow-c" />
        <span className="auth-mesh" />
        <span className="auth-scan" />
      </div>

      <div className="auth-shell">
        <aside className="auth-brand-pane">
          <div className="auth-brand-inner">
            <div className="auth-brand-mark">
              <span className="auth-mark-dot" aria-hidden />
              <p className="auth-eyebrow">miogen</p>
            </div>
            <p className="auth-portal-chip">
              {variant === "business" ? "Business Console" : "Platform Console"}
            </p>
            <h1 className="auth-brand-title">{brand}</h1>
            <p className="auth-brand-copy">{tagline}</p>
            {variant === "business" ? (
              <div className="auth-mascot" aria-hidden>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/characters/pashmak-login.png"
                  alt=""
                  className="auth-mascot-img"
                  width={320}
                  height={320}
                />
              </div>
            ) : null}
            <ul className="auth-points">
              {points.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </aside>

        <main className="auth-panel">
          <div className="auth-panel-card auth-enter">
            <div className="auth-card-shine" aria-hidden />
            {children}
          </div>
          {footer ? <div className="auth-footer">{footer}</div> : null}
          <p className="auth-legal">
            <Link href={variant === "business" ? "/super/login" : "/login"}>
              {variant === "business" ? "" : "ورود کسب‌وکار"}
            </Link>
          </p>
        </main>
      </div>
    </div>
  );
}

export function AuthStepHeader({
  title,
  sub,
  step,
  total = 2
}: {
  title: string;
  sub: string;
  step: number;
  total?: number;
}) {
  return (
    <div className="auth-step-head">
      <div className="auth-step-meta">
        <span>
          مرحله {step} از {total}
        </span>
        <div className="auth-step-track" aria-hidden>
          {Array.from({ length: total }).map((_, i) => (
            <i key={i} className={i < step ? "on" : ""} />
          ))}
        </div>
      </div>
      <h2>{title}</h2>
      <p>{sub}</p>
    </div>
  );
}

/** Replaces the login form after OTP success while the dashboard route loads. */
export function AuthEntering({
  title = "ورود موفق",
  sub = "در حال باز کردن پنل…"
}: {
  title?: string;
  sub?: string;
}) {
  return (
    <div className="auth-entering" role="status" aria-live="polite" aria-busy="true">
      <div className="auth-entering-orbit" aria-hidden>
        <span className="auth-entering-ring" />
        <span className="auth-entering-ring auth-entering-ring-b" />
        <span className="auth-entering-core" />
      </div>
      <h2>{title}</h2>
      <p>{sub}</p>
      <div className="auth-entering-bar" aria-hidden>
        <i />
      </div>
    </div>
  );
}
