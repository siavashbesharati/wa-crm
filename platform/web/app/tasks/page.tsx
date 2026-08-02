"use client";

import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { api } from "@/lib/api";

type Task = {
  id: string;
  title: string;
  message: string;
  status: string;
  assignee_id: string | null;
  due_at: string | null;
};
type Member = { user_id: string; display_name: string; phone: string };
type Lead = { id: string; name: string };

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [leadId, setLeadId] = useState("");

  async function load() {
    const [t, m, l] = await Promise.all([
      api<Task[]>("/tasks"),
      api<Member[]>("/orgs/members"),
      api<Lead[]>("/leads")
    ]);
    setTasks(t);
    setMembers(m);
    setLeads(l);
  }

  useEffect(() => {
    load().catch(console.error);
  }, []);

  async function create() {
    await api("/tasks", {
      method: "POST",
      body: JSON.stringify({
        title,
        message,
        assignee_id: assigneeId || null,
        lead_id: leadId || null
      })
    });
    setTitle("");
    setMessage("");
    await load();
  }

  return (
    <Shell title="وظایف تیمی" sub="ارجاع کار بین اپراتورها">
      <div className="card form-grid">
        <label>
          عنوان
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          ارجاع به
          <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            <option value="">خودم</option>
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.display_name || m.phone}
              </option>
            ))}
          </select>
        </label>
        <label className="full">
          لید مرتبط
          <select value={leadId} onChange={(e) => setLeadId(e.target.value)}>
            <option value="">بدون لید</option>
            {leads.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="full">
          توضیح
          <textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
        </label>
        <button className="btn" onClick={create}>
          ایجاد وظیفه
        </button>
      </div>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>عنوان</th>
              <th>وضعیت</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id}>
                <td>
                  <strong>{t.title}</strong>
                  <div className="hint">{t.message}</div>
                </td>
                <td>{t.status}</td>
                <td className="row-actions">
                  {t.status === "open" && (
                    <button
                      className="btn secondary"
                      onClick={async () => {
                        await api(`/tasks/${t.id}/done`, { method: "POST" });
                        await load();
                      }}
                    >
                      انجام شد
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
