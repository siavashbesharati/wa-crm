"use client";

import { useCallback, useEffect, useState } from "react";
import SuperShell from "@/components/SuperShell";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Badge, Card, EmptyState } from "@/components/ui/Card";
import { PageLoading } from "@/components/ui/Spinner";
import { Switch } from "@/components/ui/Switch";
import { useToast } from "@/components/ui/Toast";

type Plan = {
  id: string;
  label: string;
  price_irr: number;
  price_label: string;
  max_seats: number;
  max_channel_accounts: number;
  ai_suggest: boolean;
  ai_auto_send: boolean;
  message_retention_days: number;
  features: string[];
  sort_order: number;
  is_active: boolean;
};

const emptyForm = (): Omit<Plan, "id"> & { id: string } => ({
  id: "",
  label: "",
  price_irr: 0,
  price_label: "",
  max_seats: 2,
  max_channel_accounts: 9999,
  ai_suggest: true,
  ai_auto_send: false,
  message_retention_days: 30,
  features: [],
  sort_order: 100,
  is_active: true
});

export default function SuperPlansPage() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [featuresText, setFeaturesText] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<{ plans: Plan[] }>("/admin/plans", { platform: true });
      setPlans(res.plans || []);
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  function startCreate() {
    setEditingId(null);
    setForm(emptyForm());
    setFeaturesText("");
  }

  function startEdit(p: Plan) {
    setEditingId(p.id);
    setForm({ ...p, features: [...(p.features || [])] });
    setFeaturesText((p.features || []).join("\n"));
  }

  function parseFeatures(text: string) {
    return text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  }

  async function save() {
    if (!form.label.trim()) {
      toast.push("نام پلن لازم است", "err");
      return;
    }
    const features = parseFeatures(featuresText);
    setBusy(true);
    try {
      if (editingId) {
        await api(`/admin/plans/${editingId}`, {
          method: "PATCH",
          platform: true,
          body: JSON.stringify({
            label: form.label.trim(),
            price_irr: Number(form.price_irr) || 0,
            price_label: form.price_label.trim(),
            max_seats: Number(form.max_seats) || 1,
            max_channel_accounts: Number(form.max_channel_accounts) || 9999,
            ai_suggest: form.ai_suggest,
            ai_auto_send: form.ai_auto_send,
            message_retention_days: Number(form.message_retention_days) || 30,
            features,
            sort_order: Number(form.sort_order) || 0,
            is_active: form.is_active
          })
        });
        toast.push("پلن به‌روز شد", "ok");
      } else {
        if (!form.id.trim()) {
          toast.push("شناسه پلن (مثلاً growth) لازم است", "err");
          setBusy(false);
          return;
        }
        await api("/admin/plans", {
          method: "POST",
          platform: true,
          body: JSON.stringify({
            id: form.id.trim(),
            label: form.label.trim(),
            price_irr: Number(form.price_irr) || 0,
            price_label: form.price_label.trim(),
            max_seats: Number(form.max_seats) || 1,
            max_channel_accounts: Number(form.max_channel_accounts) || 9999,
            ai_suggest: form.ai_suggest,
            ai_auto_send: form.ai_auto_send,
            message_retention_days: Number(form.message_retention_days) || 30,
            features,
            sort_order: Number(form.sort_order) || 0,
            is_active: form.is_active
          })
        });
        toast.push("پلن ساخته شد", "ok");
      }
      startCreate();
      await load();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: Plan) {
    if (!confirm(`حذف / غیرفعال کردن پلن «${p.label}»؟`)) return;
    setBusy(true);
    try {
      const res = await api<{ message?: string; deleted?: boolean }>(
        `/admin/plans/${p.id}`,
        { method: "DELETE", platform: true }
      );
      toast.push(res.message || (res.deleted ? "حذف شد" : "غیرفعال شد"), "ok");
      if (editingId === p.id) startCreate();
      await load();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SuperShell
      title="پلن‌های قیمت‌گذاری"
      sub="افزودن، ویرایش و حذف پلن‌ها با امکانات مجاز"
      actions={
        <Button variant="secondary" onClick={startCreate}>
          پلن جدید
        </Button>
      }
    >
      {loading ? (
        <PageLoading />
      ) : (
        <>
          <Card
            title={editingId ? `ویرایش: ${editingId}` : "پلن جدید"}
            help={{
              title: "تعریف پلن",
              body: "قیمت، سقف صندلی، امکانات و برچسب نمایشی پلن‌هایی که کسب‌وکارها در آنبوردینگ/صورتحساب می‌بینند."
            }}
          >
            <div className="form-grid">
              {!editingId ? (
                <label>
                  شناسه (انگلیسی)
                  <input
                    value={form.id}
                    onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))}
                    placeholder="مثلاً pro"
                  />
                </label>
              ) : null}
              <label>
                نام نمایشی
                <input
                  value={form.label}
                  onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                  placeholder="Growth"
                />
              </label>
              <label>
                قیمت (ریال)
                <input
                  type="number"
                  value={form.price_irr}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, price_irr: Number(e.target.value) || 0 }))
                  }
                />
              </label>
              <label>
                برچسب قیمت
                <input
                  value={form.price_label}
                  onChange={(e) => setForm((f) => ({ ...f, price_label: e.target.value }))}
                  placeholder="۹۹۰٬۰۰۰ تومان / ماه"
                />
              </label>
              <label>
                سقف صندلی افزونه
                <input
                  type="number"
                  value={form.max_seats}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, max_seats: Number(e.target.value) || 1 }))
                  }
                />
              </label>
              <label>
                نگهداری پیام (روز)
                <input
                  type="number"
                  value={form.message_retention_days}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      message_retention_days: Number(e.target.value) || 30
                    }))
                  }
                />
              </label>
              <label>
                ترتیب نمایش
                <input
                  type="number"
                  value={form.sort_order}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, sort_order: Number(e.target.value) || 0 }))
                  }
                />
              </label>
              <Switch
                full
                label="پیشنهاد پاسخ AI"
                checked={form.ai_suggest}
                onChange={(v) => setForm((f) => ({ ...f, ai_suggest: v }))}
              />
              <Switch
                full
                label="AI auto-send"
                checked={form.ai_auto_send}
                onChange={(v) => setForm((f) => ({ ...f, ai_auto_send: v }))}
              />
              <Switch
                full
                label="فعال (نمایش در خرید)"
                checked={form.is_active}
                onChange={(v) => setForm((f) => ({ ...f, is_active: v }))}
              />
              <label style={{ gridColumn: "1 / -1" }}>
                آیتم‌های مجاز / امکانات (هر خط یک مورد)
                <textarea
                  rows={5}
                  value={featuresText}
                  onChange={(e) => setFeaturesText(e.target.value)}
                  placeholder={"۵ صندلی افزونه\nAI auto-send\nپشتیبانی اولویت‌دار"}
                />
              </label>
            </div>
            <div className="row-actions" style={{ marginTop: 14 }}>
              <Button loading={busy} onClick={save}>
                {editingId ? "ذخیره تغییرات" : "ایجاد پلن"}
              </Button>
              {editingId ? (
                <Button variant="secondary" onClick={startCreate}>
                  انصراف
                </Button>
              ) : null}
            </div>
          </Card>

          <Card
            title="همه پلن‌ها"
            help={{
              title: "فهرست پلن‌ها",
              body: "پلن‌های فعال/غیرفعال. ترتیب نمایش و امکان ویرایش سریع از اینجا است."
            }}
          >
            {plans.length === 0 ? (
              <EmptyState title="پلنی نیست" text="از فرم بالا یکی بسازید." />
            ) : (
              <div className="plan-grid">
                {plans.map((p) => (
                  <div
                    key={p.id}
                    className={`plan-tile ${editingId === p.id ? "selected" : ""}`}
                    style={{ textAlign: "right", cursor: "default" }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 8,
                        alignItems: "center"
                      }}
                    >
                      <strong>{p.label}</strong>
                      <Badge tone={p.is_active ? "accent" : "danger"}>
                        {p.is_active ? "فعال" : "غیرفعال"}
                      </Badge>
                    </div>
                    <span className="hint">
                      <code>{p.id}</code> · {p.price_label || `${p.price_irr} ریال`}
                    </span>
                    <ul>
                      <li>{p.max_seats} صندلی</li>
                      <li>AI suggest: {p.ai_suggest ? "بله" : "خیر"}</li>
                      <li>AI auto-send: {p.ai_auto_send ? "بله" : "خیر"}</li>
                      <li>نگهداری: {p.message_retention_days} روز</li>
                      {(p.features || []).map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                    <div className="row-actions" style={{ marginTop: 10 }}>
                      <Button size="sm" variant="secondary" onClick={() => startEdit(p)}>
                        ویرایش
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={busy}
                        onClick={() => remove(p)}
                      >
                        حذف
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </SuperShell>
  );
}
