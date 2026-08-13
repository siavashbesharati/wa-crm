"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Shell from "@/components/Shell";
import { Badge, Card, EmptyState } from "@/components/ui/Card";
import { PageLoading } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { useMutation } from "@/lib/useApi";
import { useToast } from "@/components/ui/Toast";
import { LeadModal } from "@/components/crm/LeadModal";
import {
  buildBoardReorder,
  leadsInStage,
  type BoardOrderUpdate
} from "@/components/crm/lead-form";
import {
  CrmViewToggle,
  STAGES,
  STAGE_DOT,
  LtrText,
  type CrmTask,
  type Lead,
  type Member,
  memberLabel,
  initials
} from "@/components/crm/shared";

export default function PipelinePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [openTasks, setOpenTasks] = useState<CrmTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  const [overCardId, setOverCardId] = useState<string | null>(null);
  const [dropBefore, setDropBefore] = useState(true);
  const [detailLead, setDetailLead] = useState<Lead | null>(null);
  const dragMovedRef = useRef(false);
  const { busy, run } = useMutation();
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [l, m, t] = await Promise.all([
        api<Lead[]>("/leads"),
        api<Member[]>("/orgs/members"),
        api<CrmTask[]>("/tasks?status=open")
      ]);
      setLeads(l);
      setMembers(m);
      setOpenTasks(t);
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
    const id = searchParams.get("lead");
    if (!id || leads.length === 0) return;
    const found = leads.find((l) => l.id === id);
    if (found) setDetailLead(found);
  }, [searchParams, leads]);

  useEffect(() => {
    setDetailLead((prev) => {
      if (!prev) return prev;
      return leads.find((l) => l.id === prev.id) || null;
    });
  }, [leads]);

  const taskCountByLead = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of openTasks) {
      if (!t.lead_id) continue;
      map.set(t.lead_id, (map.get(t.lead_id) || 0) + 1);
    }
    return map;
  }, [openTasks]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return leads;
    return leads.filter(
      (l) =>
        l.name.toLowerCase().includes(needle) ||
        (l.phone || "").includes(needle) ||
        (l.tags || []).some((t) => t.toLowerCase().includes(needle))
    );
  }, [leads, q]);

  async function persistBoardOrder(updates: BoardOrderUpdate[], prev: Lead[]) {
    if (updates.length === 0) return;
    const ok = await run(
      () =>
        api("/leads/board-order", {
          method: "POST",
          body: JSON.stringify({ updates })
        }),
      { silent: true }
    );
    if (!ok) {
      setLeads(prev);
      toast.push("ترتیب کارت‌ها ذخیره نشد", "err");
    }
  }

  async function applyBoardDrop(
    dragLeadId: string,
    targetStage: string,
    targetId: string | null,
    insertBefore: boolean
  ) {
    const prev = leads;
    const { next, updates } = buildBoardReorder(
      leads,
      dragLeadId,
      targetStage,
      targetId,
      insertBefore
    );
    if (updates.length === 0) return;

    const merged = leads.map((l) => next.find((n) => n.id === l.id) || l);
    setLeads(merged);
    await persistBoardOrder(updates, prev);
  }

  function resetDragState() {
    setDragId(null);
    setOverStage(null);
    setOverCardId(null);
    setDropBefore(true);
  }

  function handleCardDragOver(
    e: React.DragEvent<HTMLDivElement>,
    stage: string,
    cardId: string
  ) {
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    setOverStage(stage);
    setOverCardId(cardId);
    setDropBefore(before);
  }

  return (
    <Shell
      title="برد کانبان"
      sub="کارت‌ها را بکشید برای تغییر مرحله یا اولویت — روی کارت کلیک کنید برای جزئیات"
      search={q}
      onSearch={setQ}
      actions={<CrmViewToggle mode="board" />}
    >
      {loading ? (
        <PageLoading />
      ) : filtered.length === 0 ? (
        <Card
          help={{
            title: "برد کانبان",
            body: "نمای کانبان مراحل فروش. کارت‌ها را بکشید تا مرحله یا اولویت لید عوض شود."
          }}
        >
          <EmptyState
            title="لیدی برای نمایش نیست"
            text="از صفحه لیدها بسازید یا افزونه را همگام کنید."
            action={
              <Link className="btn secondary" href="/leads">
                رفتن به لیست لیدها
              </Link>
            }
          />
        </Card>
      ) : (
        <div className="pipeline">
          {STAGES.map((stage) => {
            const items = leadsInStage(filtered, stage);
            return (
              <div
                key={stage}
                className={`pipeline-col ${overStage === stage && !overCardId ? "drag-over" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOverStage(stage);
                  setOverCardId(null);
                }}
                onDragLeave={() => {
                  setOverStage((s) => (s === stage ? null : s));
                  setOverCardId(null);
                }}
                onDrop={async (e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData("text/lead-id") || dragId;
                  const targetStage = stage;
                  const targetId = overCardId;
                  const insertBefore = dropBefore;
                  resetDragState();
                  if (id) {
                    await applyBoardDrop(id, targetStage, targetId, insertBefore);
                  }
                }}
              >
                <div className="pipeline-col-head">
                  <h3>
                    <span className={`stage-dot ${STAGE_DOT[stage] || "new"}`} />
                    {stage}
                  </h3>
                  <span className="col-count">{items.length}</span>
                </div>
                {items.map((l) => {
                  const assignee = members.find((m) => m.user_id === l.assignee_id);
                  const isDropTarget = overCardId === l.id;
                  return (
                    <div
                      key={l.id}
                      className={`pipeline-card ${dragId === l.id ? "dragging" : ""}${
                        isDropTarget ? (dropBefore ? " drop-before" : " drop-after") : ""
                      }`}
                      draggable={!busy}
                      onDragStart={(e) => {
                        dragMovedRef.current = false;
                        setDragId(l.id);
                        e.dataTransfer.setData("text/lead-id", l.id);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDrag={(e) => {
                        if (e.clientX !== 0 || e.clientY !== 0) {
                          dragMovedRef.current = true;
                        }
                      }}
                      onDragOver={(e) => handleCardDragOver(e, stage, l.id)}
                      onDrop={async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const id = e.dataTransfer.getData("text/lead-id") || dragId;
                        resetDragState();
                        if (id && id !== l.id) {
                          await applyBoardDrop(id, stage, l.id, dropBefore);
                        }
                      }}
                      onDragEnd={resetDragState}
                      onClick={() => {
                        if (dragMovedRef.current) return;
                        setDetailLead(l);
                      }}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setDetailLead(l);
                        }
                      }}
                    >
                      <p className="card-title">{l.name}</p>
                      <div className="card-meta">
                        {(l.phone || l.group_id) && (
                          <Badge>
                            <LtrText>{l.phone || l.group_id}</LtrText>
                          </Badge>
                        )}
                        {(taskCountByLead.get(l.id) || 0) > 0 ? (
                          <Badge tone="accent">
                            {taskCountByLead.get(l.id)} وظیفه
                          </Badge>
                        ) : null}
                        {(l.tags || []).slice(0, 2).map((t) => (
                          <Badge key={t} tone="accent">
                            {t}
                          </Badge>
                        ))}
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
                          style={{ width: "auto", maxWidth: 110, padding: "4px 6px", fontSize: 11 }}
                          value={l.stage}
                          onChange={(e) => {
                            void applyBoardDrop(l.id, e.target.value, null, true);
                          }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {STAGES.map((s) => (
                            <option key={s} value={s}>
                              {s}
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

      <LeadModal
        open={!!detailLead}
        lead={detailLead}
        members={members}
        onClose={() => {
          setDetailLead(null);
          if (searchParams.get("lead")) router.replace("/pipeline");
        }}
        onChanged={load}
      />
    </Shell>
  );
}
