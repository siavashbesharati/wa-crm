"use client";

import { ToastProvider } from "@/components/ui/Toast";
import { PanelProvider } from "@/components/panel/PanelProvider";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <PanelProvider>{children}</PanelProvider>
    </ToastProvider>
  );
}
