"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { api, getPlatformSession, getSession } from "@/lib/api";

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    (async () => {
      if (getSession()) {
        try {
          const me = await api<{ needs_onboarding?: boolean; onboarding_step?: string }>(
            "/auth/me"
          );
          if (me.needs_onboarding || (me.onboarding_step && me.onboarding_step !== "done")) {
            router.replace("/onboarding");
            return;
          }
        } catch {
          /* fall through to home; Shell will re-auth */
        }
        router.replace("/home");
        return;
      }
      if (getPlatformSession()) {
        router.replace("/super/businesses");
        return;
      }
      router.replace("/login");
    })();
  }, [router]);
  return null;
}
