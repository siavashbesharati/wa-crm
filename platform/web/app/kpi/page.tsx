"use client";

import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { api } from "@/lib/api";

type Dash = {
  metrics: Record<string, number>;
  funnel: { stage: string; count: number }[];
  agents: { user_id: string; name: string; assigned_leads: number; tasks_done: number; tasks_open: number }[];
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

  async function load() {
    await api("/kpi/rollup", { method: "POST" }).catch(() => null);
    setDash(await api<Dash>("/kpi/dashboard"));
    setOkrs(await api<Okr[]>("/kpi/okrs"));
  }

  useEffect(() => {
    load().catch(console.error);
  }, []);

  async function createOkr() {
    await api("/kpi/okrs", {
      method: "POST",
      body: JSON.stringify({ title, target_value: target, current_value: 0 })
    });
    setTitle("");
    await load();
  }

  const m = dash?.metrics || {};

  return (
    <Shell title="KPI / OKR" sub="نرخ تبدیل، رفتار وظایف و اهداف سازمانی">
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
      </div>

      <div className="card">
        <h3>فانل مراحل</h3>
        <div className="stats">
          {(dash?.funnel || []).map((f) => (
            <div className="stat" key={f.stage}>
              <span>{f.count}</span>
              <small>{f.stage}</small>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>عملکرد اپراتورها</h3>
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
      </div>

      <div className="card form-grid">
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
        <button className="btn" onClick={createOkr}>
          افزودن OKR
        </button>
      </div>
      <div className="card">
        {okrs.map((o) => (
          <div key={o.id} style={{ marginBottom: 12 }}>
            <strong>{o.title}</strong>
            <div className="hint">
              {o.current_value} / {o.target_value} ({o.progress}%)
            </div>
            <div
              style={{
                height: 10,
                background: "#dbeafe",
                borderRadius: 999,
                overflow: "hidden"
              }}
            >
              <div
                style={{
                  width: `${Math.min(o.progress, 100)}%`,
                  height: "100%",
                  background: "#2563eb"
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </Shell>
  );
}
