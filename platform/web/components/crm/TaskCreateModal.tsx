"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { PersianDateField } from "@/components/ui/PersianDateField";
import { api } from "@/lib/api";
import { useMutation } from "@/lib/useApi";
import { memberLabel, type Lead, type Member } from "./shared";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: () => void | Promise<void>;
  members: Member[];
  leads: Lead[];
  defaultLeadId?: string;
};

export function TaskCreateModal({
  open,
  onClose,
  onCreated,
  members,
  leads,
  defaultLeadId = ""
}: Props) {
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [leadId, setLeadId] = useState(defaultLeadId);
  const [dueAt, setDueAt] = useState("");
  const { busy, run } = useMutation();

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setMessage("");
    setAssigneeId("");
    setDueAt("");
    setLeadId(defaultLeadId || "");
  }, [open, defaultLeadId]);

  async function create() {
    if (!title.trim()) return;
    const ok = await run(
      () =>
        api("/tasks", {
          method: "POST",
          body: JSON.stringify({
            title: title.trim(),
            message,
            assignee_id: assigneeId || null,
            lead_id: leadId || null,
            due_at: dueAt || null
          })
        }),
      { success: "وظیفه ایجاد شد" }
    );
    if (ok) {
      onClose();
      await onCreated();
    }
  }

  return (
    <Modal
      open={open}
      title="وظیفه جدید"
      onClose={onClose}
      footer={
        <>
          <Button loading={busy} onClick={create}>
            ایجاد وظیفه
          </Button>
          <Button variant="secondary" onClick={onClose}>
            انصراف
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <label>
          عنوان
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="مثلاً پیگیری پیشنهاد"
            autoFocus
          />
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
        <label>
          مخاطب مرتبط
          <select
            value={leadId}
            onChange={(e) => setLeadId(e.target.value)}
            disabled={!!defaultLeadId}
          >
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
          <textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
        </label>
      </div>
    </Modal>
  );
}
