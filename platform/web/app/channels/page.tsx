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

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: "واتساپ",
  divar: "دیوار"
};

function isOn(status: string) {
  const s = (status || "").toLowerCase();
  return s === "online" || s === "connected" || s === "ready" || s === "on";
}

export default function ChannelsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  async function load() {
    setLoading(true);
    try {
      setAccounts(await api<Account[]>("/channels/accounts"));
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
    }, 10000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Shell
      title="کانال‌ها"
      sub="وضعیت زنده از افزونه — وقتی تب واتساپ یا دیوار باز باشد، کانال روشن است"
    >
      {loading ? (
        <PageLoading />
      ) : (
        <Card
          title="اکانت‌های من"
          help={{
            title: "کانال‌ها",
            body: "اکانت‌های واتساپ و دیوار که از طریق افزونه به پنل وصل شده‌اند.",
            tips: [
              "روشن یعنی تب مربوطه باز و افزونه آنلاین است.",
              "توکن صندلی را در افزونه وارد کنید تا کانال خودش ثبت شود."
            ]
          }}
        >
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
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => {
                  const on = isOn(a.status);
                  return (
                    <tr key={a.id}>
                      <td>
                        <Badge tone="accent">{CHANNEL_LABELS[a.channel] || a.channel}</Badge>
                      </td>
                      <td>{a.label}</td>
                      <td>{a.external_id || a.phone || "-"}</td>
                      <td>
                        <Badge tone={on ? "online" : "offline"}>{on ? "روشن" : "خاموش"}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </Shell>
  );
}
