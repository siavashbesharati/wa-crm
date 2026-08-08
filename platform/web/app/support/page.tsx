"use client";

import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
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
    <Shell title="پشتیبانی" sub="ثبت و پیگیری تیکت با تیم پلتفرم">
      {loading ? (
        <PageLoading />
      ) : (
        <div className="stack" style={{ display: "grid", gap: 16 }}>
          <Card
            title="تیکت جدید"
            help={{
              title: "پشتیبانی",
              body: "برای مشکل پرداخت، افزونه، یا AI یک تیکت بسازید؛ تیم پلتفرم پاسخ می‌دهد."
            }}
          >
            <div style={{ display: "grid", gap: 10 }}>
              <input
                placeholder="موضوع"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                disabled={busy}
              />
              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
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
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  disabled={busy}
                >
                  <option value="low">اولویت کم</option>
                  <option value="normal">عادی</option>
                  <option value="high">فوری</option>
                </select>
              </div>
              <textarea
                rows={4}
                placeholder="شرح مشکل…"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                disabled={busy}
              />
              <Button disabled={busy} onClick={createTicket}>
                ثبت تیکت
              </Button>
            </div>
          </Card>

          <div
            style={{
              display: "grid",
              gap: 16,
              gridTemplateColumns: detail ? "minmax(0, 1fr) minmax(0, 1.1fr)" : "1fr"
            }}
          >
            <Card title={`تیکت‌های من (${rows.length})`}>
              {!rows.length ? (
                <EmptyState
                  title="تیکتی ندارید"
                  text="اولین درخواست پشتیبانی را از فرم بالا ثبت کنید."
                />
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>موضوع</th>
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
                            {CAT_FA[t.category] || t.category}
                            {typeof t.message_count === "number"
                              ? ` · ${t.message_count} پیام`
                              : ""}
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

            {detail && (
              <Card
                title={detail.subject}
                actions={
                  <Button variant="secondary" onClick={() => setDetail(null)}>
                    بستن
                  </Button>
                }
              >
                <div style={{ display: "grid", gap: 12 }}>
                  <div className="hint" style={{ margin: 0 }}>
                    {CAT_FA[detail.category] || detail.category} ·{" "}
                    <Badge tone={statusTone(detail.status)}>
                      {STATUS_FA[detail.status] || detail.status}
                    </Badge>
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gap: 10,
                      maxHeight: 360,
                      overflow: "auto"
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
                              : "var(--surface-2, #f1f5f9)"
                        }}
                      >
                        <div className="hint" style={{ margin: "0 0 6px" }}>
                          {m.sender_side === "platform" ? "پشتیبانی پلتفرم" : "شما"}
                          {m.created_at
                            ? ` · ${new Date(m.created_at).toLocaleString("fa-IR")}`
                            : ""}
                        </div>
                        <div style={{ whiteSpace: "pre-wrap" }}>{m.body}</div>
                      </div>
                    ))}
                  </div>
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
              </Card>
            )}
          </div>
        </div>
      )}
    </Shell>
  );
}
