"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Shell from "@/components/Shell";
import { Button } from "@/components/ui/Button";
import { Badge, Card, EmptyState } from "@/components/ui/Card";
import { PageLoading } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { useMutation } from "@/lib/useApi";
import { useToast } from "@/components/ui/Toast";
import {
  TaskViewToggle,
  TASK_STATUS_LABELS,
  leadBoardHref,
  memberLabel,
  type CrmTask,
  type Lead,
  type Member
} from "@/components/crm/shared";

export default function TasksPage() {
  const searchParams = useSearchParams();
  const [tasks, setTasks] = useState<CrmTask[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [leadId, setLeadId] = useState(searchParams.get("lead") || "");
  const [loading, setLoading] = useState(true);
  const [doneId, setDoneId] = useState<string | null>(null);
  const { busy, run } = useMutation();
  const toast = useToast();

  async function load() {
    setLoading(true);
    try {
      const [t, m, l] = await Promise.all([
        api<CrmTask[]>("/tasks"),
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

  const leadById = useMemo(() => {
    const map = new Map<string, Lead>();
    for (const l of leads) map.set(l.id, l);
    return map;
  }, [leads]);

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
    <Shell
      title="وظایف تیمی"
      sub="کارهای پیگیری — می‌توانید هر وظیفه را به یک لید وصل کنید"
      actions={<TaskViewToggle mode="list" />}
    >
      {loading ? (
        <PageLoading />
      ) : (
        <>
          <Card
            title="وظیفه جدید"
            help={{
              title: "وظیفه جدید",
              body: "کار پیگیری را به خودتان یا عضو تیم بسپارید و در صورت نیاز به یک لید وصل کنید."
            }}
          >
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
                      {memberLabel(m)}
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

          <Card
            title="فهرست وظایف"
            help={{
              title: "فهرست وظایف",
              body: "روی نام لید کلیک کنید تا کارت همان مخاطب در برد کانبان باز شود. برای جابه‌جایی وضعیت و اولویت از برد استفاده کنید."
            }}
            actions={
              <Link className="btn secondary sm" href="/tasks/board">
                نمایش برد
              </Link>
            }
          >
            {tasks.length === 0 ? (
              <EmptyState title="وظیفه‌ای نیست" text="از فرم بالا یک وظیفه بسازید." />
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>عنوان</th>
                    <th>لید</th>
                    <th>ارجاع</th>
                    <th>وضعیت</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((t) => {
                    const lead = t.lead_id ? leadById.get(t.lead_id) : undefined;
                    const who = members.find((m) => m.user_id === t.assignee_id);
                    return (
                      <tr key={t.id}>
                        <td>
                          <strong>{t.title}</strong>
                          {t.message ? <div className="hint">{t.message}</div> : null}
                        </td>
                        <td>
                          {lead ? (
                            <Link className="lead-task-link" href={leadBoardHref(lead.id)}>
                              {lead.name}
                            </Link>
                          ) : (
                            <span className="hint">بدون لید</span>
                          )}
                        </td>
                        <td>{who ? memberLabel(who) : "—"}</td>
                        <td>
                          <Badge
                            tone={
                              t.status === "open"
                                ? "accent"
                                : t.status === "done"
                                  ? "success"
                                  : "accent"
                            }
                          >
                            {TASK_STATUS_LABELS[t.status] || t.status}
                          </Badge>
                        </td>
                        <td className="row-actions">
                          {t.status === "open" || t.status === "in_progress" ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              loading={doneId === t.id}
                              onClick={() => markDone(t.id)}
                            >
                              انجام شد
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </Shell>
  );
}
