"use client";

import { useEffect, useState } from "react";
import SuperShell from "@/components/SuperShell";
import { api } from "@/lib/api";
import { Badge, Card } from "@/components/ui/Card";
import { PageLoading } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";

type SystemStatus = {
  ok: boolean;
  env: string;
  counts: {
    businesses: number;
    active_businesses: number;
    users: number;
    leads: number;
    channel_accounts: number;
    channels_online: number;
  };
  openai_api_key_configured: boolean;
  openai_model: string;
};

export default function SuperSystemPage() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<SystemStatus | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        setData(await api<SystemStatus>("/admin/system", { platform: true }));
      } catch (e) {
        toast.push(e instanceof Error ? e.message : "خطا", "err");
      } finally {
        setLoading(false);
      }
    })();
  }, [toast]);

  return (
    <SuperShell title="وضعیت سیستم" sub="سلامت پلتفرم و شمارنده‌های سراسری">
      {loading || !data ? (
        <PageLoading />
      ) : (
        <div className="stack" style={{ display: "grid", gap: 16 }}>
          <Card title="محیط">
            <p style={{ margin: 0 }}>
              وضعیت: <Badge tone={data.ok ? "accent" : "danger"}>{data.ok ? "OK" : "خطا"}</Badge>
              {" · "}
              env: <strong>{data.env}</strong>
              {" · "}
              مدل: <strong>{data.openai_model}</strong>
              {" · "}
              کلید AI:{" "}
              <Badge tone={data.openai_api_key_configured ? "accent" : "danger"}>
                {data.openai_api_key_configured ? "هست" : "نیست"}
              </Badge>
            </p>
          </Card>
          <Card title="شمارنده‌ها">
            <table>
              <tbody>
                <tr>
                  <td>کسب‌وکارها</td>
                  <td>
                    <strong>{data.counts.businesses}</strong> (فعال:{" "}
                    {data.counts.active_businesses})
                  </td>
                </tr>
                <tr>
                  <td>کاربران</td>
                  <td>
                    <strong>{data.counts.users}</strong>
                  </td>
                </tr>
                <tr>
                  <td>لیدها</td>
                  <td>
                    <strong>{data.counts.leads}</strong>
                  </td>
                </tr>
                <tr>
                  <td>اکانت کانال</td>
                  <td>
                    <strong>{data.counts.channel_accounts}</strong> (آنلاین تقریبی:{" "}
                    {data.counts.channels_online})
                  </td>
                </tr>
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </SuperShell>
  );
}
