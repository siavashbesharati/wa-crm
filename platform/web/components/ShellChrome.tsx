"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearSession, getSession, logoutOrg, ORG_KEY, api, isNetworkErrorMessage } from "@/lib/api";
import {
  EXTENSION_DOWNLOAD_NAME,
  EXTENSION_DOWNLOAD_URL,
  EXTENSION_VERSION_FALLBACK,
  type ExtensionMeta
} from "@/lib/extension";
import { getCachedOrgMe, loadOrgMe } from "@/lib/me-cache";
import { useEffect, useState, type ReactNode } from "react";
import { PageLoading } from "@/components/ui/Spinner";

const NAV = [
  { href: "/home", label: "میز کار", ico: "⌂" },
  { href: "/leads", label: "مخاطبین", ico: "☰" },
  { href: "/inbox", label: "اینباکس", ico: "✉" },
  { href: "/tasks", label: "وظایف", ico: "☑" },
  { href: "/channels", label: "کانال‌ها", ico: "☎" },
  { href: "/seats", label: "صندلی افزونه", ico: "🔑" },
  { href: "/team", label: "تیم", ico: "☺" },
  { href: "/knowledge", label: "دانش AI", ico: "✦" },
  { href: "/ai-settings", label: "تنظیمات AI", ico: "⚙" },
  { href: "/kpi", label: "KPI / OKR", ico: "◉" },
  { href: "/support", label: "پشتیبانی", ico: "?" }
];

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
  onNavigate
}: {
  title: string;
  sub: string;
  children: ReactNode;
  actions?: ReactNode;
  search?: string;
  onSearch?: (v: string) => void;
  onNavigate?: (href: string) => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const cached = getCachedOrgMe();
  const initial = profileFromMe(cached);

  const [ready, setReady] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [orgName, setOrgName] = useState(initial.orgName);
  const [userLabel, setUserLabel] = useState(initial.userLabel);
  const [planId, setPlanId] = useState(initial.planId);
  const [planName, setPlanName] = useState(initial.planName);
  const [daysRemaining, setDaysRemaining] = useState<number | null>(
    initial.daysRemaining
  );
  const [extVersion, setExtVersion] = useState(EXTENSION_VERSION_FALLBACK);

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const latest = await api<ExtensionMeta & { ok?: boolean }>("/extension/latest", {
          auth: false
        });
        if (!cancelled && latest?.version) {
          setExtVersion(latest.version);
          return;
        }
      } catch {
        /* fall through */
      }
      try {
        const r = await fetch("/downloads/extension-meta.json", { cache: "no-store" });
        const meta = r.ok ? ((await r.json()) as ExtensionMeta) : null;
        if (!cancelled && meta?.version) setExtVersion(meta.version);
      } catch {
        /* keep fallback */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
      <div className="page-loading shell-boot" style={{ minHeight: "100vh" }}>
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

  return (
    <div className={`app-shell ${collapsed ? "collapsed" : ""}${mobileOpen ? " nav-open" : ""}`}>
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
            <div className="brand">CRM چندکاناله</div>
            <div className="brand-sub">پنل کسب‌وکار</div>
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
              className={pathname.startsWith(item.href) ? "active" : ""}
              title={item.label}
              onClick={() => navTo(item.href)}
            >
              <span className="nav-ico">{item.ico}</span>
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
              ◆
            </span>
            <span className="label billing-cta-meta">
              <strong>اشتراک</strong>
              <em>{billingSub}</em>
            </span>
          </Link>
          <a
            className="ext-download-btn"
            href={EXTENSION_DOWNLOAD_URL}
            download={EXTENSION_DOWNLOAD_NAME}
            title={`دانلود افزونه نسخه ${extVersion}`}
          >
            <span className="ext-download-ico" aria-hidden>
              ↓
            </span>
            <span className="label ext-download-meta">
              <strong>دانلود افزونه</strong>
              <em>نسخه {extVersion}</em>
            </span>
          </a>
          <button
            className="btn secondary"
            onClick={() => {
              void logoutOrg().finally(() => {
                setReady(false);
                router.replace("/login");
              });
            }}
          >
            <span className="label">خروج</span>
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
