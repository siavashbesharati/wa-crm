"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import SuperShell from "@/components/SuperShell";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Badge, Card } from "@/components/ui/Card";
import { PageLoading } from "@/components/ui/Spinner";
import { Switch } from "@/components/ui/Switch";
import { useToast } from "@/components/ui/Toast";

type Preset = { label: string; base_url: string; model: string };

type AiDefaults = {
  provider: "openai_compatible" | "gemini";
  api_key_masked?: string;
  api_key_configured?: boolean;
  base_url: string;
  model: string;
  temperature: number;
  max_tokens: number;
  top_p: number;
  reasoning_effort: string;
  system_prompt: string;
  fallback_message: string;
  default_min_confidence: number;
  auto_send_default: boolean;
  notes: string;
  gemini_api_key_masked?: string;
  gemini_api_key_configured?: boolean;
  gemini_model: string;
  pinecone_api_key_masked?: string;
  pinecone_api_key_configured?: boolean;
  llm_configured?: boolean;
  active_key_masked?: string;
  presets?: Record<string, Preset>;
};

export default function SuperAiPage() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<AiDefaults | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [geminiKeyInput, setGeminiKeyInput] = useState("");
  const [pineconeKeyInput, setPineconeKeyInput] = useState("");
  const [reindexBusy, setReindexBusy] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const data = await api<AiDefaults>("/admin/ai-defaults", { platform: true });
        setForm({
          ...data,
          provider: data.provider === "gemini" ? "gemini" : "openai_compatible",
          temperature: Number(data.temperature ?? 0.4),
          max_tokens: Number(data.max_tokens ?? 2048),
          top_p: Number(data.top_p ?? 1),
          reasoning_effort: data.reasoning_effort || ""
        });
        setApiKeyInput("");
        setGeminiKeyInput("");
        setPineconeKeyInput("");
      } catch (e) {
        toast.push(e instanceof Error ? e.message : "خطا", "err");
      } finally {
        setLoading(false);
      }
    })();
  }, [toast]);

  function applyPreset(key: string) {
    if (!form?.presets?.[key]) return;
    const p = form.presets[key];
    setForm({
      ...form,
      provider: "openai_compatible",
      base_url: p.base_url,
      model: p.model
    });
  }

  async function save() {
    if (!form) return;
    setBusy(true);
    try {
      const saved = await api<AiDefaults>("/admin/ai-defaults", {
        method: "PUT",
        platform: true,
        body: JSON.stringify({
          provider: form.provider,
          api_key: apiKeyInput.trim(),
          base_url: form.base_url,
          model: form.model,
          temperature: form.temperature,
          max_tokens: form.max_tokens,
          top_p: form.top_p,
          reasoning_effort: form.reasoning_effort,
          system_prompt: form.system_prompt,
          fallback_message: form.fallback_message || "",
          default_min_confidence: form.default_min_confidence,
          auto_send_default: form.auto_send_default,
          notes: form.notes,
          gemini_api_key: geminiKeyInput.trim(),
          gemini_model: form.gemini_model,
          pinecone_api_key: pineconeKeyInput.trim()
        })
      });
      setForm({
        ...saved,
        provider: saved.provider === "gemini" ? "gemini" : "openai_compatible"
      });
      setApiKeyInput("");
      setGeminiKeyInput("");
      setPineconeKeyInput("");
      toast.push("تنظیمات AI ذخیره شد", "ok");
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setBusy(false);
    }
  }

  async function reindexKnowledge() {
    setReindexBusy(true);
    try {
      const res = await api<{
        ok: boolean;
        docs?: number;
        chunks_upserted?: number;
        failed_docs?: number;
      }>("/admin/ai/reindex-knowledge", { method: "POST", platform: true });
      toast.push(
        `ایندکس شد: ${res.chunks_upserted ?? 0} تکه از ${res.docs ?? 0} سند` +
          (res.failed_docs ? ` (${res.failed_docs} خطا)` : ""),
        "ok"
      );
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا در ایندکس Pinecone", "err");
    } finally {
      setReindexBusy(false);
    }
  }

  return (
    <SuperShell
      title="تنظیمات AI پلتفرم"
      sub="ارائه‌دهنده انعطاف‌پذیر: Groq / OpenAI / xAI یا Gemini"
      actions={
        <Link href="/super/ai-playground" className="btn secondary">
          زمین‌بازی AI
        </Link>
      }
    >
      {loading || !form ? (
        <PageLoading />
      ) : (
        <div className="stack" style={{ display: "grid", gap: 16 }}>
          <Card
            title="ارائه‌دهنده"
            help={{
              title: "ارائه‌دهنده",
              body: "OpenAI-compatible برای Groq، OpenAI، xAI Grok و هر سرویس مشابه. Gemini مسیر جداگانه Google است."
            }}
          >
            <div className="form-grid">
              <label className="full">
                نوع اتصال
                <select
                  value={form.provider}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      provider: e.target.value === "gemini" ? "gemini" : "openai_compatible"
                    })
                  }
                >
                  <option value="openai_compatible">
                    OpenAI-compatible (Groq / OpenAI / xAI / …)
                  </option>
                  <option value="gemini">Google Gemini</option>
                </select>
              </label>
              {form.provider === "openai_compatible" ? (
                <div className="full" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {Object.entries(form.presets || {}).map(([k, p]) => (
                    <Button key={k} variant="secondary" onClick={() => applyPreset(k)}>
                      پیش‌فرض {p.label}
                    </Button>
                  ))}
                </div>
              ) : null}
              <p className="full hint" style={{ margin: 0 }}>
                وضعیت فعال:{" "}
                <Badge tone={form.llm_configured ? "accent" : "danger"}>
                  {form.llm_configured ? "آماده" : "کلید لازم است"}
                </Badge>
                {form.active_key_masked ? (
                  <>
                    {" · "}
                    <code>{form.active_key_masked}</code>
                  </>
                ) : null}
              </p>
            </div>
          </Card>

          {form.provider === "openai_compatible" ? (
            <Card
              title="اتصال OpenAI-compatible"
              help={{
                title: "Base URL + API Key",
                body: "مثل SDK رسمی: chat.completions با base_url. برای Groq: https://api.groq.com/openai/v1 — مدل مثلاً llama-3.3-70b-versatile یا openai/gpt-oss-120b."
              }}
            >
              <div className="form-grid">
                <label className="full">
                  Base URL
                  <input
                    value={form.base_url || ""}
                    onChange={(e) => setForm({ ...form, base_url: e.target.value })}
                    placeholder="https://api.groq.com/openai/v1"
                    dir="ltr"
                    style={{ textAlign: "left" }}
                  />
                </label>
                <label className="full">
                  API Key{" "}
                  {form.api_key_configured ? (
                    <span className="hint">
                      (فعلی: <code>{form.api_key_masked}</code> — خالی = بدون تغییر)
                    </span>
                  ) : null}
                  <input
                    type="password"
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    placeholder="gsk_… / sk-…"
                    autoComplete="off"
                    dir="ltr"
                    style={{ textAlign: "left" }}
                  />
                </label>
                <label>
                  مدل
                  <input
                    value={form.model || ""}
                    onChange={(e) => setForm({ ...form, model: e.target.value })}
                    placeholder="llama-3.3-70b-versatile"
                    dir="ltr"
                    style={{ textAlign: "left" }}
                  />
                </label>
                <label>
                  Temperature
                  <input
                    type="number"
                    min={0}
                    max={2}
                    step={0.05}
                    value={form.temperature}
                    onChange={(e) =>
                      setForm({ ...form, temperature: Number(e.target.value) })
                    }
                  />
                </label>
                <label>
                  Max tokens
                  <input
                    type="number"
                    min={64}
                    max={8192}
                    step={64}
                    value={form.max_tokens}
                    onChange={(e) =>
                      setForm({ ...form, max_tokens: Number(e.target.value) })
                    }
                  />
                </label>
                <label>
                  Top P
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={form.top_p}
                    onChange={(e) => setForm({ ...form, top_p: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Reasoning effort (اختیاری)
                  <select
                    value={form.reasoning_effort || ""}
                    onChange={(e) =>
                      setForm({ ...form, reasoning_effort: e.target.value })
                    }
                  >
                    <option value="">خاموش</option>
                    <option value="low">low</option>
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                  </select>
                </label>
              </div>
            </Card>
          ) : (
            <Card
              title="اتصال Gemini"
              help={{
                title: "Gemini",
                body: "کلید Google AI Studio. اگر ارائه‌دهنده Gemini باشد از این مسیر استفاده می‌شود."
              }}
            >
              <div className="form-grid">
                <label className="full">
                  کلید Gemini{" "}
                  {form.gemini_api_key_configured ? (
                    <span className="hint">
                      (فعلی: <code>{form.gemini_api_key_masked}</code>)
                    </span>
                  ) : null}
                  <input
                    type="password"
                    value={geminiKeyInput}
                    onChange={(e) => setGeminiKeyInput(e.target.value)}
                    placeholder="AIza…"
                    autoComplete="off"
                  />
                </label>
                <label>
                  مدل Gemini
                  <input
                    value={form.gemini_model || ""}
                    onChange={(e) => setForm({ ...form, gemini_model: e.target.value })}
                    placeholder="gemini-2.0-flash"
                  />
                </label>
              </div>
            </Card>
          )}

          <Card
            title="پایگاه دانش Pinecone"
            help={{
              title: "Pinecone",
              body: "جستجوی برداری دانش با مدل multilingual-e5 روی app.pinecone.io. ایندکس iranexpedia-kb به‌صورت خودکار ساخته می‌شود.",
              tips: [
                "کلید را از کنسول Pinecone کپی کنید.",
                "بعد از اولین ذخیره، پایگاه دانش قدیمی را با «ایندکس مجدد» بفرستید."
              ]
            }}
          >
            <div className="form-grid">
              <label className="full">
                کلید Pinecone{" "}
                {form.pinecone_api_key_configured ? (
                  <span className="hint">
                    (فعلی: <code>{form.pinecone_api_key_masked}</code>)
                  </span>
                ) : null}
                <input
                  type="password"
                  value={pineconeKeyInput}
                  onChange={(e) => setPineconeKeyInput(e.target.value)}
                  placeholder="pcsk_…"
                  autoComplete="off"
                />
              </label>
              <div className="full" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Button
                  variant="secondary"
                  loading={reindexBusy}
                  disabled={!form.pinecone_api_key_configured}
                  onClick={() => void reindexKnowledge()}
                >
                  ایندکس مجدد همه دانش‌ها
                </Button>
                {!form.pinecone_api_key_configured ? (
                  <span className="hint">ابتدا کلید را ذخیره کنید</span>
                ) : null}
              </div>
            </div>
          </Card>

          <Card
            title="سیستم‌پرامپت و پیش‌فرض‌ها"
            help={{
              title: "پرامپت سراسری",
              body: "همین پرامپت برای همه کسب‌وکارها استفاده می‌شود. پرامپت جداگانهٔ کسب‌وکار اعمال نمی‌شود؛ تفاوت هر کسب‌وکار از دانش سازمانی است."
            }}
          >
            <div className="form-grid">
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
                پیام جایگزین سراسری (Fallback)
                <textarea
                  rows={3}
                  value={form.fallback_message || ""}
                  onChange={(e) => setForm({ ...form, fallback_message: e.target.value })}
                  placeholder="اگر AI خطا بدهد یا در دسترس نباشد، این متن برای مشتری ارسال می‌شود…"
                />
                <span className="hint" style={{ display: "block", marginTop: 6 }}>
                  کسب‌وکارها می‌توانند در تنظیمات AI خودشان این پیام را فقط برای سازمان خود override کنند.
                </span>
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
              <Link href="/super/ai-playground" className="btn secondary">
                تست در زمین‌بازی
              </Link>
            </div>
          </Card>
        </div>
      )}
    </SuperShell>
  );
}
