"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Legacy login route — OTP is only for the extension; admin is public. */
export default function LoginRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/admin");
  }, [router]);
  return null;
}
