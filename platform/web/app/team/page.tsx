"use client";

import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Button } from "@/components/ui/Button";
import { Badge, Card, EmptyState } from "@/components/ui/Card";
import { PageLoading } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { useMutation } from "@/lib/useApi";
import { useToast } from "@/components/ui/Toast";

type Member = { id: string; user_id: string; phone: string; display_name: string; role: string };
type Org = { id: string; name: string; plan: string; limits: Record<string, unknown> };

export default function TeamPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [org, setOrg] = useState<Org | null>(null);
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("agent");
  const [plan, setPlan] = useState("starter");
  const [loading, setLoading] = useState(true);
  const { busy, run } = useMutation();
  const toast = useToast();

  async function load() {
    setLoading(true);
    try {
      setMembers(await api<Member[]>("/orgs/members"));
      const o = await api<Org>("/orgs/current");
      setOrg(o);
      setPlan(o.plan);
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function invite() {
    const ok = await run(
      () =>
        api("/orgs/members", {
          method: "POST",
          body: JSON.stringify({ phone, role })
        }),
      { success: "عضو دعوت شد" }
    );
    if (ok) {
      setPhone("");
      await load();
    }
  }

  async function updatePlan() {
    const ok = await run(
      () => api("/orgs/plan", { method: "PATCH", body: JSON.stringify({ plan }) }),
      { success: "پلن به‌روز شد" }
    );
    if (ok) await load();
  }

  return (
    <Shell title="اعضای تیم" sub="نقش‌ها و سقف پلن">
      {loading ? (
        <PageLoading />
      ) : (
        <>
          {org && (
            <Card title={org.name}>
              <div className="hint">
                پلن {org.plan} — حداکثر {String(org.limits.max_seats)} کاربر /{" "}
                {String(org.limits.max_channel_accounts || org.limits.max_wa_numbers)} اکانت کانال
              </div>
              <div className="row-actions" style={{ marginTop: 12 }}>
                <select value={plan} onChange={(e) => setPlan(e.target.value)} style={{ width: "auto" }}>
                  <option value="starter">Starter</option>
                  <option value="growth">Growth</option>
                  <option value="scale">Scale</option>
                </select>
                <Button variant="secondary" loading={busy} onClick={updatePlan}>
                  تغییر پلن
                </Button>
              </div>
            </Card>
          )}

          <Card title="دعوت عضو">
            <div className="form-grid">
              <label>
                موبایل عضو جدید
                <input value={phone} onChange={(e) => setPhone(e.target.value)} />
              </label>
              <label>
                نقش
                <select value={role} onChange={(e) => setRole(e.target.value)}>
                  <option value="agent">اپراتور</option>
                  <option value="admin">ادمین</option>
                  <option value="viewer">بازدیدکننده</option>
                </select>
              </label>
              <Button loading={busy} onClick={invite}>
                دعوت
              </Button>
            </div>
          </Card>

          <Card title="اعضا">
            {members.length === 0 ? (
              <EmptyState title="عضوی نیست" />
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>نام</th>
                    <th>موبایل</th>
                    <th>نقش</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.id}>
                      <td>{m.display_name || "-"}</td>
                      <td>{m.phone}</td>
                      <td>
                        <Badge tone="accent">{m.role}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </Shell>
  );
}
