"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, saveSession } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Badge, Card, EmptyState } from "@/components/ui/Card";
import { PageLoading } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";

type Business = {
  org_id: string;
  name: string;
  plan: string;
  owner_phone: string;
  owner_name: string;
};

export default function AdminPage() {
  const router = useRouter();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<Business[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [plan, setPlan] = useState("growth");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api<Business[]>("/admin/businesses", { auth: false }));
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function createBusiness() {
    if (!name.trim() || !phone.trim()) {
      toast.push("نام و شماره لازم است", "err");
      return;
    }
    setBusy(true);
    try {
      await api("/admin/businesses", {
        method: "POST",
        auth: false,
        body: JSON.stringify({ name: name.trim(), phone: phone.trim(), plan })
      });
      toast.push("کسب‌وکار ساخته شد — این شماره می‌تواند با OTP وارد افزونه شود", "ok");
      setName("");
      setPhone("");
      await load();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setBusy(false);
    }
  }

  async function enterBusiness(orgId: string) {
    setBusy(true);
    try {
      const tok = await api<{
        access_token: string;
        refresh_token: string;
        user_id: string;
        org_id: string;
        role: string;
      }>("/admin/enter", {
        method: "POST",
        auth: false,
        body: JSON.stringify({ org_id: orgId })
      });
      saveSession(tok);
      toast.push("وارد پنل کسب‌وکار شدید", "ok");
      router.push("/home");
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap" style={{ alignItems: "stretch", padding: 24 }}>
      <div style={{ width: "min(920px, 100%)", margin: "0 auto" }}>
        <div style={{ marginBottom: 16 }}>
          <div className="brand">سوپر ادمین (توسعه)</div>
          <div className="brand-sub">بدون لاگین — ساخت کسب‌وکار با شماره مالک</div>
          <p className="hint" style={{ marginTop: 8 }}>
            شماره را اینجا ثبت کنید؛ بعد در افزونه فقط همان شماره + OTP (کد mock) کافی است.
          </p>
        </div>

        <Card title="ساخت کسب‌وکار جدید">
          <div className="form-grid">
            <label>
              نام کسب‌وکار
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="مثلاً آژانس نمونه"
              />
            </label>
            <label>
              شماره مالک (برای OTP افزونه)
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="0912..."
              />
            </label>
            <label>
              پلن
              <select value={plan} onChange={(e) => setPlan(e.target.value)}>
                <option value="starter">Starter</option>
                <option value="growth">Growth</option>
                <option value="scale">Scale</option>
              </select>
            </label>
            <Button loading={busy} onClick={createBusiness}>
              ثبت کسب‌وکار
            </Button>
          </div>
        </Card>

        <div style={{ marginTop: 16 }}>
        <Card title="کسب‌وکارها">
          {loading ? (
            <PageLoading />
          ) : rows.length === 0 ? (
            <EmptyState title="هنوز کسب‌وکاری نیست" text="از فرم بالا یکی بسازید." />
          ) : (
            <table>
              <thead>
                <tr>
                  <th>نام</th>
                  <th>شماره مالک</th>
                  <th>پلن</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.org_id}>
                    <td>
                      <strong>{b.name}</strong>
                      <div className="hint">{b.owner_name}</div>
                    </td>
                    <td>{b.owner_phone}</td>
                    <td>
                      <Badge tone="accent">{b.plan}</Badge>
                    </td>
                    <td>
                      <Button
                        variant="secondary"
                        loading={busy}
                        onClick={() => enterBusiness(b.org_id)}
                      >
                        ورود به پنل
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        </div>
      </div>
    </div>
  );
}
