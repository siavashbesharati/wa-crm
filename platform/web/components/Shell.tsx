"use client";

import type { ReactNode } from "react";
import { usePanelOptional, usePanelPage } from "@/components/panel/PanelProvider";
import ShellChrome from "@/components/ShellChrome";

/**
 * Page wrapper: registers title into the persistent panel chrome.
 * When PanelProvider is active, only children render (sidebar stays mounted).
 * Fallback: renders full ShellChrome (e.g. edge cases without provider).
 */
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
  children: ReactNode;
  actions?: ReactNode;
  search?: string;
  onSearch?: (v: string) => void;
}) {
  const panel = usePanelOptional();
  usePanelPage({ title, sub, actions, search, onSearch });

  if (panel) {
    return <>{children}</>;
  }

  return (
    <ShellChrome
      title={title}
      sub={sub}
      actions={actions}
      search={search}
      onSearch={onSearch}
    >
      {children}
    </ShellChrome>
  );
}
