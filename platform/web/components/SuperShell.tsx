"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  clearPlatformSession,
  getPlatformSession,
  logoutPlatform,
  PLATFORM_KEY,
  isNetworkErrorMessage
} from "@/lib/api";
import { getCachedPlatformMe, loadPlatformMe } from "@/lib/me-cache";
import { PageLoading } from "@/components/ui/Spinner";
import {
  IconBilling,
  IconHome,
  IconInbox,
  IconMore,
  IconPeople,
  IconSettings,
  IconSpark,
  IconSupport
} from "@/components/ui/Icons";

const PRIMARY = [
  { href: "/super", label: "گزارش", Icon: IconHome, exact: true },
  { href: "/super/businesses", label: "کسب‌وکارها", Icon: IconPeople },
  { href: "/super/payments", label: "پرداخت‌ها", Icon: IconBilling },
  { href: "/super/tickets", label: "پشتیبانی", Icon: IconSupport }
] as const;

const MORE = [
  { href: "/super/plans", label: "پلن‌ها", Icon: IconSpark },
  { href: "/super/sms-templates", label: "قالب پیامک", Icon: IconInbox },
  { href: "/super/ai", label: "تنظیمات AI", Icon: IconSettings },
  { href: "/super/ai-playground", label: "زمین‌بازی AI", Icon: IconSpark },
  { href: "/super/system", label: "سیستم", Icon: IconSettings }
] as const;

const ALL_NAV = [...PRIMARY, ...MORE];

function isActive(pathname: string, href: string, exact?: boolean) {
  if (exact || href === "/super") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function SuperShell({
  title,
  sub,
  children,
  actions
}: {
  title: string;
  sub: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const cached = getCachedPlatformMe();
  const [ready, setReady] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [userLabel, setUserLabel] = useState(
    cached?.user?.display_name || cached?.user?.phone || "سوپر ادمین"
  );

  useEffect(() => {
    if (!getPlatformSession()) {
      setReady(false);
      router.replace("/super/login");
      return;
    }
    let cancelled = false;
    loadPlatformMe(true)
      .then((me) => {
        if (cancelled) return;
        setUserLabel(me.user?.display_name || me.user?.phone || "سوپر ادمین");
        setReady(true);
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "";
        if (isNetworkErrorMessage(msg) || getPlatformSession()) {
          const cachedMe = getCachedPlatformMe();
          if (cachedMe?.user) {
            setUserLabel(cachedMe.user.display_name || cachedMe.user.phone || "سوپر ادمین");
          }
          setReady(true);
          return;
        }
        clearPlatformSession();
        setReady(false);
        router.replace("/super/login");
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== PLATFORM_KEY && e.key !== null) return;
      if (!getPlatformSession()) {
        setReady(false);
        router.replace("/super/login");
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [router]);

  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!moreOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [moreOpen]);

  if (!ready) {
    return (
      <div className="page-loading shell-boot" style={{ minHeight: "100dvh" }}>
        <PageLoading />
      </div>
    );
  }

  const initials = (userLabel || "س").trim().slice(0, 1);
  const moreActive = MORE.some((l) => isActive(pathname, l.href));

  function doLogout() {
    void logoutPlatform().finally(() => {
      setReady(false);
      router.replace("/super/login");
    });
  }

  return (
    <div className={`app-shell super-shell has-tabbar ${collapsed ? "collapsed" : ""}`}>
      <aside className="sidebar desktop-sidebar">
        <div className="sidebar-top">
          <div className="brand-block">
            <div className="brand">بیدار</div>
            <div className="brand-sub">platform</div>
          </div>
          <button
            type="button"
            className="icon-btn sidebar-collapse-btn"
            aria-label="جمع کردن منو"
            onClick={() => setCollapsed((v) => !v)}
          >
            ☰
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
          {ALL_NAV.map((item) => {
            const active = isActive(pathname, item.href, "exact" in item ? item.exact : false);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={active ? "active" : ""}
                title={item.label}
              >
                <span className="nav-ico" aria-hidden>
                  <item.Icon size={18} />
                </span>
                <span className="label">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-foot">
          <Link href="/login" className="btn secondary" style={{ textAlign: "center" }}>
            <span className="label">ورود کسب‌وکار</span>
          </Link>
          <button className="btn secondary" onClick={doLogout}>
            <span className="label">خروج سوپر ادمین</span>
          </button>
        </div>
      </aside>

      <div className="main-wrap">
        <header className="topbar">
          <div className="topbar-titles">
            <h1 className="page-title">{title}</h1>
            {sub ? <p className="page-sub">{sub}</p> : null}
          </div>
          {actions ? <div className="topbar-actions">{actions}</div> : null}
        </header>
        <main className="main">{children}</main>
      </div>

      <nav className="bottom-nav" aria-label="منوی پلتفرم">
        {PRIMARY.map((item) => {
          const active = isActive(pathname, item.href, "exact" in item ? item.exact : false);
          const Icon = item.Icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`bottom-nav-item${active ? " active" : ""}`}
              aria-current={active ? "page" : undefined}
            >
              <Icon size={22} />
              <span>{item.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          className={`bottom-nav-item${moreActive || moreOpen ? " active" : ""}`}
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen(true)}
        >
          <IconMore size={22} />
          <span>بیشتر</span>
        </button>
      </nav>

      {moreOpen ? (
        <div
          className="more-sheet-backdrop"
          role="presentation"
          onClick={() => setMoreOpen(false)}
        >
          <div
            className="more-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="منوی بیشتر"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sheet-handle" aria-hidden />
            <div className="more-sheet-head">
              <h2>بیشتر</h2>
              <button
                type="button"
                className="icon-btn"
                aria-label="بستن"
                onClick={() => setMoreOpen(false)}
              >
                ✕
              </button>
            </div>
            <div className="more-sheet-list">
              {MORE.map(({ href, label, Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className={`more-sheet-row${isActive(pathname, href) ? " active" : ""}`}
                  onClick={() => setMoreOpen(false)}
                >
                  <span className="more-sheet-ico" aria-hidden>
                    <Icon size={20} />
                  </span>
                  <span className="more-sheet-label">{label}</span>
                </Link>
              ))}
              <Link
                href="/login"
                className="more-sheet-row"
                onClick={() => setMoreOpen(false)}
              >
                <span className="more-sheet-label">ورود کسب‌وکار</span>
              </Link>
              <button type="button" className="more-sheet-row danger" onClick={doLogout}>
                <span className="more-sheet-label">خروج سوپر ادمین</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
