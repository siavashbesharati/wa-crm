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

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [q, setQ] = useState("");
  const [stageFilter, setStageFilter] = useState("");
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

  return (
    <Shell
      title="لیدها"
      sub="لیست مشترک لیدها بین اپراتورها"
      search={q}
      onSearch={setQ}
      actions={<CrmViewToggle mode="list" />}
    >
      <Card title="افزودن لید">
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

      <Card
        title={`فهرست (${filtered.length})`}
        actions={
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
        }
      >
        {loading ? (
          <PageLoading />
        ) : filtered.length === 0 ? (
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
                </tr>
              </thead>
              <tbody>
                {filtered.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <strong>{l.name}</strong>
                      <div className="card-meta" style={{ marginTop: 4 }}>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Shell>
  );
}
