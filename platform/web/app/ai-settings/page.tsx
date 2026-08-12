"use client";

import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PageLoading } from "@/components/ui/Spinner";
import { Switch } from "@/components/ui/Switch";
import { api } from "@/lib/api";
import { useMutation } from "@/lib/useApi";
import { useToast } from "@/components/ui/Toast";
import { STAGES } from "@/components/crm/shared";

type Policy = {
  auto_send_enabled: boolean;
  group_auto_send_enabled: boolean;
  min_confidence: number;
  allowed_stages: string[];
  business_hours_only: boolean;
  hours_start: string;
  hours_end: string;
  agent_role: string;
  system_prompt: string;
  fallback_message: string;
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
      { success: "تنظیمات پاسخ خودکار ذخیره شد" }
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
    <Shell title="تنظیمات AI" sub="پاسخ خودکار و مراحل مجاز">
      {loading || !policy ? (
        <PageLoading />
      ) : (
        <>
          <Card
            title="سیستم‌پرامپت"
            help={{
              title: "سیستم‌پرامپت پلتفرم",
              body: "دستورالعمل اصلی AI از پنل سوپرادمین تنظیم می‌شود و برای همه کسب‌وکارها یکسان است. دانش و محتوای هر کسب‌وکار از بخش دانش سازمانی می‌آید.",
              tips: [
                "برای تغییر لحن و قواعد کلی، از سوپرادمین (/super/ai) استفاده کنید.",
                "اطلاعات اختصاصی کسب‌وکار (قیمت، کارت، پلن‌ها) را در دانش سازمانی بگذارید."
              ]
            }}
          >
            <p className="hint" style={{ margin: 0 }}>
              سیستم‌پرامپت کسب‌وکار جداگانه اعمال نمی‌شود؛ همه پاسخ‌ها با پرامپت سوپرادمین
              ساخته می‌شوند و تفاوت هر کسب‌وکار از دانش سازمانی است.
            </p>
          </Card>

          <Card
            title="پاسخ خودکار"
            help={{
              title: "پاسخ خودکار",
              body: "وقتی روشن باشد، به پیام‌های ورودی در مراحل مجاز و با حداقل اطمینان مشخص، خودکار پاسخ می‌فرستد.",
              tips: [
                "حداقل اطمینان را بالاتر بگذارید اگر پاسخ‌های ضعیف می‌بینید.",
                "معمولاً فقط مرحله «جدید» را مجاز کنید.",
                "در واتساپ مشتری می‌تواند با «توقف» یا «stop» ربات را برای همان چت خاموش کند و با «شروع» یا «start» روشن کند."
              ]
            }}
          >
            <div className="ai-settings-stack">
              <Switch
                label="فعال‌سازی پاسخ خودکار"
                hint="وقتی روشن باشد، به پیام‌های ورودی خودکار جواب داده می‌شود."
                checked={policy.auto_send_enabled}
                onChange={(v) =>
                  setPolicy({
                    ...policy,
                    auto_send_enabled: v,
                    group_auto_send_enabled: v ? policy.group_auto_send_enabled : false
                  })
                }
              />

              <Switch
                label="پاسخ خودکار در گروه‌های واتساپ"
                hint="وقتی خاموش باشد، فقط چت خصوصی (PV) پاسخ می‌گیرد — گروه‌ها فقط در inbox ذخیره می‌شوند."
                checked={policy.group_auto_send_enabled}
                disabled={!policy.auto_send_enabled}
                onChange={(v) =>
                  setPolicy({
                    ...policy,
                    group_auto_send_enabled: v
                  })
                }
              />

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

              <label className="full" style={{ display: "block" }}>
                <strong>پیام جایگزین (Fallback)</strong>
                <div className="hint" style={{ margin: "4px 0 8px" }}>
                  اگر AI خطا بدهد یا پاسخ نسازد، این متن ارسال می‌شود. خالی بگذارید تا پیام سراسری
                  سوپرادمین استفاده شود.
                </div>
                <textarea
                  rows={3}
                  value={policy.fallback_message || ""}
                  onChange={(e) =>
                    setPolicy({ ...policy, fallback_message: e.target.value })
                  }
                  placeholder="خالی = استفاده از پیام سراسری پلتفرم"
                  style={{ width: "100%" }}
                />
              </label>

              <Button loading={busy} onClick={save}>
                ذخیره تنظیمات
              </Button>
            </div>
          </Card>
        </>
      )}
    </Shell>
  );
}
