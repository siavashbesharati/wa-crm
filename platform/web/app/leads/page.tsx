"use client";

import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { api } from "@/lib/api";

type Lead = {
  id: string;
  name: string;
  phone: string;
  group_id: string;
  stage: string;
  tags: string[];
  notes: string;
  assignee_id: string | null;
};

type Member = { user_id: string; display_name: string; phone: string };

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");

  async function load() {
    const [l, m] = await Promise.all([
      api<Lead[]>("/leads"),
      api<Member[]>("/orgs/members")
    ]);
    setLeads(l);
    setMembers(m);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  async function createLead() {
    if (!name.trim()) return;
    await api("/leads", {
      method: "POST",
      body: JSON.stringify({ name, phone, tags: [] })
    });
    setName("");
    setPhone("");
    await load();
  }

  async function assign(leadId: string, assigneeId: string) {
    await api(`/leads/${leadId}/assign?assignee_id=${encodeURIComponent(assigneeId)}`, {
      method: "POST"
    });
    await load();
  }

  return (
    <Shell title="لیدها" sub="مدیریت مشترک لیدها بین اپراتورها">
      <div className="card form-grid">
        <label>
          نام
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          تلفن
          <input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <button className="btn" onClick={createLead}>
          افزودن لید
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="card" style={{ overflow: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>نام</th>
              <th>تلفن / گروه</th>
              <th>مرحله</th>
              <th>ارجاع</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.id}>
                <td>{l.name}</td>
                <td>{l.phone || l.group_id || "-"}</td>
                <td>{l.stage}</td>
                <td>
                  <select
                    value={l.assignee_id || ""}
                    onChange={(e) => assign(l.id, e.target.value)}
                  >
                    <option value="">بدون ارجاع</option>
                    {members.map((m) => (
                      <option key={m.user_id} value={m.user_id}>
                        {m.display_name || m.phone}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
