"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { Switch } from "@/components/ui/Switch";
import { api } from "@/lib/api";
import { useMutation } from "@/lib/useApi";
import { useToast } from "@/components/ui/Toast";
import {
  CHANNEL_LABELS,
  STAGES,
  leadIdentity,
  LtrText,
  memberLabel,
  type Lead,
  type Member
} from "./shared";
import { toEditForm, type EditForm } from "./lead-form";

type LeadModalProps = {
  open: boolean;
  lead: Lead | null;
  members: Member[];
  onClose: () => void;
  onChanged: () => void | Promise<void>;
  startInEdit?: boolean;
};

export function LeadModal({
  open,
  lead,
  members,
  onClose,
  onChanged,
  startInEdit = false
}: LeadModalProps) {
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const { busy, run } = useMutation();
  const toast = useToast();

  useEffect(() => {
    if (!open || !lead) return;
    setEditForm(toEditForm(lead));
    setMode(startInEdit ? "edit" : "view");
    setDeleteOpen(false);
    setDeleteConfirmName("");
  }, [open, lead, startInEdit]);

  function closeAll() {
    setDeleteOpen(false);
    setDeleteConfirmName("");
    onClose();
  }

  async function saveForm() {
    if (!lead || !editForm) return;
    if (!editForm.name.trim()) {
      toast.push("نام لید لازم است", "err");
      return;
    }
    const tags = editForm.tags
      .split(/[,،]/)
      .map((t) => t.trim())
      .filter(Boolean);
    const ok = await run(
      () =>
        api(`/leads/${lead.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: editForm.name.trim(),
            phone: editForm.chat_type === "group" ? "" : editForm.phone.trim(),
            group_id: editForm.chat_type === "group" ? editForm.group_id.trim() : "",
            chat_type: editForm.chat_type,
            stage: editForm.stage,
            notes: editForm.notes,
            tags,
            bot_paused: editForm.bot_paused,
            assignee_id: editForm.assignee_id || null
          })
        }),
      { success: "لید ویرایش شد" }
    );
    if (ok) {
      await onChanged();
      closeAll();
    }
  }

  const deleteNameMatches =
    !!lead && deleteConfirmName.trim() === lead.name.trim();

  async function confirmDelete() {
    if (!lead || !deleteNameMatches) return;
    const ok = await run(
      () => api(`/leads/${lead.id}`, { method: "DELETE" }),
      { success: "لید حذف شد" }
    );
    if (ok) {
      await onChanged();
      closeAll();
    }
  }

  if (!lead) return null;

  const assignee = members.find((m) => m.user_id === lead.assignee_id);

  return (
    <>
      <Modal
        open={open && !deleteOpen}
        title={mode === "edit" ? `ویرایش: ${lead.name}` : lead.name}
        onClose={closeAll}
        headerActions={
          mode === "view" ? (
            <Button variant="ghost" size="sm" onClick={() => setMode("edit")} aria-label="ویرایش">
              ✎
            </Button>
          ) : null
        }
        footer={
          mode === "edit" ? (
            <>
              <Button loading={busy} onClick={saveForm}>
                ذخیره
              </Button>
              <Button variant="secondary" onClick={() => setMode("view")}>
                انصراف
              </Button>
              <Button variant="danger" onClick={() => setDeleteOpen(true)}>
                حذف لید
              </Button>
            </>
          ) : (
            <Button variant="secondary" onClick={closeAll}>
              بستن
            </Button>
          )
        }
      >
        {mode === "view" ? (
          <div className="lead-detail-grid">
            <div className="lead-detail-row">
              <span className="lead-detail-label">نوع</span>
              <span>{lead.chat_type === "group" ? "گروه" : "مخاطب"}</span>
            </div>
            <div className="lead-detail-row">
              <span className="lead-detail-label">شناسه / تلفن</span>
              <LtrText>{leadIdentity(lead)}</LtrText>
            </div>
            <div className="lead-detail-row">
              <span className="lead-detail-label">مرحله</span>
              <span>{lead.stage}</span>
            </div>
            <div className="lead-detail-row">
              <span className="lead-detail-label">کانال</span>
              <span>
                {lead.source_channel
                  ? CHANNEL_LABELS[lead.source_channel] || lead.source_channel
                  : "—"}
              </span>
            </div>
            <div className="lead-detail-row">
              <span className="lead-detail-label">ارجاع</span>
              <span>{assignee ? memberLabel(assignee) : "بدون ارجاع"}</span>
            </div>
            <div className="lead-detail-row">
              <span className="lead-detail-label">ربات</span>
              <span>{lead.bot_paused ? "متوقف" : "فعال"}</span>
            </div>
            {(lead.tags || []).length > 0 ? (
              <div className="lead-detail-row full">
                <span className="lead-detail-label">برچسب‌ها</span>
                <div className="card-meta">
                  {(lead.tags || []).map((t) => (
                    <Badge key={t} tone="accent">
                      {t}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}
            {lead.notes ? (
              <div className="lead-detail-row full">
                <span className="lead-detail-label">یادداشت</span>
                <p className="lead-detail-notes">{lead.notes}</p>
              </div>
            ) : null}
          </div>
        ) : editForm ? (
          <div className="form-grid">
            <label>
              نام
              <input
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                autoFocus
              />
            </label>
            <label>
              نوع چت
              <select
                value={editForm.chat_type}
                onChange={(e) => setEditForm({ ...editForm, chat_type: e.target.value })}
              >
                <option value="pv">خصوصی (PV)</option>
                <option value="group">گروه</option>
              </select>
            </label>
            {editForm.chat_type === "group" ? (
              <label>
                شناسه گروه
                <input
                  className="ltr-text"
                  dir="ltr"
                  value={editForm.group_id}
                  onChange={(e) => setEditForm({ ...editForm, group_id: e.target.value })}
                />
              </label>
            ) : (
              <label>
                تلفن
                <input
                  className="ltr-text"
                  dir="ltr"
                  value={editForm.phone}
                  onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                  placeholder="+989..."
                />
              </label>
            )}
            <label>
              مرحله
              <select
                value={editForm.stage}
                onChange={(e) => setEditForm({ ...editForm, stage: e.target.value })}
              >
                {STAGES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label>
              ارجاع
              <select
                value={editForm.assignee_id}
                onChange={(e) => setEditForm({ ...editForm, assignee_id: e.target.value })}
              >
                <option value="">بدون ارجاع</option>
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {memberLabel(m)}
                  </option>
                ))}
              </select>
            </label>
            <label className="full">
              برچسب‌ها (با ویرگول)
              <input
                value={editForm.tags}
                onChange={(e) => setEditForm({ ...editForm, tags: e.target.value })}
              />
            </label>
            <label className="full">
              یادداشت
              <textarea
                rows={3}
                value={editForm.notes}
                onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
              />
            </label>
            <Switch
              full
              label="ربات فعال برای این چت"
              hint="وقتی خاموش باشد، پاسخ خودکار برای این مخاطب/گروه متوقف می‌شود."
              checked={!editForm.bot_paused}
              onChange={(active) => setEditForm({ ...editForm, bot_paused: !active })}
            />
          </div>
        ) : null}
      </Modal>

      <Modal
        open={deleteOpen}
        title="تأیید حذف لید"
        onClose={() => {
          setDeleteOpen(false);
          setDeleteConfirmName("");
        }}
        footer={
          <>
            <Button
              variant="danger"
              loading={busy}
              disabled={!deleteNameMatches}
              onClick={confirmDelete}
            >
              حذف قطعی
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setDeleteOpen(false);
                setDeleteConfirmName("");
              }}
            >
              انصراف
            </Button>
          </>
        }
      >
        <div className="delete-confirm-body">
          <p className="delete-confirm-text">
            حذف «<strong>{lead.name}</strong>» برگشت‌پذیر نیست. پیام‌ها و جاب‌های مرتبط هم
            پاک می‌شوند.
          </p>
          <label>
            برای تأیید، نام مخاطب را دقیقاً بنویسید
            <input
              value={deleteConfirmName}
              onChange={(e) => setDeleteConfirmName(e.target.value)}
              placeholder={lead.name}
              autoFocus
            />
          </label>
        </div>
      </Modal>
    </>
  );
}
