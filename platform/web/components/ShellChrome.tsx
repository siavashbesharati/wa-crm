"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearSession, getSession, logoutOrg, ORG_KEY, isNetworkErrorMessage } from "@/lib/api";
import { getCachedOrgMe, loadOrgMe } from "@/lib/me-cache";
import { useEffect, useState, type ReactNode } from "react";
import { PageLoading } from "@/components/ui/Spinner";
import { BottomNav } from "@/components/ui/BottomNav";
import {
  IconBilling,
  IconCampaigns,
  IconChannels,
  IconGroups,
  IconHome,
  IconInbox,
  IconKpi,
  IconPeople,
  IconSettings,
  IconSpark,
  IconSupport,
  IconTasks,
  IconTeam
} from "@/components/ui/Icons";

const NAV = [
  { href: "/home", label: "میز کار", Icon: IconHome },
  { href: "/inbox", label: "اینباکس", Icon: IconInbox },
  { href: "/leads", label: "مخاطبین", Icon: IconPeople },
  { href: "/tasks", label: "وظایف", Icon: IconTasks },
  { href: "/campaigns", label: "کمپین‌ها", Icon: IconCampaigns },
  { href: "/channels", label: "کانال‌ها", Icon: IconChannels },
  { href: "/groups", label: "گروه‌ها", Icon: IconGroups },
  { href: "/team", label: "تیم", Icon: IconTeam },
  { href: "/knowledge", label: "دانش AI", Icon: IconSpark },
  { href: "/ai-settings", label: "تنظیمات AI", Icon: IconSettings },
  { href: "/ai-coach", label: "آقای میوژن", Icon: IconSpark },
  { href: "/kpi", label: "KPI / OKR", Icon: IconKpi },
  { href: "/support", label: "پشتیبانی", Icon: IconSupport }
];

function isNavActive(pathname: string, href: string) {
  if (href === "/home") return pathname === "/home" || pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function profileFromMe(me: Awaited<ReturnType<typeof loadOrgMe>> | null) {
  if (!me) {
    return {
      orgName: "",
      userLabel: "",
      planId: "",
      planName: "",
      daysRemaining: null as number | null
    };
  }
  const id = me.org?.plan || "";
  return {
    orgName: me.org?.name || "",
    userLabel: me.user?.display_name || me.user?.phone || "",
    planId: id,
    planName: me.org?.plan_label || me.org?.limits?.label || id || "—",
    daysRemaining:
      typeof me.org?.days_remaining === "number" ? me.org.days_remaining : null
  };
}

export default function ShellChrome({
  title,
  sub,
  children,
  actions,
  search,
  onSearch,
  onNavigate,
  hideTabBar = false,
  fullBleed = false,
  hideTopBar = false
}: {
  title: string;
  sub: string;
  children: ReactNode;
  actions?: ReactNode;
  search?: string;
  onSearch?: (v: string) => void;
  onNavigate?: (href: string) => void;
  hideTabBar?: boolean;
  fullBleed?: boolean;
  hideTopBar?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const cached = getCachedOrgMe();
  const initial = profileFromMe(cached);

  const [ready, setReady] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [orgName, setOrgName] = useState(initial.orgName);
  const [userLabel, setUserLabel] = useState(initial.userLabel);
  const [planId, setPlanId] = useState(initial.planId);
  const [planName, setPlanName] = useState(initial.planName);
  const [daysRemaining, setDaysRemaining] = useState<number | null>(
    initial.daysRemaining
  );

  useEffect(() => {
    if (!getSession()) {
      setReady(false);
      router.replace("/login");
      return;
    }
    let cancelled = false;
    loadOrgMe(true)
      .then((me) => {
        if (cancelled) return;
        if (me.needs_onboarding || (me.onboarding_step && me.onboarding_step !== "done")) {
          router.replace("/onboarding");
          return;
        }
        const next = profileFromMe(me);
        setOrgName(next.orgName);
        setUserLabel(next.userLabel);
        setPlanId(next.planId);
        setPlanName(next.planName);
        setDaysRemaining(next.daysRemaining);
        setReady(true);
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "";
        if (isNetworkErrorMessage(msg) || getSession()) {
          const cachedProfile = profileFromMe(getCachedOrgMe());
          setOrgName(cachedProfile.orgName);
          setUserLabel(cachedProfile.userLabel);
          setPlanId(cachedProfile.planId);
          setPlanName(cachedProfile.planName);
          setDaysRemaining(cachedProfile.daysRemaining);
          setReady(true);
          return;
        }
        clearSession();
        setReady(false);
        router.replace("/login");
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== ORG_KEY && e.key !== null) return;
      if (!getSession()) {
        setReady(false);
        router.replace("/login");
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [router]);

  if (!ready) {
    return (
      <div className="page-loading shell-boot" style={{ minHeight: "100dvh" }}>
        <PageLoading />
      </div>
    );
  }

  const initials = (userLabel || "ک").trim().slice(0, 1);
  const billingSub =
    daysRemaining === null
      ? planId === "starter" || !planId
        ? `${planName} · آزمایشی`
        : `${planName} · تمدید اشتراک`
      : daysRemaining === 0
        ? `${planName} · منقضی شده`
        : `${planName} · ${daysRemaining.toLocaleString("fa-IR")} روز باقی‌مانده`;

  function navTo(href: string) {
    onNavigate?.(href);
  }

  function doLogout() {
    void logoutOrg().finally(() => {
      setReady(false);
      router.replace("/login");
    });
  }

  const tabHidden = hideTabBar;
  const shellClass = [
    "app-shell",
    "has-tabbar",
    collapsed ? "collapsed" : "",
    tabHidden ? "tabbar-hidden" : "",
    fullBleed ? "full-bleed" : "",
    hideTopBar ? "topbar-hidden" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={shellClass}>
      <aside className="sidebar desktop-sidebar">
        <div className="sidebar-top">
          <div className="brand-block">
            <div className="brand">بیدار</div>
            <div className="brand-sub">bidar</div>
          </div>
          <button
            type="button"
            className="icon-btn sidebar-collapse-btn"
            aria-label={collapsed ? "باز کردن منو" : "جمع کردن منو"}
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
              prefetch
              className={isNavActive(pathname, item.href) ? "active" : ""}
              title={item.label}
              onClick={() => navTo(item.href)}
            >
              <span className="nav-ico" aria-hidden>
                <item.Icon size={18} />
              </span>
              <span className="label">{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="sidebar-foot">
          <Link
            className={`billing-cta-btn${daysRemaining === 0 ? " expired" : ""}`}
            href="/billing"
            prefetch
            title="اشتراک و پرداخت"
            onClick={() => navTo("/billing")}
          >
            <span className="billing-cta-ico" aria-hidden>
              <IconBilling size={16} />
            </span>
            <span className="label billing-cta-meta">
              <strong>اشتراک</strong>
              <em>{billingSub}</em>
            </span>
          </Link>
          <button className="btn secondary" onClick={doLogout}>
            <span className="label">خروج</span>
          </button>
        </div>
      </aside>

      <div className="main-wrap">
        {getSession()?.is_demo && (
          <div className="demo-banner" role="status">
            <span className="demo-banner-dot" aria-hidden />
            <span className="demo-banner-label">حساب دمو</span>
            <span className="demo-banner-text">
              شما در حال مشاهدهٔ نمونهٔ کامل «دپارتمان ملک پارامیس» هستید — همهٔ
              داده‌ها از پیش بارگذاری شده‌اند. برای استفادهٔ واقعی، از دکمهٔ خروج
              استفاده کنید.
            </span>
          </div>
        )}
        {!hideTopBar ? (
          <header className="topbar">
            <div className="topbar-titles">
              <h1 className="page-title">{title}</h1>
              {sub ? <p className="page-sub">{sub}</p> : null}
            </div>
            {onSearch && (
              <input
                className="top-search"
                type="search"
                enterKeyHint="search"
                placeholder="جستجو…"
                value={search || ""}
                onChange={(e) => onSearch(e.target.value)}
                aria-label="جستجو"
              />
            )}
            {actions ? <div className="topbar-actions">{actions}</div> : null}
          </header>
        ) : null}
        <main
          className={`main${tabHidden ? " main-no-tabbar" : ""}${fullBleed ? " main-full-bleed" : ""}`}
        >
          {children}
        </main>
      </div>

      <BottomNav
        hidden={tabHidden}
        onNavigate={navTo}
        onLogout={doLogout}
      />
    </div>
  );
}
