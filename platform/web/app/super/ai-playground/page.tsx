"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import SuperShell from "@/components/SuperShell";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Badge, Card } from "@/components/ui/Card";
import { PageLoading } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";

type AiDefaults = {
  provider?: string;
  model?: string;
  gemini_model?: string;
  base_url?: string;
  system_prompt: string;
  llm_configured?: boolean;
  gemini_api_key_configured?: boolean;
  api_key_configured?: boolean;
  active_key_masked?: string;
  gemini_api_key_masked?: string;
  api_key_masked?: string;
};

type Business = {
  org_id: string;
  name: string;
  plan: string;
  status: string;
};

type PlayResult = {
  ok: boolean;
  reply: string;
  confidence: number;
  sources: string[];
  provider: string;
  model: string;
  system_prompt_used: string;
  knowledge_hits: number;
  org_id: string;
  org_name: string;
  elapsed_ms: number;
};

const STAGES = ["جدید", "پیگیری", "پیشنهاد", "خرید", "بسته"];

export default function SuperAiPlaygroundPage() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [cfg, setCfg] = useState<AiDefaults | null>(null);
  const [businesses, setBusinesses] = useState<Business[]>([]);

  const [orgId, setOrgId] = useState("");
  const [message, setMessage] = useState("سلام، قیمت پلن رشد چقدره؟");
  const [leadName, setLeadName] = useState("مشتری تست");
  const [leadStage, setLeadStage] = useState("جدید");
  const [agentRole, setAgentRole] = useState("");
  const [systemOverride, setSystemOverride] = useState("");
  const [useOverride, setUseOverride] = useState(false);
  const [temperature, setTemperature] = useState(0.4);
  const [result, setResult] = useState<PlayResult | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [ai, biz] = await Promise.all([
          api<AiDefaults>("/admin/ai-defaults", { platform: true }),
          api<Business[]>("/admin/businesses", { platform: true }).catch(() => [])
        ]);
        setCfg(ai);
        setBusinesses(biz || []);
      } catch (e) {
        toast.push(e instanceof Error ? e.message : "خطا", "err");
      } finally {
        setLoading(false);
      }
    })();
  }, [toast]);

  async function run() {
    if (!message.trim()) {
      toast.push("پیام مشتری را وارد کنید", "err");
      return;
    }
    if (!cfg?.llm_configured && !cfg?.gemini_api_key_configured && !cfg?.api_key_configured) {
      toast.push("اول سرویس AI را در تنظیمات پیکربندی کنید", "err");
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const res = await api<PlayResult>("/admin/ai-playground", {
        method: "POST",
        platform: true,
        body: JSON.stringify({
          message: message.trim(),
          org_id: orgId,
          lead_name: leadName.trim() || "مشتری تست",
          lead_stage: leadStage,
          agent_role_override: agentRole.trim(),
          system_prompt_override: useOverride ? systemOverride.trim() : "",
          temperature
        })
      });
      setResult(res);
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SuperShell
      title="زمین‌بازی AI"
      sub="تست پاسخ با کلید، مدل و پرامپت پیکربندی‌شده پلتفرم"
      actions={
        <Link href="/super/ai" className="btn secondary">
          تنظیمات AI
        </Link>
      }
    >
      {loading || !cfg ? (
        <PageLoading />
      ) : (
        <div className="stack" style={{ display: "grid", gap: 16 }}>
          <Card
            title="پیکربندی فعال"
            help={{
              title: "پیکربندی",
              body: "همین کلید و مدل ذخیره‌شده در تنظیمات AI برای تولید پاسخ استفاده می‌شود."
            }}
          >
            <p style={{ margin: 0 }}>
              وضعیت:{" "}
              <Badge
                tone={
                  cfg.llm_configured || cfg.api_key_configured || cfg.gemini_api_key_configured
                    ? "accent"
                    : "danger"
                }
              >
                {cfg.llm_configured || cfg.api_key_configured || cfg.gemini_api_key_configured
                  ? "آماده"
                  : "تنظیم نشده"}
              </Badge>
              {(cfg.active_key_masked || cfg.api_key_masked || cfg.gemini_api_key_masked) && (
                <>
                  {" · "}
                  <code>
                    {cfg.active_key_masked || cfg.api_key_masked || cfg.gemini_api_key_masked}
                  </code>
                </>
              )}
              {" · "}
              ارائه‌دهنده: <strong>{cfg.provider || "—"}</strong>
              {" · "}
              مدل: <strong>{cfg.model || cfg.gemini_model || "—"}</strong>
              {cfg.base_url ? (
                <>
                  {" · "}
                  <span className="hint" dir="ltr">
                    {cfg.base_url}
                  </span>
                </>
              ) : null}
            </p>
            {!(cfg.llm_configured || cfg.api_key_configured || cfg.gemini_api_key_configured) ? (
              <p className="hint" style={{ marginTop: 10 }}>
                برای تست، از{" "}
                <Link href="/super/ai">تنظیمات AI</Link> کلید و Base URL را ذخیره کنید.
              </p>
            ) : null}
          </Card>

          <Card
            title="سناریو تست"
            help={{
              title: "سناریو",
              body: "می‌توانید فقط پرامپت پلتفرم را تست کنید یا یک کسب‌وکار انتخاب کنید تا دانش و پالیسی همان سازمان هم اعمال شود."
            }}
          >
            <div className="form-grid">
              <label className="full">
                کسب‌وکار (اختیاری — برای دانش سازمانی)
                <select value={orgId} onChange={(e) => setOrgId(e.target.value)}>
                  <option value="">بدون سازمان — فقط پلتفرم</option>
                  {businesses.map((b) => (
                    <option key={b.org_id} value={b.org_id}>
                      {b.name} ({b.plan})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                نام لید تست
                <input value={leadName} onChange={(e) => setLeadName(e.target.value)} />
              </label>
              <label>
                مرحله  قیف 
                <select value={leadStage} onChange={(e) => setLeadStage(e.target.value)}>
                  {STAGES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                نقش عامل (اختیاری)
                <input
                  value={agentRole}
                  onChange={(e) => setAgentRole(e.target.value)}
                  placeholder="مثلاً مشاور فروش تور"
                />
              </label>
              <label>
                دما (temperature)
                <input
                  type="number"
                  min={0}
                  max={1.5}
                  step={0.05}
                  value={temperature}
                  onChange={(e) => setTemperature(Number(e.target.value))}
                />
              </label>
              <label className="full">
                پیام مشتری
                <textarea
                  rows={4}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="پیام نمونه مشتری…"
                />
              </label>
              <label className="full" style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={useOverride}
                  onChange={(e) => setUseOverride(e.target.checked)}
                />
                <span>سیستم‌پرامپت موقت (جایگزین پرامپت ذخیره‌شده — ذخیره نمی‌شود)</span>
              </label>
              {useOverride ? (
                <label className="full">
                  سیستم‌پرامپت تست
                  <textarea
                    rows={5}
                    value={systemOverride}
                    onChange={(e) => setSystemOverride(e.target.value)}
                    placeholder={cfg.system_prompt || "پرامپت تست…"}
                  />
                </label>
              ) : (
                <div className="full hint" style={{ whiteSpace: "pre-wrap" }}>
                  پرامپت فعلی پلتفرم:
                  {"\n"}
                  {(cfg.system_prompt || "—").slice(0, 400)}
                  {(cfg.system_prompt || "").length > 400 ? "…" : ""}
                </div>
              )}
            </div>
            <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Button
                loading={busy}
                onClick={run}
                disabled={
                  !(cfg.llm_configured || cfg.api_key_configured || cfg.gemini_api_key_configured)
                }
              >
                اجرای تست
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setMessage("سلام، قیمت پلن رشد چقدره؟");
                  setResult(null);
                }}
              >
                نمونه پیام
              </Button>
            </div>
          </Card>

          {result ? (
            <Card
              title="نتیجه"
              help={{
                title: "نتیجه",
                body: "پاسخ واقعی Gemini با تنظیمات فعال. منابع از دانش کسب‌وکار انتخاب‌شده می‌آیند."
              }}
              actions={
                <Button variant="secondary" onClick={() => setShowPrompt((v) => !v)}>
                  {showPrompt ? "مخفی کردن پرامپت" : "نمایش پرامپت استفاده‌شده"}
                </Button>
              }
            >
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                <Badge tone="accent">{result.provider}</Badge>
                <Badge>{result.model}</Badge>
                <Badge tone="success">
                  اطمینان {(result.confidence * 100).toFixed(0)}٪
                </Badge>
                <Badge>{result.elapsed_ms.toLocaleString("fa-IR")} ms</Badge>
                {result.org_name ? <Badge>{result.org_name}</Badge> : null}
                <Badge>
                  دانش: {result.knowledge_hits.toLocaleString("fa-IR")}
                </Badge>
              </div>
              <div
                style={{
                  whiteSpace: "pre-wrap",
                  padding: 14,
                  borderRadius: 12,
                  background: "var(--surface-2, #f1f5f9)",
                  lineHeight: 1.7
                }}
              >
                {result.reply}
              </div>
              {result.sources?.length ? (
                <div style={{ marginTop: 14 }}>
                  <div className="hint" style={{ marginBottom: 6 }}>
                    منابع دانش
                  </div>
                  <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                    {result.sources.map((s, i) => (
                      <li key={`${i}-${s.slice(0, 24)}`} className="hint">
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {showPrompt ? (
                <pre
                  style={{
                    marginTop: 14,
                    marginBottom: 0,
                    padding: 12,
                    borderRadius: 10,
                    background: "var(--surface-2, #f1f5f9)",
                    overflow: "auto",
                    maxHeight: 280,
                    fontSize: 12,
                    whiteSpace: "pre-wrap"
                  }}
                >
                  {result.system_prompt_used || "—"}
                </pre>
              ) : null}
            </Card>
          ) : null}
        </div>
      )}
    </SuperShell>
  );
}
