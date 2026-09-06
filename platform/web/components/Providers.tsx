"use client";

import { useEffect, type ReactNode } from "react";
import { ToastProvider } from "@/components/ui/Toast";
import { PanelProvider } from "@/components/panel/PanelProvider";

const THEME_LIGHT = "#f5f5f7";
const THEME_DARK = "#000000";

/** Keeps browser chrome / status bar color in sync with app light/dark theme. */
function ThemeColorSync() {
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");

    function apply() {
      const dark = mq.matches;
      const color = dark ? THEME_DARK : THEME_LIGHT;
      let meta = document.querySelector('meta[name="theme-color"]');
      if (!meta) {
        meta = document.createElement("meta");
        meta.setAttribute("name", "theme-color");
        document.head.appendChild(meta);
      }
      meta.setAttribute("content", color);
      document.documentElement.style.colorScheme = dark ? "dark" : "light";
    }

    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  return null;
}

/** Tracks virtual keyboard via visualViewport → --keyboard-inset on :root */
function KeyboardInset() {
  useEffect(() => {
    const root = document.documentElement;
    const vv = window.visualViewport;
    if (!vv) {
      root.style.setProperty("--keyboard-inset", "0px");
      return;
    }

    function sync() {
      const inset = Math.max(0, window.innerHeight - vv!.height - vv!.offsetTop);
      root.style.setProperty("--keyboard-inset", `${Math.round(inset)}px`);
    }

    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    window.addEventListener("orientationchange", sync);
    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
      window.removeEventListener("orientationchange", sync);
      root.style.setProperty("--keyboard-inset", "0px");
    };
  }, []);

  return null;
}

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <ThemeColorSync />
      <KeyboardInset />
      <PanelProvider>{children}</PanelProvider>
    </ToastProvider>
  );
}
