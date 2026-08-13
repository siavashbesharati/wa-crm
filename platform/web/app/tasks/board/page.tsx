"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function TasksBoardRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const lead = searchParams.get("lead");
    router.replace(lead ? `/tasks?lead=${encodeURIComponent(lead)}` : "/tasks");
  }, [router, searchParams]);

  return null;
}
