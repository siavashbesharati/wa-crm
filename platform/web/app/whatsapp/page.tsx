"use client";

import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { api } from "@/lib/api";

type Account = { id: string; label: string; phone: string; status: string };
type Session = {
  id: string;
  account_id: string;
  device_id: string;
  role: string;
  last_seen_at: string;
};

export default function WhatsAppPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [label, setLabel] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setAccounts(await api<Account[]>("/whatsapp/accounts"));
    setSessions(await api<Session[]>("/whatsapp/sessions"));
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  async function create() {
    try {
      await api("/whatsapp/accounts", {
        method: "POST",
        body: JSON.stringify({ label, phone })
      });
      setLabel("");
      setPhone("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطا");
    }
  }

  return (
    <Shell title="شماره‌های واتساپ" sub="چند شماره در هر سازمان — محدود به پلن">
      <div className="card form-grid">
        <label>
          برچسب
          <input value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label>
          شماره
          <input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <button className="btn" onClick={create}>
          افزودن شماره
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="card">
        <h3>اکانت‌ها</h3>
        <table>
          <thead>
            <tr>
              <th>برچسب</th>
              <th>شماره</th>
              <th>وضعیت</th>
              <th>شناسه</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id}>
                <td>{a.label}</td>
                <td>{a.phone}</td>
                <td>{a.status}</td>
                <td className="hint">{a.id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card">
        <h3>نشست‌های آنلاین (hybrid connector)</h3>
        <table>
          <thead>
            <tr>
              <th>نقش</th>
              <th>device</th>
              <th>اکانت</th>
              <th>آخرین دیده شدن</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id}>
                <td>{s.role}</td>
                <td>{s.device_id}</td>
                <td className="hint">{s.account_id}</td>
                <td>{new Date(s.last_seen_at).toLocaleString("fa-IR")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
