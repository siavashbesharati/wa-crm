"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { PageLoading } from "@/components/ui/Spinner";

/** Legacy route — redirects to multi-channel page. */
export default function WhatsAppRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/channels");
  }, [router]);
  return <PageLoading />;
}
