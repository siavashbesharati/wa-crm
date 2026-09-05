"use client";

import { useEffect, type ReactNode } from "react";
import { ToastProvider } from "@/components/ui/Toast";
import { PanelProvider } from "@/components/panel/PanelProvider";

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
      <KeyboardInset />
      <PanelProvider>{children}</PanelProvider>
    </ToastProvider>
  );
}
