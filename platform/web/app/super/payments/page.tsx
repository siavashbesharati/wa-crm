"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import SuperShell from "@/components/SuperShell";
import { Badge, Card, EmptyState } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { PageLoading } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";

type PaymentRow = {
  id: string;
  org_id: string;
  org_name: string;
  purpose: string;
  plan: string;
  amount_irr: number;
  provider: string;
  track_id: string;
  ref_number: string;
  status: string;
  created_at: string | null;
  paid_at: string | null;
  raw_request?: string;
  raw_callback?: string;
  raw_verify?: string;
};

function fmt(n: number) {
  return Math.round(n).toLocaleString("fa-IR");
}

function statusTone(s: string): "accent" | "danger" | "success" | "default" {
  if (s === "paid") return "success";
  if (s === "failed") return "danger";
  if (s === "pending") return "accent";
  return "default";
}

const STATUS_FA: Record<string, string> = {
  paid: "موفق",
  failed: "ناموفق",
  pending: "در انتظار"
};

function prettyJson(raw: string) {
  if (!raw?.trim()) return "—";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export default function SuperPaymentsPage() {
  return (
    <Suspense
      fallback={
        <SuperShell title="پرداخت‌ها" sub="تاریخچه و لاگ درگاه">
          <PageLoading />
        </SuperShell>
      }
    >
      <SuperPaymentsInner />
    </Suspense>
  );
}

function SuperPaymentsInner() {
  const toast = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const focusId = searchParams.get("id");

  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [detail, setDetail] = useState<PaymentRow | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = filter ? `?status=${encodeURIComponent(filter)}` : "";
      const res = await api<{ payments: PaymentRow[] }>(`/admin/payments${q}`, {
        platform: true
      });
      setRows(res.payments || []);
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setLoading(false);
    }
  }, [filter, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const openDetail = useCallback(
    async (id: string) => {
      setDetailLoading(true);
      try {
        const p = await api<PaymentRow>(`/admin/payments/${id}`, { platform: true });
        setDetail(p);
        router.replace(`/super/payments?id=${id}`, { scroll: false });
      } catch (e) {
        toast.push(e instanceof Error ? e.message : "خطا", "err");
      } finally {
        setDetailLoading(false);
      }
    },
    [router, toast]
  );

  useEffect(() => {
    if (focusId) openDetail(focusId);
  }, [focusId, openDetail]);

  return (
    <SuperShell title="پرداخت‌ها" sub="مدیریت تراکنش‌ها و بررسی خطاهای درگاه برای هر کسب‌وکار">
      {loading ? (
        <PageLoading />
      ) : (
        <div className="stack" style={{ display: "grid", gap: 16 }}>
          <Card
            title="فیلتر"
            help={{
              title: "فیلتر وضعیت",
              body: "پرداخت‌های ناموفق را جدا ببینید تا خطاهای کارت یا درگاه را بررسی کنید."
            }}
          >
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {[
                { v: "", l: "همه" },
                { v: "paid", l: "موفق" },
                { v: "failed", l: "ناموفق" },
                { v: "pending", l: "در انتظار" }
              ].map((o) => (
                <Button
                  key={o.v || "all"}
                  variant={filter === o.v ? "primary" : "secondary"}
                  onClick={() => setFilter(o.v)}
                >
                  {o.l}
                </Button>
              ))}
            </div>
          </Card>

          <Card title={`لیست (${rows.length})`}>
            {!rows.length ? (
              <EmptyState title="پرداختی نیست" text="با این فیلتر تراکنشی یافت نشد." />
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>کسب‌وکار</th>
                    <th>هدف</th>
                    <th>مبلغ</th>
                    <th>درگاه</th>
                    <th>وضعیت</th>
                    <th>زمان</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <strong>{p.org_name || "—"}</strong>
                        <div className="hint" style={{ margin: 0 }}>
                          {p.plan}
                        </div>
                      </td>
                      <td>{p.purpose}</td>
                      <td>{fmt(p.amount_irr)} ریال</td>
                      <td>{p.provider}</td>
                      <td>
                        <Badge tone={statusTone(p.status)}>
                          {STATUS_FA[p.status] || p.status}
                        </Badge>
                      </td>
                      <td className="hint">
                        {p.created_at
                          ? new Date(p.created_at).toLocaleString("fa-IR")
                          : "—"}
                      </td>
                      <td>
                        <Button variant="secondary" onClick={() => openDetail(p.id)}>
                          جزئیات
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          {(detail || detailLoading) && (
            <Card
              title="جزئیات و لاگ درگاه"
              help={{
                title: "لاگ پرداخت",
                body: "درخواست ارسال‌شده، پاسخ کالبک، و نتیجه verify برای عیب‌یابی پرداخت‌های ناموفق."
              }}
              actions={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setDetail(null);
                    router.replace("/super/payments", { scroll: false });
                  }}
                >
                  بستن
                </Button>
              }
            >
              {detailLoading || !detail ? (
                <PageLoading />
              ) : (
                <div style={{ display: "grid", gap: 14 }}>
                  <div style={{ display: "grid", gap: 6 }}>
                    <div>
                      <strong>{detail.org_name}</strong> · {detail.purpose} · {detail.plan}
                    </div>
                    <div>
                      مبلغ: {fmt(detail.amount_irr)} ریال · وضعیت:{" "}
                      <Badge tone={statusTone(detail.status)}>
                        {STATUS_FA[detail.status] || detail.status}
                      </Badge>
                    </div>
                    <div className="hint">
                      track: {detail.track_id || "—"} · ref: {detail.ref_number || "—"} ·{" "}
                      {detail.provider}
                    </div>
                  </div>
                  {[
                    { k: "raw_request" as const, t: "درخواست (ارسال)" },
                    { k: "raw_callback" as const, t: "کالبک درگاه" },
                    { k: "raw_verify" as const, t: "پاسخ verify" }
                  ].map((block) => (
                    <div key={block.k}>
                      <div className="hint" style={{ marginBottom: 6 }}>
                        {block.t}
                      </div>
                      <pre
                        style={{
                          margin: 0,
                          padding: 12,
                          borderRadius: 10,
                          background: "var(--surface-2, #f1f5f9)",
                          overflow: "auto",
                          maxHeight: 220,
                          fontSize: 12,
                          direction: "ltr",
                          textAlign: "left"
                        }}
                      >
                        {prettyJson(detail[block.k] || "")}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
        </div>
      )}
    </SuperShell>
  );
}
