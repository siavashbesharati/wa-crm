"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import SuperShell from "@/components/SuperShell";
import { Badge, Card, EmptyState } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { PageLoading } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";

type TicketRow = {
  id: string;
  subject: string;
  status: string;
  priority: string;
  category: string;
  org_id: string;
  org_name: string;
  created_at: string | null;
  updated_at: string | null;
  message_count?: number;
};

type TicketMessage = {
  id: string;
  sender_side: string;
  body: string;
  user_name: string;
  created_at: string | null;
};

type TicketDetail = TicketRow & { messages: TicketMessage[] };

const STATUS_FA: Record<string, string> = {
  open: "باز",
  in_progress: "در حال بررسی",
  resolved: "حل‌شده",
  closed: "بسته"
};

const CAT_FA: Record<string, string> = {
  general: "عمومی",
  billing: "پرداخت",
  technical: "فنی",
  ai: "هوش مصنوعی"
};

function statusTone(s: string): "accent" | "danger" | "success" | "default" {
  if (s === "resolved") return "success";
  if (s === "closed") return "danger";
  if (s === "open" || s === "in_progress") return "accent";
  return "default";
}

export default function SuperTicketsPage() {
  return (
    <Suspense
      fallback={
        <SuperShell title="پشتیبانی" sub="تیکت‌های کسب‌وکارها">
          <PageLoading />
        </SuperShell>
      }
    >
      <SuperTicketsInner />
    </Suspense>
  );
}

function SuperTicketsInner() {
  const toast = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const focusId = searchParams.get("id");

  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [rows, setRows] = useState<TicketRow[]>([]);
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = filter ? `?status=${encodeURIComponent(filter)}` : "";
      const res = await api<{ tickets: TicketRow[] }>(`/admin/tickets${q}`, {
        platform: true
      });
      setRows(res.tickets || []);
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
      try {
        const t = await api<TicketDetail>(`/admin/tickets/${id}`, { platform: true });
        setDetail(t);
        setReply("");
        router.replace(`/super/tickets?id=${id}`, { scroll: false });
      } catch (e) {
        toast.push(e instanceof Error ? e.message : "خطا", "err");
      }
    },
    [router, toast]
  );

  useEffect(() => {
    if (focusId) openDetail(focusId);
  }, [focusId, openDetail]);

  async function sendReply() {
    if (!detail || !reply.trim()) return;
    setBusy(true);
    try {
      await api(`/admin/tickets/${detail.id}/messages`, {
        method: "POST",
        platform: true,
        body: JSON.stringify({ body: reply.trim() })
      });
      toast.push("پاسخ ارسال شد", "ok");
      setReply("");
      await openDetail(detail.id);
      await load();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setBusy(false);
    }
  }

  async function patchStatus(status: string) {
    if (!detail) return;
    setBusy(true);
    try {
      await api(`/admin/tickets/${detail.id}`, {
        method: "PATCH",
        platform: true,
        body: JSON.stringify({ status })
      });
      toast.push("وضعیت به‌روز شد", "ok");
      await openDetail(detail.id);
      await load();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SuperShell title="پشتیبانی" sub="پاسخ به تیکت‌های کسب‌وکارها و مدیریت وضعیت">
      {loading ? (
        <PageLoading />
      ) : (
        <div className="stack" style={{ display: "grid", gap: 16 }}>
          <Card title="فیلتر">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {[
                { v: "", l: "همه" },
                { v: "open", l: "باز" },
                { v: "in_progress", l: "در حال بررسی" },
                { v: "resolved", l: "حل‌شده" },
                { v: "closed", l: "بسته" }
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

          <div
            style={{
              display: "grid",
              gap: 16,
              gridTemplateColumns: detail ? "minmax(0, 1fr) minmax(0, 1.1fr)" : "1fr"
            }}
          >
            <Card title={`تیکت‌ها (${rows.length})`}>
              {!rows.length ? (
                <EmptyState title="تیکتی نیست" text="درخواستی با این فیلتر نیست." />
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>موضوع</th>
                      <th>کسب‌وکار</th>
                      <th>وضعیت</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((t) => (
                      <tr
                        key={t.id}
                        style={{
                          cursor: "pointer",
                          background:
                            detail?.id === t.id ? "var(--surface-2, #f1f5f9)" : undefined
                        }}
                        onClick={() => openDetail(t.id)}
                      >
                        <td>
                          <strong>{t.subject}</strong>
                          <div className="hint" style={{ margin: 0 }}>
                            {CAT_FA[t.category] || t.category} · {t.priority}
                            {typeof t.message_count === "number"
                              ? ` · ${t.message_count} پیام`
                              : ""}
                          </div>
                        </td>
                        <td>{t.org_name}</td>
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

            {detail && (
              <Card
                title={detail.subject}
                actions={
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setDetail(null);
                      router.replace("/super/tickets", { scroll: false });
                    }}
                  >
                    بستن
                  </Button>
                }
              >
                <div style={{ display: "grid", gap: 12 }}>
                  <div className="hint" style={{ margin: 0 }}>
                    {detail.org_name} · {CAT_FA[detail.category] || detail.category} ·{" "}
                    <Badge tone={statusTone(detail.status)}>
                      {STATUS_FA[detail.status] || detail.status}
                    </Badge>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {["open", "in_progress", "resolved", "closed"].map((s) => (
                      <Button
                        key={s}
                        disabled={busy || detail.status === s}
                        variant="secondary"
                        onClick={() => patchStatus(s)}
                      >
                        {STATUS_FA[s]}
                      </Button>
                    ))}
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gap: 10,
                      maxHeight: 360,
                      overflow: "auto",
                      padding: "4px 2px"
                    }}
                  >
                    {(detail.messages || []).map((m) => (
                      <div
                        key={m.id}
                        style={{
                          padding: "10px 12px",
                          borderRadius: 12,
                          background:
                            m.sender_side === "platform"
                              ? "rgba(37, 99, 235, 0.08)"
                              : "var(--surface-2, #f1f5f9)",
                          border:
                            m.sender_side === "platform"
                              ? "1px solid rgba(37, 99, 235, 0.2)"
                              : "1px solid transparent"
                        }}
                      >
                        <div className="hint" style={{ margin: "0 0 6px" }}>
                          {m.sender_side === "platform" ? "پلتفرم" : "کسب‌وکار"} ·{" "}
                          {m.user_name}
                          {m.created_at
                            ? ` · ${new Date(m.created_at).toLocaleString("fa-IR")}`
                            : ""}
                        </div>
                        <div style={{ whiteSpace: "pre-wrap" }}>{m.body}</div>
                      </div>
                    ))}
                  </div>
                  <textarea
                    rows={4}
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder="پاسخ پشتیبانی…"
                    disabled={busy || detail.status === "closed"}
                  />
                  <Button
                    disabled={busy || !reply.trim() || detail.status === "closed"}
                    onClick={sendReply}
                  >
                    ارسال پاسخ
                  </Button>
                </div>
              </Card>
            )}
          </div>
        </div>
      )}
    </SuperShell>
  );
}
