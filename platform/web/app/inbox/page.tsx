"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Shell from "@/components/Shell";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Card";
import { PageLoading } from "@/components/ui/Spinner";
import { CHANNEL_LABELS, initials, leadHref } from "@/components/crm/shared";
import { api } from "@/lib/api";
import { useMutation } from "@/lib/useApi";
import { useToast } from "@/components/ui/Toast";

type Thread = {
  lead: {
    id: string;
    name: string;
    phone: string;
    stage: string;
    source_channel?: string;
  };
  accounts: { account_id: string; chat_name: string }[];
  last_message: { body: string; direction: string; created_at: string } | null;
};

type Message = {
  id: string;
  body: string;
  direction: string;
  sender_type: string;
  created_at: string;
};

type ChannelFilter = "all" | "whatsapp" | "divar";

function channelOf(t: Thread) {
  return (t.lead.source_channel || "").toLowerCase();
}

function ChannelIcon({ channel }: { channel: "whatsapp" | "divar" }) {
  if (channel === "whatsapp") {
    return (
      <svg className="ch-badge-icon" viewBox="0 0 24 24" aria-hidden>
        <path
          fill="currentColor"
          d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2m.01 1.67c2.2 0 4.26.86 5.82 2.42a8.22 8.22 0 0 1 2.41 5.83c0 4.54-3.7 8.23-8.24 8.23-1.48 0-2.93-.39-4.19-1.15l-.3-.17-3.12.82.83-3.04-.2-.32a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24m-2.74 4.25c-.17 0-.44.06-.67.31-.23.26-.88.86-.88 2.1 0 1.24.9 2.44 1.02 2.61.13.17 1.76 2.67 4.25 3.75 2.07.9 2.49.72 2.94.67.45-.04 1.45-.59 1.65-1.16.21-.57.21-1.06.15-1.16-.06-.1-.23-.16-.48-.29-.25-.13-1.47-.73-1.7-.81-.23-.08-.39-.13-.56.13-.17.26-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.13-1.05-.39-2-1.23-.74-.66-1.24-1.47-1.38-1.72-.15-.26-.02-.4.11-.53.11-.11.25-.29.38-.43.12-.14.17-.25.25-.41.09-.17.04-.31-.02-.43-.06-.13-.55-1.33-.76-1.82-.2-.48-.4-.41-.56-.42"
        />
      </svg>
    );
  }
  return (
    <svg className="ch-badge-icon" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5.2v-6.2H10.2V21H5a1 1 0 0 1-1-1z"
      />
    </svg>
  );
}

function ChannelBadge({ channel }: { channel?: string }) {
  const ch = (channel || "").toLowerCase();
  if (ch !== "whatsapp" && ch !== "divar") return null;
  return (
    <span className={`ch-badge ${ch}`}>
      <ChannelIcon channel={ch} />
      {CHANNEL_LABELS[ch]}
    </span>
  );
}

function formatTime(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("fa-IR", { month: "short", day: "numeric" });
}

function dayKey(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const that = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = (today.getTime() - that.getTime()) / 86400000;
  if (diff === 0) return "امروز";
  if (diff === 1) return "دیروز";
  return d.toLocaleDateString("fa-IR", { weekday: "long", month: "long", day: "numeric" });
}

function senderLabel(type: string, outbound: boolean) {
  if (outbound) {
    if (type === "ai") return "هوش مصنوعی";
    if (type === "agent") return "شما";
    return "ارسال‌شده";
  }
  return "مشتری";
}

export default function InboxPage() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [active, setActive] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [q, setQ] = useState("");
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("all");
  const { busy, run } = useMutation();
  const toast = useToast();
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  async function load(opts?: { quiet?: boolean }) {
    if (!opts?.quiet) setLoading(true);
    try {
      setThreads(await api<Thread[]>("/messages/threads"));
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return threads.filter((t) => {
      const ch = channelOf(t);
      if (channelFilter !== "all" && ch !== channelFilter) return false;
      if (!needle) return true;
      return (
        t.lead.name.toLowerCase().includes(needle) ||
        (t.lead.phone || "").includes(needle) ||
        (t.last_message?.body || "").toLowerCase().includes(needle)
      );
    });
  }, [threads, q, channelFilter]);

  const chronological = useMemo(() => [...messages].reverse(), [messages]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [chronological.length, opening, active?.lead.id]);

  async function openThread(t: Thread, opts?: { quiet?: boolean }) {
    setActive(t);
    if (!opts?.quiet) setOpening(true);
    try {
      setMessages(await api<Message[]>(`/messages/inbox?lead_id=${t.lead.id}`));
      if (!opts?.quiet) window.setTimeout(() => inputRef.current?.focus(), 80);
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setOpening(false);
    }
  }

  async function send() {
    if (!active || !text.trim()) return;
    if (!active.accounts[0]) {
      toast.push("اکانت کانال برای این گفتگو موجود نیست", "err");
      return;
    }
    const body = text.trim();
    const ok = await run(
      () =>
        api("/messages/send", {
          method: "POST",
          body: JSON.stringify({
            account_id: active.accounts[0].account_id,
            lead_id: active.lead.id,
            target_name: active.lead.name,
            body,
            sender_type: "agent"
          })
        }),
      { success: "در صف ارسال قرار گرفت" }
    );
    if (ok) {
      setText("");
      if (inputRef.current) inputRef.current.style.height = "auto";
      await openThread(active, { quiet: true });
      await load({ quiet: true });
    }
  }

  return (
    <Shell title="اینباکس" sub="گفتگوهای واتساپ و دیوار در یک جا" search={q} onSearch={setQ}>
      {loading ? (
        <PageLoading variant="list" />
      ) : (
        <div className="chat-app">
          <aside className="chat-list" aria-label="لیست گفتگوها">
            <div className="chat-list-filters" role="tablist" aria-label="فیلتر کانال">
              {(
                [
                  ["all", "همه"],
                  ["whatsapp", "واتساپ"],
                  ["divar", "دیوار"]
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={channelFilter === id}
                  className={`chat-filter${channelFilter === id ? " on" : ""}`}
                  onClick={() => setChannelFilter(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="chat-list-scroll">
              {filtered.length === 0 ? (
                <EmptyState title="گفتگویی نیست" text="بعد از همگام‌سازی پیام‌ها اینجا می‌آیند." />
              ) : (
                filtered.map((t) => {
                  const ch = channelOf(t);
                  const on = active?.lead.id === t.lead.id;
                  return (
                    <button
                      key={t.lead.id}
                      type="button"
                      className={`chat-row${on ? " active" : ""}`}
                      aria-current={on ? "true" : undefined}
                      onClick={() => void openThread(t)}
                    >
                      <span className={`chat-avatar ${ch || "unknown"}`} aria-hidden>
                        {initials(t.lead.name)}
                      </span>
                      <span className="chat-row-body">
                        <span className="chat-row-top">
                          <strong dir="auto">{t.lead.name}</strong>
                          <time>{formatTime(t.last_message?.created_at)}</time>
                        </span>
                        <span className="chat-row-mid">
                          <span className="chat-preview" dir="auto">
                            {t.last_message?.direction === "outbound" ? "شما: " : ""}
                            {t.last_message?.body || "بدون پیام"}
                          </span>
                          <ChannelBadge channel={ch} />
                        </span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </aside>

          <section className="chat-stage" aria-label="پنجره گفتگو">
            {!active ? (
              <div className="chat-empty">
                <EmptyState title="یک گفتگو را انتخاب کنید" text="لیست سمت راست را باز کنید و چت را ادامه دهید." />
              </div>
            ) : (
              <>
                <header className="chat-head">
                  <span className={`chat-avatar ${channelOf(active) || "unknown"}`} aria-hidden>
                    {initials(active.lead.name)}
                  </span>
                  <div className="chat-head-meta">
                    <Link href={leadHref(active.lead.id)} className="chat-head-name" dir="auto">
                      {active.lead.name}
                    </Link>
                    <div className="chat-head-sub">
                      <ChannelBadge channel={channelOf(active)} />
                      {active.lead.phone ? <span dir="ltr">{active.lead.phone}</span> : null}
                      {active.lead.stage ? <span>{active.lead.stage}</span> : null}
                    </div>
                  </div>
                </header>

                <div className="chat-scroll" ref={scroller}>
                  {opening ? (
                    <PageLoading label="بارگذاری پیام‌ها…" variant="compact" />
                  ) : chronological.length === 0 ? (
                    <EmptyState title="هنوز پیامی نیست" text="اولین پیام را از پایین بفرستید." />
                  ) : (
                    chronological.map((m, i) => {
                      const outbound = m.direction === "outbound";
                      const prev = chronological[i - 1];
                      const showDay = !prev || dayKey(prev.created_at) !== dayKey(m.created_at);
                      return (
                        <div key={m.id} className="chat-block">
                          {showDay ? <div className="chat-day">{dayLabel(m.created_at)}</div> : null}
                          <div className={`bubble-row ${outbound ? "out" : "in"}`}>
                            <div className={`bubble ${outbound ? "out" : "in"}`}>
                              <p dir="auto">{m.body}</p>
                              <span className="bubble-meta">
                                {senderLabel(m.sender_type, outbound)}
                                {" · "}
                                {formatTime(m.created_at)}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                <form
                  className="chat-composer"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send();
                  }}
                >
                  <textarea
                    ref={inputRef}
                    rows={1}
                    value={text}
                    onChange={(e) => {
                      setText(e.target.value);
                      e.target.style.height = "auto";
                      e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
                    }}
                    placeholder="پیام…"
                    dir="auto"
                    aria-label="متن پیام"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                  />
                  <Button type="submit" loading={busy} disabled={!text.trim()}>
                    ارسال
                  </Button>
                </form>
              </>
            )}
          </section>
        </div>
      )}
    </Shell>
  );
}
