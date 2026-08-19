"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Shell from "@/components/Shell";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Card";
import { PageLoading } from "@/components/ui/Spinner";
import {
  initials,
  leadHref,
  leadDisplayName,
  leadPhone,
  tagLabel,
  SENTIMENT_LABELS_FA,
  type Lead
} from "@/components/crm/shared";
import { ChannelBadge } from "@/components/channels/brand";
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
    external_chat_id?: string | null;
    tags?: string[];
    lead_score?: number;
    bot_paused?: boolean;
    notes?: string;
    ai_meta?: {
      sentiment?: string;
      suggested_stage?: string;
      confidence?: number;
      escalation?: boolean;
    };
  };
  accounts: { account_id: string; chat_name: string }[];
  last_message: { body: string; direction: string; created_at: string } | null;
};

function threadLead(t: Thread): Lead {
  return {
    id: t.lead.id,
    name: t.lead.name,
    phone: t.lead.phone,
    group_id: "",
    external_chat_id: t.lead.external_chat_id,
    source_channel: t.lead.source_channel,
    stage: t.lead.stage,
    tags: t.lead.tags || [],
    notes: t.lead.notes || "",
    assignee_id: null
  };
}

type Message = {
  id: string;
  body: string;
  direction: string;
  sender_type: string;
  created_at: string;
  media_type?: string;
  delivery_status?: string;
  wa_message_id?: string;
};

type ChannelFilter = "all" | "whatsapp" | "divar" | "bale" | "instagram";

type SuggestDraft = {
  reply: string;
  confidence: number;
  sources: string[];
};

function channelOf(t: Thread) {
  return (t.lead.source_channel || "").toLowerCase();
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

function displayMessageBody(body: string, mediaType?: string) {
  const raw = (body || "").trim();
  if (!raw || raw === "[]") {
    if (mediaType === "sticker") return "استیکر";
    if (mediaType === "image") return "تصویر";
    if (mediaType === "audio") return "پیام صوتی";
    if (mediaType === "video") return "ویدیو";
    if (mediaType === "document") return "سند";
    return "پیام بدون متن";
  }
  // Connector placeholders like [sticker] / [تصویر]
  const m = raw.match(/^\[([^\]]+)\]$/);
  if (m) return m[1];
  return raw;
}

function isPlaceholderBody(body: string) {
  const raw = (body || "").trim();
  return !raw || raw === "[]" || /^\[([^\]]+)\]$/.test(raw);
}

function senderLabel(type: string, outbound: boolean) {
  if (outbound) {
    if (type === "ai") return "هوش مصنوعی";
    if (type === "agent") return "شما";
    return "ارسال‌شده";
  }
  return "مشتری";
}

function DeliveryTicks({ status }: { status?: string }) {
  const s = (status || "").toLowerCase();
  if (!s || s === "pending") {
    return (
      <span className="msg-ticks pending" title="در صف ارسال" aria-label="در صف ارسال">
        ✓
      </span>
    );
  }
  if (s === "sent") {
    return (
      <span className="msg-ticks sent" title="ارسال شد" aria-label="ارسال شد">
        ✓
      </span>
    );
  }
  if (s === "delivered") {
    return (
      <span className="msg-ticks delivered" title="تحویل شد" aria-label="تحویل شد">
        ✓✓
      </span>
    );
  }
  if (s === "read" || s === "played") {
    return (
      <span className="msg-ticks read" title="دیده شد" aria-label="دیده شد">
        ✓✓
      </span>
    );
  }
  return null;
}

function isRiskLead(lead: Thread["lead"]) {
  const tags = lead.tags || [];
  const sentiment = lead.ai_meta?.sentiment;
  const hardRisk = tags.some((t) =>
    ["churn_risk", "detractor", "complaint"].includes(t)
  );
  const needsHuman = tags.includes("needs_human");
  // needs_human alone with neutral/positive tone is not shown as risk
  return (
    !!lead.ai_meta?.escalation ||
    sentiment === "negative" ||
    hardRisk ||
    (needsHuman && sentiment === "negative")
  );
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
  const [allowSuggest, setAllowSuggest] = useState(true);
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [draft, setDraft] = useState<SuggestDraft | null>(null);
  const [typing, setTyping] = useState(false);
  const [typingKind, setTypingKind] = useState<"composing" | "recording" | "">("");
  const { busy, run } = useMutation();
  const toast = useToast();
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const typingTimer = useRef<number | null>(null);
  const lastTypingSent = useRef(0);

  async function load(opts?: { quiet?: boolean }) {
    if (!opts?.quiet) setLoading(true);
    try {
      const rows = await api<Thread[]>("/messages/threads");
      setThreads(rows);
      setActive((cur) => {
        if (!cur) return cur;
        return rows.find((r) => r.lead.id === cur.lead.id) || cur;
      });
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    (async () => {
      try {
        const p = await api<{ plan_allows_suggest?: boolean }>("/ai/policy");
        setAllowSuggest(p.plan_allows_suggest !== false);
      } catch {
        setAllowSuggest(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return threads.filter((t) => {
      const ch = channelOf(t);
      if (channelFilter !== "all" && ch !== channelFilter) return false;
      if (!needle) return true;
      return (
        leadDisplayName(threadLead(t)).toLowerCase().includes(needle) ||
        t.lead.name.toLowerCase().includes(needle) ||
        (t.lead.phone || "").includes(needle) ||
        (t.lead.external_chat_id || "").toLowerCase().includes(needle) ||
        (t.last_message?.body || "").toLowerCase().includes(needle) ||
        (t.lead.tags || []).some((tag) => tag.toLowerCase().includes(needle))
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
    setDraft(null);
    if (!opts?.quiet) {
      setOpening(true);
      setTyping(false);
      setTypingKind("");
    }
    try {
      setMessages(await api<Message[]>(`/messages/inbox?lead_id=${t.lead.id}`));
      // Subscribe so we receive their composing / online updates
      if (!opts?.quiet && t.accounts[0]?.account_id) {
        void api("/messages/presence/subscribe", {
          method: "POST",
          body: JSON.stringify({
            lead_id: t.lead.id,
            account_id: t.accounts[0].account_id
          })
        }).catch(() => undefined);
      }
      if (!opts?.quiet) window.setTimeout(() => inputRef.current?.focus(), 80);
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setOpening(false);
    }
  }

  function clearTypingTimer() {
    if (typingTimer.current != null) {
      window.clearTimeout(typingTimer.current);
      typingTimer.current = null;
    }
  }

  function broadcastOwnTyping(state: "composing" | "paused") {
    if (!active?.lead.id || !active.accounts[0]?.account_id) return;
    const accountId = active.accounts[0].account_id;
    const leadId = active.lead.id;
    void api("/messages/typing", {
      method: "POST",
      body: JSON.stringify({ lead_id: leadId, account_id: accountId, state })
    }).catch(() => undefined);
  }

  function onComposerChange(value: string) {
    setText(value);
    if (!active?.lead.id) return;
    const now = Date.now();
    // Presence expires ~10s — refresh composing at most every ~3s while typing
    if (value.trim() && now - lastTypingSent.current > 3000) {
      lastTypingSent.current = now;
      broadcastOwnTyping("composing");
    }
    clearTypingTimer();
    typingTimer.current = window.setTimeout(() => {
      lastTypingSent.current = 0;
      broadcastOwnTyping("paused");
    }, 2500);
  }

  useEffect(() => {
    if (!active?.lead.id) return;
    let cancelled = false;
    const leadId = active.lead.id;
    const tick = async () => {
      try {
        const [msgs, presence] = await Promise.all([
          api<Message[]>(`/messages/inbox?lead_id=${leadId}`),
          api<{ typing?: boolean; state?: string }>(
            `/messages/presence?lead_id=${encodeURIComponent(leadId)}`
          ).catch(() => ({ typing: false, state: "paused" }))
        ]);
        if (cancelled) return;
        setMessages((prev) => {
          // Avoid scroll jump if only delivery_status changed
          if (
            prev.length === msgs.length &&
            prev.every(
              (m, i) =>
                m.id === msgs[i]?.id &&
                m.body === msgs[i]?.body &&
                m.delivery_status === msgs[i]?.delivery_status
            )
          ) {
            return prev;
          }
          return msgs;
        });
        const isTyping = !!presence.typing;
        setTyping(isTyping);
        setTypingKind(
          isTyping && presence.state === "recording"
            ? "recording"
            : isTyping
              ? "composing"
              : ""
        );
      } catch {
        /* ignore poll errors */
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 2500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      clearTypingTimer();
    };
  }, [active?.lead.id]);

  async function send() {
    if (!active || !text.trim()) return;
    if (!active.accounts[0]) {
      toast.push("اکانت کانال برای این گفتگو موجود نیست", "err");
      return;
    }
    clearTypingTimer();
    broadcastOwnTyping("paused");
    lastTypingSent.current = 0;
    const body = text.trim();
    const ok = await run(
      () =>
        api("/messages/send", {
          method: "POST",
          body: JSON.stringify({
            account_id: active.accounts[0].account_id,
            lead_id: active.lead.id,
            target_name: leadDisplayName(threadLead(active)),
            body,
            sender_type: "agent"
          })
        }),
      { success: "در صف ارسال قرار گرفت" }
    );
    if (ok) {
      setText("");
      setDraft(null);
      if (inputRef.current) inputRef.current.style.height = "auto";
      await openThread(active, { quiet: true });
      await load({ quiet: true });
    }
  }

  async function requestSuggest() {
    if (!active) return;
    const lastInbound = chronological.filter((m) => m.direction === "inbound").slice(-1)[0];
    const message = text.trim() || lastInbound?.body || "سلام";
    setSuggestBusy(true);
    try {
      const res = await api<SuggestDraft>("/ai/suggest", {
        method: "POST",
        body: JSON.stringify({ lead_id: active.lead.id, message })
      });
      setDraft(res);
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا در پیشنهاد AI", "err");
    } finally {
      setSuggestBusy(false);
    }
  }

  async function acceptSuggest() {
    if (!active || !draft) return;
    setText(draft.reply);
    try {
      await api("/ai/suggest/accept", {
        method: "POST",
        body: JSON.stringify({ lead_id: active.lead.id, message: draft.reply })
      });
    } catch {
      /* non-blocking */
    }
    setDraft(null);
    window.setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.style.height = "auto";
        inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 120)}px`;
        inputRef.current.focus();
      }
    }, 40);
  }

  async function applySuggestedStage() {
    if (!active) return;
    const stage = (active.lead.ai_meta?.suggested_stage || "").trim();
    if (!stage || stage === active.lead.stage) return;
    const ok = await run(
      () =>
        api(`/leads/${active.lead.id}`, {
          method: "PATCH",
          body: JSON.stringify({ stage })
        }),
      { success: "مرحله اعمال شد" }
    );
    if (ok) await load({ quiet: true });
  }

  async function resumeBot() {
    if (!active) return;
    const ok = await run(
      () =>
        api(`/leads/${active.lead.id}`, {
          method: "PATCH",
          body: JSON.stringify({ bot_paused: false })
        }),
      { success: "ربات دوباره فعال شد" }
    );
    if (ok) await load({ quiet: true });
  }

  const activeTags = active?.lead.tags || [];
  const activeScore = Math.round(active?.lead.lead_score || 0);
  const activeSentiment = active?.lead.ai_meta?.sentiment || "";
  const suggestedStage = (active?.lead.ai_meta?.suggested_stage || "").trim();

  return (
    <Shell title="اینباکس" sub="گفتگوهای واتساپ، دیوار، بله و اینستاگرام در یک جا" search={q} onSearch={setQ}>
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
                  ["divar", "دیوار"],
                  ["bale", "بله"],
                  ["instagram", "اینستاگرام"]
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
                      className={`chat-row${on ? " active" : ""}${isRiskLead(t.lead) ? " risk" : ""}`}
                      aria-current={on ? "true" : undefined}
                      onClick={() => void openThread(t)}
                    >
                      <span className={`chat-avatar ${ch || "unknown"}`} aria-hidden>
                        {initials(leadDisplayName(threadLead(t)))}
                      </span>
                      <span className="chat-row-body">
                        <span className="chat-row-top">
                          <strong dir="auto">{leadDisplayName(threadLead(t))}</strong>
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
                    {initials(leadDisplayName(threadLead(active)))}
                  </span>
                  <div className="chat-head-meta">
                    <Link href={leadHref(active.lead.id)} className="chat-head-name" dir="auto">
                      {leadDisplayName(threadLead(active))}
                    </Link>
                    <div className="chat-head-sub">
                      <ChannelBadge channel={channelOf(active)} />
                      {leadPhone(threadLead(active)) ? (
                        <span dir="ltr">{leadPhone(threadLead(active))}</span>
                      ) : null}
                      {active.lead.stage ? <span>{active.lead.stage}</span> : null}
                      {activeScore > 0 ? <span>امتیاز {activeScore}</span> : null}
                      {active.lead.bot_paused ? (
                        <>
                          <span className="chat-risk">ربات متوقف</span>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            loading={busy}
                            onClick={() => void resumeBot()}
                          >
                            شروع ربات
                          </Button>
                        </>
                      ) : null}
                    </div>
                    {activeTags.length > 0 || activeSentiment ? (
                      <div className="chat-head-tags">
                        {activeSentiment ? (
                          <span className={`chat-tag${activeSentiment === "negative" ? " danger" : ""}`}>
                            {SENTIMENT_LABELS_FA[activeSentiment] || activeSentiment}
                          </span>
                        ) : null}
                        {activeTags.slice(0, 6).map((t) => (
                          <span key={t} className="chat-tag">
                            {tagLabel(t)}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {isRiskLead(active.lead) ? (
                      <div className="chat-risk-banner">این گفتگو ریسک دارد یا نیاز به کارشناس دارد.</div>
                    ) : null}
                    {typing ? (
                      <div className="chat-typing" aria-live="polite">
                        <span className="chat-typing-dots" aria-hidden>
                          <i />
                          <i />
                          <i />
                        </span>
                        {typingKind === "recording"
                          ? "در حال ضبط صدا…"
                          : "در حال نوشتن…"}
                      </div>
                    ) : null}
                    {suggestedStage && suggestedStage !== active.lead.stage ? (
                      <div className="chat-stage-suggest">
                        <span>پیشنهاد مرحله: {suggestedStage}</span>
                        <Button type="button" size="sm" variant="secondary" onClick={() => void applySuggestedStage()}>
                          اعمال
                        </Button>
                      </div>
                    ) : null}
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
                              <p
                                dir="auto"
                                className={isPlaceholderBody(m.body) ? "bubble-placeholder" : undefined}
                              >
                                {displayMessageBody(m.body, m.media_type)}
                              </p>
                              <span className="bubble-meta">
                                {senderLabel(m.sender_type, outbound)}
                                {" · "}
                                {formatTime(m.created_at)}
                                {outbound ? (
                                  <>
                                    {" · "}
                                    <DeliveryTicks status={m.delivery_status} />
                                  </>
                                ) : null}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {draft ? (
                  <div className="chat-ai-draft">
                    <div className="chat-ai-draft-head">
                      <strong>پیشنهاد هوش مصنوعی</strong>
                      <span>اطمینان {(draft.confidence * 100).toFixed(0)}٪</span>
                    </div>
                    <p dir="auto">{draft.reply}</p>
                    <div className="chat-ai-draft-actions">
                      <Button type="button" size="sm" onClick={() => void acceptSuggest()}>
                        پذیرش
                      </Button>
                      <Button type="button" size="sm" variant="secondary" onClick={() => setDraft(null)}>
                        رد
                      </Button>
                    </div>
                  </div>
                ) : null}

                <form
                  className="chat-composer"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send();
                  }}
                >
                  {allowSuggest ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      loading={suggestBusy}
                      onClick={() => void requestSuggest()}
                    >
                      پیشنهاد AI
                    </Button>
                  ) : null}
                  <textarea
                    ref={inputRef}
                    rows={1}
                    value={text}
                    onChange={(e) => {
                      onComposerChange(e.target.value);
                      e.target.style.height = "auto";
                      e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
                    }}
                    onBlur={() => {
                      clearTypingTimer();
                      lastTypingSent.current = 0;
                      broadcastOwnTyping("paused");
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
