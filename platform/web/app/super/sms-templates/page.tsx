"use client";

import { useCallback, useEffect, useState } from "react";
import SuperShell from "@/components/SuperShell";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Badge, Card, EmptyState } from "@/components/ui/Card";
import { PageLoading } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";

type SmsParam = {
  name: string;
  source: "otp" | "static";
  value: string;
};

type SmsTemplate = {
  id: string;
  name: string;
  template_id: number;
  parameters: SmsParam[];
  purpose: string;
  is_active: boolean;
  is_default: boolean;
};

const emptyForm = () => ({
  name: "",
  template_id: "" as string | number,
  purpose: "otp",
  is_active: true,
  is_default: true,
  parameters: [{ name: "Code", source: "otp" as const, value: "" }]
});

export default function SuperSmsTemplatesPage() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<SmsTemplate[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<{ templates: SmsTemplate[] }>("/admin/sms-templates", {
        platform: true
      });
      setRows(res.templates || []);
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
  }

  function startEdit(t: SmsTemplate) {
    setEditingId(t.id);
    setForm({
      name: t.name,
      template_id: t.template_id,
      purpose: t.purpose || "otp",
      is_active: t.is_active,
      is_default: t.is_default,
      parameters:
        t.parameters?.length > 0
          ? t.parameters.map((p) => ({
              name: p.name,
              source: p.source === "static" ? "static" : "otp",
              value: p.value || ""
            }))
          : [{ name: "Code", source: "otp", value: "" }]
    });
  }

  function setParam(i: number, patch: Partial<SmsParam>) {
    setForm((f) => {
      const parameters = f.parameters.map((p, idx) =>
        idx === i ? { ...p, ...patch } : p
      );
      return { ...f, parameters };
    });
  }

  function addParam() {
    setForm((f) => ({
      ...f,
      parameters: [...f.parameters, { name: "", source: "static", value: "" }]
    }));
  }

  function removeParam(i: number) {
    setForm((f) => ({
      ...f,
      parameters: f.parameters.filter((_, idx) => idx !== i)
    }));
  }

  async function save() {
    if (!form.name.trim()) {
      toast.push("نام قالب لازم است", "err");
      return;
    }
    const tid = Number(form.template_id);
    if (!tid || tid <= 0) {
      toast.push("Template ID معتبر وارد کنید", "err");
      return;
    }
    const parameters = form.parameters
      .map((p) => ({
        name: p.name.trim(),
        source: p.source,
        value: p.value
      }))
      .filter((p) => p.name);
    if (!parameters.length) {
      toast.push("حداقل یک پارامتر لازم است", "err");
      return;
    }
    if (!parameters.some((p) => p.source === "otp") && form.purpose === "otp") {
      toast.push("برای قالب OTP حداقل یک پارامتر با منبع «کد OTP» بگذارید", "err");
      return;
    }

    setBusy(true);
    try {
      const payload = {
        name: form.name.trim(),
        template_id: tid,
        parameters,
        purpose: form.purpose,
        is_active: form.is_active,
        is_default: form.is_default
      };
      if (editingId) {
        await api(`/admin/sms-templates/${editingId}`, {
          method: "PATCH",
          platform: true,
          body: JSON.stringify(payload)
        });
        toast.push("قالب به‌روز شد", "ok");
      } else {
        await api("/admin/sms-templates", {
          method: "POST",
          platform: true,
          body: JSON.stringify(payload)
        });
        toast.push("قالب ساخته شد", "ok");
      }
      startCreate();
      await load();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setBusy(false);
    }
  }

  async function remove(t: SmsTemplate) {
    if (!confirm(`حذف قالب «${t.name}»؟`)) return;
    setBusy(true);
    try {
      await api(`/admin/sms-templates/${t.id}`, {
        method: "DELETE",
        platform: true
      });
      toast.push("حذف شد", "ok");
      if (editingId === t.id) startCreate();
      await load();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SuperShell
      title="قالب‌های پیامک"
      sub="قالب‌های sms.ir — نام، Template ID و پارامترها"
      actions={
        <Button variant="secondary" onClick={startCreate}>
          قالب جدید
        </Button>
      }
    >
      {loading ? (
        <PageLoading />
      ) : (
        <>
          <Card title={editingId ? "ویرایش قالب" : "قالب جدید"}>
            <p className="hint" style={{ marginTop: 0 }}>
              Template ID را از پنل sms.ir (ارسال سریع / VERIFY) کپی کنید. نام پارامترها باید
              دقیقاً مثل کلید داخل قالب باشد (بدون #).
            </p>
            <div className="form-grid">
              <label>
                نام قالب
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="OTP ورود"
                />
              </label>
              <label>
                Template ID
                <input
                  type="number"
                  value={form.template_id}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, template_id: e.target.value }))
                  }
                  placeholder="123456"
                />
              </label>
              <label>
                کاربرد
                <select
                  value={form.purpose}
                  onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))}
                >
                  <option value="otp">OTP / کد تأیید</option>
                  <option value="custom">سایر</option>
                </select>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                />
                فعال
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={form.is_default}
                  onChange={(e) => setForm((f) => ({ ...f, is_default: e.target.checked }))}
                />
                پیش‌فرض برای OTP
              </label>
            </div>

            <div style={{ marginTop: 16 }}>
              <strong>پارامترها</strong>
              <div className="hint">برای هر کلید قالب یک ردیف بسازید.</div>
              <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                {form.parameters.map((p, i) => (
                  <div
                    key={i}
                    className="form-grid"
                    style={{
                      alignItems: "end",
                      padding: 10,
                      borderRadius: 10,
                      border: "1px solid rgba(148,163,184,0.25)"
                    }}
                  >
                    <label>
                      نام پارامتر
                      <input
                        value={p.name}
                        onChange={(e) => setParam(i, { name: e.target.value })}
                        placeholder="Code"
                      />
                    </label>
                    <label>
                      منبع مقدار
                      <select
                        value={p.source}
                        onChange={(e) =>
                          setParam(i, {
                            source: e.target.value === "static" ? "static" : "otp"
                          })
                        }
                      >
                        <option value="otp">کد OTP</option>
                        <option value="static">مقدار ثابت</option>
                      </select>
                    </label>
                    {p.source === "static" ? (
                      <label>
                        مقدار ثابت
                        <input
                          value={p.value}
                          onChange={(e) => setParam(i, { value: e.target.value })}
                          placeholder="مثلاً نام برند"
                        />
                      </label>
                    ) : (
                      <div className="hint">در ارسال، کد ۶ رقمی اینجا قرار می‌گیرد.</div>
                    )}
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => removeParam(i)}
                      disabled={form.parameters.length <= 1}
                    >
                      حذف
                    </Button>
                  </div>
                ))}
              </div>
              <div className="row-actions" style={{ marginTop: 10 }}>
                <Button size="sm" variant="secondary" onClick={addParam}>
                  + پارامتر
                </Button>
              </div>
            </div>

            <div className="row-actions" style={{ marginTop: 16 }}>
              <Button loading={busy} onClick={save}>
                {editingId ? "ذخیره تغییرات" : "ایجاد قالب"}
              </Button>
              {editingId ? (
                <Button variant="secondary" onClick={startCreate}>
                  انصراف
                </Button>
              ) : null}
            </div>
          </Card>

          <Card title="قالب‌های ثبت‌شده">
            {rows.length === 0 ? (
              <EmptyState
                title="قالبی نیست"
                text="اولین قالب OTP را بسازید تا ورود با پیامک کار کند."
              />
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>نام</th>
                    <th>Template ID</th>
                    <th>پارامترها</th>
                    <th>وضعیت</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <strong>{t.name}</strong>
                        <div className="hint">{t.purpose}</div>
                      </td>
                      <td>
                        <code>{t.template_id}</code>
                      </td>
                      <td>
                        {(t.parameters || [])
                          .map(
                            (p) =>
                              `${p.name}${p.source === "otp" ? "→OTP" : `=${p.value || "…"}`}`
                          )
                          .join(" · ") || "—"}
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {t.is_default ? <Badge tone="accent">پیش‌فرض OTP</Badge> : null}
                          <Badge tone={t.is_active ? "accent" : "danger"}>
                            {t.is_active ? "فعال" : "غیرفعال"}
                          </Badge>
                        </div>
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <Button size="sm" variant="secondary" onClick={() => startEdit(t)}>
                            ویرایش
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            loading={busy}
                            onClick={() => remove(t)}
                          >
                            حذف
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </SuperShell>
  );
}
