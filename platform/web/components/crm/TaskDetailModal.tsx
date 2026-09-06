"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { PersianDateField } from "@/components/ui/PersianDateField";
import { api } from "@/lib/api";
import { useMutation } from "@/lib/useApi";
import { formatJalali } from "@/lib/jalali";
import {
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  isSetupChannelTask,
  memberLabel,
  type CrmTask,
  type Lead,
  type Member
} from "./shared";

type Props = {
  open: boolean;
  task: CrmTask | null;
  members: Member[];
  leads: Lead[];
  onClose: () => void;
  onChanged: () => void | Promise<void>;
};

function toDateInput(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return iso.slice(0, 10);
}

export function TaskDetailModal({
  open,
  task,
  members,
  leads,
  onClose,
  onChanged
}: Props) {
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [leadId, setLeadId] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [status, setStatus] = useState("open");
  const { busy, run } = useMutation();

  useEffect(() => {
    if (!open || !task) return;
    setTitle(task.title || "");
    setMessage(task.message || "");
    setAssigneeId(task.assignee_id || "");
    setLeadId(task.lead_id || "");
    setDueAt(toDateInput(task.due_at));
    setStatus(task.status || "open");
  }, [open, task]);

  if (!task) return null;

  const canAct = status === "open" || status === "in_progress";
  const linkedLead = leadId ? leads.find((l) => l.id === leadId) : undefined;

  async function save() {
    if (!title.trim()) return;
    const ok = await run(
      () =>
        api(`/tasks/${task!.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            title: title.trim(),
            message,
            assignee_id: assigneeId || null,
            lead_id: leadId || null,
            due_at: dueAt || null,
            status
          })
        }),
      { success: "وظیفه به‌روز شد" }
    );
    if (ok) await onChanged();
  }

  async function markDone() {
    const ok = await run(
      () => api(`/tasks/${task!.id}/done`, { method: "POST" }),
      { success: "وظیفه انجام شد" }
    );
    if (ok) {
      await onChanged();
      onClose();
    }
  }

  async function markCancel() {
    const ok = await run(
      () => api(`/tasks/${task!.id}/cancel`, { method: "POST" }),
      { success: "وظیفه لغو شد" }
    );
    if (ok) {
      await onChanged();
      onClose();
    }
  }

  return (
    <Modal
      open={open}
      title={task.title || "جزئیات وظیفه"}
      onClose={onClose}
      presentation="auto"
      panelClassName="lead-modal-panel"
      headerActions={<span className="lead-modal-header-tag">وظیفه</span>}
      footer={
        <>
          <Button loading={busy} onClick={save}>
            ذخیره
          </Button>
          {canAct ? (
            <Button variant="secondary" loading={busy} onClick={markDone}>
              انجام شد
            </Button>
          ) : null}
          {canAct ? (
            <Button variant="danger" loading={busy} onClick={markCancel}>
              لغو وظیفه
            </Button>
          ) : null}
          <Button variant="secondary" onClick={onClose}>
            بستن
          </Button>
        </>
      }
    >
      <div className="form-grid lead-modal-form">
        <div className="lead-info-tiles" style={{ gridColumn: "1 / -1" }}>
          <div className="lead-info-tile">
            <span className="lead-info-tile-label">وضعیت فعلی</span>
            <span className="lead-info-tile-value">
              <Badge
                tone={
                  task.status === "done"
                    ? "success"
                    : task.status === "cancelled"
                      ? "danger"
                      : "accent"
                }
              >
                {TASK_STATUS_LABELS[task.status] || task.status}
              </Badge>
            </span>
          </div>
          <div className="lead-info-tile">
            <span className="lead-info-tile-label">منبع</span>
            <span className="lead-info-tile-value">
              {isSetupChannelTask(task)
                ? "راه‌اندازی کانال"
                : task.source === "ai"
                  ? "هوش مصنوعی"
                  : "دستی"}
            </span>
          </div>
          <div className="lead-info-tile">
            <span className="lead-info-tile-label">سررسید ثبت‌شده</span>
            <span className="lead-info-tile-value">
              {task.due_at ? formatJalali(task.due_at) : "تعیین نشده"}
            </span>
          </div>
          <div className="lead-info-tile">
            <span className="lead-info-tile-label">مخاطب</span>
            <span className="lead-info-tile-value">
              {linkedLead?.name || "بدون مخاطب"}
            </span>
          </div>
        </div>

        <label>
          عنوان
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="عنوان وظیفه"
            autoFocus
          />
        </label>
        <label>
          وضعیت
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {TASK_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          ارجاع به
          <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            <option value="">بدون ارجاع</option>
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {memberLabel(m)}
              </option>
            ))}
          </select>
        </label>
        <label>
          مخاطب مرتبط
          <select value={leadId} onChange={(e) => setLeadId(e.target.value)}>
            <option value="">بدون مخاطب</option>
            {leads.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <PersianDateField value={dueAt} onChange={setDueAt} />
        <label className="full">
          توضیح
          <textarea rows={4} value={message} onChange={(e) => setMessage(e.target.value)} />
        </label>
      </div>
    </Modal>
  );
}
