"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Shell from "@/components/Shell";
import { Card } from "@/components/ui/Card";
import { PageLoading } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";

type Me = {
  org: { name: string; plan: string; limits: Record<string, unknown> };
  role: string;
  user: { phone: string; display_name: string };
};

type Dash = {
  metrics: Record<string, number>;
};

export default function HomePage() {
  const [me, setMe] = useState<Me | null>(null);
  const [dash, setDash] = useState<Dash | null>(null);
  const [accounts, setAccounts] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const m = await api<Me>("/auth/me");
        setMe(m);
        await api("/kpi/rollup", { method: "POST" }).catch(() => null);
        setDash(await api<Dash>("/kpi/dashboard"));
        const acc = await api<{ id: string }[]>("/whatsapp/accounts");
        setAccounts(acc.length);
      } catch (e) {
        toast.push(e instanceof Error ? e.message : "خطا", "err");
      } finally {
        setLoading(false);
      }
    })();
  }, [toast]);

  const steps = [
    {
      done: accounts > 0,
      title: "افزودن شماره واتساپ",
      href: "/whatsapp",
      text: "حداقل یک شماره کسب‌وکار ثبت کنید"
    },
    {
      done: (dash?.metrics.leads_total || 0) > 0,
      title: "اولین لید",
      href: "/leads",
      text: "لید دستی بسازید یا از افزونه همگام شود"
    },
    {
      done: false,
      title: "نصب افزونه کانکتور",
      href: "/whatsapp",
      text: "روی یک PC همیشه روشن، افزونه را با نقش کانکتور وصل کنید"
    },
    {
      done: false,
      title: "دانش AI",
      href: "/knowledge",
      text: "FAQ و قیمت‌ها را آپلود کنید تا پیشنهاد پاسخ فعال شود"
    }
  ];

  return (
    <Shell title="میز کار" sub="وضعیت سازمان و مسیر راه‌اندازی فروش">
      {loading ? (
        <PageLoading />
      ) : (
        <>
          {me && (
            <Card>
              <strong>{me.org.name}</strong>
              <div className="hint" style={{ marginTop: 6 }}>
                پلن {me.org.plan} · نقش شما: {me.role} · سقف{" "}
                {String(me.org.limits.max_seats)} کاربر /{" "}
                {String(me.org.limits.max_wa_numbers)} شماره واتساپ
              </div>
            </Card>
          )}

          <div className="stats">
            <div className="stat">
              <span>{dash?.metrics.leads_total ?? 0}</span>
              <small>لید</small>
            </div>
            <div className="stat">
              <span>{dash?.metrics.conversion_rate ?? 0}%</span>
              <small>نرخ تبدیل</small>
            </div>
            <div className="stat">
              <span>{dash?.metrics.tasks_open ?? 0}</span>
              <small>وظیفه باز</small>
            </div>
            <div className="stat">
              <span>{accounts}</span>
              <small>شماره واتساپ</small>
            </div>
          </div>

          <Card title="راه‌اندازی سریع">
            {steps.map((s) => (
              <Link
                key={s.title}
                href={s.href}
                className={`checklist-item ${s.done ? "done" : ""}`}
              >
                <strong>
                  {s.done ? "✓ " : "○ "}
                  {s.title}
                </strong>
                <div className="hint">{s.text}</div>
              </Link>
            ))}
          </Card>

          <div className="row-actions">
            <Link className="btn" href="/inbox">
              اینباکس یکپارچه
            </Link>
            <Link className="btn secondary" href="/pipeline">
              پایپلاین
            </Link>
            <Link className="btn secondary" href="/team">
              دعوت اپراتور
            </Link>
            <Link className="btn secondary" href="/kpi">
              گزارش KPI
            </Link>
          </div>
        </>
      )}
    </Shell>
  );
}
