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
  { id: "guides", label: "راهنما" }
];

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
          <Card title="در انتظار راه‌اندازی">
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
              <Card title="۱. تکمیل پروفایل">
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
              <Card title="۲. انتخاب پلن">
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
              >
                <p className="hint">
                  بعد از پرداخت موفق، صندلی افزونه ساخته می‌شود و وارد بخش راهنما می‌شوید.
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

            {data.step === "guides" && (
              <Card title="۴. راهنما و افزونه">
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
