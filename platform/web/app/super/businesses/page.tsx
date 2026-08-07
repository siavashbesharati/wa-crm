"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import SuperShell from "@/components/SuperShell";
import { api, saveSession } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Badge, Card, EmptyState } from "@/components/ui/Card";
import { PageLoading } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";

type Business = {
  org_id: string;
  name: string;
  plan: string;
  status: string;
  owner_phone: string;
  owner_name: string;
};

type PlanOpt = { id: string; label: string; is_active?: boolean };

export default function SuperBusinessesPage() {
  const router = useRouter();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<Business[]>([]);
  const [planOpts, setPlanOpts] = useState<PlanOpt[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [plan, setPlan] = useState("growth");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [biz, plansRes] = await Promise.all([
        api<Business[]>("/admin/businesses", { platform: true }),
        api<{ plans: PlanOpt[] }>("/admin/plans", { platform: true }).catch(() => ({
          plans: []
        }))
      ]);
      setRows(biz);
      const opts = (plansRes.plans || []).filter((p) => p.is_active !== false);
      setPlanOpts(opts.length ? opts : [{ id: "starter", label: "Starter" }]);
      setPlan((prev) =>
        opts.some((p) => p.id === prev) ? prev : opts[0]?.id || "starter"
      );
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
        platform: true,
        body: JSON.stringify({ name: name.trim(), phone: phone.trim(), plan })
      });
      toast.push("کسب‌وکار ساخته شد", "ok");
      setName("");
      setPhone("");
      await load();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(orgId: string, status: "active" | "suspended") {
    setBusy(true);
    try {
      await api(`/admin/businesses/${orgId}`, {
        method: "PATCH",
        platform: true,
        body: JSON.stringify({ status })
      });
      toast.push(status === "active" ? "فعال شد" : "تعلیق شد", "ok");
      await load();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setBusy(false);
    }
  }

  async function changePlan(orgId: string, nextPlan: string) {
    setBusy(true);
    try {
      await api(`/admin/businesses/${orgId}`, {
        method: "PATCH",
        platform: true,
        body: JSON.stringify({ plan: nextPlan })
      });
      toast.push("پلن به‌روز شد", "ok");
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
        platform: true,
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
    <SuperShell title="کسب‌وکارها" sub="ثبت، پلن، تعلیق و ورود پشتیبانی به پنل هر سازمان">
      <div className="stack" style={{ display: "grid", gap: 16 }}>
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
              شماره مالک (OTP افزونه / پنل)
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="0912..."
              />
            </label>
            <label>
              پلن
              <select value={plan} onChange={(e) => setPlan(e.target.value)}>
                {planOpts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <Button loading={busy} onClick={createBusiness}>
              ثبت کسب‌وکار
            </Button>
          </div>
        </Card>

        <Card title="همه کسب‌وکارهای ثبت‌شده">
          {loading ? (
            <PageLoading />
          ) : rows.length === 0 ? (
            <EmptyState title="هنوز کسب‌وکاری نیست" text="از فرم بالا یکی بسازید." />
          ) : (
            <table>
              <thead>
                <tr>
                  <th>نام</th>
                  <th>مالک</th>
                  <th>پلن</th>
                  <th>وضعیت</th>
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
                      <select
                        value={b.plan}
                        disabled={busy}
                        onChange={(e) => changePlan(b.org_id, e.target.value)}
                        style={{ minWidth: 110 }}
                      >
                        {[
                          ...planOpts,
                          ...(!planOpts.some((p) => p.id === b.plan)
                            ? [{ id: b.plan, label: b.plan }]
                            : [])
                        ].map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <Badge tone={b.status === "active" ? "accent" : "danger"}>
                        {b.status === "active" ? "فعال" : "تعلیق"}
                      </Badge>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <Button
                          variant="secondary"
                          loading={busy}
                          onClick={() => enterBusiness(b.org_id)}
                        >
                          ورود به پنل
                        </Button>
                        {b.status === "active" ? (
                          <Button
                            variant="secondary"
                            loading={busy}
                            onClick={() => setStatus(b.org_id, "suspended")}
                          >
                            تعلیق
                          </Button>
                        ) : (
                          <Button
                            variant="secondary"
                            loading={busy}
                            onClick={() => setStatus(b.org_id, "active")}
                          >
                            فعال‌سازی
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </SuperShell>
  );
}
