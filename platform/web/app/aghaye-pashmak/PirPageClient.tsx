"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import Shell from "@/components/Shell";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { PageLoading } from "@/components/ui/Spinner";
import { PASHMAK_AVATAR, PASHMAK_NAME } from "@/components/AghaPashmakFloat";
import { api } from "@/lib/api";
import { getCachedOrgMe, loadOrgMe } from "@/lib/me-cache";
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
  "کدام اپراتور کارآمدتر است؟",
  "فروشنده برتر کیست؟",
  "خریداران برتر چه کسانی‌اند؟",
  "امروز چه لیدهایی پتانسیل خرید بیشتری دارند؟",
  "چطور پاسخ‌های ربات را بهتر کنیم؟",
  "برای لیدهای سرد یک ایده کمپین بده"
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

function PashmakAvatar({ size = 36 }: { size?: number }) {
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

function UserInitialAvatar({ name }: { name: string }) {
  const label = (name || "ک").trim();
  const initial = label.slice(0, 1);
  return (
    <span className="pir-user-avatar" title={label} aria-hidden>
      {initial}
    </span>
  );
}

function TypewriterText({ text, active }: { text: string; active: boolean }) {
  const [shown, setShown] = useState(active ? "" : text);

  useEffect(() => {
    if (!active) {
      setShown(text);
      return;
    }
    setShown("");
    if (!text) return;
    let i = 0;
    const step = Math.max(1, Math.ceil(text.length / 80));
    const id = window.setInterval(() => {
      i = Math.min(text.length, i + step);
      setShown(text.slice(0, i));
      if (i >= text.length) window.clearInterval(id);
    }, 28);
    return () => window.clearInterval(id);
  }, [text, active]);

  return (
    <p className={active && shown.length < text.length ? "pir-typewriter" : undefined}>
      {shown}
      {active && shown.length < text.length ? <span className="pir-caret" aria-hidden /> : null}
    </p>
  );
}

export default function PirPageClient() {
  const searchParams = useSearchParams();
  const wantChat = searchParams.get("chat") === "1";
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"wizard" | "chat">("wizard");
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState<PirProfile>(emptyProfile());
  const [messages, setMessages] = useState<CoachMsg[]>([]);
  const [text, setText] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [typingId, setTypingId] = useState<string | null>(null);
  const [userName, setUserName] = useState(
    () => getCachedOrgMe()?.user?.display_name || getCachedOrgMe()?.user?.phone || "کاربر"
  );
  const { busy, run } = useMutation();
  const toast = useToast();
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  async function load() {
    setLoading(true);
    try {
      const [p, thread, me] = await Promise.all([
        api<PirProfile>("/ai/pir/profile"),
        api<{ messages: CoachMsg[] }>("/ai/pir/messages").catch(() => ({ messages: [] })),
        loadOrgMe().catch(() => getCachedOrgMe())
      ]);
      if (me?.user) {
        setUserName(me.user.display_name || me.user.phone || "کاربر");
      }
      setProfile({
        ...emptyProfile(),
        ...p,
        goals: p.goals?.length ? p.goals : ["lead"]
      });
      setMessages(thread.messages || []);
      if (wantChat && p.wizard_completed) setMode("chat");
      else if (wantChat && !p.wizard_completed) setMode("wizard");
      else setMode(p.wizard_completed ? "chat" : "wizard");
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
  }, [wantChat]);

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
      const assistant =
        res.message ||
        ({
          id: `a-${Date.now()}`,
          role: "assistant",
          body: res.reply,
          created_at: new Date().toISOString()
        } satisfies CoachMsg);
      setTypingId(assistant.id);
      setMessages((m) => {
        const without = m.filter((x) => x.id !== optimistic.id);
        return [...without, { ...optimistic, id: `u-${Date.now()}` }, assistant];
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
    if (ok) {
      setMessages([]);
      setInfoOpen(false);
    }
  }

  if (loading) {
    return (
      <Shell title={PASHMAK_NAME} sub="مربی هوشمند کسب‌وکار">
        <PageLoading />
      </Shell>
    );
  }

  const goalLabels = profile.goals
    .map((g) => GOALS.find((x) => x.key === g)?.label || g)
    .filter(Boolean)
    .join("، ");

  return (
    <Shell title={PASHMAK_NAME} sub="مربی خردمند تیم فروش">
      <div className={`pir-page${mode === "chat" ? " pir-page--chat" : ""}`}>
        {mode !== "chat" ? (
          <header className="pir-hero">
            <div className="pir-hero-brand-row">
              <PashmakAvatar size={56} />
              <p className="pir-brand">{PASHMAK_NAME}</p>
            </div>
            <p className="pir-lead">
              پروفایل کسب‌وکارتان را بسازید تا دستور AI مشتری نوشته شود؛ سپس از مربی برای کمپین،
              دانش و بهبود پاسخ‌ها بپرسید.
            </p>
            <p className="pir-disclaimer">
              {PASHMAK_NAME} فقط به تیم شما مشاوره می‌دهد؛ پیام مشتری نمی‌فرستد.
            </p>
            {profile.wizard_completed ? (
              <div className="pir-hero-actions">
                <Button type="button" size="sm" variant="secondary" onClick={() => setMode("chat")}>
                  بازگشت به گفتگو
                </Button>
              </div>
            ) : null}
          </header>
        ) : null}

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
          <section className="pir-chat" aria-label={`گفتگو با ${PASHMAK_NAME}`}>
            <button
              type="button"
              className="pir-chat-head"
              onClick={() => setInfoOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={infoOpen}
              aria-label={`${PASHMAK_NAME} — مشاهده جزئیات و اقدامات`}
            >
              <span className="pir-chat-head-avatar">
                <PashmakAvatar size={42} />
              </span>
              <span className="pir-chat-head-meta">
                <strong>{PASHMAK_NAME}</strong>
                <span>مربی تیم · ضربه بزنید برای جزئیات</span>
              </span>
              <span className="pir-chat-head-cta" aria-hidden>
                جزئیات
                <span className="pir-chat-head-chevron">‹</span>
              </span>
            </button>
            <div className="pir-chat-thread" ref={scroller}>
              {messages.length === 0 ? (
                <div className="pir-chat-empty">
                  <PashmakAvatar size={56} />
                  <p>از {PASHMAK_NAME} بپرسید…</p>
                  <div className="pir-starters">
                    {STARTERS.map((s) => (
                      <button key={s} type="button" className="pir-starter" onClick={() => void sendChat(s)}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((m) =>
                  m.role === "assistant" ? (
                    <div key={m.id} className="pir-msg-row assistant">
                      <div className="pir-bubble assistant" dir="auto">
                        <div className="pir-bubble-head">
                          <PashmakAvatar size={22} />
                        </div>
                        <TypewriterText text={m.body} active={typingId === m.id} />
                      </div>
                    </div>
                  ) : (
                    <div key={m.id} className="pir-msg-row user">
                      <div className="pir-bubble user" dir="auto">
                        <div className="pir-bubble-head">
                          <UserInitialAvatar name={userName} />
                        </div>
                        <p>{m.body}</p>
                      </div>
                    </div>
                  )
                )
              )}
              {chatBusy ? (
                <div className="pir-msg-row assistant">
                  <div className="pir-bubble assistant pir-thinking" dir="auto">
                    <div className="pir-bubble-head">
                      <PashmakAvatar size={22} />
                    </div>
                    <p className="pir-typing-row">
                      در حال اندیشیدن
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
              className="pir-chat-composer"
              onSubmit={(e) => {
                e.preventDefault();
                void sendChat();
              }}
            >
              <textarea
                ref={inputRef}
                rows={1}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={`پیام به ${PASHMAK_NAME}…`}
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
                بفرست
              </Button>
            </form>
          </section>
        )}
      </div>

      <Modal
        open={infoOpen}
        title={PASHMAK_NAME}
        onClose={() => setInfoOpen(false)}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setInfoOpen(false)}>
              بستن
            </Button>
            <Button
              type="button"
              variant="ghost"
              loading={busy}
              onClick={() => void clearChat()}
            >
              پاک کردن گفتگو
            </Button>
          </>
        }
      >
        <div className="pir-info-modal">
          <div className="pir-info-hero">
            <PashmakAvatar size={72} />
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
