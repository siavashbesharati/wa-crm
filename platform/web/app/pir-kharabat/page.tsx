"use client";

import { useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageLoading } from "@/components/ui/Spinner";

function RedirectInner() {
  const router = useRouter();
  const search = useSearchParams();
  useEffect(() => {
    const q = search.toString();
    router.replace(q ? `/ai-coach?${q}` : "/ai-coach");
  }, [router, search]);
  return <PageLoading />;
}

/** Legacy URL → /ai-coach */
export default function LegacyPirRedirect() {
  return (
    <Suspense fallback={<PageLoading />}>
      <RedirectInner />
    </Suspense>
  );
}
