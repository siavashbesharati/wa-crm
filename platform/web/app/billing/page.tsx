"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import Shell from "@/components/Shell";
import { Button } from "@/components/ui/Button";
import { Badge, Card } from "@/components/ui/Card";
import { PageLoading } from "@/components/ui/Spinner";
import { api, getSession } from "@/lib/api";
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

type Org = {
  id: string;
  name: string;
  plan: string;
  limits: Record<string, unknown>;
  days_remaining?: number | null;
};

type PayHistory = {
  id: string;
  purpose: string;
  plan: string;
  amount_irr: number;
  provider: string;
  status: string;
  ref_number: string;
  created_at: string | null;
};

export default function BillingPage() {
  return (
    <Suspense
      fallback={
        <Shell title="اشتراک و پرداخت" sub="ارتقا و تمدید پلن">
          <PageLoading />
        </Shell>
      }
    >
      <BillingPageInner />
    </Suspense>
  );
}

function BillingPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const paidHandled = useRef(false);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [org, setOrg] = useState<Org | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selected, setSelected] = useState("growth");
  const [provider, setProvider] = useState<"mock" | "zibal">("mock");
  const [role, setRole] = useState("agent");
  const [lastReceipt, setLastReceipt] = useState<{
    ref: string;
    label: string;
    amount_irr: number;
  } | null>(null);
  const [history, setHistory] = useState<PayHistory[]>([]);

  const load = useCallback(async () => {
    if (!getSession()) {
      router.replace("/login");
      return;
    }
    setLoading(true);
    try {
      const [o, p, me, cfg, hist] = await Promise.all([
        api<Org>("/orgs/current"),
        api<{ plans: Plan[] }>("/orgs/plans"),
        api<{ role: string }>("/auth/me"),
        api<{ provider?: string }>("/payments/config", { auth: false }).catch(() => ({
          provider: "mock"
        })),
        api<{ payments: PayHistory[] }>("/payments/history").catch(() => ({ payments: [] }))
      ]);
      setOrg(o);
      setPlans(p.plans || []);
      setHistory(hist.payments || []);
      setRole(me.role || "agent");
      setSelected(o.plan === "starter" ? "growth" : o.plan);
      const pr = (cfg.provider || "mock").toLowerCase();
      setProvider(pr === "zibal" ? "zibal" : "mock");
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setLoading(false);
    }
  }, [router, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (paidHandled.current || loading) return;
    const paid = searchParams.get("paid");
    if (paid !== "1" && paid !== "0") return;
    paidHandled.current = true;
    const error = searchParams.get("error");
    const ref = searchParams.get("ref");
    if (paid === "1") {
      toast.push(ref ? `پرداخت موفق — رسید ${ref}` : "پرداخت موفق", "ok");
      if (ref) setLastReceipt({ ref, label: "", amount_irr: 0 });
      void load();
    } else {
      toast.push(error ? `پرداخت ناموفق: ${error}` : "پرداخت ناموفق", "err");
    }
    router.replace("/billing");
  }, [loading, load, router, searchParams, toast]);

  const current = plans.find((p) => p.id === org?.plan);
  const chosen = plans.find((p) => p.id === selected);
  const isOwner = role === "owner";
  const purpose =
    org && selected === org.plan ? ("renew" as const) : ("upgrade" as const);

  async function pay() {
    if (!isOwner) {
      toast.push("فقط مالک می‌تواند پرداخت کند", "err");
      return;
    }
    if (!chosen) return;
    setBusy(true);
    try {
      const res = await api<{
        paid?: boolean;
        payment_url?: string;
        plan?: string;
        receipt?: { ref: string; label: string; amount_irr: number };
      }>("/payments/start", {
        method: "POST",
        body: JSON.stringify({ purpose, plan: selected })
      });
      if (res.payment_url) {
        window.location.href = res.payment_url;
        return;
      }
      if (res.receipt) setLastReceipt(res.receipt);
      toast.push(
        purpose === "renew" ? "تمدید با موفقیت انجام شد" : "پلن با موفقیت به‌روز شد",
        "ok"
      );
      await load();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setBusy(false);
    }
  }

  const payLabel = () => {
    if (!chosen) return "پرداخت";
    if ((chosen.price_irr || 0) <= 0) return "فعال‌سازی پلن رایگان";
    if (purpose === "renew") {
      return provider === "zibal" ? "تمدید با زیبال" : "تمدید اشتراک";
    }
    return provider === "zibal" ? "ارتقا / پرداخت با زیبال" : "ارتقا و پرداخت";
  };

  return (
    <Shell title="اشتراک و پرداخت" sub="تمدید یا ارتقای پلن سازمان">
      {loading || !org ? (
        <PageLoading />
      ) : (
        <>
          <Card
            title="پلن فعلی"
            help={{
              title: "پلن فعلی",
              body: "اشتراک فعال سازمان، محدودیت‌ها و روزهای باقی‌مانده تا تمدید."
            }}
          >
            <div className="hint">
              <strong>{org.name}</strong> · پلن{" "}
              <Badge tone="accent">{current?.label || org.plan}</Badge>
              {" · "}
              {current?.price_label || "—"} · سقف{" "}
              {String(org.limits.max_seats)} اعضای تیم
            </div>
            <p className="hint" style={{ marginTop: 8 }}>
              {typeof org.days_remaining === "number"
                ? org.days_remaining === 0
                  ? "اشتراک منقضی شده است — برای ادامه تمدید کنید."
                  : `${org.days_remaining.toLocaleString("fa-IR")} روز تا پایان اشتراک باقی مانده`
                : current && (current.price_irr || 0) <= 0
                  ? "پلن آزمایشی (بدون تاریخ انقضا)"
                  : "پس از پرداخت، ۳۰ روز به اشتراک اضافه می‌شود."}
            </p>
            {lastReceipt ? (
              <p className="hint" style={{ marginTop: 10 }}>
                آخرین رسید: <strong>{lastReceipt.ref}</strong>
                {lastReceipt.label ? ` · ${lastReceipt.label}` : ""}
              </p>
            ) : null}
            {!isOwner ? (
              <p className="hint" style={{ marginTop: 10 }}>
                برای تغییر اشتراک با مالک سازمان هماهنگ کنید.
              </p>
            ) : null}
          </Card>

          <Card
            title="انتخاب پلن"
            help={{
              title: "انتخاب پلن",
              body: "پلن را عوض کنید یا تمدید کنید. پرداخت از طریق درگاه انجام می‌شود و سقف اعضا/امکانات به‌روز می‌گردد."
            }}
          >
            <div className="plan-grid">
              {plans.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`plan-tile ${selected === p.id ? "selected" : ""}`}
                  onClick={() => setSelected(p.id)}
                  disabled={!isOwner}
                >
                  <strong>{p.label}</strong>
                  <span className="hint">{p.price_label}</span>
                  <ul>
                    {(p.features && p.features.length > 0
                      ? p.features
                      : [
                          `${p.max_seats} اعضای تیم`,
                          "همه کانال‌ها (واتساپ، دیوار، …)",
                          `AI auto-send: ${p.ai_auto_send ? "بله" : "خیر"}`
                        ]
                    ).map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                  {org.plan === p.id ? <Badge tone="accent">فعلی</Badge> : null}
                  {selected === p.id && org.plan !== p.id ? (
                    <Badge>انتخاب‌شده</Badge>
                  ) : null}
                </button>
              ))}
            </div>

            {isOwner ? (
              <div className="wizard-actions" style={{ marginTop: 16 }}>
                <Button className="wizard-btn" loading={busy} onClick={pay}>
                  {payLabel()}
                </Button>
                <span className="hint">
                  {purpose === "renew"
                    ? "تمدید همان پلن فعلی"
                    : selected === "starter"
                      ? "سوییچ به پلن آزمایشی"
                      : "تغییر / ارتقای پلن"}
                  {provider === "zibal" && (chosen?.price_irr || 0) > 0
                    ? " — پس از پرداخت به همین صفحه برمی‌گردید"
                    : ""}
                </span>
              </div>
            ) : null}
          </Card>

          {history.length > 0 ? (
            <Card
              title="تاریخچه پرداخت"
              help={{
                title: "تاریخچه",
                body: "تراکنش‌های موفق، ناموفق و در انتظار سازمان."
              }}
            >
              <table>
                <thead>
                  <tr>
                    <th>هدف</th>
                    <th>پلن</th>
                    <th>مبلغ</th>
                    <th>وضعیت</th>
                    <th>زمان</th>
                  </tr>
                </thead>
                <tbody>
                  {history.slice(0, 20).map((h) => (
                    <tr key={h.id}>
                      <td>{h.purpose}</td>
                      <td>{h.plan}</td>
                      <td>{Math.round(h.amount_irr || 0).toLocaleString("fa-IR")} ریال</td>
                      <td>
                        <Badge
                          tone={
                            h.status === "paid"
                              ? "success"
                              : h.status === "failed"
                                ? "danger"
                                : "accent"
                          }
                        >
                          {h.status === "paid"
                            ? "موفق"
                            : h.status === "failed"
                              ? "ناموفق"
                              : h.status === "pending"
                                ? "در انتظار"
                                : h.status}
                        </Badge>
                      </td>
                      <td className="hint">
                        {h.created_at
                          ? new Date(h.created_at).toLocaleString("fa-IR")
                          : "—"}
                        {h.ref_number ? ` · ${h.ref_number}` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ) : null}

          <div className="row-actions">
            <Link className="btn secondary" href="/support">
              پشتیبانی
            </Link>
            <Link className="btn secondary" href="/team">
              تیم
            </Link>
            <Link className="btn secondary" href="/home">
              میز کار
            </Link>
          </div>
        </>
      )}
    </Shell>
  );
}
