"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getPlatformSession } from "@/lib/api";

export default function SuperIndexPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace(getPlatformSession() ? "/super/businesses" : "/super/login");
  }, [router]);
  return null;
}
