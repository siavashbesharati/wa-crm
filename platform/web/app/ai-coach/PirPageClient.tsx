"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import Shell from "@/components/Shell";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { PageLoading } from "@/components/ui/Spinner";
import { IconBack } from "@/components/ui/Icons";
import { PASHMAK_AVATAR, PASHMAK_NAME } from "@/components/AghaPashmakFloat";
import { api } from "@/lib/api";
import { useMutation } from "@/lib/useApi";
import { useToast } from "@/components/ui/Toast";

type PirProfile = {
  niche: string;
  audience: string;
  tone: string;
  goals: string[];
  offers: string;
  banned_phrases: string;
  wizard_completed: boolean;
  updated_at?: string | null;
};

type CoachMsg = {
  id: string;
  role: string;
  body: string;
  created_at: string;
  thread_id?: string;
};

type CoachThread = {
  id: string;
  title: string;
  preview: string;
  updated_at?: string | null;
  message_count: number;
};

const NICHES = ["تور و سفر", "فروشگاه", "خدمات", "املاک", "آموزش", "سایر"];
const TONES = ["رسمی", "خودمانی", "لوکس"];
const GOALS: { key: string; label: string }[] = [
  { key: "lead", label: "جذب لید" },
  { key: "booking", label: "رزرو / فروش" },
  { key: "support", label: "پشتیبانی" },
  { key: "recovery", label: "بازگردانی مشتری" }
];

const STARTERS = [
  "خلاصه امروز را بده",
  "کدام اپراتور کارآمدتر است؟",
  "امروز چه لیدهایی پتانسیل خرید بیشتری دارند؟",
  "کدام نیاز به مداخله انسانی یا ریسک از دست رفتن داره؟",
  "برای داغ‌ترین لید وظیفه بساز",
  "پیش‌نویس پیام برای داغ‌ترین لید"
];

const emptyProfile = (): PirProfile => ({
  niche: "",
  audience: "",
  tone: "رسمی",
  goals: ["lead"],
  offers: "",
  banned_phrases: "",
  wizard_completed: false
});

function newThreadId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `t-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatTime(iso?: string | null) {
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

function CoachAvatar({ size = 36 }: { size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={PASHMAK_AVATAR}
      alt={PASHMAK_NAME}
      className="pashmak-avatar"
      width={size}
      height={size}
    />
  );
}

export default function PirPageClient() {
  const searchParams = useSearchParams();
  const wantChat = searchParams.get("chat") === "1";
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"wizard" | "chat">("wizard");
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState<PirProfile>(emptyProfile());
  const [threads, setThreads] = useState<CoachThread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeTitle, setActiveTitle] = useState("گفتگوی جدید");
  const [messages, setMessages] = useState<CoachMsg[]>([]);
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const { busy, run } = useMutation();
  const toast = useToast();
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollThreadToEnd = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ top: Math.max(0, el.scrollHeight - el.clientHeight), behavior: "smooth" });
  }, []);

  const loadThreads = useCallback(async () => {
    const res = await api<{ threads: CoachThread[] }>("/ai/pir/threads").catch(() => ({
      threads: [] as CoachThread[]
    }));
    setThreads(res.threads || []);
    return res.threads || [];
  }, []);

  async function load() {
    setLoading(true);
    try {
      const [p, threadList] = await Promise.all([
        api<PirProfile>("/ai/pir/profile"),
        loadThreads()
      ]);
      setProfile({
        ...emptyProfile(),
        ...p,
        goals: p.goals?.length ? p.goals : ["lead"]
      });
      const done = !!p.wizard_completed;
      if (!done) {
        setMode("wizard");
      } else {
        setMode("chat");
        if (wantChat) {
          startNewChat();
        }
      }
      setStep(0);
      void threadList;
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantChat]);

  useEffect(() => {
    scrollThreadToEnd();
  }, [messages.length, chatBusy, activeId, scrollThreadToEnd]);

  function toggleGoal(key: string) {
    setProfile((cur) => {
      const has = cur.goals.includes(key);
      const next = has ? cur.goals.filter((g) => g !== key) : [...cur.goals, key];
      return { ...cur, goals: next.length ? next : cur.goals };
    });
  }

  async function saveWizard(complete: boolean) {
    const body = {
      niche: profile.niche.trim(),
      audience: profile.audience.trim(),
      tone: profile.tone.trim(),
      goals: profile.goals,
      offers: profile.offers.trim(),
      banned_phrases: profile.banned_phrases.trim(),
      wizard_completed: complete || profile.wizard_completed,
      apply_prompts: complete
    };
    if (complete && !body.niche) {
      toast.push("حوزه کسب‌وکار را مشخص کنید", "err");
      return;
    }
    const ok = await run(
      () =>
        api<PirProfile>("/ai/pir/profile", {
          method: "PUT",
          body: JSON.stringify(body)
        }),
      { success: complete ? "پروفایل ذخیره و دستور AI نوشته شد" : "پیش‌نویس ذخیره شد" }
    );
    if (ok && typeof ok === "object") {
      setProfile({ ...emptyProfile(), ...ok, goals: ok.goals?.length ? ok.goals : ["lead"] });
      if (complete) {
        setMode("chat");
        startNewChat();
      }
    } else if (ok) {
      await load();
      if (complete) {
        setMode("chat");
        startNewChat();
      }
    }
  }

  async function openThread(t: CoachThread) {
    setActiveId(t.id);
    setActiveTitle(t.title || "گفتگو");
    setMessages([]);
    try {
      const res = await api<{ messages: CoachMsg[] }>(
        `/ai/pir/messages?thread_id=${encodeURIComponent(t.id)}`
      );
      setMessages(res.messages || []);
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا در بارگذاری گفتگو", "err");
    }
  }

  function startNewChat() {
    const id = newThreadId();
    setActiveId(id);
    setActiveTitle("گفتگوی جدید");
    setMessages([]);
    setText("");
  }

  function closeThread() {
    setActiveId(null);
    setMessages([]);
    setText("");
    void loadThreads();
  }

  async function sendChat(override?: string) {
    const msg = (override ?? text).trim();
    if (!msg || chatBusy || !activeId) return;
    setText("");
    setChatBusy(true);
    if (inputRef.current) inputRef.current.style.height = "auto";
    const optimistic: CoachMsg = {
      id: `local-${Date.now()}`,
      role: "user",
      body: msg,
      created_at: new Date().toISOString(),
      thread_id: activeId
    };
    setMessages((m) => [...m, optimistic]);
    if (activeTitle === "گفتگوی جدید") {
      setActiveTitle(msg.length > 48 ? `${msg.slice(0, 47)}…` : msg);
    }
    try {
      const res = await api<{ reply: string; message: CoachMsg; thread_id?: string }>(
        "/ai/pir/chat",
        {
          method: "POST",
          body: JSON.stringify({ message: msg, thread_id: activeId })
        }
      );
      const assistant =
        res.message ||
        ({
          id: `a-${Date.now()}`,
          role: "assistant",
          body: res.reply,
          created_at: new Date().toISOString(),
          thread_id: activeId
        } satisfies CoachMsg);
      setMessages((m) => {
        const without = m.filter((x) => x.id !== optimistic.id);
        return [...without, { ...optimistic, id: `u-${Date.now()}` }, assistant];
      });
      if (res.thread_id && res.thread_id !== activeId) {
        setActiveId(res.thread_id);
      }
      void loadThreads();
    } catch (e) {
      setMessages((m) => m.filter((x) => x.id !== optimistic.id));
      toast.push(e instanceof Error ? e.message : "خطا در گفتگو", "err");
    } finally {
      setChatBusy(false);
    }
  }

  async function clearActiveChat() {
    if (!activeId) return;
    const ok = await run(
      () =>
        api(`/ai/pir/messages?thread_id=${encodeURIComponent(activeId)}`, {
          method: "DELETE"
        }),
      { success: "گفتگو پاک شد" }
    );
    if (ok) {
      setMessages([]);
      setInfoOpen(false);
      closeThread();
    }
  }

  const filteredThreads = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return threads;
    return threads.filter(
      (t) =>
        (t.title || "").toLowerCase().includes(needle) ||
        (t.preview || "").toLowerCase().includes(needle)
    );
  }, [threads, q]);

  const chronological = messages;

  const goalLabels = profile.goals
    .map((g) => GOALS.find((x) => x.key === g)?.label || g)
    .filter(Boolean)
    .join("، ");

  if (loading) {
    return (
      <Shell title={PASHMAK_NAME} sub="مربی هوشمند کسب‌وکار" hideTopBar fullBleed>
        <PageLoading variant="list" />
      </Shell>
    );
  }

  if (mode === "wizard") {
    return (
      <Shell title={PASHMAK_NAME} sub="راه‌اندازی پروفایل">
        <div className="pir-page">
          <header className="pir-hero">
            <div className="pir-hero-brand-row">
              <CoachAvatar size={56} />
              <p className="pir-brand">{PASHMAK_NAME}</p>
            </div>
            <p className="pir-lead">
              پروفایل کسب‌وکارتان را بسازید تا دستور AI مشتری نوشته شود؛ سپس گفتگوهای مربی مثل
              واتساپ اینجا می‌مانند.
            </p>
            {profile.wizard_completed ? (
              <div className="pir-hero-actions">
                <Button type="button" size="sm" variant="secondary" onClick={() => setMode("chat")}>
                  بازگشت به گفتگوها
                </Button>
              </div>
            ) : null}
          </header>

          <section className="pir-wizard" aria-label="ویزارد پروفایل">
            <div className="pir-steps" role="tablist">
              {["حوزه", "لحن و هدف", "پیشنهادها", "خلاصه"].map((label, i) => (
                <button
                  key={label}
                  type="button"
                  role="tab"
                  className={`pir-step${step === i ? " active" : ""}`}
                  aria-selected={step === i}
                  onClick={() => setStep(i)}
                >
                  {i + 1}. {label}
                </button>
              ))}
            </div>

            <div className="pir-wizard-body">
              {step === 0 ? (
                <>
                  <label className="pir-field">
                    حوزه کسب‌وکار
                    <div className="pir-chips">
                      {NICHES.map((n) => (
                        <button
                          key={n}
                          type="button"
                          className={`pir-chip${profile.niche === n ? " active" : ""}`}
                          onClick={() => setProfile({ ...profile, niche: n })}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                    <input
                      value={profile.niche}
                      onChange={(e) => setProfile({ ...profile, niche: e.target.value })}
                      placeholder="یا بنویسید…"
                    />
                  </label>
                  <label className="pir-field">
                    مخاطب هدف
                    <textarea
                      rows={3}
                      value={profile.audience}
                      onChange={(e) => setProfile({ ...profile, audience: e.target.value })}
                      placeholder="مثلاً خانواده‌های علاقه‌مند به تور کیش"
                      dir="auto"
                    />
                  </label>
                </>
              ) : null}

              {step === 1 ? (
                <>
                  <label className="pir-field">
                    لحن گفتگو با مشتری
                    <div className="pir-chips">
                      {TONES.map((t) => (
                        <button
                          key={t}
                          type="button"
                          className={`pir-chip${profile.tone === t ? " active" : ""}`}
                          onClick={() => setProfile({ ...profile, tone: t })}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </label>
                  <div className="pir-field">
                    <span>اهداف اصلی</span>
                    <div className="pir-chips">
                      {GOALS.map((g) => (
                        <button
                          key={g.key}
                          type="button"
                          className={`pir-chip${profile.goals.includes(g.key) ? " active" : ""}`}
                          onClick={() => toggleGoal(g.key)}
                        >
                          {g.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              ) : null}

              {step === 2 ? (
                <>
                  <label className="pir-field">
                    محصولات / خدمات اصلی
                    <textarea
                      rows={4}
                      value={profile.offers}
                      onChange={(e) => setProfile({ ...profile, offers: e.target.value })}
                      placeholder="چه می‌فروشید یا چه خدمتی می‌دهید؟"
                      dir="auto"
                    />
                  </label>
                  <label className="pir-field">
                    عبارات ممنوع / وعده‌های ممنوع
                    <textarea
                      rows={3}
                      value={profile.banned_phrases}
                      onChange={(e) =>
                        setProfile({ ...profile, banned_phrases: e.target.value })
                      }
                      placeholder="مثلاً تضمین ویزا، قیمت بدون تأیید"
                      dir="auto"
                    />
                  </label>
                </>
              ) : null}

              {step === 3 ? (
                <div className="pir-summary" dir="auto">
                  <p>
                    <strong>حوزه:</strong> {profile.niche || "—"}
                  </p>
                  <p>
                    <strong>مخاطب:</strong> {profile.audience || "—"}
                  </p>
                  <p>
                    <strong>لحن:</strong> {profile.tone || "—"}
                  </p>
                  <p>
                    <strong>اهداف:</strong>{" "}
                    {profile.goals.map((g) => GOALS.find((x) => x.key === g)?.label || g).join("، ") ||
                      "—"}
                  </p>
                  <p>
                    <strong>پیشنهادها:</strong> {profile.offers || "—"}
                  </p>
                  <p>
                    <strong>ممنوعیات:</strong> {profile.banned_phrases || "—"}
                  </p>
                </div>
              ) : null}
            </div>

            <div className="pir-wizard-footer">
              <Button
                type="button"
                variant="secondary"
                disabled={step === 0}
                onClick={() => setStep((s) => Math.max(0, s - 1))}
              >
                قبلی
              </Button>
              {step < 3 ? (
                <Button type="button" onClick={() => setStep((s) => Math.min(3, s + 1))}>
                  بعدی
                </Button>
              ) : (
                <Button type="button" loading={busy} onClick={() => void saveWizard(true)}>
                  تکمیل و نوشتن دستور AI
                </Button>
              )}
            </div>
          </section>
        </div>
      </Shell>
    );
  }

  return (
    <Shell
      title={PASHMAK_NAME}
      sub="گفتگوهای مربی"
      hideTabBar={!!activeId}
      fullBleed
      hideTopBar
    >
      <div className={`chat-app coach-chat-app${activeId ? " chat-thread-open" : ""}`}>
        <aside className="chat-list" aria-label="تاریخچه گفتگوها">
          <div className="chat-list-head coach-list-head">
            <div className="coach-list-head-row">
              <h1 className="chat-list-title">{PASHMAK_NAME}</h1>
              <div className="coach-list-actions">
                <button
                  type="button"
                  className="coach-icon-btn"
                  aria-label="گفتگوی جدید"
                  title="گفتگوی جدید"
                  onClick={startNewChat}
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path
                      d="M12 5v14M5 12h14"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
                <button
                  type="button"
                  className="coach-icon-btn"
                  aria-label="جزئیات و تنظیمات"
                  onClick={() => setInfoOpen(true)}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
                    <path
                      d="M12 11v5M12 8h.01"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>
            </div>
            <input
              className="chat-list-search"
              type="search"
              enterKeyHint="search"
              placeholder="جستجوی گفتگو…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="جستجوی گفتگو"
            />
          </div>
          <div className="chat-list-scroll">
            {filteredThreads.length === 0 ? (
              <EmptyState
                title="گفتگویی نیست"
                text="با دکمه + یک گفتگوی جدید شروع کنید."
                action={
                  <Button type="button" onClick={startNewChat}>
                    گفتگوی جدید
                  </Button>
                }
              />
            ) : (
              filteredThreads.map((t) => {
                const on = activeId === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    className={`chat-row${on ? " active" : ""}`}
                    aria-current={on ? "true" : undefined}
                    onClick={() => void openThread(t)}
                  >
                    <span className="chat-avatar coach-avatar-wrap" aria-hidden>
                      <CoachAvatar size={49} />
                    </span>
                    <span className="chat-row-body">
                      <span className="chat-row-top">
                        <strong dir="auto">{t.title || "گفتگو"}</strong>
                        <time>{formatTime(t.updated_at)}</time>
                      </span>
                      <span className="chat-row-mid">
                        <span className="chat-preview" dir="auto">
                          {t.preview || "بدون پیام"}
                        </span>
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
          <div className="coach-list-footer">
            <Button type="button" className="coach-new-chat-btn" onClick={startNewChat}>
              گفتگوی جدید
            </Button>
          </div>
        </aside>

        <section className="chat-stage" aria-label="پنجره گفتگو">
          {!activeId ? (
            <div className="chat-empty">
              <EmptyState
                title="یک گفتگو را انتخاب کنید"
                text="از فهرست سمت راست یک تاریخچه را باز کنید یا گفتگوی جدید بسازید."
                action={
                  <Button type="button" onClick={startNewChat}>
                    گفتگوی جدید
                  </Button>
                }
              />
            </div>
          ) : (
            <>
              <header className="chat-head">
                <button
                  type="button"
                  className="chat-back-btn coach-back-always"
                  aria-label="بازگشت به فهرست"
                  onClick={closeThread}
                >
                  <IconBack size={20} />
                </button>
                <span className="chat-avatar coach-avatar-wrap" aria-hidden>
                  <CoachAvatar size={40} />
                </span>
                <button
                  type="button"
                  className="chat-head-meta coach-head-meta-btn"
                  onClick={() => setInfoOpen(true)}
                >
                  <span className="chat-head-name" dir="auto">
                    {activeTitle}
                  </span>
                  <div className="chat-head-sub">
                    <span>{PASHMAK_NAME}</span>
                  </div>
                </button>
              </header>

              <div className="chat-scroll" ref={scroller}>
                {chronological.length === 0 ? (
                  <div className="coach-chat-empty">
                    <CoachAvatar size={64} />
                    <p>از {PASHMAK_NAME} بپرسید…</p>
                    <div className="pir-starters">
                      {STARTERS.map((s) => (
                        <button
                          key={s}
                          type="button"
                          className="pir-starter"
                          onClick={() => void sendChat(s)}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  chronological.map((m, i) => {
                    const prev = chronological[i - 1];
                    const showDay = !prev || dayKey(prev.created_at) !== dayKey(m.created_at);
                    const outbound = m.role === "user";
                    return (
                      <div key={m.id} className="chat-block">
                        {showDay ? <div className="chat-day">{dayLabel(m.created_at)}</div> : null}
                        <div className={`bubble-row ${outbound ? "out" : "in"}`}>
                          <div className={`bubble ${outbound ? "out" : "in"}`} dir="auto">
                            <p className="bubble-text">{m.body}</p>
                            <time className="bubble-time">{formatTime(m.created_at)}</time>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                {chatBusy ? (
                  <div className="bubble-row in">
                    <div className="bubble in">
                      <p className="bubble-text pir-typing-row">
                        در حال نوشتن
                        <span className="chat-typing-dots" aria-hidden>
                          <i />
                          <i />
                          <i />
                        </span>
                      </p>
                    </div>
                  </div>
                ) : null}
              </div>

              <form
                className="chat-composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  void sendChat();
                }}
              >
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    const el = e.target;
                    el.style.height = "auto";
                    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
                  }}
                  placeholder="پیام…"
                  dir="rtl"
                  disabled={chatBusy}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void sendChat();
                    }
                  }}
                />
                <Button type="submit" disabled={chatBusy || !text.trim()} loading={chatBusy}>
                  ارسال
                </Button>
              </form>
            </>
          )}
        </section>
      </div>

      <Modal
        open={infoOpen}
        title={PASHMAK_NAME}
        onClose={() => setInfoOpen(false)}
        presentation="auto"
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setInfoOpen(false)}>
              بستن
            </Button>
            {activeId ? (
              <Button
                type="button"
                variant="danger"
                loading={busy}
                onClick={() => void clearActiveChat()}
              >
                پاک کردن این گفتگو
              </Button>
            ) : null}
          </>
        }
      >
        <div className="pir-info-modal">
          <div className="pir-info-hero">
            <CoachAvatar size={72} />
            <div>
              <strong>{PASHMAK_NAME}</strong>
              <p>مربی هوشمند داخلی — فقط برای تیم شما، نه مشتری.</p>
            </div>
          </div>
          <dl className="pir-info-facts">
            <div>
              <dt>حوزه</dt>
              <dd dir="auto">{profile.niche || "—"}</dd>
            </div>
            <div>
              <dt>لحن</dt>
              <dd dir="auto">{profile.tone || "—"}</dd>
            </div>
            <div>
              <dt>اهداف</dt>
              <dd dir="auto">{goalLabels || "—"}</dd>
            </div>
          </dl>
          <div className="pir-info-actions">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setInfoOpen(false);
                setMode("wizard");
              }}
            >
              ویرایش پروفایل
            </Button>
            <Link
              href="/ai-settings"
              className="btn secondary"
              onClick={() => setInfoOpen(false)}
            >
              تنظیمات AI
            </Link>
          </div>
        </div>
      </Modal>
    </Shell>
  );
}
