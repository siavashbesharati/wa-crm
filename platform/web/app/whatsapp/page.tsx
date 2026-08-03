"use client";

import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Button } from "@/components/ui/Button";
import { Badge, Card, EmptyState } from "@/components/ui/Card";
import { PageLoading } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { useMutation } from "@/lib/useApi";
import { useToast } from "@/components/ui/Toast";

type Account = { id: string; label: string; phone: string; status: string };
type Session = {
  id: string;
  account_id: string;
  device_id: string;
  role: string;
  last_seen_at: string;
};

export default function WhatsAppPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [label, setLabel] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(true);
  const { busy, run } = useMutation();
  const toast = useToast();

  async function load() {
    setLoading(true);
    try {
      setAccounts(await api<Account[]>("/whatsapp/accounts"));
      setSessions(await api<Session[]>("/whatsapp/sessions"));
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(() => {
      api<Account[]>("/whatsapp/accounts").then(setAccounts).catch(() => undefined);
      api<Session[]>("/whatsapp/sessions").then(setSessions).catch(() => undefined);
    }, 15000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function create() {
    const ok = await run(
      () =>
        api("/whatsapp/accounts", {
          method: "POST",
          body: JSON.stringify({ label, phone })
        }),
      { success: "شماره افزوده شد" }
    );
    if (ok) {
      setLabel("");
      setPhone("");
      await load();
    }
  }

  return (
    <Shell title="شماره‌های واتساپ" sub="چند شماره در هر سازمان — محدود به پلن">
      <Card title="افزودن شماره">
        <div className="form-grid">
          <label>
            برچسب
            <input value={label} onChange={(e) => setLabel(e.target.value)} />
          </label>
          <label>
            شماره
            <input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
          <Button loading={busy} onClick={create}>
            افزودن شماره
          </Button>
        </div>
      </Card>

      {loading ? (
        <PageLoading />
      ) : (
        <>
          <Card title="اکانت‌ها">
            {accounts.length === 0 ? (
              <EmptyState title="شماره‌ای ثبت نشده" text="از فرم بالا یک شماره اضافه کنید." />
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>برچسب</th>
                    <th>شماره</th>
                    <th>وضعیت</th>
                    <th>شناسه</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((a) => (
                    <tr key={a.id}>
                      <td>{a.label}</td>
                      <td>{a.phone}</td>
                      <td>
                        <Badge tone={a.status === "online" ? "online" : "offline"}>
                          {a.status}
                        </Badge>
                      </td>
                      <td className="hint">{a.id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <Card title="نشست‌های آنلاین (hybrid connector)">
            {sessions.length === 0 ? (
              <EmptyState
                title="نشست آنلاینی نیست"
                text="افزونه کانکتور را وصل کنید تا heartbeat بیاید."
              />
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>نقش</th>
                    <th>device</th>
                    <th>اکانت</th>
                    <th>آخرین دیده شدن</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <Badge tone="accent">{s.role}</Badge>
                      </td>
                      <td className="hint">{s.device_id}</td>
                      <td className="hint">{s.account_id}</td>
                      <td>{new Date(s.last_seen_at).toLocaleString("fa-IR")}</td>
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
