"use client";

import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Badge, Card, EmptyState } from "@/components/ui/Card";
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
  billing: "پرداخت / اشتراک",
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

export default function SupportPage() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<TicketRow[]>([]);
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState("general");
  const [priority, setPriority] = useState("normal");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<{ tickets: TicketRow[] }>("/support/tickets");
      setRows(res.tickets || []);
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function openDetail(id: string) {
    try {
      const t = await api<TicketDetail>(`/support/tickets/${id}`);
      setDetail(t);
      setReply("");
      setComposeOpen(false);
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    }
  }

  async function createTicket() {
    if (subject.trim().length < 3 || body.trim().length < 5) {
      toast.push("موضوع و متن را کامل وارد کنید", "err");
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ ticket: TicketDetail }>("/support/tickets", {
        method: "POST",
        body: JSON.stringify({
          subject: subject.trim(),
          body: body.trim(),
          category,
          priority
        })
      });
      toast.push("تیکت ثبت شد", "ok");
      setSubject("");
      setBody("");
      setCategory("general");
      setPriority("normal");
      setComposeOpen(false);
      await load();
      if (res.ticket?.id) await openDetail(res.ticket.id);
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setBusy(false);
    }
  }

  async function sendReply() {
    if (!detail || !reply.trim()) return;
    setBusy(true);
    try {
      const res = await api<{ ticket: TicketDetail }>(
        `/support/tickets/${detail.id}/messages`,
        {
          method: "POST",
          body: JSON.stringify({ body: reply.trim() })
        }
      );
      toast.push("پیام ارسال شد", "ok");
      setReply("");
      setDetail(res.ticket);
      await load();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell
      title="پشتیبانی"
      sub="ثبت و پیگیری تیکت با تیم پلتفرم"
      hideTabBar={!!detail}
      actions={
        !detail ? (
          <Button size="sm" onClick={() => setComposeOpen((v) => !v)}>
            {composeOpen ? "بستن فرم" : "تیکت جدید"}
          </Button>
        ) : undefined
      }
    >
      {loading ? (
        <PageLoading />
      ) : (
        <div className={`tickets-page${detail ? " tickets-page--detail" : ""}`}>
          {composeOpen && !detail ? (
            <Card title="تیکت جدید" className="tickets-compose">
              <div className="tickets-compose-form">
                <label>
                  موضوع
                  <input
                    placeholder="مثلاً مشکل اتصال کانال"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    disabled={busy}
                    autoFocus
                  />
                </label>
                <label>
                  دسته
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    disabled={busy}
                  >
                    {Object.entries(CAT_FA).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  اولویت
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                    disabled={busy}
                  >
                    <option value="low">کم</option>
                    <option value="normal">عادی</option>
                    <option value="high">فوری</option>
                  </select>
                </label>
                <label className="full">
                  شرح
                  <textarea
                    rows={4}
                    placeholder="شرح مشکل…"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    disabled={busy}
                  />
                </label>
                <Button disabled={busy} onClick={createTicket}>
                  ثبت تیکت
                </Button>
              </div>
            </Card>
          ) : null}

          <div className="tickets-layout">
            <section className="tickets-list-pane" aria-label="فهرست تیکت‌ها">
              <div className="tickets-list-head">
                <h2>تیکت‌های من</h2>
                <span className="hint">{rows.length.toLocaleString("fa-IR")} مورد</span>
              </div>
              {!rows.length ? (
                <EmptyState
                  title="تیکتی ندارید"
                  text="اولین درخواست پشتیبانی را ثبت کنید."
                  action={
                    <Button onClick={() => setComposeOpen(true)}>تیکت جدید</Button>
                  }
                />
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
                    onClick={() => setDetail(null)}
                  >
                    <IconBack size={20} />
                  </button>
                  <div className="tickets-detail-titles">
                    <h2 dir="auto">{detail.subject}</h2>
                    <div className="tickets-row-meta">
                      <span>{CAT_FA[detail.category] || detail.category}</span>
                      <Badge tone={statusTone(detail.status)}>
                        {STATUS_FA[detail.status] || detail.status}
                      </Badge>
                    </div>
                  </div>
                </header>

                <div className="tickets-thread">
                  {(detail.messages || []).map((m) => (
                    <div
                      key={m.id}
                      className={`tickets-bubble${
                        m.sender_side === "platform" ? " platform" : " mine"
                      }`}
                    >
                      <div className="tickets-bubble-meta">
                        {m.sender_side === "platform" ? "پشتیبانی پلتفرم" : "شما"}
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
                    placeholder="پیام بعدی…"
                    disabled={busy || detail.status === "closed"}
                  />
                  <Button
                    disabled={busy || !reply.trim() || detail.status === "closed"}
                    onClick={sendReply}
                  >
                    ارسال
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
    </Shell>
  );
}
