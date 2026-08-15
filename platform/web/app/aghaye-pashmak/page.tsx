"use client";

import { Suspense } from "react";
import Shell from "@/components/Shell";
import { PageLoading } from "@/components/ui/Spinner";
import { PASHMAK_NAME } from "@/components/AghaPashmakFloat";
import PirPageClient from "./PirPageClient";

export default function Page() {
  return (
    <Suspense
      fallback={
        <Shell title={PASHMAK_NAME} sub="مربی هوشمند کسب‌وکار">
          <PageLoading />
        </Shell>
      }
    >
      <PirPageClient />
    </Suspense>
  );
}
