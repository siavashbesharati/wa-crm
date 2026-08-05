"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getSession } from "@/lib/api";

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    // Dev: public super-admin first; org panel when a session is chosen
    router.replace(getSession() ? "/home" : "/admin");
  }, [router]);
  return null;
}
