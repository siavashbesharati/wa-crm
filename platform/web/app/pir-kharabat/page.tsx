"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { PageLoading } from "@/components/ui/Spinner";

function RedirectInner() {
  const router = useRouter();
  const search = useSearchParams();
  useEffect(() => {
    const q = search.toString();
    router.replace(q ? `/aghaye-pashmak?${q}` : "/aghaye-pashmak");
  }, [router, search]);
  return <PageLoading />;
}

/** Legacy URL → /aghaye-pashmak */
export default function LegacyPirRedirect() {
  return (
    <Suspense fallback={<PageLoading />}>
      <RedirectInner />
    </Suspense>
  );
}
