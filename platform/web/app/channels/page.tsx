"use client";

import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Button } from "@/components/ui/Button";
import { Badge, Card, EmptyState } from "@/components/ui/Card";
import { PageLoading } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { useMutation } from "@/lib/useApi";
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
  const [channel, setChannel] = useState("whatsapp");
  const [label, setLabel] = useState("");
  const [externalId, setExternalId] = useState("");
  const [loading, setLoading] = useState(true);
  const { busy, run } = useMutation();
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

  async function create() {
    const ok = await run(
      () =>
        api("/channels/accounts", {
          method: "POST",
          body: JSON.stringify({
            channel,
            label,
            external_id: externalId,
            phone: channel === "whatsapp" ? externalId : ""
          })
        }),
      { success: "اکانت کانال افزوده شد" }
    );
    if (ok) {
      setLabel("");
      setExternalId("");
      await load();
    }
  }

  return (
    <Shell title="کانال‌ها" sub="واتساپ، دیوار و کانال‌های بعدی — محدود به پلن">
      <Card title="افزودن اکانت کانال">
        <div className="form-grid">
          <label>
            کانال
            <select value={channel} onChange={(e) => setChannel(e.target.value)}>
              <option value="whatsapp">واتساپ</option>
              <option value="divar">دیوار</option>
            </select>
          </label>
          <label>
            برچسب
            <input value={label} onChange={(e) => setLabel(e.target.value)} />
          </label>
          <label>
            {channel === "whatsapp" ? "شماره" : "شناسه / برچسب نشست"}
            <input
              value={externalId}
              onChange={(e) => setExternalId(e.target.value)}
              placeholder={channel === "whatsapp" ? "98912..." : "divar-main"}
            />
          </label>
          <Button loading={busy} onClick={create}>
            افزودن اکانت
          </Button>
        </div>
      </Card>

      {loading ? (
        <PageLoading />
      ) : (
        <>
          <Card title="اکانت‌ها">
            {accounts.length === 0 ? (
              <EmptyState title="اکانتی ثبت نشده" text="از فرم بالا یک اکانت کانال اضافه کنید." />
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
          <Card title="نشست‌های آنلاین (hybrid connector)">
            {sessions.length === 0 ? (
              <EmptyState
                title="نشست آنلاینی نیست"
                text="افزونه کانکتور را روی تب واتساپ یا دیوار وصل کنید تا heartbeat بیاید."
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
