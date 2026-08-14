"use client";

import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Button } from "@/components/ui/Button";
import { Card, EmptyState } from "@/components/ui/Card";
import { PageLoading } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { useMutation } from "@/lib/useApi";
import { useToast } from "@/components/ui/Toast";

type Dash = {
  metrics: Record<string, number>;
  funnel: { stage: string; count: number }[];
  agents: {
    user_id: string;
    name: string;
    assigned_leads: number;
    tasks_done: number;
    tasks_open: number;
  }[];
};

type Okr = {
  id: string;
  title: string;
  target_value: number;
  current_value: number;
  progress: number;
};

export default function KpiPage() {
  const [dash, setDash] = useState<Dash | null>(null);
  const [okrs, setOkrs] = useState<Okr[]>([]);
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState(20);
  const [loading, setLoading] = useState(true);
  const { busy, run } = useMutation();
  const toast = useToast();

  async function load() {
    setLoading(true);
    try {
      await api("/kpi/rollup", { method: "POST" }).catch(() => null);
      setDash(await api<Dash>("/kpi/dashboard"));
      setOkrs(await api<Okr[]>("/kpi/okrs"));
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

  async function createOkr() {
    if (!title.trim()) return;
    const ok = await run(
      () =>
        api("/kpi/okrs", {
          method: "POST",
          body: JSON.stringify({ title, target_value: target, current_value: 0 })
        }),
      { success: "OKR افزوده شد" }
    );
    if (ok) {
      setTitle("");
      await load();
    }
  }

  const m = dash?.metrics || {};

  return (
    <Shell title="KPI / OKR" sub="نرخ تبدیل، رفتار وظایف و اهداف سازمانی">
      {loading ? (
        <PageLoading />
      ) : (
        <>
          <div className="stats">
            <div className="stat">
              <span>{m.leads_total ?? 0}</span>
              <small>کل لید</small>
            </div>
            <div className="stat">
              <span>{m.conversion_rate ?? 0}%</span>
              <small>نرخ تبدیل</small>
            </div>
            <div className="stat">
              <span>{m.tasks_done_7d ?? 0}</span>
              <small>وظایف انجام‌شده ۷روز</small>
            </div>
            <div className="stat">
              <span>{m.tasks_overdue ?? 0}</span>
              <small>وظایف عقب‌افتاده</small>
            </div>
            <div className="stat">
              <span>{m.messages_inbound_7d ?? 0}</span>
              <small>پیام ورودی ۷روز</small>
            </div>
            <div className="stat">
              <span>{m.ai_outbound_7d ?? 0}</span>
              <small>پاسخ AI ۷روز</small>
            </div>
            <div className="stat">
              <span>{Math.round(Number(m.ai_suggest_accept_rate || 0) * 100)}%</span>
              <small>نرخ پذیرش پیشنهاد</small>
            </div>
            <div className="stat">
              <span>{m.ai_enrichments_7d ?? 0}</span>
              <small>غنی‌سازی لید ۷روز</small>
            </div>
            <div className="stat">
              <span>{m.ai_tasks_open ?? 0}</span>
              <small>وظایف AI باز</small>
            </div>
            <div className="stat">
              <span>{m.ai_escalations_7d ?? 0}</span>
              <small>اسکالیشن ۷روز</small>
            </div>
          </div>

          <Card
            title="قیفمراحل"
            help={{
              title: "قیففروش",
              body: "تعداد لید در هر مرحله برد کانبان — نشان می‌دهد کجا بیشترین ریزش یا انباشت دارید."
            }}
          >
            <div className="stats" style={{ marginBottom: 0 }}>
              {(dash?.funnel || []).map((f) => (
                <div className="stat" key={f.stage}>
                  <span>{f.count}</span>
                  <small>{f.stage}</small>
                </div>
              ))}
            </div>
          </Card>

          <Card
            title="عملکرد اپراتورها"
            help={{
              title: "عملکرد تیم",
              body: "لیدهای ارجاع‌شده و وضعیت وظایف هر عضو — برای سنجش بار کاری و پیگیری."
            }}
          >
            {(dash?.agents || []).length === 0 ? (
              <EmptyState title="داده‌ای نیست" />
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>نام</th>
                    <th>لید ارجاعی</th>
                    <th>وظیفه باز</th>
                    <th>انجام‌شده</th>
                  </tr>
                </thead>
                <tbody>
                  {(dash?.agents || []).map((a) => (
                    <tr key={a.user_id}>
                      <td>{a.name}</td>
                      <td>{a.assigned_leads}</td>
                      <td>{a.tasks_open}</td>
                      <td>{a.tasks_done}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card
            title="افزودن OKR"
            help={{
              title: "OKR",
              body: "هدف قابل اندازه‌گیری برای سازمان تعریف کنید (مثلاً نرخ تبدیل یا تعداد فروش ماهانه)."
            }}
          >
            <div className="form-grid">
              <label>
                هدف OKR
                <input value={title} onChange={(e) => setTitle(e.target.value)} />
              </label>
              <label>
                مقدار هدف
                <input
                  type="number"
                  value={target}
                  onChange={(e) => setTarget(Number(e.target.value))}
                />
              </label>
              <Button loading={busy} onClick={createOkr}>
                افزودن OKR
              </Button>
            </div>
          </Card>

          <Card
            title="اهداف"
            help={{
              title: "لیست اهداف",
              body: "پیشرفت فعلی نسبت به هدف هر OKR. مقدار فعلی از رول‌آپ KPI به‌روز می‌شود."
            }}
          >
            {okrs.length === 0 ? (
              <EmptyState title="OKR تعریف نشده" />
            ) : (
              okrs.map((o) => (
                <div key={o.id} style={{ marginBottom: 14 }}>
                  <strong>{o.title}</strong>
                  <div className="hint">
                    {o.current_value} / {o.target_value} ({o.progress}%)
                  </div>
                  <div className="progress-bar">
                    <i style={{ width: `${Math.min(o.progress, 100)}%` }} />
                  </div>
                </div>
              ))
            )}
          </Card>
        </>
      )}
    </Shell>
  );
}
