"use client";

import { useEffect, useMemo, useState } from "react";
import Shell from "@/components/Shell";
import { Button } from "@/components/ui/Button";
import { Badge, Card, EmptyState } from "@/components/ui/Card";
import { Switch } from "@/components/ui/Switch";
import { PageLoading } from "@/components/ui/Spinner";
import { STAGES, TAG_LABELS_FA, tagLabel } from "@/components/crm/shared";
import { api } from "@/lib/api";
import { useMutation } from "@/lib/useApi";
import { useToast } from "@/components/ui/Toast";

type Account = {
  id: string;
  label?: string;
  channel?: string;
  phone?: string;
};

type Campaign = {
  id: string;
  name: string;
  status: string;
  segment: {
    tags?: string[];
    stages?: string[];
    min_score?: number;
    include_groups?: boolean;
  };
  message_template: string;
  channel_account_id: string | null;
  sends_total: number;
  sends_queued: number;
  sends_sent: number;
  sends_failed: number;
  sends_skipped: number;
  audience_count?: number;
};

const STATUS_FA: Record<string, string> = {
  draft: "پیش‌نویس",
  running: "در حال ارسال",
  paused: "متوقف",
  done: "تمام‌شده",
  queued: "در صف"
};

const STATUS_TONE: Record<string, "default" | "accent" | "success" | "danger"> = {
  draft: "default",
  running: "accent",
  paused: "danger",
  done: "success",
  queued: "accent"
};

const TAG_KEYS = Object.keys(TAG_LABELS_FA).filter((k) => k !== "handoff");

export default function CampaignsPage() {
  const [rows, setRows] = useState<Campaign[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [accountId, setAccountId] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [stages, setStages] = useState<string[]>([]);
  const [minScore, setMinScore] = useState(0);
  const [includeGroups, setIncludeGroups] = useState(false);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const { busy, run } = useMutation();
  const toast = useToast();

  async function load() {
    setLoading(true);
    try {
      const [camps, accs] = await Promise.all([
        api<Campaign[]>("/campaigns"),
        api<Account[]>("/channels/accounts").catch(() => [] as Account[])
      ]);
      setRows(camps);
      setAccounts(accs);
      if (!accountId && accs[0]?.id) setAccountId(accs[0].id);
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep progress alive while campaigns are sending — survives route leave/return via API
  const needsPoll = rows.some(
    (c) =>
      c.status === "running" ||
      c.status === "queued" ||
      c.sends_queued > 0
  );
  useEffect(() => {
    if (!needsPoll) return;
    const id = window.setInterval(() => {
      void api<Campaign[]>("/campaigns")
        .then((camps) => setRows(camps))
        .catch(() => undefined);
    }, 2500);
    return () => window.clearInterval(id);
  }, [needsPoll]);

  const accountLabel = useMemo(() => {
    const map: Record<string, string> = {};
    for (const a of accounts) {
      map[a.id] = a.label || a.phone || a.channel || a.id.slice(0, 8);
    }
    return map;
  }, [accounts]);

  function toggleTag(key: string) {
    setTags((cur) => (cur.includes(key) ? cur.filter((t) => t !== key) : [...cur, key]));
  }

  function toggleStage(stage: string) {
    setStages((cur) => (cur.includes(stage) ? cur.filter((s) => s !== stage) : [...cur, stage]));
  }

  async function create() {
    if (!name.trim() || !message.trim()) {
      toast.push("نام و متن پیام لازم است", "err");
      return;
    }
    if (!accountId) {
      toast.push("اکانت کانال را انتخاب کنید", "err");
      return;
    }
    const ok = await run(
      () =>
        api("/campaigns", {
          method: "POST",
          body: JSON.stringify({
            name: name.trim(),
            message_template: message.trim(),
            channel_account_id: accountId,
            segment: {
              tags,
              stages,
              min_score: minScore,
              include_groups: includeGroups
            }
          })
        }),
      { success: "کمپین ساخته شد" }
    );
    if (ok) {
      setName("");
      setMessage("");
      setTags([]);
      setStages([]);
      setMinScore(0);
      setPreviewCount(null);
      await load();
    }
  }

  async function start(id: string) {
    const ok = await run(
      () => api(`/campaigns/${id}/start`, { method: "POST" }),
      { success: "ارسال کمپین شروع شد" }
    );
    if (ok) await load();
  }

  async function pause(id: string) {
    const ok = await run(
      () => api(`/campaigns/${id}/pause`, { method: "POST" }),
      { success: "کمپین متوقف شد" }
    );
    if (ok) await load();
  }

  async function remove(id: string) {
    const ok = await run(
      () => api(`/campaigns/${id}`, { method: "DELETE" }),
      { success: "کمپین حذف شد" }
    );
    if (ok) await load();
  }

  async function previewExisting(id: string) {
    const prev = await run(
      () => api<{ count: number }>(`/campaigns/${id}/preview`, { method: "POST" }),
      { silent: true }
    );
    if (prev) {
      toast.push(`${prev.count} مخاطب مطابق فیلتر`, "ok");
      await load();
    }
  }

  async function previewDraft() {
    if (!name.trim() || !message.trim() || !accountId) {
      toast.push("ابتدا فرم را کامل کنید و کمپین بسازید، سپس پیش‌نمایش از لیست", "err");
      return;
    }
    try {
      const created = await api<Campaign>("/campaigns", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          message_template: message.trim(),
          channel_account_id: accountId,
          segment: { tags, stages, min_score: minScore, include_groups: includeGroups }
        })
      });
      const prev = await api<{ count: number }>(`/campaigns/${created.id}/preview`, {
        method: "POST"
      });
      setPreviewCount(prev.count);
      await load();
      toast.push(`${prev.count} مخاطب با این فیلتر`, "ok");
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    }
  }

  return (
    <Shell title="کمپین‌ها" sub="ارسال یک‌باره پیام به سگمنت برچسب / مرحله / امتیاز">
      {loading ? (
        <PageLoading />
      ) : (
        <>
          <Card title="کمپین جدید">
            <div className="form-grid" style={{ gap: 12 }}>
              <label className="full">
                نام کمپین
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="مثلاً پیگیری قصد خرید بالا"
                />
              </label>
              <label className="full">
                اکانت کانال
                <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                  <option value="">انتخاب کنید</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {accountLabel[a.id]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="full">
                متن پیام
                <textarea
                  rows={4}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="سلام {{name}}، …"
                />
                <span className="hint">
                  جای‌نگهدار: {"{{name}}"} با نام مخاطب و {"{{phone}}"} با شماره جایگزین می‌شود
                </span>
              </label>
              <div className="full">
                <strong>برچسب‌ها</strong>
                <div className="hint" style={{ marginTop: 4 }}>
                  خالی = همه مخاطبین · انتخاب‌شده = حداقل یکی از این برچسب‌ها
                </div>
                <div className="ai-stage-chips" style={{ marginTop: 8 }}>
                  {TAG_KEYS.map((key) => (
                    <button
                      key={key}
                      type="button"
                      className={`ai-stage-chip${tags.includes(key) ? " active" : ""}`}
                      onClick={() => toggleTag(key)}
                    >
                      {tagLabel(key)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="full">
                <strong>مراحل</strong>
                <div className="hint" style={{ marginTop: 4 }}>
                  خالی = همه مراحل
                </div>
                <div className="ai-stage-chips" style={{ marginTop: 8 }}>
                  {STAGES.map((stage) => (
                    <button
                      key={stage}
                      type="button"
                      className={`ai-stage-chip${stages.includes(stage) ? " active" : ""}`}
                      onClick={() => toggleStage(stage)}
                    >
                      {stage}
                    </button>
                  ))}
                </div>
              </div>
              <div className="full campaigns-actions-row">
                <label className="campaigns-actions-field">
                  حداقل امتیاز AI
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={minScore}
                    onChange={(e) => setMinScore(Number(e.target.value) || 0)}
                  />
                </label>
                <Switch
                  className="campaigns-actions-switch"
                  label="شامل گروه‌ها"
                  checked={includeGroups}
                  onChange={setIncludeGroups}
                />
                <div className="campaigns-actions-btns">
                  <Button loading={busy} onClick={() => void create()}>
                    ذخیره پیش‌نویس
                  </Button>
                  <Button variant="secondary" loading={busy} onClick={() => void previewDraft()}>
                    ذخیره و شمارش مخاطب
                    {previewCount != null ? ` (${previewCount})` : ""}
                  </Button>
                </div>
              </div>
            </div>
          </Card>

          <Card title="کمپین‌های موجود">
            {rows.length === 0 ? (
              <EmptyState title="کمپینی نیست" text="اولین کمپین nurture را بسازید." />
            ) : (
              <div className="campaign-list">
                {rows.map((c) => {
                  const audience = c.audience_count ?? 0;
                  const total = Math.max(c.sends_total, 0);
                  const done = c.sends_sent + c.sends_failed + c.sends_skipped;
                  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
                  const showProgress =
                    total > 0 || c.status === "running" || c.status === "queued";
                  const anyActive = rows.some(
                    (x) => x.status === "running" || x.status === "queued"
                  );
                  const canStart =
                    (c.status === "draft" || c.status === "paused" || c.status === "done") &&
                    audience > 0 &&
                    !anyActive;
                  return (
                    <article key={c.id} className="campaign-card">
                      <div className="campaign-card-body">
                        <div className="campaign-card-head">
                          <h3 className="campaign-card-title">{c.name}</h3>
                          <Badge tone={STATUS_TONE[c.status] || "default"}>
                            {STATUS_FA[c.status] || c.status}
                          </Badge>
                        </div>
                        <div className="campaign-card-meta">
                          <span>{accountLabel[c.channel_account_id || ""] || "بدون اکانت"}</span>
                          <span className="campaign-card-dot">·</span>
                          <span>
                            مخاطب هدف: <strong>{audience}</strong>
                          </span>
                          {total > 0 ? (
                            <>
                              <span className="campaign-card-dot">·</span>
                              <span>
                                ارسال {total} (موفق {c.sends_sent} / ناموفق {c.sends_failed} /
                                صف {c.sends_queued}
                                {c.sends_skipped ? ` / رد ${c.sends_skipped}` : ""})
                              </span>
                            </>
                          ) : null}
                        </div>
                        {showProgress ? (
                          <div
                            className="campaign-progress"
                            role="progressbar"
                            aria-valuenow={pct}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label={`پیشرفت ارسال ${pct} درصد`}
                          >
                            <div className="campaign-progress-track">
                              <div
                                className={`campaign-progress-fill${
                                  c.sends_failed > 0 ? " has-fail" : ""
                                }${c.status === "done" ? " done" : ""}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <div className="campaign-progress-legend">
                              <span>
                                {done} از {total || "—"}
                              </span>
                              <span>{pct}٪</span>
                            </div>
                          </div>
                        ) : null}
                        <div className="campaign-card-tags">
                          {(c.segment.tags || []).map((t) => (
                            <span key={t} className="campaign-chip">
                              {tagLabel(t)}
                            </span>
                          ))}
                          {(c.segment.stages || []).map((s) => (
                            <span key={s} className="campaign-chip stage">
                              {s}
                            </span>
                          ))}
                          {(c.segment.min_score || 0) > 0 ? (
                            <span className="campaign-chip">امتیاز ≥ {c.segment.min_score}</span>
                          ) : null}
                          {c.segment.include_groups ? (
                            <span className="campaign-chip">شامل گروه</span>
                          ) : null}
                        </div>
                        <p className="campaign-card-msg" dir="auto">
                          {c.message_template}
                        </p>
                      </div>
                      <div className="campaign-card-actions">
                        {c.status === "draft" || c.status === "paused" || c.status === "done" ? (
                          <Button
                            className="campaign-action-btn"
                            size="sm"
                            loading={busy}
                            disabled={!canStart}
                            title={
                              anyActive
                                ? "تا پایان کمپین در حال اجرا صبر کنید"
                                : audience === 0
                                  ? "مخاطبی نیست"
                                  : undefined
                            }
                            onClick={() => void start(c.id)}
                          >
                            شروع ارسال
                          </Button>
                        ) : null}
                        {c.status === "running" ? (
                          <Button
                            className="campaign-action-btn"
                            size="sm"
                            variant="secondary"
                            loading={busy}
                            onClick={() => void pause(c.id)}
                          >
                            توقف
                          </Button>
                        ) : null}
                        <Button
                          className="campaign-action-btn"
                          size="sm"
                          variant="secondary"
                          loading={busy}
                          onClick={() => void previewExisting(c.id)}
                        >
                          شمارش مخاطب
                        </Button>
                        <Button
                          className="campaign-action-btn"
                          size="sm"
                          variant="danger"
                          loading={busy}
                          onClick={() => void remove(c.id)}
                        >
                          حذف
                        </Button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </Card>
        </>
      )}
    </Shell>
  );
}
