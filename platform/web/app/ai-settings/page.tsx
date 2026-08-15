"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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
  auto_apply_stage: boolean;
  pause_bot_on_escalate: boolean;
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
        setPolicy({
          ...p,
          group_reply_mode: mode,
          auto_apply_stage: !!p.auto_apply_stage,
          pause_bot_on_escalate: p.pause_bot_on_escalate !== false
        });
        setKeywordsText(keywordsToText(p.group_keywords));
      } catch (e) {
        toast.push(e instanceof Error ? e.message : "خطا", "err");
      } finally {
        setLoading(false);
      }
    })();
  }, [toast]);

  async function save(next?: Partial<Policy>, nextKeywordsText?: string) {
    if (!policy) return;
    const patch: Partial<Policy> =
      next && typeof next === "object" && !("nativeEvent" in next) ? next : {};
    const merged: Policy = { ...policy, ...patch };
    const keywords = textToKeywords(
      typeof nextKeywordsText === "string" ? nextKeywordsText : keywordsText
    );
    let mode: GroupReplyMode = merged.group_reply_mode === "keywords" ? "keywords" : "off";
    if (!merged.auto_send_enabled) mode = "off";
    if (mode === "keywords" && keywords.length === 0) {
      toast.push("برای پاسخ گروهی حداقل یک کلمه کلیدی وارد کنید", "err");
      return;
    }
    const body = {
      ...merged,
      group_reply_mode: mode,
      group_keywords: keywords,
      group_auto_send_enabled: mode === "keywords"
    };
    const ok = await run(
      () => api("/ai/policy", { method: "PUT", body: JSON.stringify(body) }),
      { success: "تنظیمات پاسخ خودکار ذخیره شد" }
    );
    if (!ok) return;
    setPolicy({ ...merged, ...body });
    setKeywordsText(keywordsToText(keywords));
  }

  async function setAutoSendEnabled(enabled: boolean) {
    if (!policy) return;
    const next: Policy = {
      ...policy,
      auto_send_enabled: enabled,
      group_reply_mode: enabled ? policy.group_reply_mode : "off",
      group_auto_send_enabled: enabled ? policy.group_auto_send_enabled : false
    };
    setPolicy(next);
    await save(next);
  }

  function toggleStage(stage: string) {
    if (!policy) return;
    const cur = new Set(policy.allowed_stages || []);
    if (cur.has(stage)) cur.delete(stage);
    else cur.add(stage);
    setPolicy({ ...policy, allowed_stages: STAGES.filter((s) => cur.has(s)) });
  }

  const groupMode = policy?.group_reply_mode === "keywords" ? "keywords" : "off";

  return (
    <Shell title="تنظیمات AI" sub="پاسخ خودکار و مراحل مجاز">
      {loading || !policy ? (
        <PageLoading />
      ) : (
        <>
          <Card
            title="سیستم‌پرامپت (سوپرادمین)"
            help={{
              title: "سیستم‌پرامپت پلتفرم",
              body: "دستورالعمل کلی AI فقط از پنل سوپرادمین تنظیم می‌شود. هر کسب‌وکار با «نقش دستیار» و «دانش سازمانی» شخصی‌سازی می‌شود.",
              tips: [
                "برای تغییر قواعد کلی، از سوپرادمین (/super/ai) استفاده کنید.",
                "اطلاعات اختصاصی (قیمت، FAQ) را در بخش دانش سازمانی بگذارید."
              ]
            }}
          >
            <p className="hint" style={{ margin: 0 }}>
              سیستم‌پرامپت در این صفحه قابل ویرایش نیست. پایین، نقش دستیار این کسب‌وکار را
              تنظیم کنید — یا با{" "}
              <Link href="/aghaye-pashmak" style={{ fontWeight: 600 }}>
                آقای پشمک
              </Link>{" "}
              ویزارد پروفایل را کامل کنید تا نقش و دستور پاسخ‌گویی خودکار نوشته شود.
            </p>
          </Card>

          <Card title="نقش دستیار (این کسب‌وکار)">
            <label className="full" style={{ display: "block" }}>
              <strong>نقش و لحن پاسخ‌گویی</strong>
              <div className="hint" style={{ margin: "4px 0 8px" }}>
                مثلاً «مشاور فروش تورهای خارجی» — با ذخیره، بلافاصله روی پاسخ‌های بعدی اعمال
                می‌شود. پیکربندی سریع:{" "}
                <Link href="/aghaye-pashmak">پیکربندی با آقای پشمک</Link>
              </div>
              <input
                value={policy.agent_role || ""}
                onChange={(e) => setPolicy({ ...policy, agent_role: e.target.value })}
                placeholder="مثلاً مشاور فروش و پشتیبانی ایران اکسپدیا"
                style={{ width: "100%" }}
              />
            </label>
          </Card>

          <Card
            title="پاسخ خودکار"
            help={{
              title: "پاسخ خودکار",
              body: "وقتی روشن باشد، به پیام‌های ورودی در مراحل مجاز خودکار پاسخ می‌فرستد. هر پاسخ موفق AI مستقیماً ارسال می‌شود.",
              tips: [
                "معمولاً فقط مرحله «جدید» را مجاز کنید.",
                "در واتساپ مشتری می‌تواند با «توقف» یا «stop» ربات را برای همان چت خاموش کند و با «شروع» یا «start» روشن کند.",
                "پیام‌های گروه همیشه ذخیره می‌شوند؛ پاسخ گروهی فقط طبق حالت انتخاب‌شده انجام می‌شود."
              ]
            }}
          >
            <div className="ai-settings-stack">
              <Switch
                label="فعال‌سازی پاسخ خودکار"
                hint="با روشن/خاموش شدن، همان لحظه روی سرور ذخیره می‌شود."
                checked={policy.auto_send_enabled}
                onChange={(v) => {
                  void setAutoSendEnabled(v);
                }}
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

              <div className="ai-stages-block">
                <strong>مراحل برد مجاز برای پاسخ خودکار</strong>
                <div className="hint" style={{ marginTop: 4 }}>
                  ربات فقط روی لیدهایی که در این مراحل هستند جواب می‌دهد. اگر فقط «جدید»
                  انتخاب باشد، بعد از رفتن به «پیگیری/پیشنهاد» دیگر پاسخ خودکار نمی‌فرستد
                  (پیشنهاد دستی Inbox همچنان کار می‌کند).
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

              <Switch
                label="اعمال خودکار مرحله پیشنهادی AI"
                hint="اگر روشن باشد، بعد از تحلیل گفتگو مرحله  قیف  (به‌جز مراحل پایانی) خودکار به‌روز می‌شود."
                checked={!!policy.auto_apply_stage}
                onChange={(v) => setPolicy({ ...policy, auto_apply_stage: v })}
              />

              <Switch
                label="توقف ربات هنگام اسکالیشن"
                hint="وقتی ریسک از دست رفتن یا نیاز به کارشناس تشخیص داده شود، ربات برای آن مخاطب متوقف می‌شود."
                checked={policy.pause_bot_on_escalate !== false}
                onChange={(v) => setPolicy({ ...policy, pause_bot_on_escalate: v })}
              />

              <label className="full" style={{ display: "block" }}>
                <strong>حداقل اطمینان برای ارسال خودکار</strong>
                <div className="hint" style={{ margin: "4px 0 8px" }}>
                  اگر امتیاز اطمینان پاسخ کمتر از این مقدار باشد، ارسال خودکار انجام نمی‌شود.
                </div>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={policy.min_confidence}
                  onChange={(e) =>
                    setPolicy({ ...policy, min_confidence: Number(e.target.value) })
                  }
                />
              </label>

              <Switch
                label="فقط در ساعت کاری"
                hint="خارج از بازه زمانی، پاسخ خودکار ارسال نمی‌شود (غنی‌سازی CRM همچنان انجام می‌شود)."
                checked={!!policy.business_hours_only}
                onChange={(v) => setPolicy({ ...policy, business_hours_only: v })}
              />
              {policy.business_hours_only ? (
                <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <label>
                    از ساعت
                    <input
                      type="time"
                      value={policy.hours_start || "09:00"}
                      onChange={(e) => setPolicy({ ...policy, hours_start: e.target.value })}
                    />
                  </label>
                  <label>
                    تا ساعت
                    <input
                      type="time"
                      value={policy.hours_end || "18:00"}
                      onChange={(e) => setPolicy({ ...policy, hours_end: e.target.value })}
                    />
                  </label>
                </div>
              ) : null}

              <label className="full" style={{ display: "block" }}>
                <strong>پیام جایگزین (Fallback)</strong>
                <div className="hint" style={{ margin: "4px 0 8px" }}>
                  فقط وقتی سرویس AI خطا بدهد (شبکه، rate limit، کلید نامعتبر و…) این متن ارسال
                  می‌شود. پاسخ موفق AI همیشه همان‌طور که تولید شده ارسال می‌شود.
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

              <Button loading={busy} onClick={() => void save()}>
                ذخیره تنظیمات
              </Button>
            </div>
          </Card>
        </>
      )}
    </Shell>
  );
}
