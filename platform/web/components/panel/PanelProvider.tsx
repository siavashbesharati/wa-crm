"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import { usePathname, useRouter } from "next/navigation";
import ShellChrome from "@/components/ShellChrome";
import { PageLoading } from "@/components/ui/Spinner";

export type PanelMeta = {
  title: string;
  sub: string;
  actions?: ReactNode;
  search?: string;
  onSearch?: (v: string) => void;
};

type PanelContextValue = {
  setMeta: (meta: PanelMeta) => void;
  beginNav: (href: string) => void;
  pendingHref: string | null;
};

const PanelContext = createContext<PanelContextValue | null>(null);

const PANEL_PREFIXES = [
  "/home",
  "/leads",
  "/pipeline",
  "/inbox",
  "/tasks",
  "/channels",
  "/seats",
  "/team",
  "/knowledge",
  "/ai-settings",
  "/kpi",
  "/billing",
  "/support",
  "/whatsapp"
];

export function isPanelPath(pathname: string) {
  return PANEL_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}

export function usePanel() {
  const ctx = useContext(PanelContext);
  if (!ctx) {
    throw new Error("usePanel must be used within PanelProvider");
  }
  return ctx;
}

/** Optional: pages outside panel chrome should not call this. */
export function usePanelOptional() {
  return useContext(PanelContext);
}

export function PanelProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const onPanel = isPanelPath(pathname);
  const [meta, setMetaState] = useState<PanelMeta>({
    title: "پنل",
    sub: ""
  });
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  const setMeta = useCallback((next: PanelMeta) => {
    setMetaState((prev) => {
      if (
        prev.title === next.title &&
        prev.sub === next.sub &&
        prev.search === next.search &&
        prev.onSearch === next.onSearch
      ) {
        // Avoid re-render loops from inline `actions={<.../>}` on every page render.
        return prev;
      }
      return next;
    });
  }, []);

  const beginNav = useCallback(
    (href: string) => {
      if (!href || href === pathname) return;
      setPendingHref(href);
      const hit = PANEL_PREFIXES.find((p) => href === p || href.startsWith(`${p}/`));
      if (hit) {
        const labels: Record<string, string> = {
          "/home": "میز کار",
          "/leads": "لیدها",
          "/pipeline": "پایپلاین",
          "/inbox": "اینباکس",
          "/tasks": "وظایف",
          "/channels": "کانال‌ها",
          "/seats": "صندلی افزونه",
          "/team": "تیم",
          "/knowledge": "دانش AI",
          "/ai-settings": "تنظیمات AI",
          "/kpi": "KPI / OKR",
          "/billing": "اشتراک و پرداخت",
          "/support": "پشتیبانی"
        };
        setMetaState((m) => ({
          ...m,
          title: labels[hit] || m.title,
          sub: "در حال بارگذاری…",
          actions: undefined,
          search: undefined,
          onSearch: undefined
        }));
      }
    },
    [pathname]
  );

  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);

  useEffect(() => {
    if (!onPanel) return;
    for (const href of PANEL_PREFIXES) {
      try {
        router.prefetch(href);
      } catch {
        /* ignore */
      }
    }
  }, [onPanel, router]);

  const value = useMemo(
    () => ({ setMeta, beginNav, pendingHref }),
    [setMeta, beginNav, pendingHref]
  );

  if (!onPanel) {
    return <>{children}</>;
  }

  const showNavShimmer = !!pendingHref && pendingHref !== pathname;

  return (
    <PanelContext.Provider value={value}>
      <ShellChrome
        title={meta.title}
        sub={meta.sub}
        actions={meta.actions}
        search={meta.search}
        onSearch={meta.onSearch}
        onNavigate={beginNav}
      >
        {showNavShimmer ? <PageLoading /> : children}
      </ShellChrome>
    </PanelContext.Provider>
  );
}

/** Register page title/actions into the persistent shell. */
export function usePanelPage(meta: PanelMeta) {
  const ctx = usePanelOptional();
  useLayoutEffect(() => {
    if (!ctx) return;
    ctx.setMeta(meta);
    // actions omitted on purpose — often an inline element; title/sub/search drive updates
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, meta.title, meta.sub, meta.search, meta.onSearch]);
}
