"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, clearSession, getSession } from "@/lib/api";
import {
  EXTENSION_DOWNLOAD_NAME,
  EXTENSION_DOWNLOAD_URL,
  EXTENSION_VERSION_FALLBACK
} from "@/lib/extension";
import { Button } from "@/components/ui/Button";
import { Badge, Card } from "@/components/ui/Card";
import { PageLoading } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";

type Plan = {
  id: string;
  label: string;
  max_seats: number;
  ai_auto_send: boolean;
  price_irr: number;
  price_label: string;
  features?: string[];
};

type OnboardingState = {
  step: string;
  needs_onboarding: boolean;
  role: string;
  org: {
    id: string;
    name: string;
    plan: string;
    industry: string;
    city: string;
  };
  user: { phone: string; display_name: string };
  plans: Plan[];
  bootstrap_seat_token?: string | null;
};

const STEPS = [
  { id: "profile", label: "پروفایل" },
  { id: "plan", label: "پلن" },
  { id: "payment", label: "پرداخت" },
  { id: "ai_settings", label: "تنظیمات AI" },
  { id: "knowledge", label: "دانش AI" },
  { id: "guides", label: "راهنما" }
];

const AI_ROLE_EXAMPLES = [
  "مشاور فروش تورهای گردشگری",
  "پشتیبان فروش فروشگاه آنلاین",
  "هماهنگ‌کننده نوبت کلینیک زیبایی"
];

const AI_PROMPT_EXAMPLE = `تو دستیار فروش این کسب‌وکار هستی.
- مودب، مختصر و به فارسی پاسخ بده.
- فقط بر اساس دانش بارگذاری‌شده قیمت و شرایط بگو؛ اگر مطمئن نیستی بگو «همکارم پیگیری می‌کند».
- شماره کارت یا لینک پرداخت نفرست مگر در دانش آمده باشد.
- مشتری را به مرحله بعد (مثلاً ارسال مشخصات مسافر) هدایت کن.`;

const KB_TITLE_EXAMPLE = "سوالات متداول و قیمت‌ها";
const KB_CONTENT_EXAMPLE = `سوال: ساعت پاسخگویی؟
جواب: همه روزه از ۹ صبح تا ۹ شب.

سوال: هزینه تور استانبول چند است؟
جواب: تور ۳ شب از ۲۸ میلیون تومان (بدون بلیط هواپیما). پیش‌پرداخت ۳۰٪.

سوال: کنسلی؟
جواب: تا ۷۲ ساعت قبل از سفر با کسر ۱۰٪، بعد از آن غیرقابل استرداد.

نکته: برای رزرو نام کامل، کد ملی و تاریخ سفر را بگیرید.`;

function stepIndex(step: string) {
  const i = STEPS.findIndex((s) => s.id === step);
  return i < 0 ? 0 : i;
}

export default function OnboardingPage() {
  return (
    <Suspense
      fallback={
        <div className="page-loading" style={{ minHeight: "100vh" }}>
          <PageLoading />
        </div>
      }
    >
      <OnboardingPageInner />
    </Suspense>
  );
}

function OnboardingPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const paidHandled = useRef(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<"form" | "creating-seat">("form");
  const [data, setData] = useState<OnboardingState | null>(null);
  const [payProvider, setPayProvider] = useState<"mock" | "zibal">("mock");

  const [orgName, setOrgName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [industry, setIndustry] = useState("");
  const [city, setCity] = useState("");
  const [selectedPlan, setSelectedPlan] = useState("starter");
  const [mockCard, setMockCard] = useState("4242");
  const [agentRole, setAgentRole] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [autoSend, setAutoSend] = useState(true);
  const [kbTitle, setKbTitle] = useState("");
  const [kbContent, setKbContent] = useState("");
  const [receipt, setReceipt] = useState<{
    ref: string;
    label: string;
    amount_irr: number;
  } | null>(null);
  const [seatToken, setSeatToken] = useState<string | null>(null);
  const [extVersion, setExtVersion] = useState(EXTENSION_VERSION_FALLBACK);

  const load = useCallback(async () => {
    if (!getSession()) {
      router.replace("/login");
      return;
    }
    setLoading(true);
    try {
      const res = await api<OnboardingState>("/orgs/onboarding");
      if (!res.needs_onboarding || res.step === "done") {
        router.replace("/home");
        return;
      }
      setData(res);
      setOrgName(res.org.name === "کسب‌وکار جدید" ? "" : res.org.name || "");
      setDisplayName(res.user.display_name || "");
      setIndustry(res.org.industry || "");
      setCity(res.org.city || "");
      setSelectedPlan(res.org.plan || "starter");
      if (res.bootstrap_seat_token) setSeatToken(res.bootstrap_seat_token);
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
      clearSession();
      router.replace("/login");
    } finally {
      setLoading(false);
    }
  }, [router, toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api<{ version?: string }>("/extension/latest", { auth: false })
      .then((r) => {
        if (r?.version) setExtVersion(r.version);
      })
      .catch(() => undefined);
    api<{ provider?: string }>("/payments/config", { auth: false })
      .then((r) => {
        const p = (r?.provider || "mock").toLowerCase();
        setPayProvider(p === "zibal" ? "zibal" : "mock");
      })
      .catch(() => setPayProvider("mock"));
  }, []);

  useEffect(() => {
    if (paidHandled.current || loading) return;
    const paid = searchParams.get("paid");
    if (paid !== "1" && paid !== "0") return;
    paidHandled.current = true;
    const error = searchParams.get("error");
    const ref = searchParams.get("ref");
    if (paid === "1") {
      toast.push(
        ref ? `پرداخت موفق — رسید ${ref}` : "پرداخت موفق",
        "ok"
      );
      if (ref) {
        setReceipt((prev) =>
          prev || { ref, label: "", amount_irr: 0 }
        );
      }
      void load();
    } else {
      toast.push(error ? `پرداخت ناموفق: ${error}` : "پرداخت ناموفق", "err");
    }
    router.replace("/onboarding");
  }, [loading, load, router, searchParams, toast]);

  async function saveProfile() {
    if (orgName.trim().length < 2) {
      toast.push("نام کسب‌وکار را وارد کنید", "err");
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ step: string }>("/orgs/onboarding/profile", {
        method: "PUT",
        body: JSON.stringify({
          org_name: orgName.trim(),
          display_name: displayName.trim(),
          industry: industry.trim(),
          city: city.trim()
        })
      });
      toast.push("پروفایل ذخیره شد", "ok");
      setData((d) => (d ? { ...d, step: res.step } : d));
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setBusy(false);
    }
  }

  async function savePlan() {
    setBusy(true);
    try {
      const res = await api<{ step: string }>("/orgs/onboarding/plan", {
        method: "PUT",
        body: JSON.stringify({ plan: selectedPlan })
      });
      toast.push("پلن انتخاب شد", "ok");
      setData((d) => (d ? { ...d, step: res.step } : d));
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setBusy(false);
    }
  }

  async function pay() {
    setBusy(true);
    setPhase("creating-seat");
    try {
      const res = await api<{
        step: string;
        paid?: boolean;
        provider?: string;
        payment_url?: string;
        bootstrap_seat_token?: string | null;
        receipt?: { ref: string; label: string; amount_irr: number };
      }>("/orgs/onboarding/pay", {
        method: "POST",
        body: JSON.stringify({
          plan: selectedPlan,
          mock_card: payProvider === "mock" ? mockCard : undefined
        })
      });

      if (res.payment_url) {
        window.location.href = res.payment_url;
        return;
      }

      if (res.receipt) setReceipt(res.receipt);
      if (res.bootstrap_seat_token) {
        setSeatToken(res.bootstrap_seat_token);
        try {
          await navigator.clipboard.writeText(res.bootstrap_seat_token);
        } catch {
          /* ignore */
        }
      }
      await new Promise((r) => setTimeout(r, 700));
      toast.push("پرداخت موفق — صندلی افزونه ساخته شد", "ok");
      setData((d) => (d ? { ...d, step: res.step } : d));
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setPhase("form");
      setBusy(false);
    }
  }

  async function saveAiSettings() {
    if (agentRole.trim().length < 3) {
      toast.push("نقش دستیار را وارد کنید یا یک نمونه را انتخاب کنید", "err");
      return;
    }
    if (systemPrompt.trim().length < 20) {
      toast.push("سیستم‌پرامپت را کامل‌تر بنویسید یا نمونه را اعمال کنید", "err");
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ step: string }>("/orgs/onboarding/ai-settings", {
        method: "PUT",
        body: JSON.stringify({
          agent_role: agentRole.trim(),
          system_prompt: systemPrompt.trim(),
          auto_send_enabled: autoSend
        })
      });
      toast.push("تنظیمات AI ذخیره شد", "ok");
      setData((d) => (d ? { ...d, step: res.step } : d));
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setBusy(false);
    }
  }

  async function saveKnowledge() {
    if (kbTitle.trim().length < 2 || kbContent.trim().length < 30) {
      toast.push("عنوان و متن دانش را پر کنید یا نمونه را اعمال کنید", "err");
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ step: string }>("/orgs/onboarding/knowledge", {
        method: "POST",
        body: JSON.stringify({
          title: kbTitle.trim(),
          content: kbContent.trim()
        })
      });
      toast.push("دانش AI ذخیره شد", "ok");
      setData((d) => (d ? { ...d, step: res.step } : d));
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    setBusy(true);
    try {
      await api("/orgs/onboarding/complete", { method: "POST" });
      toast.push("راه‌اندازی تکمیل شد", "ok");
      router.replace("/home");
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setBusy(false);
    }
  }

  if (loading || !data) {
    return (
      <div className="page-loading" style={{ minHeight: "100vh" }}>
        <PageLoading />
      </div>
    );
  }

  if (data.role !== "owner" && data.role !== "admin") {
    return (
      <div className="wizard-wrap">
        <div className="wizard-card">
          <Card
            title="در انتظار راه‌اندازی"
            help="مالک کسب‌وکار باید ویزارد را تمام کند تا بقیه اعضا وارد داشبورد شوند."
          >
            <p className="hint">
              مالک کسب‌وکار هنوز راه‌اندازی را تمام نکرده است.
            </p>
            <Button
              className="wizard-btn"
              variant="secondary"
              onClick={() => {
                clearSession();
                router.replace("/login");
              }}
            >
              خروج
            </Button>
          </Card>
        </div>
      </div>
    );
  }

  const idx = stepIndex(data.step);
  const plans = data.plans || [];
  const selectedMeta = plans.find((p) => p.id === selectedPlan);
  const progressPct = ((idx + (phase === "creating-seat" ? 0.5 : 0)) / (STEPS.length - 1)) * 100;

  return (
    <div className="wizard-wrap">
      <div className="wizard-card">
        <div className="wizard-head">
          <div>
            <div className="brand">راه‌اندازی کسب‌وکار</div>
            <div className="brand-sub">{data.user.phone}</div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              clearSession();
              router.replace("/login");
            }}
          >
            خروج
          </Button>
        </div>

        <div className="wizard-progress" aria-hidden>
          <i style={{ width: `${Math.min(100, progressPct)}%` }} />
        </div>

        <ol className="wizard-steps">
          {STEPS.map((s, i) => (
            <li
              key={s.id}
              className={i < idx ? "done" : i === idx ? "active" : ""}
            >
              <span className="wizard-dot">{i < idx ? "✓" : i + 1}</span>
              <span>{s.label}</span>
            </li>
          ))}
        </ol>

        {phase === "creating-seat" ? (
          <div className="wizard-pane wizard-seat-creating">
            <div className="wizard-pulse" aria-hidden />
            <h2>در حال ساخت صندلی افزونه…</h2>
            <p className="hint">توکن یکتا برای نصب Chrome شما آماده می‌شود.</p>
          </div>
        ) : (
          <div key={data.step} className="wizard-pane">
            {data.step === "profile" && (
              <Card
                title="۱. تکمیل پروفایل"
                help={{
                  title: "پروفایل",
                  body: "نام کسب‌وکار و مشخصات پایه — روی فاکتور، داشبورد و پیام‌های سیستم دیده می‌شود."
                }}
              >
                <div className="form-grid">
                  <label className="full">
                    نام کسب‌وکار
                    <input
                      value={orgName}
                      onChange={(e) => setOrgName(e.target.value)}
                      placeholder="مثلاً آژانس مسافرتی نمونه"
                    />
                  </label>
                  <label>
                    نام شما
                    <input
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="اختیاری"
                    />
                  </label>
                  <label>
                    حوزه فعالیت
                    <input
                      value={industry}
                      onChange={(e) => setIndustry(e.target.value)}
                      placeholder="مثلاً گردشگری"
                    />
                  </label>
                  <label>
                    شهر
                    <input
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      placeholder="مثلاً تهران"
                    />
                  </label>
                </div>
                <div className="wizard-actions">
                  <Button className="wizard-btn" loading={busy} onClick={saveProfile}>
                    ذخیره و ادامه
                  </Button>
                </div>
              </Card>
            )}

            {data.step === "plan" && (
              <Card
                title="۲. انتخاب پلن"
                help={{
                  title: "انتخاب پلن",
                  body: "سقف صندلی افزونه و امکانات اشتراک را مشخص می‌کند. بعداً از صفحه صورتحساب قابل ارتقا است."
                }}
              >
                <div className="plan-grid">
                  {plans.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={`plan-tile ${selectedPlan === p.id ? "selected" : ""}`}
                      onClick={() => setSelectedPlan(p.id)}
                    >
                      <strong>{p.label}</strong>
                      <span className="hint">{p.price_label}</span>
                      <ul>
                        {(p.features && p.features.length > 0
                          ? p.features
                          : [
                              `${p.max_seats} صندلی افزونه هم‌زمان`,
                              "همه کانال‌ها (واتساپ، دیوار، …)",
                              `AI auto-send: ${p.ai_auto_send ? "بله" : "خیر"}`
                            ]
                        ).map((f) => (
                          <li key={f}>{f}</li>
                        ))}
                      </ul>
                      {selectedPlan === p.id ? (
                        <Badge tone="accent">انتخاب‌شده</Badge>
                      ) : null}
                    </button>
                  ))}
                </div>
                <div style={{ marginTop: 16 }}>
                  <Button className="wizard-btn" loading={busy} onClick={savePlan}>
                    ادامه به پرداخت
                  </Button>
                </div>
              </Card>
            )}

            {data.step === "payment" && (
              <Card
                title={
                  payProvider === "zibal" && selectedMeta?.price_irr
                    ? "۳. پرداخت با زیبال"
                    : "۳. پرداخت"
                }
                help={{
                  title: "پرداخت",
                  body: "فعال‌سازی اشتراک انتخاب‌شده. بعد از موفقیت، صندلی افزونه ساخته می‌شود و مراحل AI شروع می‌شود."
                }}
              >
                <p className="hint">
                  بعد از پرداخت موفق، صندلی افزونه ساخته می‌شود و وارد تنظیمات AI می‌شوید.
                  {payProvider === "mock" && (selectedMeta?.price_irr || 0) > 0 ? (
                    <>
                      {" "}
                      کارت تست: <code>4242</code> — شکست: <code>0000</code>
                    </>
                  ) : null}
                  {payProvider === "zibal" && (selectedMeta?.price_irr || 0) > 0 ? (
                    <> برای تست می‌توانید merchant <code>zibal</code> را در API تنظیم کنید.</>
                  ) : null}
                  {(selectedMeta?.price_irr || 0) <= 0 ? (
                    <> این پلن رایگان است و نیاز به درگاه ندارد.</>
                  ) : null}
                </p>
                <div className="form-grid">
                  <label>
                    پلن
                    <select
                      value={selectedPlan}
                      onChange={(e) => setSelectedPlan(e.target.value)}
                    >
                      {plans.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label} — {p.price_label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {payProvider === "mock" && (selectedMeta?.price_irr || 0) > 0 ? (
                    <label>
                      شماره کارت (mock)
                      <input
                        value={mockCard}
                        onChange={(e) => setMockCard(e.target.value)}
                        placeholder="4242"
                      />
                    </label>
                  ) : null}
                </div>
                <div className="wizard-actions">
                  <Button className="wizard-btn" loading={busy} onClick={pay}>
                    {payProvider === "zibal" && (selectedMeta?.price_irr || 0) > 0
                      ? "پرداخت با زیبال"
                      : "پرداخت و ساخت صندلی"}
                  </Button>
                </div>
              </Card>
            )}

            {data.step === "ai_settings" && (
              <Card
                title="۴. تنظیمات دستیار AI"
                help={{
                  title: "تنظیمات AI",
                  body: "نقش و قوانین پاسخ دستیار را مشخص کنید تا لحن و دقت فروش با برند شما یکی باشد.",
                  tips: ["از نمونه‌های آماده استفاده کنید و بعد سفارشی کنید."]
                }}
              >
                <div className="wizard-ai-intro">
                  <p>
                    نقش و دستورالعمل دستیار مشخص می‌کند <strong>چطور</strong> با مشتری حرف بزند.
                    بعداً می‌توانید از منوی «تنظیمات AI» هم ویرایش کنید.
                  </p>
                </div>

                <div className="form-grid">
                  <label className="full">
                    نقش دستیار
                    <input
                      value={agentRole}
                      onChange={(e) => setAgentRole(e.target.value)}
                      placeholder="مثلاً مشاور فروش تورهای گردشگری"
                    />
                  </label>
                  <div className="full wizard-example-block">
                    <div className="hint">نمونه‌های آماده — کلیک کنید تا پر شود:</div>
                    <div className="wizard-example-chips">
                      {AI_ROLE_EXAMPLES.map((ex) => (
                        <button
                          key={ex}
                          type="button"
                          className="wizard-example-chip"
                          onClick={() => setAgentRole(ex)}
                        >
                          {ex}
                        </button>
                      ))}
                    </div>
                  </div>

                  <label className="full">
                    سیستم‌پرامپت (قوانین پاسخ)
                    <textarea
                      rows={7}
                      value={systemPrompt}
                      onChange={(e) => setSystemPrompt(e.target.value)}
                      placeholder="لحن، ممنوعیت‌ها، و نحوه هدایت مشتری…"
                    />
                  </label>
                  <div className="full wizard-example-block">
                    <div className="wizard-example-head">
                      <span className="hint">نمونه سیستم‌پرامپت فروش</span>
                      <button
                        type="button"
                        className="btn secondary"
                        style={{ width: "auto", padding: "6px 12px" }}
                        onClick={() => setSystemPrompt(AI_PROMPT_EXAMPLE)}
                      >
                        اعمال نمونه
                      </button>
                    </div>
                    <pre className="wizard-example-pre">{AI_PROMPT_EXAMPLE}</pre>
                  </div>

                  <div className="full ai-switch-row" style={{ marginTop: 4 }}>
                    <div>
                      <strong>فعال‌سازی پاسخ خودکار</strong>
                      <div className="hint">
                        اگر روشن باشد، به پیام‌های جدید (مرحله «جدید») خودکار جواب می‌دهد.
                      </div>
                    </div>
                    <button
                      type="button"
                      className={`ui-switch${autoSend ? " on" : ""}`}
                      role="switch"
                      aria-checked={autoSend}
                      onClick={() => setAutoSend((v) => !v)}
                    >
                      <span className="ui-switch-knob" />
                    </button>
                  </div>
                </div>

                <div className="wizard-actions">
                  <Button className="wizard-btn" loading={busy} onClick={saveAiSettings}>
                    ذخیره و ادامه به دانش AI
                  </Button>
                </div>
              </Card>
            )}

            {data.step === "knowledge" && (
              <Card
                title="۵. پایگاه دانش AI"
                help={{
                  title: "دانش AI",
                  body: "FAQ و قیمت‌ها را بارگذاری کنید تا دستیار فقط بر اساس اطلاعات واقعی کسب‌وکار جواب بدهد."
                }}
              >
                <div className="wizard-ai-intro">
                  <p>
                    دانش AI منبع حقیقت دستیار است: <strong>قیمت‌ها، FAQ، شرایط کنسلی</strong> و هر
                    چیزی که باید دقیق بگوید. بدون دانش، پاسخ‌ها عمومی و کم‌دقت می‌شوند.
                  </p>
                  <ul className="wizard-ai-bullets">
                    <li>هر سند به تکه‌های کوچک تبدیل و برای جستجو ایندکس می‌شود.</li>
                    <li>می‌توانید بعداً از منوی «دانش AI» اسناد بیشتری اضافه کنید.</li>
                    <li>حداقل یک سند در این مرحله لازم است.</li>
                  </ul>
                </div>

                <div className="form-grid">
                  <label className="full">
                    عنوان سند
                    <input
                      value={kbTitle}
                      onChange={(e) => setKbTitle(e.target.value)}
                      placeholder={KB_TITLE_EXAMPLE}
                    />
                  </label>
                  <label className="full">
                    متن دانش (FAQ / قیمت / قوانین)
                    <textarea
                      rows={9}
                      value={kbContent}
                      onChange={(e) => setKbContent(e.target.value)}
                      placeholder="سوال و جواب‌ها را اینجا بنویسید…"
                    />
                  </label>
                  <div className="full wizard-example-block">
                    <div className="wizard-example-head">
                      <span className="hint">نمونه دانش آژانس مسافرتی</span>
                      <button
                        type="button"
                        className="btn secondary"
                        style={{ width: "auto", padding: "6px 12px" }}
                        onClick={() => {
                          setKbTitle(KB_TITLE_EXAMPLE);
                          setKbContent(KB_CONTENT_EXAMPLE);
                        }}
                      >
                        اعمال نمونه
                      </button>
                    </div>
                    <pre className="wizard-example-pre">{KB_CONTENT_EXAMPLE}</pre>
                  </div>
                </div>

                <div className="wizard-actions">
                  <Button className="wizard-btn" loading={busy} onClick={saveKnowledge}>
                    ذخیره دانش و ادامه
                  </Button>
                </div>
              </Card>
            )}

            {data.step === "guides" && (
              <Card
                title="۶. راهنما و افزونه"
                help={{
                  title: "نصب افزونه",
                  body: "توکن صندلی را در Chrome وارد کنید و تب واتساپ/دیوار را باز بگذارید تا همگام‌سازی شروع شود."
                }}
              >
                {receipt ? (
                  <p className="hint">
                    رسید: <strong>{receipt.ref}</strong> · {receipt.label}
                  </p>
                ) : null}

                {seatToken ? (
                  <div className="wizard-token-box">
                    <div className="hint">توکن صندلی شما:</div>
                    <code>{seatToken}</code>
                    <Button
                      size="sm"
                      className="wizard-btn"
                      onClick={async () => {
                        await navigator.clipboard.writeText(seatToken);
                        toast.push("توکن کپی شد", "ok");
                      }}
                    >
                      کپی توکن
                    </Button>
                  </div>
                ) : (
                  <p className="hint">
                    توکن را از منوی «صندلی افزونه» ببینید یا یک صندلی جدید بسازید.
                  </p>
                )}

                <ol className="guide-list">
                  <li>
                    افزونه را دانلود و Extract کنید، سپس در{" "}
                    <code>chrome://extensions</code> با Load unpacked نصب کنید.
                  </li>
                  <li>توکن بالا را در پاپ‌آپ افزونه وارد کنید (روی این نصب قفل می‌شود).</li>
                  <li>
                    تب‌های <strong>web.whatsapp.com</strong> و/یا{" "}
                    <strong>divar.ir/chat</strong> را باز بگذارید.
                  </li>
                  <li>
                    برای دستگاه بعدی از داشبورد → صندلی افزونه توکن جدید بسازید. شماره پنل:{" "}
                    <strong>{data.user.phone}</strong>
                  </li>
                </ol>
                <div className="wizard-actions">
                  <a
                    className="btn wizard-btn"
                    href={EXTENSION_DOWNLOAD_URL}
                    download={EXTENSION_DOWNLOAD_NAME}
                  >
                    دانلود افزونه v{extVersion}
                  </a>
                  <Button className="wizard-btn" loading={busy} onClick={finish}>
                    ورود به داشبورد
                  </Button>
                </div>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
