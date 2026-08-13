"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import Shell from "@/components/Shell";
import { Button } from "@/components/ui/Button";
import { Badge, Card, EmptyState } from "@/components/ui/Card";
import { PageLoading } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { useMutation } from "@/lib/useApi";
import { useToast } from "@/components/ui/Toast";
import {
  CrmViewToggle,
  STAGES,
  STAGE_DOT,
  CHANNEL_LABELS,
  leadIdentity,
  type Lead,
  type Member,
  memberLabel
} from "@/components/crm/shared";

type EditForm = {
  name: string;
  phone: string;
  group_id: string;
  chat_type: string;
  stage: string;
  notes: string;
  tags: string;
  bot_paused: boolean;
  assignee_id: string;
};

function toEditForm(l: Lead): EditForm {
  return {
    name: l.name || "",
    phone: l.phone || "",
    group_id: l.group_id || "",
    chat_type: l.chat_type === "group" ? "group" : "pv",
    stage: l.stage || STAGES[0],
    notes: l.notes || "",
    tags: (l.tags || []).join(", "),
    bot_paused: !!l.bot_paused,
    assignee_id: l.assignee_id || ""
  };
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [q, setQ] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [editing, setEditing] = useState<Lead | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const { busy, run } = useMutation();
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [l, m] = await Promise.all([
        api<Lead[]>("/leads"),
        api<Member[]>("/orgs/members")
      ]);
      setLeads(l);
      setMembers(m);
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    return leads.filter((l) => {
      if (stageFilter && l.stage !== stageFilter) return false;
      const needle = q.trim().toLowerCase();
      if (!needle) return true;
      return (
        l.name.toLowerCase().includes(needle) ||
        (l.phone || "").includes(needle) ||
        (l.external_chat_id || "").toLowerCase().includes(needle) ||
        (l.source_channel || "").toLowerCase().includes(needle) ||
        (l.tags || []).some((t) => t.toLowerCase().includes(needle))
      );
    });
  }, [leads, q, stageFilter]);

  async function createLead() {
    if (!name.trim()) return;
    const ok = await run(
      () =>
        api("/leads", {
          method: "POST",
          body: JSON.stringify({ name, phone, tags: [] })
        }),
      { success: "لید افزوده شد" }
    );
    if (ok) {
      setName("");
      setPhone("");
      await load();
    }
  }

  async function assign(leadId: string, assigneeId: string) {
    await run(
      () =>
        api(`/leads/${leadId}/assign?assignee_id=${encodeURIComponent(assigneeId)}`, {
          method: "POST"
        }),
      { success: "ارجاع ذخیره شد" }
    );
    await load();
  }

  async function setStage(leadId: string, stage: string) {
    await run(
      () =>
        api(`/leads/${leadId}`, {
          method: "PATCH",
          body: JSON.stringify({ stage })
        }),
      { success: "مرحله به‌روز شد" }
    );
    await load();
  }

  function openEdit(l: Lead) {
    setEditing(l);
    setEditForm(toEditForm(l));
  }

  function closeEdit() {
    setEditing(null);
    setEditForm(null);
  }

  async function saveEdit() {
    if (!editing || !editForm) return;
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
        api(`/leads/${editing.id}`, {
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
      closeEdit();
      await load();
    }
  }

  async function removeLead(l: Lead) {
    if (!window.confirm(`حذف لید «${l.name}»؟ پیام‌ها و جاب‌های مرتبط هم پاک می‌شوند.`)) {
      return;
    }
    const ok = await run(
      () => api(`/leads/${l.id}`, { method: "DELETE" }),
      { success: "لید حذف شد" }
    );
    if (ok) {
      if (editing?.id === l.id) closeEdit();
      await load();
    }
  }

  async function clearAllLeads() {
    if (leads.length === 0) return;
    if (
      !window.confirm(
        `همه ${leads.length} لید این کسب‌وکار پاک شوند؟ این عمل پیام‌ها و لینک‌های مرتبط را هم حذف می‌کند و برگشت‌پذیر نیست.`
      )
    ) {
      return;
    }
    const typed = window.prompt('برای تأیید، کلمه «پاک» را بنویسید:');
    if (typed !== "پاک") {
      toast.push("لغو شد", "err");
      return;
    }
    const ok = await run(
      () => api<{ ok: boolean; deleted: number }>("/leads/clear-all", { method: "DELETE" }),
      { success: "همه لیدها پاک شدند" }
    );
    if (ok) {
      closeEdit();
      await load();
    }
  }

  return (
    <Shell
      title="لیدها"
      sub="لیست مشترک لیدها بین اپراتورها"
      search={q}
      onSearch={setQ}
      actions={<CrmViewToggle mode="list" />}
    >
      {loading ? (
        <PageLoading variant="list" />
      ) : (
        <>
          <Card
            title="افزودن لید"
            help={{
              title: "افزودن لید",
              body: "لید دستی بسازید یا صبر کنید افزونه از واتساپ/دیوار همگام کند.",
              tips: ["نام لازم است؛ تلفن اختیاری ولی برای پیگیری مفید است."]
            }}
          >
            <div className="form-grid">
              <label>
                نام
                <input value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label>
                تلفن
                <input value={phone} onChange={(e) => setPhone(e.target.value)} />
              </label>
              <div className="row-actions">
                <Button loading={busy} onClick={createLead}>
                  افزودن لید
                </Button>
                <Link className="btn secondary" href="/pipeline">
                  مشاهده برد
                </Link>
              </div>
            </div>
          </Card>

          {editing && editForm ? (
            <Card
              title={`ویرایش: ${editing.name}`}
              actions={
                <Button variant="ghost" size="sm" onClick={closeEdit}>
                  بستن
                </Button>
              }
            >
              <div className="form-grid">
                <label>
                  نام
                  <input
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  />
                </label>
                <label>
                  نوع چت
                  <select
                    value={editForm.chat_type}
                    onChange={(e) =>
                      setEditForm({ ...editForm, chat_type: e.target.value })
                    }
                  >
                    <option value="pv">خصوصی (PV)</option>
                    <option value="group">گروه</option>
                  </select>
                </label>
                {editForm.chat_type === "group" ? (
                  <label>
                    شناسه گروه
                    <input
                      value={editForm.group_id}
                      onChange={(e) =>
                        setEditForm({ ...editForm, group_id: e.target.value })
                      }
                    />
                  </label>
                ) : (
                  <label>
                    تلفن
                    <input
                      value={editForm.phone}
                      onChange={(e) =>
                        setEditForm({ ...editForm, phone: e.target.value })
                      }
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
                    onChange={(e) =>
                      setEditForm({ ...editForm, assignee_id: e.target.value })
                    }
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
                <label className="row-actions" style={{ alignItems: "center", gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={editForm.bot_paused}
                    onChange={(e) =>
                      setEditForm({ ...editForm, bot_paused: e.target.checked })
                    }
                  />
                  ربات این چت متوقف باشد
                </label>
                <div className="row-actions">
                  <Button loading={busy} onClick={saveEdit}>
                    ذخیره ویرایش
                  </Button>
                  <Button variant="secondary" onClick={closeEdit}>
                    انصراف
                  </Button>
                  <Button variant="danger" loading={busy} onClick={() => removeLead(editing)}>
                    حذف لید
                  </Button>
                </div>
              </div>
            </Card>
          ) : null}

          <Card
            title={`فهرست (${filtered.length})`}
            help={{
              title: "فهرست لیدها",
              body: "همه سرنخ‌های مشترک تیم. می‌توانید ویرایش، حذف، مرحله و ارجاع را همین‌جا مدیریت کنید.",
              tips: [
                "پاک‌سازی همه فقط برای مدیر/مالک است و برگشت‌پذیر نیست.",
                "حذف یک لید، پیام‌ها و جاب‌های همان لید را هم پاک می‌کند."
              ]
            }}
            actions={
              <div className="row-actions">
                <select
                  value={stageFilter}
                  onChange={(e) => setStageFilter(e.target.value)}
                  style={{ width: "auto", minWidth: 120 }}
                >
                  <option value="">همه مراحل</option>
                  {STAGES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <Button
                  variant="danger"
                  size="sm"
                  loading={busy}
                  disabled={leads.length === 0}
                  onClick={clearAllLeads}
                >
                  پاک‌سازی همه
                </Button>
              </div>
            }
          >
            {filtered.length === 0 ? (
              <EmptyState
                title="هنوز لیدی نیست"
                text="افزونه را Reload کنید، تب واتساپ یا دیوار را باز بگذارید، یا از فرم بالا لید بسازید."
              />
            ) : (
              <div style={{ overflow: "auto" }}>
                <table>
                  <thead>
                    <tr>
                      <th>نام</th>
                      <th>شناسه / تلفن</th>
                      <th>کانال</th>
                      <th>مرحله</th>
                      <th>ارجاع</th>
                      <th>عملیات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((l) => (
                      <tr key={l.id}>
                        <td>
                          <strong>{l.name}</strong>
                          <div className="card-meta" style={{ marginTop: 4 }}>
                            {l.chat_type === "group" ? (
                              <Badge tone="accent">گروه</Badge>
                            ) : null}
                            {l.bot_paused ? <Badge tone="danger">ربات متوقف</Badge> : null}
                            {(l.tags || []).map((t) => (
                              <Badge key={t} tone="accent">
                                {t}
                              </Badge>
                            ))}
                          </div>
                        </td>
                        <td>{leadIdentity(l)}</td>
                        <td>
                          {l.source_channel ? (
                            <Badge tone="accent">
                              {CHANNEL_LABELS[l.source_channel] || l.source_channel}
                            </Badge>
                          ) : (
                            "-"
                          )}
                        </td>
                        <td>
                          <div className="row-actions">
                            <span className={`stage-dot ${STAGE_DOT[l.stage] || "new"}`} />
                            <select
                              value={l.stage}
                              onChange={(e) => setStage(l.id, e.target.value)}
                              style={{ width: "auto" }}
                            >
                              {STAGES.map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                            </select>
                          </div>
                        </td>
                        <td>
                          <select
                            value={l.assignee_id || ""}
                            onChange={(e) => assign(l.id, e.target.value)}
                          >
                            <option value="">بدون ارجاع</option>
                            {members.map((m) => (
                              <option key={m.user_id} value={m.user_id}>
                                {memberLabel(m)}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <div className="row-actions">
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => openEdit(l)}
                            >
                              ویرایش
                            </Button>
                            <Button
                              variant="danger"
                              size="sm"
                              loading={busy}
                              onClick={() => removeLead(l)}
                            >
                              حذف
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </Shell>
  );
}
