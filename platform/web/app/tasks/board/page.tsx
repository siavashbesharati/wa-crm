"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function TasksBoardRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const lead = searchParams.get("lead");
    const tag = searchParams.get("tag");
    const params = new URLSearchParams();
    if (lead) params.set("lead", lead);
    if (tag) params.set("tag", tag);
    // Prefer list on mobile entry via /tasks/board redirect; keep board opt-in
    const mobile = window.matchMedia("(max-width: 960px)").matches;
    if (mobile) {
      const qs = params.toString();
      router.replace(`/tasks/list${qs ? `?${qs}` : ""}`);
      return;
    }
    params.set("layout", "board");
    const qs = params.toString();
    router.replace(`/tasks?${qs}`);
  }, [router, searchParams]);

  return null;
}
