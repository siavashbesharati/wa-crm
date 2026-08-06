"use client";

import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Badge, Card, EmptyState } from "@/components/ui/Card";
import { PageLoading } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";

type Account = {
  id: string;
  channel: string;
  label: string;
  external_id: string;
  phone: string;
  status: string;
};

type Session = {
  id: string;
  account_id: string;
  device_id: string;
  role: string;
  last_seen_at: string;
};

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: "واتساپ",
  divar: "دیوار"
};

export default function ChannelsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  async function load() {
    setLoading(true);
    try {
      setAccounts(await api<Account[]>("/channels/accounts"));
      setSessions(await api<Session[]>("/channels/sessions"));
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(() => {
      api<Account[]>("/channels/accounts").then(setAccounts).catch(() => undefined);
      api<Session[]>("/channels/sessions").then(setSessions).catch(() => undefined);
    }, 15000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Shell
      title="کانال‌ها"
      sub="به‌صورت خودکار از افزونه‌ای که با توکن صندلی وصل شده شناسایی می‌شوند"
    >
      {loading ? (
        <PageLoading />
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <Card title="اکانت‌های شناسایی‌شده">
            {accounts.length === 0 ? (
              <EmptyState
                title="هنوز کانالی نیست"
                text="توکن صندلی را در افزونه وارد کنید و تب واتساپ یا دیوار را باز بگذارید — کانال خودش ثبت می‌شود."
              />
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>کانال</th>
                    <th>برچسب</th>
                    <th>شناسه</th>
                    <th>وضعیت</th>
                    <th>شناسه سیستم</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <Badge tone="accent">{CHANNEL_LABELS[a.channel] || a.channel}</Badge>
                      </td>
                      <td>{a.label}</td>
                      <td>{a.external_id || a.phone || "-"}</td>
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

          <Card title="نشست‌های آنلاین">
            {sessions.length === 0 ? (
              <EmptyState
                title="نشست آنلاینی نیست"
                text="وقتی افزونه روی تب واتساپ یا دیوار فعال باشد، heartbeat اینجا دیده می‌شود."
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
        </div>
      )}
    </Shell>
  );
}
