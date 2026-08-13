"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Shell from "@/components/Shell";
import { Button } from "@/components/ui/Button";
import { Badge, Card, EmptyState } from "@/components/ui/Card";
import { PageLoading } from "@/components/ui/Spinner";
import { TaskCreateModal } from "@/components/crm/TaskCreateModal";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { formatJalali } from "@/lib/jalali";
import {
  TaskViewToggle,
  TASK_STATUS_LABELS,
  leadHref,
  memberLabel,
  tasksBoardHref,
  type CrmTask,
  type Lead,
  type Member
} from "@/components/crm/shared";

export default function TasksListPage() {
  const searchParams = useSearchParams();
  const leadFilter = searchParams.get("lead") || "";
  const [tasks, setTasks] = useState<CrmTask[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [doneId, setDoneId] = useState<string | null>(null);
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

  const visible = useMemo(() => {
    if (!leadFilter) return tasks;
    return tasks.filter((t) => t.lead_id === leadFilter);
  }, [tasks, leadFilter]);

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

  const filterLead = leadFilter ? leadById.get(leadFilter) : undefined;

  return (
    <Shell
      title="فهرست وظایف"
      sub="کارهای پیگیری — می‌توانید هر وظیفه را به یک مخاطب وصل کنید"
      actions={
        <div className="task-toolbar">
          <button
            type="button"
            className="icon-btn task-add-btn"
            aria-label="وظیفه جدید"
            onClick={() => setCreateOpen(true)}
          >
            +
          </button>
          <TaskViewToggle mode="list" leadId={leadFilter || null} />
        </div>
      }
    >
      {loading ? (
        <PageLoading />
      ) : (
        <>
          {filterLead ? (
            <div className="task-lead-filter-bar">
              <span>
                فیلتر فهرست: وظایف «<strong>{filterLead.name}</strong>»
              </span>
              <div className="row-actions">
                <Link className="btn secondary sm" href={leadHref(filterLead.id)}>
                  کارت مخاطب
                </Link>
                <Link className="btn secondary sm" href="/tasks/list">
                  همه وظایف
                </Link>
              </div>
            </div>
          ) : null}

          <Card
            title={
              filterLead ? `وظایف «${filterLead.name}»` : "فهرست وظایف"
            }
            help={{
              title: "فهرست وظایف",
              body: "روی نام مخاطب کلیک کنید تا کارت همان مخاطب باز شود."
            }}
            actions={
              <Link className="btn secondary sm" href={tasksBoardHref(leadFilter || null)}>
                نمایش برد
              </Link>
            }
          >
            {visible.length === 0 ? (
              <EmptyState
                title="وظیفه‌ای نیست"
                text="با دکمه + یک وظیفه بسازید."
                action={<Button onClick={() => setCreateOpen(true)}>وظیفه جدید</Button>}
              />
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>عنوان</th>
                    <th>مخاطب</th>
                    <th>ارجاع</th>
                    <th>سررسید</th>
                    <th>وضعیت</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((t) => {
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
                            <Link className="lead-task-link" href={leadHref(lead.id)}>
                              {lead.name}
                            </Link>
                          ) : (
                            <span className="hint">بدون مخاطب</span>
                          )}
                        </td>
                        <td>{who ? memberLabel(who) : "—"}</td>
                        <td>{t.due_at ? formatJalali(t.due_at) : "—"}</td>
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
      <TaskCreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={load}
        members={members}
        leads={leads}
        defaultLeadId={leadFilter}
      />
    </Shell>
  );
}
