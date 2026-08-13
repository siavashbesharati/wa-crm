"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Shell from "@/components/Shell";
import { Button } from "@/components/ui/Button";
import { Badge, Card, EmptyState } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { PageLoading } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { useMutation } from "@/lib/useApi";
import { useToast } from "@/components/ui/Toast";
import {
  buildTaskBoardReorder,
  tasksInStatus,
  type TaskBoardOrderUpdate
} from "@/components/crm/task-board";
import {
  TaskViewToggle,
  TASK_STATUSES,
  TASK_STATUS_DOT,
  TASK_STATUS_LABELS,
  leadBoardHref,
  memberLabel,
  initials,
  type CrmTask,
  type Lead,
  type Member
} from "@/components/crm/shared";

export default function TasksBoardPage() {
  const [tasks, setTasks] = useState<CrmTask[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStatus, setOverStatus] = useState<string | null>(null);
  const [overCardId, setOverCardId] = useState<string | null>(null);
  const [dropBefore, setDropBefore] = useState(true);
  const [detailTask, setDetailTask] = useState<CrmTask | null>(null);
  const dragMovedRef = useRef(false);
  const { busy, run } = useMutation();
  const toast = useToast();

  const load = useCallback(async () => {
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
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setDetailTask((prev) => {
      if (!prev) return prev;
      return tasks.find((t) => t.id === prev.id) || null;
    });
  }, [tasks]);

  const leadById = useMemo(() => {
    const map = new Map<string, Lead>();
    for (const l of leads) map.set(l.id, l);
    return map;
  }, [leads]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return tasks;
    return tasks.filter((t) => {
      const leadName = t.lead_id ? leadById.get(t.lead_id)?.name || "" : "";
      return (
        t.title.toLowerCase().includes(needle) ||
        (t.message || "").toLowerCase().includes(needle) ||
        leadName.toLowerCase().includes(needle)
      );
    });
  }, [tasks, q, leadById]);

  async function persistBoardOrder(updates: TaskBoardOrderUpdate[], prev: CrmTask[]) {
    if (updates.length === 0) return;
    const ok = await run(
      () =>
        api("/tasks/board-order", {
          method: "POST",
          body: JSON.stringify({ updates })
        }),
      { silent: true }
    );
    if (!ok) {
      setTasks(prev);
      toast.push("ترتیب کارت‌ها ذخیره نشد", "err");
    }
  }

  async function applyBoardDrop(
    dragTaskId: string,
    targetStatus: string,
    targetId: string | null,
    insertBefore: boolean
  ) {
    const prev = tasks;
    const { next, updates } = buildTaskBoardReorder(
      tasks,
      dragTaskId,
      targetStatus,
      targetId,
      insertBefore
    );
    if (updates.length === 0) return;
    const merged = tasks.map((t) => next.find((n) => n.id === t.id) || t);
    setTasks(merged);
    await persistBoardOrder(updates, prev);
  }

  function resetDragState() {
    setDragId(null);
    setOverStatus(null);
    setOverCardId(null);
    setDropBefore(true);
  }

  function handleCardDragOver(
    e: React.DragEvent<HTMLDivElement>,
    status: string,
    cardId: string
  ) {
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    setOverStatus(status);
    setOverCardId(cardId);
    setDropBefore(before);
  }

  return (
    <Shell
      title="برد وظایف"
      sub="کارت‌ها را بکشید برای تغییر وضعیت یا اولویت"
      search={q}
      onSearch={setQ}
      actions={<TaskViewToggle mode="board" />}
    >
      {loading ? (
        <PageLoading />
      ) : filtered.length === 0 ? (
        <Card
          help={{
            title: "برد وظایف",
            body: "نمای کانبان کارهای تیم. کارت را بین ستون‌ها بکشید تا وضعیت عوض شود، یا بالا/پایین ببرید تا اولویت عوض شود."
          }}
        >
          <EmptyState
            title="وظیفه‌ای برای نمایش نیست"
            text="از لیست وظایف یک کار بسازید."
            action={
              <Link className="btn secondary" href="/tasks">
                رفتن به لیست وظایف
              </Link>
            }
          />
        </Card>
      ) : (
        <div className="pipeline">
          {TASK_STATUSES.map((status) => {
            const items = tasksInStatus(filtered, status);
            return (
              <div
                key={status}
                className={`pipeline-col ${overStatus === status && !overCardId ? "drag-over" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOverStatus(status);
                  setOverCardId(null);
                }}
                onDragLeave={() => {
                  setOverStatus((s) => (s === status ? null : s));
                  setOverCardId(null);
                }}
                onDrop={async (e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData("text/task-id") || dragId;
                  const targetId = overCardId;
                  const insertBefore = dropBefore;
                  resetDragState();
                  if (id) {
                    await applyBoardDrop(id, status, targetId, insertBefore);
                  }
                }}
              >
                <div className="pipeline-col-head">
                  <h3>
                    <span className={`stage-dot ${TASK_STATUS_DOT[status] || "new"}`} />
                    {TASK_STATUS_LABELS[status]}
                  </h3>
                  <span className="col-count">{items.length}</span>
                </div>
                {items.map((t) => {
                  const assignee = members.find((m) => m.user_id === t.assignee_id);
                  const lead = t.lead_id ? leadById.get(t.lead_id) : undefined;
                  const isDropTarget = overCardId === t.id;
                  return (
                    <div
                      key={t.id}
                      className={`pipeline-card ${dragId === t.id ? "dragging" : ""}${
                        isDropTarget ? (dropBefore ? " drop-before" : " drop-after") : ""
                      }`}
                      draggable={!busy}
                      onDragStart={(e) => {
                        dragMovedRef.current = false;
                        setDragId(t.id);
                        e.dataTransfer.setData("text/task-id", t.id);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDrag={(e) => {
                        if (e.clientX !== 0 || e.clientY !== 0) {
                          dragMovedRef.current = true;
                        }
                      }}
                      onDragOver={(e) => handleCardDragOver(e, status, t.id)}
                      onDrop={async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const id = e.dataTransfer.getData("text/task-id") || dragId;
                        resetDragState();
                        if (id && id !== t.id) {
                          await applyBoardDrop(id, status, t.id, dropBefore);
                        }
                      }}
                      onDragEnd={resetDragState}
                      onClick={() => {
                        if (dragMovedRef.current) return;
                        setDetailTask(t);
                      }}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setDetailTask(t);
                        }
                      }}
                    >
                      <p className="card-title">{t.title}</p>
                      <div className="card-meta">
                        {lead ? <Badge tone="accent">{lead.name}</Badge> : null}
                        {t.message ? <Badge>{t.message.slice(0, 42)}</Badge> : null}
                      </div>
                      <div className="card-foot">
                        {assignee ? (
                          <span className="avatar-sm" title={memberLabel(assignee)}>
                            {initials(memberLabel(assignee))}
                          </span>
                        ) : (
                          <span className="hint" style={{ fontSize: 11 }}>
                            بدون ارجاع
                          </span>
                        )}
                        <select
                          className="sm"
                          style={{ width: "auto", maxWidth: 120, padding: "4px 6px", fontSize: 11 }}
                          value={t.status}
                          onChange={(e) => {
                            void applyBoardDrop(t.id, e.target.value, null, true);
                          }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {TASK_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {TASK_STATUS_LABELS[s]}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={!!detailTask}
        title={detailTask?.title || "وظیفه"}
        onClose={() => setDetailTask(null)}
        footer={
          <>
            {detailTask?.lead_id && leadById.get(detailTask.lead_id) ? (
              <Link className="btn secondary" href={leadBoardHref(detailTask.lead_id)}>
                مشاهده لید در برد
              </Link>
            ) : null}
            <Button variant="secondary" onClick={() => setDetailTask(null)}>
              بستن
            </Button>
          </>
        }
      >
        {detailTask ? (
          <div className="lead-info-tiles">
            <div className="lead-info-tile">
              <span className="lead-info-tile-label">وضعیت</span>
              <span className="lead-info-tile-value">
                {TASK_STATUS_LABELS[detailTask.status] || detailTask.status}
              </span>
            </div>
            <div className="lead-info-tile">
              <span className="lead-info-tile-label">ارجاع</span>
              <span className="lead-info-tile-value">
                {memberLabel(members.find((m) => m.user_id === detailTask.assignee_id)) || "بدون ارجاع"}
              </span>
            </div>
            <div className="lead-info-tile">
              <span className="lead-info-tile-label">لید</span>
              <span className="lead-info-tile-value">
                {detailTask.lead_id
                  ? leadById.get(detailTask.lead_id)?.name || "—"
                  : "بدون لید"}
              </span>
            </div>
            {detailTask.message ? (
              <div className="lead-info-tile" style={{ gridColumn: "1 / -1" }}>
                <span className="lead-info-tile-label">توضیح</span>
                <span className="lead-info-tile-value">{detailTask.message}</span>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </Shell>
  );
}
