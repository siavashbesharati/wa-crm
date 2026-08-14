"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Shell from "@/components/Shell";
import { Button } from "@/components/ui/Button";
import { PageLoading } from "@/components/ui/Spinner";
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
  "چطور پاسخ‌های ربات را بهتر کنیم؟",
  "برای لیدهای سرد یک ایده کمپین بده",
  "چه دانشی باید به پایگاه دانش اضافه کنیم؟"
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

export default function PirKharabatPage() {
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"wizard" | "chat">("wizard");
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState<PirProfile>(emptyProfile());
  const [messages, setMessages] = useState<CoachMsg[]>([]);
  const [text, setText] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const { busy, run } = useMutation();
  const toast = useToast();
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  async function load() {
    setLoading(true);
    try {
      const [p, thread] = await Promise.all([
        api<PirProfile>("/ai/pir/profile"),
        api<{ messages: CoachMsg[] }>("/ai/pir/messages").catch(() => ({ messages: [] }))
      ]);
      setProfile({
        ...emptyProfile(),
        ...p,
        goals: p.goals?.length ? p.goals : ["lead"]
      });
      setMessages(thread.messages || []);
      setMode(p.wizard_completed ? "chat" : "wizard");
      setStep(0);
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length, chatBusy, mode]);

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
      if (complete) setMode("chat");
    } else if (ok) {
      await load();
      if (complete) setMode("chat");
    }
  }

  async function sendChat(override?: string) {
    const msg = (override ?? text).trim();
    if (!msg || chatBusy) return;
    setText("");
    setChatBusy(true);
    const optimistic: CoachMsg = {
      id: `local-${Date.now()}`,
      role: "user",
      body: msg,
      created_at: new Date().toISOString()
    };
    setMessages((m) => [...m, optimistic]);
    try {
      const res = await api<{ reply: string; message: CoachMsg }>("/ai/pir/chat", {
        method: "POST",
        body: JSON.stringify({ message: msg })
      });
      setMessages((m) => {
        const without = m.filter((x) => x.id !== optimistic.id);
        return [
          ...without,
          { ...optimistic, id: `u-${Date.now()}` },
          res.message || {
            id: `a-${Date.now()}`,
            role: "assistant",
            body: res.reply,
            created_at: new Date().toISOString()
          }
        ];
      });
    } catch (e) {
      setMessages((m) => m.filter((x) => x.id !== optimistic.id));
      toast.push(e instanceof Error ? e.message : "خطا در گفتگو", "err");
    } finally {
      setChatBusy(false);
      window.setTimeout(() => inputRef.current?.focus(), 40);
    }
  }

  async function clearChat() {
    const ok = await run(
      () => api("/ai/pir/messages", { method: "DELETE" }),
      { success: "گفتگو پاک شد" }
    );
    if (ok) setMessages([]);
  }

  if (loading) {
    return (
      <Shell title="پیر خرابات" sub="مربی هوشمند کسب‌وکار">
        <PageLoading />
      </Shell>
    );
  }

  return (
    <Shell title="پیر خرابات" sub="مربی خردمند تیم فروش — نه ربات مشتری">
      <div className="pir-page">
        <header className="pir-hero">
          <p className="pir-brand">پیر خرابات</p>
          <p className="pir-lead">
            پروفایل کسب‌وکارتان را بسازید تا دستور AI مشتری نوشته شود؛ سپس از مربی برای کمپین،
            دانش و بهبود پاسخ‌ها بپرسید.
          </p>
          <p className="pir-disclaimer">
            پیر خرابات فقط به تیم شما مشاوره می‌دهد؛ پیام مشتری نمی‌فرستد.
          </p>
          {mode === "chat" ? (
            <div className="pir-hero-actions">
              <Button type="button" size="sm" variant="secondary" onClick={() => setMode("wizard")}>
                ویرایش پروفایل
              </Button>
              <Link href="/ai-settings" className="pir-link">
                تنظیمات AI
              </Link>
            </div>
          ) : profile.wizard_completed ? (
            <div className="pir-hero-actions">
              <Button type="button" size="sm" variant="secondary" onClick={() => setMode("chat")}>
                بازگشت به گفتگو
              </Button>
            </div>
          ) : null}
        </header>

        {mode === "wizard" ? (
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
        ) : (
          <section className="pir-chat" aria-label="گفتگو با پیر خرابات">
            <div className="pir-chat-toolbar">
              <Button type="button" size="sm" variant="ghost" loading={busy} onClick={() => void clearChat()}>
                پاک کردن گفتگو
              </Button>
            </div>
            <div className="pir-chat-thread" ref={scroller}>
              {messages.length === 0 ? (
                <div className="pir-chat-empty">
                  <p>از پیر خرابات بپرسید…</p>
                  <div className="pir-starters">
                    {STARTERS.map((s) => (
                      <button key={s} type="button" className="pir-starter" onClick={() => void sendChat(s)}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((m) => (
                  <div
                    key={m.id}
                    className={`pir-bubble ${m.role === "user" ? "user" : "assistant"}`}
                    dir="auto"
                  >
                    {m.role === "assistant" ? <span className="pir-bubble-label">پیر خرابات</span> : null}
                    <p>{m.body}</p>
                  </div>
                ))
              )}
              {chatBusy ? (
                <div className="pir-bubble assistant pir-thinking">
                  <span className="pir-bubble-label">پیر خرابات</span>
                  <p>در حال اندیشیدن…</p>
                </div>
              ) : null}
            </div>
            <form
              className="pir-chat-composer"
              onSubmit={(e) => {
                e.preventDefault();
                void sendChat();
              }}
            >
              <textarea
                ref={inputRef}
                rows={2}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="سوال از پیر خرابات…"
                dir="auto"
                disabled={chatBusy}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void sendChat();
                  }
                }}
              />
              <Button type="submit" loading={chatBusy} disabled={!text.trim()}>
                بپرس
              </Button>
            </form>
          </section>
        )}
      </div>
    </Shell>
  );
}
