"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearSession, getSession } from "@/lib/api";
import { useEffect, useState } from "react";

const NAV = [
  { href: "/leads", label: "لیدها" },
  { href: "/pipeline", label: "پایپلاین" },
  { href: "/inbox", label: "اینباکس" },
  { href: "/tasks", label: "وظایف تیمی" },
  { href: "/whatsapp", label: "شماره‌های واتساپ" },
  { href: "/team", label: "اعضای تیم" },
  { href: "/knowledge", label: "پایگاه دانش AI" },
  { href: "/ai-settings", label: "تنظیمات AI" },
  { href: "/kpi", label: "KPI / OKR" }
];

export default function Shell({
  title,
  sub,
  children
}: {
  title: string;
  sub: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getSession()) {
      router.replace("/login");
      return;
    }
    setReady(true);
  }, [router]);

  if (!ready) return <div className="main">در حال بارگذاری...</div>;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <div className="brand">CRM واتساپ</div>
          <div className="brand-sub">پلتفرم ابری B2B</div>
        </div>
        <nav className="nav">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={pathname.startsWith(item.href) ? "active" : ""}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <button
          className="btn secondary"
          style={{ marginTop: "auto" }}
          onClick={() => {
            clearSession();
            router.replace("/login");
          }}
        >
          خروج
        </button>
      </aside>
      <main className="main">
        <h1 className="page-title">{title}</h1>
        <p className="page-sub">{sub}</p>
        {children}
      </main>
    </div>
  );
}
