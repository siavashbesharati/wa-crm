"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  api,
  clearPlatformSession,
  getPlatformSession
} from "@/lib/api";
import { Spinner } from "@/components/ui/Spinner";

const NAV = [
  { href: "/super/businesses", label: "کسب‌وکارها", ico: "▣" },
  { href: "/super/plans", label: "پلن‌ها", ico: "◈" },
  { href: "/super/sms-templates", label: "قالب پیامک", ico: "✉" },
  { href: "/super/ai", label: "تنظیمات AI", ico: "✦" },
  { href: "/super/system", label: "سیستم", ico: "◉" }
];

export default function SuperShell({
  title,
  sub,
  children,
  actions
}: {
  title: string;
  sub: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userLabel, setUserLabel] = useState("سوپر ادمین");

  useEffect(() => {
    if (!getPlatformSession()) {
      router.replace("/super/login");
      return;
    }
    setReady(true);
    api<{ user: { display_name: string; phone: string } }>("/admin/me", {
      platform: true
    })
      .then((me) => {
        setUserLabel(me.user?.display_name || me.user?.phone || "سوپر ادمین");
      })
      .catch(() => {
        clearPlatformSession();
        router.replace("/super/login");
      });
  }, [router]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileOpen]);

  if (!ready) {
    return (
      <div className="page-loading" style={{ minHeight: "100vh" }}>
        <Spinner dark lg />
        <span>در حال بارگذاری پنل پلتفرم…</span>
      </div>
    );
  }

  const initials = (userLabel || "س").trim().slice(0, 1);

  return (
    <div className={`app-shell super-shell ${collapsed ? "collapsed" : ""}${mobileOpen ? " nav-open" : ""}`}>
      {mobileOpen && (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="بستن منو"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside className={`sidebar ${mobileOpen ? "open" : ""}`}>
        <div className="sidebar-top">
          <div className="brand-block">
            <div className="brand">سوپر ادمین</div>
            <div className="brand-sub">مالک پلتفرم</div>
          </div>
          <button
            type="button"
            className="icon-btn sidebar-collapse-btn"
            aria-label="جمع کردن منو"
            onClick={() => setCollapsed((v) => !v)}
          >
            ☰
          </button>
          <button
            type="button"
            className="icon-btn sidebar-close-btn"
            aria-label="بستن منو"
            onClick={() => setMobileOpen(false)}
          >
            ✕
          </button>
        </div>

        <div className="user-chip">
          <div className="user-avatar">{initials}</div>
          <div className="user-meta">
            <strong>{userLabel}</strong>
            <span>دسترسی سراسری</span>
          </div>
        </div>

        <div className="nav-label">پلتفرم</div>
        <nav className="nav">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={pathname.startsWith(item.href) ? "active" : ""}
              title={item.label}
            >
              <span className="nav-ico">{item.ico}</span>
              <span className="label">{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="sidebar-foot">
          <Link href="/login" className="btn secondary" style={{ textAlign: "center" }}>
            <span className="label">ورود کسب‌وکار</span>
          </Link>
          <button
            className="btn secondary"
            onClick={() => {
              clearPlatformSession();
              router.replace("/super/login");
            }}
          >
            <span className="label">خروج سوپر ادمین</span>
          </button>
        </div>
      </aside>

      <div className="main-wrap">
        <header className="topbar">
          <button
            type="button"
            className="icon-btn topbar-menu-btn"
            aria-label="منو"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((v) => !v)}
          >
            ☰
          </button>
          <div className="topbar-titles">
            <h1 className="page-title">{title}</h1>
            <p className="page-sub">{sub}</p>
          </div>
          <div className="topbar-actions">{actions}</div>
        </header>
        <main className="main">{children}</main>
      </div>
    </div>
  );
}
