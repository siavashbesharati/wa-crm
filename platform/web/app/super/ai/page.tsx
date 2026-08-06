"use client";

import { useEffect, useState } from "react";
import SuperShell from "@/components/SuperShell";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Badge, Card } from "@/components/ui/Card";
import { PageLoading } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";

type AiDefaults = {
  openai_model: string;
  openai_base_url: string;
  default_min_confidence: number;
  auto_send_default: boolean;
  notes: string;
  openai_api_key_configured?: boolean;
};

export default function SuperAiPage() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<AiDefaults | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        setForm(await api<AiDefaults>("/admin/ai-defaults", { platform: true }));
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
          openai_model: form.openai_model,
          openai_base_url: form.openai_base_url,
          default_min_confidence: form.default_min_confidence,
          auto_send_default: form.auto_send_default,
          notes: form.notes
        })
      });
      setForm(saved);
      toast.push("تنظیمات سراسری AI ذخیره شد", "ok");
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SuperShell
      title="تنظیمات AI پلتفرم"
      sub="پیش‌فرض مدل و سیاست برای کسب‌وکارهای جدید — کلید API از env سرور خوانده می‌شود"
    >
      {loading || !form ? (
        <PageLoading />
      ) : (
        <div className="stack" style={{ display: "grid", gap: 16 }}>
          <Card title="وضعیت کلید">
            <p style={{ margin: 0 }}>
              OpenAI API Key:{" "}
              <Badge tone={form.openai_api_key_configured ? "accent" : "danger"}>
                {form.openai_api_key_configured ? "پیکربندی شده" : "تنظیم نشده"}
              </Badge>
            </p>
            <p className="hint" style={{ marginTop: 8 }}>
              برای امنیت، کلید فقط از متغیر محیطی <code>OPENAI_API_KEY</code> روی API تنظیم
              می‌شود.
            </p>
          </Card>

          <Card title="پیش‌فرض‌های سراسری">
            <div className="form-grid">
              <label>
                مدل پیش‌فرض
                <input
                  value={form.openai_model}
                  onChange={(e) => setForm({ ...form, openai_model: e.target.value })}
                />
              </label>
              <label>
                Base URL
                <input
                  value={form.openai_base_url}
                  onChange={(e) => setForm({ ...form, openai_base_url: e.target.value })}
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
              <label className="full check">
                <input
                  type="checkbox"
                  checked={form.auto_send_default}
                  onChange={(e) =>
                    setForm({ ...form, auto_send_default: e.target.checked })
                  }
                />
                فعال بودن auto-send برای کسب‌وکارهای تازه
              </label>
              <label className="full">
                یادداشت داخلی
                <textarea
                  rows={3}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="سیاست داخلی، محدودیت‌ها، …"
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
