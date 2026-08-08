"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import Shell from "@/components/Shell";
import { Badge, Card, EmptyState } from "@/components/ui/Card";
import { PageLoading } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { useMutation } from "@/lib/useApi";
import { useToast } from "@/components/ui/Toast";
import {
  CrmViewToggle,
  STAGES,
  STAGE_DOT,
  type Lead,
  type Member,
  memberLabel,
  initials
} from "@/components/crm/shared";

export default function PipelinePage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
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
    const needle = q.trim().toLowerCase();
    if (!needle) return leads;
    return leads.filter(
      (l) =>
        l.name.toLowerCase().includes(needle) ||
        (l.phone || "").includes(needle) ||
        (l.tags || []).some((t) => t.toLowerCase().includes(needle))
    );
  }, [leads, q]);

  async function move(id: string, stage: string) {
    const prev = leads;
    setLeads((list) => list.map((l) => (l.id === id ? { ...l, stage } : l)));
    const ok = await run(
      () =>
        api(`/leads/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ stage })
        }),
      { silent: true }
    );
    if (!ok) {
      setLeads(prev);
      toast.push("جابه‌جایی ذخیره نشد", "err");
    }
  }

  return (
    <Shell
      title="پایپلاین فروش"
      sub="کارت‌ها را بین مراحل بکشید — تغییرات فوری ذخیره می‌شود"
      search={q}
      onSearch={setQ}
      actions={<CrmViewToggle mode="board" />}
    >
      {loading ? (
        <PageLoading />
      ) : filtered.length === 0 ? (
        <Card
          help={{
            title: "پایپلاین",
            body: "برد کانبان مراحل فروش. کارت‌ها را بکشید تا مرحله لید عوض شود — ذخیره فوری است."
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
            const items = filtered.filter((l) => l.stage === stage);
            return (
              <div
                key={stage}
                className={`pipeline-col ${overStage === stage ? "drag-over" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOverStage(stage);
                }}
                onDragLeave={() => setOverStage((s) => (s === stage ? null : s))}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData("text/lead-id") || dragId;
                  setOverStage(null);
                  setDragId(null);
                  if (id) move(id, stage);
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
                  return (
                    <div
                      key={l.id}
                      className={`pipeline-card ${dragId === l.id ? "dragging" : ""}`}
                      draggable={!busy}
                      onDragStart={(e) => {
                        setDragId(l.id);
                        e.dataTransfer.setData("text/lead-id", l.id);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setOverStage(null);
                      }}
                    >
                      <p className="card-title">{l.name}</p>
                      <div className="card-meta">
                        {(l.phone || l.group_id) && (
                          <Badge>{l.phone || l.group_id}</Badge>
                        )}
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
                          onChange={(e) => move(l.id, e.target.value)}
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
    </Shell>
  );
}
