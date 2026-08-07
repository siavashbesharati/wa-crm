"use client";

import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PageLoading } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { useMutation } from "@/lib/useApi";
import { useToast } from "@/components/ui/Toast";
import { STAGES } from "@/components/crm/shared";

type Policy = {
  auto_send_enabled: boolean;
  min_confidence: number;
  allowed_stages: string[];
  business_hours_only: boolean;
  hours_start: string;
  hours_end: string;
  agent_role: string;
  system_prompt: string;
};

export default function AiSettingsPage() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [loading, setLoading] = useState(true);
  const { busy, run } = useMutation();
  const toast = useToast();

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        setPolicy(await api<Policy>("/ai/policy"));
      } catch (e) {
        toast.push(e instanceof Error ? e.message : "خطا", "err");
      } finally {
        setLoading(false);
      }
    })();
  }, [toast]);

  async function save() {
    if (!policy) return;
    await run(
      () => api("/ai/policy", { method: "PUT", body: JSON.stringify(policy) }),
      { success: "سیاست و پرامپت ذخیره شد" }
    );
  }

  function toggleStage(stage: string) {
    if (!policy) return;
    const cur = new Set(policy.allowed_stages || []);
    if (cur.has(stage)) cur.delete(stage);
    else cur.add(stage);
    setPolicy({ ...policy, allowed_stages: STAGES.filter((s) => cur.has(s)) });
  }

  const confidencePct = Math.round((policy?.min_confidence ?? 0) * 100);

  return (
    <Shell title="تنظیمات AI" sub="نقش، سیستم‌پرامپت و پاسخ خودکار">
      {loading || !policy ? (
        <PageLoading />
      ) : (
        <div className="panel-narrow">
          <Card title="نقش و سیستم‌پرامپت">
            <div className="form-grid">
              <label className="full">
                نقش دستیار
                <input
                  value={policy.agent_role || ""}
                  onChange={(e) => setPolicy({ ...policy, agent_role: e.target.value })}
                  placeholder="مثلاً مشاور فروش تورهای گردشگری"
                />
              </label>
              <label className="full">
                سیستم‌پرامپت کسب‌وکار
                <textarea
                  rows={6}
                  value={policy.system_prompt || ""}
                  onChange={(e) =>
                    setPolicy({ ...policy, system_prompt: e.target.value })
                  }
                  placeholder="دستورالعمل‌های اختصاصی این کسب‌وکار (لحن، ممنوعیت‌ها، …)"
                />
              </label>
            </div>
          </Card>

          <Card title="پاسخ خودکار">
            <div className="ai-settings-stack">
              <div className="ai-switch-row">
                <div>
                  <strong>فعال‌سازی پاسخ خودکار</strong>
                  <div className="hint">وقتی روشن باشد، به پیام‌های ورودی خودکار جواب داده می‌شود.</div>
                </div>
                <button
                  type="button"
                  className={`ui-switch${policy.auto_send_enabled ? " on" : ""}`}
                  role="switch"
                  aria-checked={policy.auto_send_enabled}
                  onClick={() =>
                    setPolicy({
                      ...policy,
                      auto_send_enabled: !policy.auto_send_enabled
                    })
                  }
                >
                  <span className="ui-switch-knob" />
                </button>
              </div>

              <div className="ai-slider-block">
                <div className="ai-slider-head">
                  <strong>حداقل اطمینان</strong>
                  <span className="ai-slider-value">{confidencePct}٪</span>
                </div>
                <input
                  className="ai-range"
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={confidencePct}
                  onChange={(e) =>
                    setPolicy({
                      ...policy,
                      min_confidence: Number(e.target.value) / 100
                    })
                  }
                  style={{
                    ["--ai-range-pct" as string]: `${confidencePct}%`
                  }}
                />
                <div className="hint">
                  فقط وقتی مدل به اندازه‌ی کافی مطمئن باشد پاسخ ارسال می‌شود.
                </div>
              </div>

              <div className="ai-stages-block">
                <strong>مراحل پایپلاین مجاز برای پاسخ خودکار</strong>
                <div className="hint" style={{ marginTop: 4 }}>
                  ربات فقط روی لیدهایی که در این مراحل هستند جواب می‌دهد (مثلاً فقط «جدید»).
                </div>
                <div className="ai-stage-chips">
                  {STAGES.map((stage) => {
                    const active = (policy.allowed_stages || []).includes(stage);
                    return (
                      <button
                        key={stage}
                        type="button"
                        className={`ai-stage-chip${active ? " active" : ""}`}
                        onClick={() => toggleStage(stage)}
                      >
                        {stage}
                      </button>
                    );
                  })}
                </div>
              </div>

              <Button loading={busy} onClick={save}>
                ذخیره تنظیمات
              </Button>
            </div>
          </Card>
        </div>
      )}
    </Shell>
  );
}
