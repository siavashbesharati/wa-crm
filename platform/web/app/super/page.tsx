"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import SuperShell from "@/components/SuperShell";
import { Badge, Card, EmptyState } from "@/components/ui/Card";
import { PageLoading } from "@/components/ui/Spinner";
import { api, getPlatformSession } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";

type Metrics = {
  businesses: number;
  active_businesses: number;
  suspended_businesses: number;
  users: number;
  leads: number;
  channel_accounts: number;
  payments_paid: number;
  payments_failed: number;
  payments_pending: number;
  revenue_irr: number;
  revenue_7d_irr: number;
  tickets_open: number;
  messages_7d: number;
};

type RecentPayment = {
  id: string;
  org_name: string;
  purpose: string;
  plan: string;
  amount_irr: number;
  status: string;
  created_at: string | null;
};

type RecentTicket = {
  id: string;
  subject: string;
  status: string;
  priority: string;
  org_name: string;
  updated_at: string | null;
};

function fmt(n: number) {
  return Math.round(n).toLocaleString("fa-IR");
}

function money(n: number) {
  return `${fmt(n)} ریال`;
}

function statusTone(s: string): "accent" | "danger" | "success" | "default" {
  if (s === "paid" || s === "resolved" || s === "active") return "success";
  if (s === "failed" || s === "closed" || s === "suspended") return "danger";
  if (s === "pending" || s === "in_progress" || s === "open") return "accent";
  return "default";
}

const STATUS_FA: Record<string, string> = {
  paid: "موفق",
  failed: "ناموفق",
  pending: "در انتظار",
  open: "باز",
  in_progress: "در حال بررسی",
  resolved: "حل‌شده",
  closed: "بسته"
};

export default function SuperDashboardPage() {
  const router = useRouter();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [payments, setPayments] = useState<RecentPayment[]>([]);
  const [tickets, setTickets] = useState<RecentTicket[]>([]);

  useEffect(() => {
    if (!getPlatformSession()) {
      router.replace("/super/login");
      return;
    }
    (async () => {
      setLoading(true);
      try {
        const res = await api<{
          metrics: Metrics;
          recent_payments: RecentPayment[];
          recent_tickets: RecentTicket[];
        }>("/admin/dashboard", { platform: true });
        setMetrics(res.metrics);
        setPayments(res.recent_payments || []);
        setTickets(res.recent_tickets || []);
      } catch (e) {
        toast.push(e instanceof Error ? e.message : "خطا", "err");
      } finally {
        setLoading(false);
      }
    })();
  }, [router, toast]);

  const m = metrics;

  return (
    <SuperShell title="گزارش پلتفرم" sub="نمای کلی کسب‌وکارها، پرداخت‌ها و پشتیبانی">
      {loading || !m ? (
        <PageLoading />
      ) : (
        <div className="dash-home">
          <div className="dash-kpi-grid">
            <div className="dash-kpi accent">
              <small>کسب‌وکار فعال</small>
              <strong>{fmt(m.active_businesses)}</strong>
              <em>از {fmt(m.businesses)} · تعلیق {fmt(m.suspended_businesses)}</em>
            </div>
            <div className="dash-kpi">
              <small>درآمد کل</small>
              <strong>{fmt(m.revenue_irr)}</strong>
              <em>۷ روز اخیر: {money(m.revenue_7d_irr)}</em>
            </div>
            <div className="dash-kpi">
              <small>پرداخت‌ها</small>
              <strong>{fmt(m.payments_paid)}</strong>
              <em>
                ناموفق {fmt(m.payments_failed)} · در انتظار {fmt(m.payments_pending)}
              </em>
            </div>
            <div className="dash-kpi">
              <small>تیکت باز</small>
              <strong>{fmt(m.tickets_open)}</strong>
              <em>
                پیام ۷روز: {fmt(m.messages_7d)} · لید کل: {fmt(m.leads)}
              </em>
            </div>
          </div>

          <div className="dash-grid-2" style={{ display: "grid", gap: 16, gridTemplateColumns: "1fr 1fr" }}>
            <Card
              title="آخرین پرداخت‌ها"
              help={{
                title: "پرداخت‌ها",
                body: "موفق، ناموفق و در انتظار — برای جزئیات و لاگ درگاه به بخش پرداخت‌ها بروید."
              }}
              actions={
                <Link href="/super/payments" className="btn secondary" style={{ fontSize: 13 }}>
                  همه
                </Link>
              }
            >
              {!payments.length ? (
                <EmptyState title="پرداختی نیست" text="هنوز تراکنشی ثبت نشده." />
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>کسب‌وکار</th>
                      <th>مبلغ</th>
                      <th>وضعیت</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <Link href={`/super/payments?id=${p.id}`}>{p.org_name || "—"}</Link>
                          <div className="hint" style={{ margin: 0 }}>
                            {p.purpose} · {p.plan}
                          </div>
                        </td>
                        <td>{money(p.amount_irr)}</td>
                        <td>
                          <Badge tone={statusTone(p.status)}>
                            {STATUS_FA[p.status] || p.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            <Card
              title="تیکت‌های اخیر"
              help={{
                title: "پشتیبانی",
                body: "تیکت‌های باز کسب‌وکارها را از اینجا پیگیری کنید."
              }}
              actions={
                <Link href="/super/tickets" className="btn secondary" style={{ fontSize: 13 }}>
                  همه
                </Link>
              }
            >
              {!tickets.length ? (
                <EmptyState title="تیکتی نیست" text="هنوز درخواستی ثبت نشده." />
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>موضوع</th>
                      <th>وضعیت</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tickets.map((t) => (
                      <tr key={t.id}>
                        <td>
                          <Link href={`/super/tickets?id=${t.id}`}>{t.subject}</Link>
                          <div className="hint" style={{ margin: 0 }}>
                            {t.org_name} · {t.priority}
                          </div>
                        </td>
                        <td>
                          <Badge tone={statusTone(t.status)}>
                            {STATUS_FA[t.status] || t.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>

          <Card title="میان‌برها">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              <Link href="/super/businesses" className="btn secondary">
                کسب‌وکارها
              </Link>
              <Link href="/super/payments" className="btn secondary">
                مدیریت پرداخت
              </Link>
              <Link href="/super/tickets" className="btn secondary">
                پشتیبانی
              </Link>
              <Link href="/super/plans" className="btn secondary">
                پلن‌ها
              </Link>
            </div>
          </Card>
        </div>
      )}
    </SuperShell>
  );
}
