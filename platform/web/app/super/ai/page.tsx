"use client";

import { useEffect, useState } from "react";
import SuperShell from "@/components/SuperShell";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Badge, Card } from "@/components/ui/Card";
import { PageLoading } from "@/components/ui/Spinner";
import { Switch } from "@/components/ui/Switch";
import { useToast } from "@/components/ui/Toast";

type AiDefaults = {
  gemini_api_key?: string;
  gemini_api_key_masked?: string;
  gemini_api_key_configured?: boolean;
  gemini_model: string;
  system_prompt: string;
  default_min_confidence: number;
  auto_send_default: boolean;
  notes: string;
};

export default function SuperAiPage() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<AiDefaults | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const data = await api<AiDefaults>("/admin/ai-defaults", { platform: true });
        setForm(data);
        setApiKeyInput("");
      } catch (e) {
        toast.push(e instanceof Error ? e.message : "خطا", "err");
      } finally {
        setLoading(false);
      }
    })();
  }, [toast]);

  async function save() {
    if (!form) return;
    setBusy(true);
    try {
      const saved = await api<AiDefaults>("/admin/ai-defaults", {
        method: "PUT",
        platform: true,
        body: JSON.stringify({
          gemini_api_key: apiKeyInput.trim(),
          gemini_model: form.gemini_model,
          system_prompt: form.system_prompt,
          default_min_confidence: form.default_min_confidence,
          auto_send_default: form.auto_send_default,
          notes: form.notes
        })
      });
      setForm(saved);
      setApiKeyInput("");
      toast.push("تنظیمات Gemini ذخیره شد", "ok");
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SuperShell
      title="تنظیمات AI پلتفرم"
      sub="کلید و مدل Gemini + سیستم‌پرامپت سراسری"
    >
      {loading || !form ? (
        <PageLoading />
      ) : (
        <div className="stack" style={{ display: "grid", gap: 16 }}>
          <Card
            title="کلید Gemini"
            help={{
              title: "کلید Gemini",
              body: "کلید API گوگل برای تولید پاسخ در کل پلتفرم. کلید ماسک می‌شود؛ فقط سوپر ادمین می‌تواند عوض کند."
            }}
          >
            <p style={{ margin: 0 }}>
              وضعیت:{" "}
              <Badge tone={form.gemini_api_key_configured ? "accent" : "danger"}>
                {form.gemini_api_key_configured ? "پیکربندی شده" : "تنظیم نشده"}
              </Badge>
              {form.gemini_api_key_masked ? (
                <>
                  {" · "}
                  <code>{form.gemini_api_key_masked}</code>
                </>
              ) : null}
            </p>
            <label className="full" style={{ display: "block", marginTop: 12 }}>
              کلید جدید (خالی بگذارید تا کلید فعلی حفظ شود)
              <input
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="AIza…"
                autoComplete="off"
              />
            </label>
          </Card>

          <Card
            title="مدل و سیستم‌پرامپت سراسری"
            help={{
              title: "پرامپت سراسری",
              body: "مدل پیش‌فرض و دستورالعمل پایه برای همه کسب‌وکارها. پرامپت هر سازمان روی این لایه اضافه می‌شود."
            }}
          >
            <div className="form-grid">
              <label>
                مدل Gemini
                <input
                  value={form.gemini_model || ""}
                  onChange={(e) => setForm({ ...form, gemini_model: e.target.value })}
                  placeholder="gemini-2.0-flash"
                />
              </label>
              <label>
                حداقل اطمینان پیش‌فرض
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={form.default_min_confidence}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      default_min_confidence: Number(e.target.value)
                    })
                  }
                />
              </label>
              <Switch
                full
                label="فعال بودن auto-send برای کسب‌وکارهای تازه"
                checked={form.auto_send_default}
                onChange={(v) => setForm({ ...form, auto_send_default: v })}
              />
              <label className="full">
                سیستم‌پرامپت سراسری
                <textarea
                  rows={6}
                  value={form.system_prompt || ""}
                  onChange={(e) => setForm({ ...form, system_prompt: e.target.value })}
                  placeholder="دستورالعمل کلی برای همه کسب‌وکارها…"
                />
              </label>
              <label className="full">
                یادداشت داخلی
                <textarea
                  rows={2}
                  value={form.notes || ""}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </label>
              <Button loading={busy} onClick={save}>
                ذخیره تنظیمات
              </Button>
            </div>
          </Card>
        </div>
      )}
    </SuperShell>
  );
}
