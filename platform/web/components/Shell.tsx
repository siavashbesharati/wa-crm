"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearSession, getSession, api } from "@/lib/api";
import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui/Spinner";

const NAV = [
  { href: "/admin", label: "ادمین", ico: "★" },
  { href: "/home", label: "میز کار", ico: "⌂" },
  { href: "/leads", label: "لیدها", ico: "☰" },
  { href: "/pipeline", label: "پایپلاین", ico: "▦" },
  { href: "/inbox", label: "اینباکس", ico: "✉" },
  { href: "/tasks", label: "وظایف", ico: "☑" },
  { href: "/channels", label: "کانال‌ها", ico: "☎" },
  { href: "/team", label: "تیم", ico: "☺" },
  { href: "/knowledge", label: "دانش AI", ico: "✦" },
  { href: "/ai-settings", label: "تنظیمات AI", ico: "⚙" },
  { href: "/kpi", label: "KPI / OKR", ico: "◉" }
];

export default function Shell({
  title,
  sub,
  children,
  actions,
  search,
  onSearch
}: {
  title: string;
  sub: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  search?: string;
  onSearch?: (v: string) => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [orgName, setOrgName] = useState("");
  const [userLabel, setUserLabel] = useState("");

  useEffect(() => {
    if (!getSession()) {
      // Dev: no login wall — pick a business from public super-admin
      router.replace("/admin");
      return;
    }
    setReady(true);
    api<{ org: { name: string }; user: { display_name: string; phone: string } }>("/auth/me")
      .then((me) => {
        setOrgName(me.org?.name || "");
        setUserLabel(me.user?.display_name || me.user?.phone || "");
      })
      .catch(() => undefined);
  }, [router]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  if (!ready) {
    return (
      <div className="page-loading" style={{ minHeight: "100vh" }}>
        <Spinner dark lg />
        <span>در حال بارگذاری…</span>
      </div>
    );
  }

  const initials = (userLabel || "ک").trim().slice(0, 1);

  return (
    <div className={`app-shell ${collapsed ? "collapsed" : ""}`}>
      <aside className={`sidebar ${mobileOpen ? "open" : ""}`}>
        <div className="sidebar-top">
          <div className="brand-block">
            <div className="brand">CRM واتساپ</div>
            <div className="brand-sub">iranexpedia</div>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label="جمع کردن منو"
            onClick={() => setCollapsed((v) => !v)}
          >
            ☰
          </button>
        </div>

        <div className="user-chip">
          <div className="user-avatar">{initials}</div>
          <div className="user-meta">
            <strong>{userLabel || "کاربر"}</strong>
            <span>{orgName || "سازمان"}</span>
          </div>
        </div>

        <div className="nav-label">منو</div>
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
          <button
            className="btn secondary"
            onClick={() => {
              clearSession();
              router.replace("/admin");
            }}
          >
            <span className="label">تعویض کسب‌وکار</span>
          </button>
        </div>
      </aside>

      <div className="main-wrap">
        <header className="topbar">
          <button
            type="button"
            className="icon-btn"
            style={{ display: undefined }}
            aria-label="منو"
            onClick={() => {
              if (window.matchMedia("(max-width: 960px)").matches) {
                setMobileOpen((v) => !v);
              } else {
                setCollapsed((v) => !v);
              }
            }}
          >
            ☰
          </button>
          <div className="topbar-titles">
            <h1 className="page-title">{title}</h1>
            <p className="page-sub">{sub}</p>
          </div>
          {onSearch && (
            <input
              className="top-search"
              placeholder="جستجو…"
              value={search || ""}
              onChange={(e) => onSearch(e.target.value)}
            />
          )}
          <div className="topbar-actions">{actions}</div>
        </header>
        <main className="main">{children}</main>
      </div>
    </div>
  );
}
