"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { Switch } from "@/components/ui/Switch";
import { PersianDateField } from "@/components/ui/PersianDateField";
import { api } from "@/lib/api";
import { useMutation } from "@/lib/useApi";
import { useToast } from "@/components/ui/Toast";
import { formatJalali } from "@/lib/jalali";
import { ChannelBadge } from "@/components/channels/brand";
import {
  STAGES,
  STAGE_DOT,
  leadPhone,
  leadContactId,
  LtrText,
  initials,
  memberLabel,
  tagLabel,
  SENTIMENT_LABELS_FA,
  TASK_STATUS_LABELS,
  tasksBoardHref,
  type CrmTask,
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
  startWithTaskComposer?: boolean;
};

function LeadDetailView({
  lead,
  assignee,
  onApplyStage,
  applyingStage,
  onResumeBot,
  resumingBot
}: {
  lead: Lead;
  assignee: Member | undefined;
  onApplyStage?: (stage: string) => void;
  applyingStage?: boolean;
  onResumeBot?: () => void;
  resumingBot?: boolean;
}) {
  const phone = leadPhone(lead);
  const contactId = leadContactId(lead);
  const isGroup = lead.chat_type === "group";
  const score = typeof lead.lead_score === "number" ? lead.lead_score : 0;
  const meta = lead.ai_meta || {};
  const suggested = (meta.suggested_stage || "").trim();
  const sentiment = meta.sentiment || "";
  const buyingIntent =
    typeof meta.buying_intent === "number" ? meta.buying_intent : null;
  const memorySummary = (meta.memory?.summary || "").trim();
  const followPlan = meta.follow_up_plan;
  const risk =
    sentiment === "negative" ||
    !!meta.escalation ||
    (lead.tags || []).some((t) =>
      ["churn_risk", "detractor", "complaint"].includes(t)
    ) ||
    ((lead.tags || []).includes("needs_human") && sentiment === "negative");

  const handoffPack = [
    `نام: ${lead.name || "—"}`,
    phone ? `تلفن: ${phone}` : null,
    `مرحله: ${lead.stage || "—"}`,
    `امتیاز AI: ${Math.round(score)}`,
    buyingIntent != null ? `قصد خرید: ${Math.round(buyingIntent)}٪` : null,
    sentiment ? `احساس: ${SENTIMENT_LABELS_FA[sentiment] || sentiment}` : null,
    (lead.tags || []).length
      ? `برچسب‌ها: ${(lead.tags || []).map(tagLabel).join("، ")}`
      : null,
    assignee ? `مسئول: ${memberLabel(assignee)}` : "مسئول: بدون ارجاع",
    lead.bot_paused ? "وضعیت ربات: متوقف" : "وضعیت ربات: فعال",
    memorySummary ? `خلاصه AI: ${memorySummary}` : null,
    lead.notes ? `یادداشت:\n${lead.notes.slice(0, 600)}` : null
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div className="lead-modal-view">
      <div className="lead-modal-hero">
        <div className="lead-modal-avatar" aria-hidden>
          {initials(lead.name)}
        </div>
        <div className="lead-modal-hero-copy">
          <h3 className="lead-modal-name">{lead.name}</h3>
          <div className="lead-modal-badges">
            <Badge tone="accent">{isGroup ? "گروه" : "مخاطب"}</Badge>
            <span className="lead-stage-pill">
              <span className={`stage-dot ${STAGE_DOT[lead.stage] || "new"}`} />
              {lead.stage}
            </span>
            <Badge tone={lead.bot_paused ? "danger" : "accent"}>
              {lead.bot_paused ? "ربات متوقف" : "ربات فعال"}
            </Badge>
            {lead.bot_paused && onResumeBot ? (
              <Button type="button" size="sm" loading={resumingBot} onClick={onResumeBot}>
                شروع دوباره ربات
              </Button>
            ) : null}
            {risk ? <Badge tone="danger">ریسک / نیاز به کارشناس</Badge> : null}
          </div>
        </div>
      </div>

      <div className="lead-info-tiles">
        <div className="lead-info-tile">
          <span className="lead-info-tile-label">تلفن</span>
          <LtrText className="lead-info-tile-value ltr-block">
            {phone || "—"}
          </LtrText>
        </div>
        <div className="lead-info-tile">
          <span className="lead-info-tile-label">شناسه مخاطب</span>
          <LtrText className="lead-info-tile-value ltr-block">
            {isGroup ? lead.group_id || "—" : contactId || "—"}
          </LtrText>
        </div>
        <div className="lead-info-tile">
          <span className="lead-info-tile-label">کانال</span>
          <span className="lead-info-tile-value">
            {lead.source_channel ? <ChannelBadge channel={lead.source_channel} /> : "—"}
          </span>
        </div>
        <div className="lead-info-tile">
          <span className="lead-info-tile-label">ارجاع</span>
          <span className="lead-info-tile-value">
            {assignee ? memberLabel(assignee) : "بدون ارجاع"}
          </span>
        </div>
        <div className="lead-info-tile">
          <span className="lead-info-tile-label">امتیاز AI</span>
          <span className="lead-info-tile-value">{Math.round(score)}</span>
        </div>
        <div className="lead-info-tile">
          <span className="lead-info-tile-label">قصد خرید</span>
          <span className="lead-info-tile-value">
            {buyingIntent != null ? `${Math.round(buyingIntent)}٪` : "—"}
          </span>
        </div>
      </div>

      {(memorySummary || buyingIntent != null || followPlan?.status) && (
        <div className="lead-modal-section lead-memory-card">
          <span className="lead-modal-section-label">حافظه AI</span>
          <div className="lead-memory-body">
            {memorySummary ? (
              <p className="lead-memory-summary">{memorySummary}</p>
            ) : (
              <p className="lead-memory-summary hint">هنوز خلاصه‌ای ثبت نشده.</p>
            )}
            <div className="lead-memory-meta">
              {buyingIntent != null ? (
                <Badge tone={buyingIntent >= 70 ? "accent" : "default"}>
                  قصد خرید {Math.round(buyingIntent)}٪
                </Badge>
              ) : null}
              {followPlan?.status ? (
                <Badge tone="accent">
                  پیگیری خودکار:{" "}
                  {followPlan.status === "scheduled"
                    ? "زمان‌بندی‌شده"
                    : followPlan.status === "sent"
                      ? "ارسال شد"
                      : followPlan.status.startsWith("cancelled")
                        ? "لغو شد"
                        : followPlan.status}
                </Badge>
              ) : null}
            </div>
          </div>
        </div>
      )}

      <div className="lead-modal-section lead-handoff-card">
        <span className="lead-modal-section-label">بسته ارجاع به کارشناس</span>
        <pre className="lead-handoff-pack">{handoffPack}</pre>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => {
            void navigator.clipboard?.writeText(handoffPack);
          }}
        >
          کپی برای کارشناس
        </Button>
      </div>

      {sentiment || suggested ? (
        <div className="lead-modal-section">
          <span className="lead-modal-section-label">بینش هوش مصنوعی</span>
          <div className="card-meta" style={{ gap: 8, alignItems: "center" }}>
            {sentiment ? (
              <Badge tone={sentiment === "negative" ? "danger" : "accent"}>
                احساس: {SENTIMENT_LABELS_FA[sentiment] || sentiment}
              </Badge>
            ) : null}
            {suggested && suggested !== lead.stage ? (
              <>
                <Badge tone="accent">پیشنهاد مرحله: {suggested}</Badge>
                {onApplyStage ? (
                  <Button
                    type="button"
                    size="sm"
                    loading={applyingStage}
                    onClick={() => onApplyStage(suggested)}
                  >
                    اعمال مرحله
                  </Button>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {(lead.tags || []).length > 0 ? (
        <div className="lead-modal-section">
          <span className="lead-modal-section-label">برچسب‌ها</span>
          <div className="card-meta">
            {(lead.tags || []).map((t) => (
              <Badge key={t} tone="accent">
                {tagLabel(t)}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}

      {lead.notes ? (
        <div className="lead-modal-section">
          <span className="lead-modal-section-label">یادداشت</span>
          <div className="lead-modal-notes-box">{lead.notes}</div>
        </div>
      ) : null}
    </div>
  );
}

function LeadTasksSection({
  lead,
  members,
  onChanged,
  startComposer = false
}: {
  lead: Lead;
  members: Member[];
  onChanged: () => void | Promise<void>;
  startComposer?: boolean;
}) {
  const [tasks, setTasks] = useState<CrmTask[]>([]);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [assigneeId, setAssigneeId] = useState(lead.assignee_id || "");
  const [showComposer, setShowComposer] = useState(startComposer);
  const [doneId, setDoneId] = useState<string | null>(null);
  const { busy, run } = useMutation();
  const toast = useToast();

  async function loadTasks() {
    try {
      const rows = await api<CrmTask[]>(`/leads/${encodeURIComponent(lead.id)}/tasks`);
      setTasks(rows);
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا در بارگذاری وظایف", "err");
    }
  }

  useEffect(() => {
    setAssigneeId(lead.assignee_id || "");
    setTitle("");
    setMessage("");
    setDueAt("");
    setShowComposer(startComposer);
    void loadTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id, startComposer]);

  const openTasks = tasks.filter((t) => t.status === "open" || t.status === "in_progress");
  const doneTasks = tasks.filter((t) => t.status !== "open" && t.status !== "in_progress");

  async function createTask() {
    if (!title.trim()) {
      toast.push("عنوان وظیفه لازم است", "err");
      return;
    }
    const ok = await run(
      () =>
        api(`/leads/${lead.id}/tasks`, {
          method: "POST",
          body: JSON.stringify({
            title: title.trim(),
            message,
            assignee_id: assigneeId || null,
            due_at: dueAt || null,
            source: "manual"
          })
        }),
      { success: "وظیفه ساخته شد" }
    );
    if (ok) {
      setTitle("");
      setMessage("");
      setDueAt("");
      setShowComposer(false);
      await loadTasks();
      await onChanged();
    }
  }

  async function markDone(id: string) {
    setDoneId(id);
    try {
      await api(`/tasks/${id}/done`, { method: "POST" });
      toast.push("انجام شد", "ok");
      await loadTasks();
      await onChanged();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setDoneId(null);
    }
  }

  return (
    <div className="lead-modal-section lead-tasks-block">
      <div className="lead-tasks-head">
        <span className="lead-modal-section-label">
          وظایف این مخاطب
          {openTasks.length > 0 ? ` (${openTasks.length} باز)` : ""}
        </span>
        <div className="lead-tasks-head-actions">
          <Link className="btn secondary sm" href={tasksBoardHref(lead.id)}>
            برد وظایف این مخاطب
          </Link>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowComposer((v) => !v)}
          >
            {showComposer ? "انصراف" : "وظیفه جدید"}
          </Button>
        </div>
      </div>

      {showComposer ? (
        <div className="lead-task-composer">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="مثلاً پیگیری پیشنهاد"
            autoFocus
          />
          <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            <option value="">بدون ارجاع</option>
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {memberLabel(m)}
              </option>
            ))}
          </select>
          <PersianDateField value={dueAt} onChange={setDueAt} />
          <textarea
            rows={2}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="توضیح اختیاری"
          />
          <Button loading={busy} size="sm" onClick={createTask}>
            افزودن وظیفه
          </Button>
        </div>
      ) : null}

      {openTasks.length === 0 && !showComposer ? (
        <p className="hint" style={{ margin: 0 }}>
          هنوز وظیفه بازی برای این مخاطب نیست.
        </p>
      ) : (
        <div className="lead-task-list">
          {openTasks.map((t) => {
            const who = members.find((m) => m.user_id === t.assignee_id);
            return (
              <div key={t.id} className="lead-task-item">
                <div className="lead-task-copy">
                  <strong>
                    {t.title}
                    {t.source === "ai" ? " · AI" : ""}
                  </strong>
                  {t.message ? <span className="hint">{t.message}</span> : null}
                  {t.due_at ? (
                    <span className="hint">سررسید: {formatJalali(t.due_at)}</span>
                  ) : null}
                  {who ? <span className="hint">ارجاع: {memberLabel(who)}</span> : null}
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={doneId === t.id}
                  onClick={() => markDone(t.id)}
                >
                  انجام شد
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {doneTasks.length > 0 ? (
        <div className="lead-task-done-list">
          {doneTasks.slice(0, 3).map((t) => (
            <div key={t.id} className="lead-task-done">
              <Badge tone={t.status === "done" ? "success" : "accent"}>
                {TASK_STATUS_LABELS[t.status] || t.status}
              </Badge>
              <span>{t.title}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function LeadModal({
  open,
  lead,
  members,
  onClose,
  onChanged,
  startInEdit = false,
  startWithTaskComposer = false
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
            wa_lid: editForm.chat_type === "group" ? "" : editForm.contact_id.trim(),
            external_chat_id:
              editForm.chat_type === "group"
                ? null
                : editForm.contact_id.trim() || null,
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

  async function applySuggestedStage(stage: string) {
    if (!lead || !stage) return;
    const ok = await run(
      () =>
        api(`/leads/${lead.id}`, {
          method: "PATCH",
          body: JSON.stringify({ stage })
        }),
      { success: "مرحله اعمال شد" }
    );
    if (ok) await onChanged();
  }

  async function resumeBot() {
    if (!lead) return;
    const ok = await run(
      () =>
        api(`/leads/${lead.id}`, {
          method: "PATCH",
          body: JSON.stringify({ bot_paused: false })
        }),
      { success: "ربات دوباره فعال شد" }
    );
    if (ok) await onChanged();
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
        title={mode === "edit" ? `ویرایش: ${lead.name}` : ""}
        panelClassName={mode === "view" ? "lead-modal lead-modal-panel" : "lead-modal-panel"}
        onClose={closeAll}
        headerActions={
          mode === "view" ? (
            <span className="lead-modal-header-tag">جزئیات لید</span>
          ) : null
        }
        footer={
          mode === "edit" ? (
            <>
              <Button loading={busy} onClick={saveForm}>
                ذخیره تغییرات
              </Button>
              <Button variant="secondary" onClick={() => setMode("view")}>
                انصراف
              </Button>
              <Button variant="danger" onClick={() => setDeleteOpen(true)}>
                حذف لید
              </Button>
            </>
          ) : (
            <>
              <Button onClick={() => setMode("edit")}>ویرایش لید</Button>
              <Button variant="secondary" onClick={closeAll}>
                بستن
              </Button>
            </>
          )
        }
      >
        {mode === "view" ? (
          <>
            <LeadDetailView
              lead={lead}
              assignee={assignee}
              onApplyStage={(stage) => void applySuggestedStage(stage)}
              applyingStage={busy}
              onResumeBot={() => void resumeBot()}
              resumingBot={busy}
            />
            <LeadTasksSection
              lead={lead}
              members={members}
              onChanged={onChanged}
              startComposer={startWithTaskComposer}
            />
          </>
        ) : editForm ? (
          <div className="form-grid lead-modal-form">
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
              <>
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
                <label>
                  شناسه مخاطب
                  <input
                    className="ltr-text"
                    dir="ltr"
                    value={editForm.contact_id}
                    onChange={(e) => setEditForm({ ...editForm, contact_id: e.target.value })}
                    placeholder="…@lid یا شناسه چت"
                  />
                </label>
              </>
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
        panelClassName="lead-modal-panel"
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
