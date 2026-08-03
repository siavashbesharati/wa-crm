"use client";

import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Button } from "@/components/ui/Button";
import { Badge, Card, EmptyState } from "@/components/ui/Card";
import { PageLoading } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { useMutation } from "@/lib/useApi";
import { useToast } from "@/components/ui/Toast";

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
  const [loading, setLoading] = useState(true);
  const [doneId, setDoneId] = useState<string | null>(null);
  const { busy, run } = useMutation();
  const toast = useToast();

  async function load() {
    setLoading(true);
    try {
      const [t, m, l] = await Promise.all([
        api<Task[]>("/tasks"),
        api<Member[]>("/orgs/members"),
        api<Lead[]>("/leads")
      ]);
      setTasks(t);
      setMembers(m);
      setLeads(l);
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

  async function create() {
    if (!title.trim()) return;
    const ok = await run(
      () =>
        api("/tasks", {
          method: "POST",
          body: JSON.stringify({
            title,
            message,
            assignee_id: assigneeId || null,
            lead_id: leadId || null
          })
        }),
      { success: "وظیفه ایجاد شد" }
    );
    if (ok) {
      setTitle("");
      setMessage("");
      await load();
    }
  }

  async function markDone(id: string) {
    setDoneId(id);
    try {
      await api(`/tasks/${id}/done`, { method: "POST" });
      toast.push("انجام شد", "ok");
      await load();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setDoneId(null);
    }
  }

  return (
    <Shell title="وظایف تیمی" sub="ارجاع کار بین اپراتورها">
      <Card title="وظیفه جدید">
        <div className="form-grid">
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
          <Button loading={busy} onClick={create}>
            ایجاد وظیفه
          </Button>
        </div>
      </Card>

      <Card title="فهرست وظایف">
        {loading ? (
          <PageLoading />
        ) : tasks.length === 0 ? (
          <EmptyState title="وظیفه‌ای نیست" text="از فرم بالا یک وظیفه بسازید." />
        ) : (
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
                  <td>
                    <Badge tone={t.status === "open" ? "accent" : "success"}>
                      {t.status}
                    </Badge>
                  </td>
                  <td className="row-actions">
                    {t.status === "open" && (
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={doneId === t.id}
                        onClick={() => markDone(t.id)}
                      >
                        انجام شد
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Shell>
  );
}
