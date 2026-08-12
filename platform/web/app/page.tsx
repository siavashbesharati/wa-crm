"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { api, getPlatformSession, getSession } from "@/lib/api";

const ME_TIMEOUT_MS = 4000;

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (getSession()) {
        try {
          const me = await Promise.race([
            api<{ needs_onboarding?: boolean; onboarding_step?: string }>("/auth/me"),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("timeout")), ME_TIMEOUT_MS)
            ),
          ]);
          if (cancelled) return;
          if (me.needs_onboarding || (me.onboarding_step && me.onboarding_step !== "done")) {
            router.replace("/onboarding");
            return;
          }
        } catch {
          /* API down or timeout — still go home; Shell will re-auth */
        }
        if (!cancelled) router.replace("/home");
        return;
      }
      if (getPlatformSession()) {
        if (!cancelled) router.replace("/super/businesses");
        return;
      }
      if (!cancelled) router.replace("/login");
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        fontFamily: "system-ui, sans-serif",
        color: "#64748b",
        fontSize: 14,
      }}
    >
      در حال انتقال…
    </div>
  );
}
