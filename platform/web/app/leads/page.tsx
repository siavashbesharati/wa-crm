"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Shell from "@/components/Shell";
import { Button } from "@/components/ui/Button";
import { Badge, Card, EmptyState } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { ActionSheet } from "@/components/ui/ActionSheet";
import { Switch } from "@/components/ui/Switch";
import { PageLoading } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { useMutation } from "@/lib/useApi";
import { useToast } from "@/components/ui/Toast";
import { LeadModal } from "@/components/crm/LeadModal";
import { ChannelBadge } from "@/components/channels/brand";
import {
  STAGES,
  STAGE_DOT,
  CHANNEL_LABELS,
  leadPhone,
  leadContactId,
  leadDisplayName,
  LtrText,
  tasksBoardHref,
  tasksByTagHref,
  tagLabel,
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

function emptyForm(): EditForm {
  return {
    name: "",
    phone: "",
    group_id: "",
    chat_type: "pv",
    stage: STAGES[0],
    notes: "",
    tags: "",
    bot_paused: false,
    assignee_id: ""
  };
}

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
  const router = useRouter();
  const searchParams = useSearchParams();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [nameFilter, setNameFilter] = useState("");
  const [identityFilter, setIdentityFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [channelFilter, setChannelFilter] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Lead | null>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [detailLead, setDetailLead] = useState<Lead | null>(null);
  const [openTaskComposer, setOpenTaskComposer] = useState(false);
  const [menuLead, setMenuLead] = useState<Lead | null>(null);
  const [tagsPop, setTagsPop] = useState<Lead | null>(null);
  const tagsPopCloseTimer = useRef<number | null>(null);
  const { busy, run } = useMutation();
  const toast = useToast();

  function clearTagsPopTimer() {
    if (tagsPopCloseTimer.current != null) {
      window.clearTimeout(tagsPopCloseTimer.current);
      tagsPopCloseTimer.current = null;
    }
  }

  function openTagsPop(lead: Lead) {
    clearTagsPopTimer();
    setMenuLead(null);
    setTagsPop(lead);
  }

  function openRowMenu(lead: Lead) {
    setTagsPop(null);
    setMenuLead((cur) => (cur?.id === lead.id ? null : lead));
  }

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

  useEffect(() => {
    return () => clearTagsPopTimer();
  }, []);

  useEffect(() => {
    const id = searchParams.get("lead");
    if (!id || leads.length === 0) return;
    const found = leads.find((l) => l.id === id);
    if (found) {
      setDetailLead(found);
      setOpenTaskComposer(false);
    }
  }, [searchParams, leads]);

  const channelOptions = useMemo(() => {
    const set = new Set<string>();
    for (const l of leads) {
      if (l.source_channel) set.add(l.source_channel);
    }
    return Array.from(set).sort();
  }, [leads]);

  const hasActiveFilters = !!(
    nameFilter.trim() ||
    typeFilter ||
    stageFilter ||
    assigneeFilter ||
    channelFilter ||
    identityFilter.trim()
  );

  const filtered = useMemo(() => {
    return leads.filter((l) => {
      if (typeFilter === "group" && l.chat_type !== "group") return false;
      if (typeFilter === "bot" && l.chat_type !== "bot") return false;
      if (typeFilter === "pv" && (l.chat_type === "group" || l.chat_type === "bot"))
        return false;
      if (stageFilter && l.stage !== stageFilter) return false;
      if (assigneeFilter === "__none__" && l.assignee_id) return false;
      if (
        assigneeFilter &&
        assigneeFilter !== "__none__" &&
        l.assignee_id !== assigneeFilter
      ) {
        return false;
      }
      if (channelFilter === "__none__" && l.source_channel) return false;
      if (
        channelFilter &&
        channelFilter !== "__none__" &&
        l.source_channel !== channelFilter
      ) {
        return false;
      }
      const idNeedle = identityFilter.trim().toLowerCase().replace(/[\s\-()]/g, "");
      if (idNeedle) {
        const idHay = [l.phone, l.external_chat_id, l.group_id]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .replace(/[\s\-()]/g, "");
        if (!idHay.includes(idNeedle)) return false;
      }
      const nameNeedle = nameFilter.trim().toLowerCase();
      if (nameNeedle && !l.name.toLowerCase().includes(nameNeedle)) return false;
      return true;
    });
  }, [leads, nameFilter, typeFilter, stageFilter, assigneeFilter, channelFilter, identityFilter]);

  function clearFilters() {
    setNameFilter("");
    setTypeFilter("");
    setStageFilter("");
    setAssigneeFilter("");
    setChannelFilter("");
    setIdentityFilter("");
  }

  function openCreate() {
    setEditingLead(null);
    setEditForm(emptyForm());
    setFormOpen(true);
  }

  function openContact(l: Lead, withTask = true) {
    setDetailLead(l);
    setOpenTaskComposer(withTask);
  }

  function closeDetail() {
    setDetailLead(null);
    setOpenTaskComposer(false);
    if (searchParams.get("lead")) router.replace("/leads");
  }

  function closeForm() {
    setFormOpen(false);
    setEditingLead(null);
    setEditForm(null);
  }

  async function saveForm() {
    if (!editForm) return;
    if (!editForm.name.trim()) {
      toast.push("نام لید لازم است", "err");
      return;
    }
    const tags = editForm.tags
      .split(/[,،]/)
      .map((t) => t.trim())
      .filter(Boolean);
    const payload = {
      name: editForm.name.trim(),
      phone: editForm.chat_type === "group" ? "" : editForm.phone.trim(),
      group_id: editForm.chat_type === "group" ? editForm.group_id.trim() : "",
      chat_type: editForm.chat_type,
      stage: editForm.stage,
      notes: editForm.notes,
      tags,
      bot_paused: editForm.bot_paused,
      assignee_id: editForm.assignee_id || null
    };
    const ok = editingLead
      ? await run(
          () =>
            api(`/leads/${editingLead.id}`, {
              method: "PATCH",
              body: JSON.stringify(payload)
            }),
          { success: "لید ویرایش شد" }
        )
      : await run(
          () =>
            api("/leads", {
              method: "POST",
              body: JSON.stringify(payload)
            }),
          { success: "لید افزوده شد" }
        );
    if (ok) {
      closeForm();
      await load();
    }
  }

  useEffect(() => {
    setDetailLead((prev) => {
      if (!prev) return prev;
      return leads.find((x) => x.id === prev.id) || null;
    });
  }, [leads]);

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

  async function setBotPaused(leadId: string, paused: boolean) {
    await run(
      () =>
        api(`/leads/${leadId}`, {
          method: "PATCH",
          body: JSON.stringify({ bot_paused: paused })
        }),
      { success: paused ? "ربات متوقف شد" : "ربات دوباره فعال شد" }
    );
    await load();
  }

  function openDeleteConfirm(l: Lead) {
    setDeleteTarget(l);
    setDeleteConfirmName("");
  }

  function closeDeleteConfirm() {
    setDeleteTarget(null);
    setDeleteConfirmName("");
  }

  const deleteNameMatches =
    !!deleteTarget && deleteConfirmName.trim() === deleteTarget.name.trim();

  async function confirmDeleteLead() {
    if (!deleteTarget || !deleteNameMatches) return;
    const l = deleteTarget;
    const ok = await run(
      () => api(`/leads/${l.id}`, { method: "DELETE" }),
      { success: "لید حذف شد" }
    );
    if (ok) {
      closeDeleteConfirm();
      if (editingLead?.id === l.id) closeForm();
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
      closeForm();
      await load();
    }
  }

  async function mergeWaDuplicates() {
    const ok = await run(
      () => api<{ ok: boolean; merged: number }>("/leads/merge-wa-duplicates", { method: "POST" }),
      { success: "ادغام تکراری‌ها انجام شد" }
    );
    if (ok) await load();
  }

  const isEditing = !!editingLead;
  return (
    <Shell
      title="مخاطبین"
      sub="فهرست مخاطبین — روی نام کلیک کنید تا جزئیات باز شود و برایش وظیفه بسازید"
      search={nameFilter}
      onSearch={setNameFilter}
    >
      {loading ? (
        <PageLoading variant="list" />
      ) : (
        <>
          <Card
            title={`فهرست (${filtered.length}${filtered.length !== leads.length ? ` از ${leads.length}` : ""})`}
            help={{
              title: "فهرست لیدها",
              body: "همه سرنخ‌های مشترک تیم. روی نام کلیک کنید تا جزئیات باز شود.",
              tips: [
                "فیلترها بالای جدول هستند — سرستون‌ها خلوت مانده‌اند.",
                "«ادغام تکراری واتساپ» لیدهای LID و شماره را یکی می‌کند.",
                "پاک‌سازی همه فقط برای مدیر/مالک است و برگشت‌پذیر نیست."
              ]
            }}
            actions={
              <div className="row-actions">
                <Button size="sm" onClick={openCreate}>
                  افزودن لید
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={busy}
                  disabled={leads.length === 0}
                  onClick={() => void mergeWaDuplicates()}
                >
                  ادغام تکراری واتساپ
                </Button>
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
            {leads.length === 0 ? (
              <EmptyState
                title="هنوز لیدی نیست"
                text="از صفحه کانال‌ها واتساپ یا دیوار یا بله را وصل کنید، یا با دکمه «افزودن لید» یک مخاطب بسازید."
              />
            ) : (
              <>
                <div className="leads-toolbar">
                  <label className="leads-toolbar-field">
                    <span>نوع</span>
                    <select
                      value={typeFilter}
                      onChange={(e) => setTypeFilter(e.target.value)}
                      aria-label="فیلتر نوع"
                    >
                      <option value="">همه</option>
                      <option value="pv">مخاطب</option>
                      <option value="group">گروه</option>
                      <option value="bot">ربات</option>
                    </select>
                  </label>
                  <label className="leads-toolbar-field">
                    <span>کانال</span>
                    <select
                      value={channelFilter}
                      onChange={(e) => setChannelFilter(e.target.value)}
                      aria-label="فیلتر کانال"
                    >
                      <option value="">همه</option>
                      <option value="__none__">بدون کانال</option>
                      {channelOptions.map((ch) => (
                        <option key={ch} value={ch}>
                          {CHANNEL_LABELS[ch] || ch}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="leads-toolbar-field">
                    <span>مرحله</span>
                    <select
                      value={stageFilter}
                      onChange={(e) => setStageFilter(e.target.value)}
                      aria-label="فیلتر مرحله"
                    >
                      <option value="">همه</option>
                      {STAGES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="leads-toolbar-field">
                    <span>ارجاع</span>
                    <select
                      value={assigneeFilter}
                      onChange={(e) => setAssigneeFilter(e.target.value)}
                      aria-label="فیلتر ارجاع"
                    >
                      <option value="">همه</option>
                      <option value="__none__">بدون ارجاع</option>
                      {members.map((m) => (
                        <option key={m.user_id} value={m.user_id}>
                          {memberLabel(m)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="leads-toolbar-field leads-toolbar-grow">
                    <span>تلفن / شناسه</span>
                    <input
                      className="ltr-text"
                      dir="ltr"
                      type="text"
                      value={identityFilter}
                      onChange={(e) => setIdentityFilter(e.target.value)}
                      placeholder="جستجوی شماره یا شناسه مخاطب…"
                      aria-label="فیلتر تلفن یا شناسه مخاطب"
                    />
                  </label>
                  {hasActiveFilters ? (
                    <Button variant="secondary" size="sm" onClick={clearFilters}>
                      پاک فیلتر
                    </Button>
                  ) : null}
                </div>

                <div className="leads-desktop-only" style={{ overflow: "auto" }}>
                  <table className="leads-table leads-table-compact">
                    <thead>
                      <tr>
                        <th>نام</th>
                        <th>نوع</th>
                        <th>تلفن</th>
                        <th>شناسه مخاطب</th>
                        <th>کانال</th>
                        <th>مرحله</th>
                        <th>ارجاع</th>
                        <th aria-label="عملیات" />
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.length === 0 ? (
                        <tr>
                          <td colSpan={8} style={{ textAlign: "center", padding: "28px 12px" }}>
                            <span style={{ color: "var(--muted)", fontWeight: 600 }}>
                              نتیجه‌ای با این فیلتر نیست — فیلترها را تغییر دهید.
                            </span>
                          </td>
                        </tr>
                      ) : (
                        filtered.map((l) => {
                          const tags = l.tags || [];
                          const visibleTags = tags.slice(0, 2);
                          const extraTags = tags.length - visibleTags.length;
                          return (
                            <tr key={l.id}>
                              <td>
                                <button
                                  type="button"
                                  className="lead-name-link"
                                  onClick={() => openContact(l)}
                                >
                                  <strong>{leadDisplayName(l)}</strong>
                                </button>
                                <div className="lead-row-meta">
                                  {l.bot_paused ? (
                                    <button
                                      type="button"
                                      className="lead-bot-paused-chip"
                                      title="کلیک برای شروع دوباره ربات"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        void setBotPaused(l.id, false);
                                      }}
                                    >
                                      ربات متوقف
                                    </button>
                                  ) : null}
                                  {visibleTags.map((t) => (
                                    <Link
                                      key={t}
                                      className="lead-tag-link"
                                      href={tasksByTagHref(t)}
                                      title={`وظایف با برچسب ${tagLabel(t)}`}
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <Badge tone="accent">{tagLabel(t)}</Badge>
                                    </Link>
                                  ))}
                                  {extraTags > 0 ? (
                                    <button
                                      type="button"
                                      className="lead-tag-more"
                                      aria-label="برچسب‌های بیشتر"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openTagsPop(l);
                                      }}
                                    >
                                      +{extraTags}
                                    </button>
                                  ) : null}
                                  {(l.lead_score || 0) > 0 ? (
                                    <span className="lead-score-pill">
                                      {Math.round(l.lead_score || 0)}
                                    </span>
                                  ) : null}
                                </div>
                              </td>
                              <td>
                                {l.chat_type === "group" ? (
                                  <Badge tone="accent">گروه</Badge>
                                ) : l.chat_type === "bot" ? (
                                  <Badge tone="accent">ربات</Badge>
                                ) : (
                                  <span className="muted-cell">مخاطب</span>
                                )}
                              </td>
                              <td>
                                <LtrText>{leadPhone(l) || "—"}</LtrText>
                              </td>
                              <td>
                                <LtrText className="muted-cell">
                                  {l.chat_type === "group"
                                    ? l.group_id || "—"
                                    : leadContactId(l) || "—"}
                                </LtrText>
                              </td>
                              <td>
                                {l.source_channel ? (
                                  <ChannelBadge channel={l.source_channel} />
                                ) : (
                                  <span className="muted-cell">—</span>
                                )}
                              </td>
                              <td>
                                <div className="row-actions">
                                  <span className={`stage-dot ${STAGE_DOT[l.stage] || "new"}`} />
                                  <select
                                    value={l.stage}
                                    onChange={(e) => setStage(l.id, e.target.value)}
                                    style={{ width: "auto", minWidth: 96 }}
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
                              <td className="leads-actions-cell">
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  aria-haspopup="menu"
                                  aria-label={`عملیات ${leadDisplayName(l)}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openRowMenu(l);
                                  }}
                                >
                                  ⋯
                                </Button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="leads-mobile-only">
                  {filtered.length === 0 ? (
                    <EmptyState
                      title="نتیجه‌ای نیست"
                      text="فیلترها را تغییر دهید یا مخاطب جدید اضافه کنید."
                    />
                  ) : (
                    <div className="leads-card-list">
                      {filtered.map((l) => {
                        const tags = l.tags || [];
                        const assignee = members.find((m) => m.user_id === l.assignee_id);
                        return (
                          <article key={l.id} className="leads-card">
                            <div className="leads-card-top">
                              <div>
                                <button
                                  type="button"
                                  className="lead-name-link"
                                  onClick={() => openContact(l)}
                                >
                                  <h3 className="leads-card-name">{leadDisplayName(l)}</h3>
                                </button>
                                <div className="leads-card-meta">
                                  {l.source_channel ? (
                                    <ChannelBadge channel={l.source_channel} />
                                  ) : null}
                                  <span className={`stage-dot ${STAGE_DOT[l.stage] || "new"}`} />
                                  <span>{l.stage}</span>
                                  {l.bot_paused ? <Badge tone="danger">ربات متوقف</Badge> : null}
                                </div>
                              </div>
                              <Button
                                variant="secondary"
                                size="sm"
                                aria-label="عملیات"
                                onClick={() => openRowMenu(l)}
                              >
                                ⋯
                              </Button>
                            </div>
                            <div className="leads-card-meta">
                              {leadPhone(l) ? <LtrText>{leadPhone(l)}</LtrText> : null}
                              {assignee ? <span>{memberLabel(assignee)}</span> : <span>بدون ارجاع</span>}
                            </div>
                            {tags.length > 0 ? (
                              <div className="leads-card-meta">
                                {tags.slice(0, 4).map((t) => (
                                  <Link key={t} href={tasksByTagHref(t)}>
                                    <Badge tone="accent">{tagLabel(t)}</Badge>
                                  </Link>
                                ))}
                                {tags.length > 4 ? (
                                  <button
                                    type="button"
                                    className="lead-tag-more"
                                    onClick={() => openTagsPop(l)}
                                  >
                                    +{tags.length - 4}
                                  </button>
                                ) : null}
                              </div>
                            ) : null}
                            <div className="leads-card-actions">
                              <Button size="sm" variant="secondary" onClick={() => openContact(l)}>
                                جزئیات
                              </Button>
                              <Button size="sm" onClick={() => openContact(l, true)}>
                                وظیفه
                              </Button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </Card>

          <ActionSheet
            open={!!menuLead}
            title={menuLead ? leadDisplayName(menuLead) : undefined}
            onClose={() => setMenuLead(null)}
            items={
              menuLead
                ? [
                    {
                      id: "detail",
                      label: "جزئیات",
                      onSelect: () => openContact(menuLead, false)
                    },
                    {
                      id: "task",
                      label: "وظیفه جدید",
                      onSelect: () => openContact(menuLead, true)
                    },
                    {
                      id: "board",
                      label: "برد وظایف",
                      href: tasksBoardHref(menuLead.id)
                    },
                    {
                      id: "bot",
                      label: menuLead.bot_paused ? "شروع ربات" : "توقف ربات",
                      disabled: busy,
                      onSelect: () => void setBotPaused(menuLead.id, !menuLead.bot_paused)
                    },
                    {
                      id: "delete",
                      label: "حذف",
                      tone: "danger",
                      onSelect: () => openDeleteConfirm(menuLead)
                    }
                  ]
                : []
            }
          />

          <ActionSheet
            open={!!tagsPop}
            title="برچسب‌ها"
            onClose={() => setTagsPop(null)}
            items={
              tagsPop
                ? (tagsPop.tags || []).map((t) => ({
                    id: t,
                    label: tagLabel(t),
                    href: tasksByTagHref(t)
                  }))
                : []
            }
          />

          <Modal
            open={formOpen && !!editForm}
            title={isEditing ? `ویرایش: ${editingLead?.name}` : "افزودن لید"}
            onClose={closeForm}
            presentation="sheet"
            footer={
              <>
                <Button loading={busy} onClick={saveForm}>
                  {isEditing ? "ذخیره" : "افزودن"}
                </Button>
                <Button variant="secondary" onClick={closeForm}>
                  انصراف
                </Button>
                {isEditing && editingLead ? (
                  <Button variant="danger" onClick={() => openDeleteConfirm(editingLead)}>
                    حذف لید
                  </Button>
                ) : null}
              </>
            }
          >
            {editForm ? (
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
                      className="ltr-text"
                      dir="ltr"
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
                      className="ltr-text"
                      dir="ltr"
                      value={editForm.phone}
                      onChange={(e) =>
                        setEditForm({ ...editForm, phone: e.target.value })
                      }
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
                <Switch
                  full
                  label="ربات فعال برای این چت"
                  hint="وقتی خاموش باشد، پاسخ خودکار برای این مخاطب/گروه متوقف می‌شود."
                  checked={!editForm.bot_paused}
                  onChange={(active) =>
                    setEditForm({ ...editForm, bot_paused: !active })
                  }
                />
              </div>
            ) : null}
          </Modal>

          <Modal
            open={!!deleteTarget}
            title="تأیید حذف لید"
            onClose={closeDeleteConfirm}
            presentation="sheet"
            footer={
              <>
                <Button
                  variant="danger"
                  loading={busy}
                  disabled={!deleteNameMatches}
                  onClick={confirmDeleteLead}
                >
                  حذف قطعی
                </Button>
                <Button variant="secondary" onClick={closeDeleteConfirm}>
                  انصراف
                </Button>
              </>
            }
          >
            {deleteTarget ? (
              <div className="delete-confirm-body">
                <p className="delete-confirm-text">
                  حذف «<strong>{deleteTarget.name}</strong>» برگشت‌پذیر نیست. پیام‌ها و
                  جاب‌های مرتبط هم پاک می‌شوند.
                </p>
                <label>
                  برای تأیید، نام مخاطب را دقیقاً بنویسید
                  <input
                    value={deleteConfirmName}
                    onChange={(e) => setDeleteConfirmName(e.target.value)}
                    placeholder={deleteTarget.name}
                    autoFocus
                  />
                </label>
              </div>
            ) : null}
          </Modal>
          <LeadModal
            open={!!detailLead}
            lead={detailLead}
            members={members}
            startWithTaskComposer={openTaskComposer}
            onClose={closeDetail}
            onChanged={load}
          />
        </>      )}
    </Shell>
  );
}
