"use client";

import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Button } from "@/components/ui/Button";
import { Card, EmptyState } from "@/components/ui/Card";
import { Switch } from "@/components/ui/Switch";
import { PageLoading } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";

type Account = { id: string; label?: string; external_id?: string; status?: string; pairing_state?: string };
type Condition = { type: "contains"; value: string };
type Action = { type: string; text?: string; tag?: string };
type Rule = {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  trigger_type: string;
  source_channel: string;
  source_account_id: string | null;
  conditions: Condition[];
  actions: Action[];
  created_at: string;
  updated_at: string;
};

const EMPTY_FORM = {
  name: "",
  keyword: "",
  accountId: "",
  publicReply: "",
  dm: "",
  tag: "",
  enabled: true,
  priority: 0
};

type FormState = typeof EMPTY_FORM;

function accountName(account: Account) {
  return account.label || account.external_id || account.id.slice(0, 8);
}

export default function AutomationsPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function load() {
    setLoading(true);
    try {
      const [nextRules, nextAccounts] = await Promise.all([
        api<Rule[]>("/automations"),
        api<Account[]>("/channels/accounts?channel=instagram")
      ]);
      setRules(nextRules);
      setAccounts(nextAccounts);
      if (!form.accountId && nextAccounts[0]?.id) {
        setForm((current) => ({ ...current, accountId: nextAccounts[0].id }));
      }
    } catch (error) {
      toast.push(error instanceof Error ? error.message : "خطا", "err");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function reset() {
    setForm({ ...EMPTY_FORM, accountId: accounts[0]?.id || "" });
    setEditingId(null);
  }

  function edit(rule: Rule) {
    const publicReply = rule.actions.find((action) => action.type === "public_reply" || action.type === "comment_reply");
    const dm = rule.actions.find((action) => action.type === "dm" || action.type === "send_dm");
    const tag = rule.actions.find((action) => action.type === "tag");
    setEditingId(rule.id);
    setForm({
      name: rule.name,
      keyword: rule.conditions.find((condition) => condition.type === "contains")?.value || "",
      accountId: rule.source_account_id || accounts[0]?.id || "",
      publicReply: publicReply?.text || "",
      dm: dm?.text || "",
      tag: tag?.tag || "",
      enabled: rule.enabled,
      priority: rule.priority
    });
  }

  function actionsFromForm() {
    const actions: Action[] = [];
    if (form.publicReply.trim()) actions.push({ type: "public_reply", text: form.publicReply.trim() });
    if (form.dm.trim()) actions.push({ type: "send_dm", text: form.dm.trim() });
    if (form.tag.trim()) actions.push({ type: "tag", tag: form.tag.trim() });
    return actions;
  }

  async function save() {
    if (!form.name.trim() || !form.keyword.trim()) {
      toast.push("نام قانون و کلمه کلیدی لازم است", "err");
      return;
    }
    if (!form.publicReply.trim() && !form.dm.trim() && !form.tag.trim()) {
      toast.push("حداقل یک عمل انتخاب کنید", "err");
      return;
    }
    setBusy(true);
    try {
      const payload = {
        name: form.name.trim(),
        enabled: form.enabled,
        priority: Number(form.priority) || 0,
        trigger_type: "instagram_comment",
        source_channel: "instagram",
        source_account_id: form.accountId || null,
        conditions: [{ type: "contains", value: form.keyword.trim() }],
        actions: actionsFromForm()
      };
      await api(editingId ? `/automations/${editingId}` : "/automations", {
        method: editingId ? "PATCH" : "POST",
        body: JSON.stringify(payload)
      });
      toast.push(editingId ? "قانون به‌روزرسانی شد" : "قانون ساخته شد", "ok");
      reset();
      await load();
    } catch (error) {
      toast.push(error instanceof Error ? error.message : "خطا", "err");
    } finally {
      setBusy(false);
    }
  }

  async function remove(rule: Rule) {
    if (!window.confirm(`حذف قانون «${rule.name}»؟`)) return;
    setBusy(true);
    try {
      await api(`/automations/${rule.id}`, { method: "DELETE" });
      toast.push("قانون حذف شد", "ok");
      if (editingId === rule.id) reset();
      await load();
    } catch (error) {
      toast.push(error instanceof Error ? error.message : "خطا", "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell title="اتوماسیون" sub="قوانین کامنت اینستاگرام و پاسخ خودکار">
      {loading ? <PageLoading variant="list" /> : (
        <div className="crm-page-grid">
          <Card>
            <div className="card-head">
              <div>
                <h2>{editingId ? "ویرایش قانون" : "قانون جدید"}</h2>
                <p className="muted">برای کامنت‌های جدید اینستاگرام شرط و عمل تعیین کنید.</p>
              </div>
              {editingId ? <Button variant="ghost" onClick={reset}>انصراف</Button> : null}
            </div>
            {accounts.length === 0 ? <EmptyState title="اکانت اینستاگرام ندارید" body="ابتدا از صفحه کانال‌ها یک حساب اینستاگرام وصل کنید." /> : (
              <div className="form-stack">
                <label>نام قانون<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
                <label>اکانت اینستاگرام<select value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })}>{accounts.map((account) => <option key={account.id} value={account.id}>{accountName(account)}</option>)}</select></label>
                <label>اگر کامنت شامل این عبارت بود<input dir="rtl" value={form.keyword} onChange={(e) => setForm({ ...form, keyword: e.target.value })} placeholder="قیمت" /></label>
                <label>پاسخ عمومی کامنت<textarea rows={3} value={form.publicReply} onChange={(e) => setForm({ ...form, publicReply: e.target.value })} placeholder="سلام، اطلاعات را برایتان دایرکت کردیم." /></label>
                <label>پیام دایرکت اختیاری<textarea rows={3} value={form.dm} onChange={(e) => setForm({ ...form, dm: e.target.value })} /></label>
                <label>برچسب CRM<input dir="ltr" value={form.tag} onChange={(e) => setForm({ ...form, tag: e.target.value })} placeholder="price-inquiry" /></label>
                <label>اولویت<input type="number" min={0} value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })} /></label>
                <Switch label="فعال" checked={form.enabled} onChange={(checked) => setForm({ ...form, enabled: checked })} />
                <Button loading={busy} onClick={() => void save()}>{editingId ? "ذخیره تغییرات" : "ساخت قانون"}</Button>
              </div>
            )}
          </Card>
          <Card>
            <div className="card-head"><div><h2>قوانین فعال</h2><p className="muted">قوانین به ترتیب اولویت بررسی می‌شوند.</p></div></div>
            {rules.length === 0 ? <EmptyState title="هنوز قانونی ساخته نشده" body="اولین پاسخ خودکار کامنت را از فرم کنار صفحه بسازید." /> : (
              <div className="list-stack">
                {rules.map((rule) => (
                  <div className="list-row" key={rule.id}>
                    <div><strong>{rule.name}</strong><p className="muted">شامل «{rule.conditions[0]?.value || ""}» · {rule.actions.length} عمل · اولویت {rule.priority}</p></div>
                    <div className="row-actions"><span className={rule.enabled ? "status-on" : "status-off"}>{rule.enabled ? "فعال" : "خاموش"}</span><Button size="sm" variant="ghost" onClick={() => edit(rule)}>ویرایش</Button><Button size="sm" variant="danger" loading={busy} onClick={() => void remove(rule)}>حذف</Button></div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </Shell>
  );
}
