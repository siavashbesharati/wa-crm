"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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
  const [loading, setLoading] = useState(true);
  const { busy, run } = useMutation();
  const toast = useToast();

  async function load() {
    setLoading(true);
    try {
      setMembers(await api<Member[]>("/orgs/members"));
      setOrg(await api<Org>("/orgs/current"));
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

  return (
    <Shell title="اعضای تیم" sub="نقش‌ها و سقف پلن">
      {loading ? (
        <PageLoading />
      ) : (
        <>
          {org && (
            <Card
              title={org.name}
              help={{
                title: "سازمان",
                body: "نام کسب‌وکار و پلن فعلی. سقف صندلی افزونه از پلن می‌آید."
              }}
            >
              <div className="hint">
                پلن {org.plan} — حداکثر {String(org.limits.max_seats)} صندلی افزونه هم‌زمان
                (کانال‌ها نامحدود)
              </div>
              <div className="row-actions" style={{ marginTop: 12 }}>
                <Link className="btn secondary" href="/billing">
                  تمدید / ارتقای اشتراک
                </Link>
              </div>
            </Card>
          )}

          <Card
            title="دعوت عضو"
            help={{
              title: "دعوت عضو",
              body: "با شماره موبایل، اپراتور یا ادمین جدید به تیم اضافه کنید تا به لیدها و اینباکس دسترسی داشته باشد."
            }}
          >
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

          <Card
            title="اعضا"
            help={{
              title: "اعضای تیم",
              body: "فهرست کسانی که به این سازمان دسترسی دارند و نقش هرکدام."
            }}
          >
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
