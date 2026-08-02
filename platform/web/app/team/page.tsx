"use client";

import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { api } from "@/lib/api";

type Member = { id: string; user_id: string; phone: string; display_name: string; role: string };
type Org = { id: string; name: string; plan: string; limits: Record<string, unknown> };

export default function TeamPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [org, setOrg] = useState<Org | null>(null);
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("agent");
  const [plan, setPlan] = useState("starter");
  const [error, setError] = useState("");

  async function load() {
    setMembers(await api<Member[]>("/orgs/members"));
    const o = await api<Org>("/orgs/current");
    setOrg(o);
    setPlan(o.plan);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  async function invite() {
    try {
      await api("/orgs/members", {
        method: "POST",
        body: JSON.stringify({ phone, role })
      });
      setPhone("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطا");
    }
  }

  async function updatePlan() {
    try {
      await api("/orgs/plan", { method: "PATCH", body: JSON.stringify({ plan }) });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطا");
    }
  }

  return (
    <Shell title="اعضای تیم" sub="نقش‌ها و سقف پلن">
      {org && (
        <div className="card">
          <strong>{org.name}</strong>
          <div className="hint">
            پلن {org.plan} — حداکثر {String(org.limits.max_seats)} کاربر /{" "}
            {String(org.limits.max_wa_numbers)} شماره واتساپ
          </div>
          <div className="row-actions" style={{ marginTop: 10 }}>
            <select value={plan} onChange={(e) => setPlan(e.target.value)}>
              <option value="starter">Starter</option>
              <option value="growth">Growth</option>
              <option value="scale">Scale</option>
            </select>
            <button className="btn secondary" onClick={updatePlan}>
              تغییر پلن
            </button>
          </div>
        </div>
      )}
      <div className="card form-grid">
        <label>
          موبایل عضو جدید
          <input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label>
          نقش
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="agent">اپراتور</option>
            <option value="admin">ادمین</option>
            <option value="viewer">بازدیدکننده</option>
          </select>
        </label>
        <button className="btn" onClick={invite}>
          دعوت
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>نام</th>
              <th>موبایل</th>
              <th>نقش</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}>
                <td>{m.display_name || "-"}</td>
                <td>{m.phone}</td>
                <td>{m.role}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
