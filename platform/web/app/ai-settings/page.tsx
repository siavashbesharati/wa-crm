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

type GroupReplyMode = "off" | "keywords";

type Policy = {
  auto_send_enabled: boolean;
  group_auto_send_enabled: boolean;
  group_reply_mode: GroupReplyMode;
  group_keywords: string[];
  min_confidence: number;
  allowed_stages: string[];
  business_hours_only: boolean;
  hours_start: string;
  hours_end: string;
  agent_role: string;
  system_prompt: string;
  fallback_message: string;
};

function keywordsToText(list: string[] | undefined): string {
  return (list || []).join("\n");
}

function textToKeywords(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.replace(/\n/g, ",").split(",")) {
    const kw = part.trim();
    if (!kw) continue;
    const key = kw.toLocaleLowerCase("fa");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(kw);
  }
  return out;
}

export default function AiSettingsPage() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [keywordsText, setKeywordsText] = useState("");
  const [loading, setLoading] = useState(true);
  const { busy, run } = useMutation();
  const toast = useToast();

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const p = await api<Policy>("/ai/policy");
        const mode: GroupReplyMode =
          p.group_reply_mode === "keywords" || p.group_auto_send_enabled
            ? "keywords"
            : "off";
        setPolicy({ ...p, group_reply_mode: mode });
        setKeywordsText(keywordsToText(p.group_keywords));
      } catch (e) {
        toast.push(e instanceof Error ? e.message : "خطا", "err");
      } finally {
        setLoading(false);
      }
    })();
  }, [toast]);

  async function save() {
    if (!policy) return;
    const keywords = textToKeywords(keywordsText);
    let mode: GroupReplyMode = policy.group_reply_mode === "keywords" ? "keywords" : "off";
    if (!policy.auto_send_enabled) mode = "off";
    if (mode === "keywords" && keywords.length === 0) {
      toast.push("برای پاسخ گروهی حداقل یک کلمه کلیدی وارد کنید", "err");
      return;
    }
    const body = {
      ...policy,
      group_reply_mode: mode,
      group_keywords: keywords,
      group_auto_send_enabled: mode === "keywords"
    };
    await run(() => api("/ai/policy", { method: "PUT", body: JSON.stringify(body) }), {
      success: "تنظیمات پاسخ خودکار ذخیره شد"
    });
    setPolicy({ ...policy, ...body });
    setKeywordsText(keywordsToText(keywords));
  }

  function toggleStage(stage: string) {
    if (!policy) return;
    const cur = new Set(policy.allowed_stages || []);
    if (cur.has(stage)) cur.delete(stage);
    else cur.add(stage);
    setPolicy({ ...policy, allowed_stages: STAGES.filter((s) => cur.has(s)) });
  }

  const confidencePct = Math.round((policy?.min_confidence ?? 0) * 100);
  const groupMode = policy?.group_reply_mode === "keywords" ? "keywords" : "off";

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
                "در واتساپ مشتری می‌تواند با «توقف» یا «stop» ربات را برای همان چت خاموش کند و با «شروع» یا «start» روشن کند.",
                "پیام‌های گروه همیشه ذخیره می‌شوند؛ پاسخ گروهی فقط طبق حالت انتخاب‌شده انجام می‌شود."
              ]
            }}
          >
            <div className="ai-settings-stack">
              <Switch
                label="فعال‌سازی پاسخ خودکار"
                hint="وقتی روشن باشد، به پیام‌های خصوصی (و در صورت تنظیم، گروه‌ها) خودکار جواب داده می‌شود."
                checked={policy.auto_send_enabled}
                onChange={(v) =>
                  setPolicy({
                    ...policy,
                    auto_send_enabled: v,
                    group_reply_mode: v ? policy.group_reply_mode : "off",
                    group_auto_send_enabled: v ? policy.group_auto_send_enabled : false
                  })
                }
              />

              <div className="ai-stages-block">
                <strong>پاسخ در گروه‌های واتساپ</strong>
                <div className="hint" style={{ marginTop: 4 }}>
                  همه پیام‌های گروه در سرور ذخیره می‌شوند. فقط حالت پاسخ را انتخاب کنید.
                </div>
                <div className="ai-stage-chips" style={{ marginTop: 10 }}>
                  <button
                    type="button"
                    className={`ai-stage-chip${groupMode === "off" ? " active" : ""}`}
                    disabled={!policy.auto_send_enabled}
                    onClick={() =>
                      setPolicy({
                        ...policy,
                        group_reply_mode: "off",
                        group_auto_send_enabled: false
                      })
                    }
                  >
                    عدم پاسخ (پیش‌فرض)
                  </button>
                  <button
                    type="button"
                    className={`ai-stage-chip${groupMode === "keywords" ? " active" : ""}`}
                    disabled={!policy.auto_send_enabled}
                    onClick={() =>
                      setPolicy({
                        ...policy,
                        group_reply_mode: "keywords",
                        group_auto_send_enabled: true
                      })
                    }
                  >
                    پاسخ با کلمات کلیدی
                  </button>
                </div>
                {groupMode === "keywords" && policy.auto_send_enabled ? (
                  <label className="full" style={{ display: "block", marginTop: 12 }}>
                    <strong>کلمات کلیدی گروه</strong>
                    <div className="hint" style={{ margin: "4px 0 8px" }}>
                      اگر پیام گروه یکی از این کلمات را داشته باشد، AI پاسخ می‌دهد؛ وگرنه فقط
                      ذخیره می‌شود. هر خط یا با ویرگول جدا کنید.
                    </div>
                    <textarea
                      rows={4}
                      value={keywordsText}
                      onChange={(e) => setKeywordsText(e.target.value)}
                      placeholder={"قیمت\nخرید\n@bot"}
                      style={{ width: "100%" }}
                    />
                  </label>
                ) : null}
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
                <strong>مراحل برد مجاز برای پاسخ خودکار</strong>
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
