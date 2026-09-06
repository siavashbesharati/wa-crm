"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import SuperShell from "@/components/SuperShell";
import { Badge, EmptyState } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { PageLoading } from "@/components/ui/Spinner";
import { IconBack } from "@/components/ui/Icons";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { formatJalali } from "@/lib/jalali";

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

const PRIORITY_FA: Record<string, string> = {
  low: "کم",
  normal: "عادی",
  high: "فوری"
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

  function closeDetail() {
    setDetail(null);
    router.replace("/super/tickets", { scroll: false });
  }

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
        <div className={`tickets-page${detail ? " tickets-page--detail" : ""}`}>
          <div className="tickets-filters" role="tablist" aria-label="فیلتر وضعیت">
            {[
              { v: "", l: "همه" },
              { v: "open", l: "باز" },
              { v: "in_progress", l: "در حال بررسی" },
              { v: "resolved", l: "حل‌شده" },
              { v: "closed", l: "بسته" }
            ].map((o) => (
              <button
                key={o.v || "all"}
                type="button"
                role="tab"
                aria-selected={filter === o.v}
                className={`tickets-filter${filter === o.v ? " on" : ""}`}
                onClick={() => setFilter(o.v)}
              >
                {o.l}
              </button>
            ))}
          </div>

          <div className="tickets-layout">
            <section className="tickets-list-pane" aria-label="فهرست تیکت‌ها">
              <div className="tickets-list-head">
                <h2>تیکت‌ها</h2>
                <span className="hint">{rows.length.toLocaleString("fa-IR")} مورد</span>
              </div>
              {!rows.length ? (
                <EmptyState title="تیکتی نیست" text="درخواستی با این فیلتر نیست." />
              ) : (
                <ul className="tickets-list">
                  {rows.map((t) => {
                    const active = detail?.id === t.id;
                    return (
                      <li key={t.id}>
                        <button
                          type="button"
                          className={`tickets-row${active ? " active" : ""}`}
                          onClick={() => void openDetail(t.id)}
                        >
                          <div className="tickets-row-top">
                            <strong dir="auto">{t.subject}</strong>
                            <Badge tone={statusTone(t.status)}>
                              {STATUS_FA[t.status] || t.status}
                            </Badge>
                          </div>
                          <div className="tickets-row-meta">
                            <span>{t.org_name}</span>
                            <span>{CAT_FA[t.category] || t.category}</span>
                            <span>{PRIORITY_FA[t.priority] || t.priority}</span>
                            {typeof t.message_count === "number" ? (
                              <span>{t.message_count.toLocaleString("fa-IR")} پیام</span>
                            ) : null}
                            {t.updated_at || t.created_at ? (
                              <span>{formatJalali(t.updated_at || t.created_at)}</span>
                            ) : null}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {detail ? (
              <section className="tickets-detail-pane" aria-label="جزئیات تیکت">
                <header className="tickets-detail-head">
                  <button
                    type="button"
                    className="tickets-back-btn"
                    aria-label="بازگشت به فهرست"
                    onClick={closeDetail}
                  >
                    <IconBack size={20} />
                  </button>
                  <div className="tickets-detail-titles">
                    <h2 dir="auto">{detail.subject}</h2>
                    <div className="tickets-row-meta">
                      <span>{detail.org_name}</span>
                      <Badge tone={statusTone(detail.status)}>
                        {STATUS_FA[detail.status] || detail.status}
                      </Badge>
                    </div>
                  </div>
                </header>

                <div className="tickets-status-actions">
                  {["open", "in_progress", "resolved", "closed"].map((s) => (
                    <Button
                      key={s}
                      size="sm"
                      disabled={busy || detail.status === s}
                      variant={detail.status === s ? "primary" : "secondary"}
                      onClick={() => patchStatus(s)}
                    >
                      {STATUS_FA[s]}
                    </Button>
                  ))}
                </div>

                <div className="tickets-thread">
                  {(detail.messages || []).map((m) => (
                    <div
                      key={m.id}
                      className={`tickets-bubble${
                        m.sender_side === "platform" ? " platform" : " mine"
                      }`}
                    >
                      <div className="tickets-bubble-meta">
                        {m.sender_side === "platform" ? "پلتفرم" : "کسب‌وکار"} · {m.user_name}
                        {m.created_at
                          ? ` · ${new Date(m.created_at).toLocaleString("fa-IR")}`
                          : ""}
                      </div>
                      <div className="tickets-bubble-body" dir="auto">
                        {m.body}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="tickets-composer">
                  <textarea
                    rows={3}
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
              </section>
            ) : (
              <aside className="tickets-detail-empty leads-desktop-only">
                <EmptyState
                  title="یک تیکت را انتخاب کنید"
                  text="از فهرست سمت راست جزئیات را ببینید."
                />
              </aside>
            )}
          </div>
        </div>
      )}
    </SuperShell>
  );
}
