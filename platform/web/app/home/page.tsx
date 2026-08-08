"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Shell from "@/components/Shell";
import { Card, EmptyState } from "@/components/ui/Card";
import { PageLoading } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";

type Me = {
  org: {
    name: string;
    plan: string;
    plan_label?: string;
    limits: Record<string, unknown>;
    days_remaining?: number | null;
  };
  role: string;
  user: { phone: string; display_name: string };
};

type Dash = {
  metrics: Record<string, number>;
  funnel: { stage: string; count: number }[];
  channels: { channel: string; count: number }[];
  series: {
    date: string;
    label: string;
    inbound: number;
    outbound: number;
    leads: number;
  }[];
  agents: {
    user_id: string;
    name: string;
    assigned_leads: number;
    tasks_done: number;
    tasks_open: number;
  }[];
};

const STAGE_COLORS: Record<string, string> = {
  جدید: "#f59e0b",
  پیگیری: "#f43f5e",
  پیشنهاد: "#0ea5e9",
  خرید: "#6366f1",
  بسته: "#22c55e"
};

const CHANNEL_COLORS = ["#2563eb", "#0ea5e9", "#8b5cf6", "#14b8a6", "#f59e0b"];

function fmt(n: number) {
  return Math.round(n).toLocaleString("fa-IR");
}

function BarChart({
  items,
  colorKey
}: {
  items: { label: string; value: number; color?: string }[];
  colorKey?: (label: string) => string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="dash-bars">
      {items.map((item) => (
        <div className="dash-bar-row" key={item.label}>
          <div className="dash-bar-meta">
            <span>{item.label}</span>
            <strong>{fmt(item.value)}</strong>
          </div>
          <div className="dash-bar-track">
            <i
              style={{
                width: `${(item.value / max) * 100}%`,
                background:
                  item.color ||
                  (colorKey ? colorKey(item.label) : undefined) ||
                  "linear-gradient(90deg, #38bdf8, #2563eb)"
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function GroupedBars({
  series
}: {
  series: { label: string; inbound: number; outbound: number; leads: number }[];
}) {
  const max = Math.max(
    1,
    ...series.flatMap((s) => [s.inbound, s.outbound, s.leads])
  );
  return (
    <div className="dash-grouped">
      <div className="dash-grouped-legend">
        <span>
          <i className="lg-in" /> ورودی
        </span>
        <span>
          <i className="lg-out" /> خروجی
        </span>
        <span>
          <i className="lg-lead" /> لید جدید
        </span>
      </div>
      <div className="dash-grouped-chart">
        {series.map((s) => (
          <div className="dash-grouped-col" key={s.label}>
            <div className="dash-grouped-bars">
              <span
                className="g-bar in"
                style={{ height: `${(s.inbound / max) * 100}%` }}
                title={`ورودی: ${s.inbound}`}
              />
              <span
                className="g-bar out"
                style={{ height: `${(s.outbound / max) * 100}%` }}
                title={`خروجی: ${s.outbound}`}
              />
              <span
                className="g-bar lead"
                style={{ height: `${(s.leads / max) * 100}%` }}
                title={`لید: ${s.leads}`}
              />
            </div>
            <em>{s.label}</em>
          </div>
        ))}
      </div>
    </div>
  );
}

function Donut({
  segments
}: {
  segments: { label: string; value: number; color: string }[];
}) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  const r = 42;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="dash-donut">
      <svg viewBox="0 0 120 120" className="dash-donut-svg" aria-hidden>
        <circle cx="60" cy="60" r={r} fill="none" stroke="#e2e8f0" strokeWidth="14" />
        {segments.map((s) => {
          const len = (s.value / total) * c;
          const el = (
            <circle
              key={s.label}
              cx="60"
              cy="60"
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth="14"
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
              transform="rotate(-90 60 60)"
            />
          );
          offset += len;
          return el;
        })}
        <text x="60" y="56" textAnchor="middle" className="dash-donut-num">
          {fmt(total === 1 && segments.every((s) => s.value === 0) ? 0 : total)}
        </text>
        <text x="60" y="72" textAnchor="middle" className="dash-donut-label">
          لید
        </text>
      </svg>
      <ul className="dash-donut-legend">
        {segments.map((s) => (
          <li key={s.label}>
            <i style={{ background: s.color }} />
            <span>{s.label}</span>
            <strong>{fmt(s.value)}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function HomePage() {
  const [me, setMe] = useState<Me | null>(null);
  const [dash, setDash] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const m = await api<Me>("/auth/me");
        setMe(m);
        await api("/kpi/rollup", { method: "POST" }).catch(() => null);
        setDash(await api<Dash>("/kpi/dashboard"));
      } catch (e) {
        toast.push(e instanceof Error ? e.message : "خطا", "err");
      } finally {
        setLoading(false);
      }
    })();
  }, [toast]);

  const m = dash?.metrics || {};
  const funnel = dash?.funnel || [];
  const channels = dash?.channels || [];
  const series = dash?.series || [];
  const agents = dash?.agents || [];

  const funnelTotal = funnel.reduce((a, f) => a + f.count, 0);
  const setupDone = useMemo(() => {
    const leads = m.leads_total || 0;
    const channelsN = m.channels_online || 0;
    const knowledge = m.knowledge_docs || 0;
    return leads > 0 && channelsN > 0 && knowledge > 0;
  }, [m]);

  const conversion = Number(m.conversion_rate || 0);
  const seatsUsed = Number(m.seats_used || 0);
  const seatsMax = Math.max(1, Number(m.seats_max || 1));
  const seatPct = Math.min(100, Math.round((seatsUsed / seatsMax) * 100));

  const weekInbound = series.reduce((a, s) => a + s.inbound, 0);
  const weekOutbound = series.reduce((a, s) => a + s.outbound, 0);
  const weekLeads = series.reduce((a, s) => a + s.leads, 0);

  return (
    <Shell title="میز کار" sub="گزارش‌ها، تحلیل فروش و وضعیت لحظه‌ای سازمان">
      {loading ? (
        <PageLoading />
      ) : (
        <div className="dash-home">
          <div className="dash-hero">
            <div>
              <h2>{me?.org.name || "سازمان"}</h2>
              <p className="hint">
                {(me?.org.plan_label || me?.org.plan || "—") +
                  " · نقش " +
                  (me?.role || "—") +
                  (typeof me?.org.days_remaining === "number"
                    ? ` · ${me.org.days_remaining.toLocaleString("fa-IR")} روز باقی‌مانده`
                    : "")}
              </p>
            </div>
            <div className="dash-hero-actions">
              <Link className="btn secondary" href="/kpi">
                جزئیات KPI
              </Link>
              <Link className="btn" href="/inbox">
                اینباکس
              </Link>
            </div>
          </div>

          <div className="dash-kpi-grid">
            <div className="dash-kpi accent">
              <small>کل لید</small>
              <strong>{fmt(Number(m.leads_total || 0))}</strong>
              <em>+{fmt(weekLeads)} این هفته</em>
            </div>
            <div className="dash-kpi">
              <small>نرخ تبدیل</small>
              <strong>{conversion.toLocaleString("fa-IR")}٪</strong>
              <div className="dash-mini-meter">
                <i style={{ width: `${Math.min(100, conversion)}%` }} />
              </div>
            </div>
            <div className="dash-kpi">
              <small>پیام ورودی ۷روز</small>
              <strong>{fmt(Number(m.messages_inbound_7d || weekInbound))}</strong>
              <em>خروجی: {fmt(Number(m.messages_outbound_7d || weekOutbound))}</em>
            </div>
            <div className="dash-kpi">
              <small>وظایف باز</small>
              <strong>{fmt(Number(m.tasks_open || 0))}</strong>
              <em>
                انجام‌شده ۷روز: {fmt(Number(m.tasks_done_7d || 0))}
                {Number(m.tasks_overdue || 0) > 0
                  ? ` · عقب‌افتاده ${fmt(Number(m.tasks_overdue))}`
                  : ""}
              </em>
            </div>
            <div className="dash-kpi">
              <small>کانال‌ها</small>
              <strong>{fmt(Number(m.channels_online || 0))}</strong>
              <em>دانش AI: {fmt(Number(m.knowledge_docs || 0))} سند</em>
            </div>
            <div className="dash-kpi">
              <small>صندلی افزونه</small>
              <strong>
                {fmt(seatsUsed)}/{fmt(seatsMax)}
              </strong>
              <div className="dash-mini-meter">
                <i style={{ width: `${seatPct}%` }} />
              </div>
            </div>
          </div>

          <div className="dash-grid-2">
            <Card
              title="فعالیت ۷ روز اخیر"
              help={{
                title: "نمودار فعالیت",
                body: "مقایسه روزانه پیام‌های ورودی/خروجی و لیدهای جدید در هفته گذشته."
              }}
            >
              {series.length === 0 ? (
                <EmptyState title="هنوز داده‌ای نیست" text="بعد از همگام‌سازی پیام‌ها اینجا پر می‌شود." />
              ) : (
                <GroupedBars series={series} />
              )}
            </Card>

            <Card
              title="ترکیب کانال‌ها"
              help={{
                title: "کانال‌ها",
                body: "سهم لیدها بر اساس منبع (واتساپ، دیوار و …)."
              }}
            >
              {channels.length === 0 ? (
                <EmptyState title="کانالی ثبت نشده" text="از منوی کانال‌ها یا افزونه شروع کنید." />
              ) : (
                <Donut
                  segments={channels.map((c, i) => ({
                    label: c.channel,
                    value: c.count,
                    color: CHANNEL_COLORS[i % CHANNEL_COLORS.length]
                  }))}
                />
              )}
            </Card>
          </div>

          <div className="dash-grid-2">
            <Card
              title="فانل فروش"
              help={{
                title: "فانل",
                body: "توزیع لیدها در مراحل پایپلاین. میله‌های بلندتر یعنی انباشت در آن مرحله."
              }}
            >
              {funnelTotal === 0 ? (
                <EmptyState title="لیدی در پایپلاین نیست" />
              ) : (
                <BarChart
                  items={funnel.map((f) => ({
                    label: f.stage,
                    value: f.count,
                    color: STAGE_COLORS[f.stage]
                  }))}
                  colorKey={(label) => STAGE_COLORS[label]}
                />
              )}
            </Card>

            <Card
              title="عملکرد تیم"
              help={{
                title: "اپراتورها",
                body: "لید ارجاعی و وضعیت وظایف هر عضو تیم."
              }}
            >
              {agents.length === 0 ? (
                <EmptyState title="عضوی نیست" />
              ) : (
                <div className="dash-agents">
                  {agents.map((a) => {
                    const load = a.assigned_leads + a.tasks_open;
                    const maxLoad = Math.max(
                      1,
                      ...agents.map((x) => x.assigned_leads + x.tasks_open)
                    );
                    return (
                      <div className="dash-agent" key={a.user_id}>
                        <div className="dash-agent-top">
                          <strong>{a.name}</strong>
                          <span>
                            {fmt(a.assigned_leads)} لید · {fmt(a.tasks_open)} باز ·{" "}
                            {fmt(a.tasks_done)} انجام
                          </span>
                        </div>
                        <div className="dash-bar-track thin">
                          <i
                            style={{
                              width: `${(load / maxLoad) * 100}%`,
                              background: "linear-gradient(90deg, #a5b4fc, #4f46e5)"
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>

          <Card
            title="نسبت پیام‌ها"
            help={{
              title: "ورودی در برابر خروجی",
              body: "تعادل پاسخ‌گویی در ۷ روز اخیر بر اساس اسنپ‌شات KPI."
            }}
          >
            <div className="dash-msg-ratio">
              {(() => {
                const inn = Number(m.messages_inbound_7d || weekInbound);
                const out = Number(m.messages_outbound_7d || weekOutbound);
                const sum = Math.max(1, inn + out);
                return (
                  <>
                    <div className="dash-msg-stack">
                      <i className="in" style={{ width: `${(inn / sum) * 100}%` }} />
                      <i className="out" style={{ width: `${(out / sum) * 100}%` }} />
                    </div>
                    <div className="dash-msg-labels">
                      <span>ورودی {fmt(inn)}</span>
                      <span>خروجی {fmt(out)}</span>
                    </div>
                  </>
                );
              })()}
            </div>
          </Card>

          {!setupDone && (
            <Card
              title="راه‌اندازی باقی‌مانده"
              help="موارد ضروری برای فعال شدن کامل فروش و AI."
            >
              <div className="dash-setup-row">
                <Link
                  href="/channels"
                  className={`checklist-item ${Number(m.channels_online) > 0 ? "done" : ""}`}
                >
                  <strong>
                    {Number(m.channels_online) > 0 ? "✓" : "○"} اتصال کانال
                  </strong>
                </Link>
                <Link
                  href="/leads"
                  className={`checklist-item ${Number(m.leads_total) > 0 ? "done" : ""}`}
                >
                  <strong>{Number(m.leads_total) > 0 ? "✓" : "○"} اولین لید</strong>
                </Link>
                <Link
                  href="/knowledge"
                  className={`checklist-item ${Number(m.knowledge_docs) > 0 ? "done" : ""}`}
                >
                  <strong>
                    {Number(m.knowledge_docs) > 0 ? "✓" : "○"} دانش AI
                  </strong>
                </Link>
                <Link href="/pipeline" className="checklist-item">
                  <strong>○ پایپلاین</strong>
                </Link>
              </div>
            </Card>
          )}

          <div className="dash-quick-links">
            <Link href="/pipeline">پایپلاین</Link>
            <Link href="/leads">لیدها</Link>
            <Link href="/tasks">وظایف</Link>
            <Link href="/ai-settings">تنظیمات AI</Link>
            <Link href="/billing">اشتراک</Link>
          </div>
        </div>
      )}
    </Shell>
  );
}
