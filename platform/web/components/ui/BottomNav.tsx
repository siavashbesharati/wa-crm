"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  IconChannels,
  IconCampaigns,
  IconBilling,
  IconGroups,
  IconHome,
  IconInbox,
  IconKpi,
  IconLogout,
  IconMore,
  IconPeople,
  IconSettings,
  IconSpark,
  IconSupport,
  IconTasks,
  IconTeam
} from "@/components/ui/Icons";

/** Order matches RTL visual: میز کار | وظایف | مربی | اینباکس (+ بیشتر) */
export const PRIMARY_TABS = [
  { href: "/home", label: "میز کار", Icon: IconHome, featured: false },
  { href: "/tasks/list", label: "وظایف", Icon: IconTasks, featured: false },
  {
    href: "/ai-coach",
    label: "مربی",
    ariaLabel: "مربی هوش مصنوعی",
    Icon: IconSpark,
    featured: true
  },
  { href: "/inbox", label: "اینباکس", Icon: IconInbox, featured: false }
] as const;

export const MORE_LINKS = [
  { href: "/leads", label: "مخاطبین", Icon: IconPeople },
  { href: "/campaigns", label: "کمپین‌ها", Icon: IconCampaigns },
  { href: "/channels", label: "کانال‌ها", Icon: IconChannels },
  { href: "/groups", label: "گروه‌ها", Icon: IconGroups },
  { href: "/team", label: "تیم", Icon: IconTeam },
  { href: "/knowledge", label: "دانش AI", Icon: IconSpark },
  { href: "/ai-settings", label: "تنظیمات AI", Icon: IconSettings },
  { href: "/kpi", label: "KPI / OKR", Icon: IconKpi },
  { href: "/support", label: "پشتیبانی", Icon: IconSupport },
  { href: "/billing", label: "اشتراک", Icon: IconBilling }
] as const;

function isActive(pathname: string, href: string) {
  if (href === "/home") return pathname === "/home" || pathname === "/";
  if (href === "/tasks/list" || href === "/tasks") {
    return pathname === "/tasks" || pathname.startsWith("/tasks/");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function BottomNav({
  hidden = false,
  onNavigate,
  onLogout
}: {
  hidden?: boolean;
  onNavigate?: (href: string) => void;
  onLogout?: () => void;
}) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

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

  const moreActive =
    MORE_LINKS.some((l) => isActive(pathname, l.href)) || pathname === "/billing";

  if (hidden) return null;

  return (
    <>
      <nav className="bottom-nav" aria-label="منوی اصلی">
        {PRIMARY_TABS.map((tab) => {
          const { href, label, Icon, featured } = tab;
          const active = isActive(pathname, href);
          const ariaLabel = "ariaLabel" in tab ? tab.ariaLabel : undefined;
          return (
            <Link
              key={href}
              href={href}
              prefetch
              className={`bottom-nav-item${featured ? " bottom-nav-featured" : ""}${
                active ? " active" : ""
              }`}
              aria-label={ariaLabel}
              aria-current={active ? "page" : undefined}
              onClick={() => onNavigate?.(href)}
            >
              <span className={featured ? "bottom-nav-featured-ico" : undefined} aria-hidden>
                <Icon size={featured ? 24 : 22} />
              </span>
              <span>{label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          className={`bottom-nav-item${moreActive || moreOpen ? " active" : ""}`}
          aria-expanded={moreOpen}
          aria-haspopup="dialog"
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
              {MORE_LINKS.map(({ href, label, Icon }) => {
                const active = isActive(pathname, href);
                return (
                  <Link
                    key={href}
                    href={href}
                    prefetch
                    className={`more-sheet-row${active ? " active" : ""}`}
                    onClick={() => {
                      onNavigate?.(href);
                      setMoreOpen(false);
                    }}
                  >
                    <span className="more-sheet-ico" aria-hidden>
                      <Icon size={20} />
                    </span>
                    <span className="more-sheet-label">{label}</span>
                    <span className="more-sheet-chevron" aria-hidden>
                      ‹
                    </span>
                  </Link>
                );
              })}
              {onLogout ? (
                <button
                  type="button"
                  className="more-sheet-row danger"
                  onClick={() => {
                    setMoreOpen(false);
                    onLogout();
                  }}
                >
                  <span className="more-sheet-ico" aria-hidden>
                    <IconLogout size={20} />
                  </span>
                  <span className="more-sheet-label">خروج</span>
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function MoreMenuTrigger({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}
