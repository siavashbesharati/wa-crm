"use client";

import { useCallback, useEffect, useState } from "react";
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
  connector_type?: string;
  pairing_state?: string;
  wa_jid?: string;
};

type PairStatus = {
  account_id: string;
  pairing_state: string;
  status: string;
  qr_payload: string;
  wa_jid: string;
  connector_type: string;
};

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: "واتساپ",
  divar: "دیوار"
};

function isOn(status: string, pairing?: string) {
  const s = (status || "").toLowerCase();
  if (s === "online" || s === "connected" || s === "ready" || s === "on") return true;
  return (pairing || "").toLowerCase() === "connected";
}

export default function ChannelsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [qrAccountId, setQrAccountId] = useState<string | null>(null);
  const [pair, setPair] = useState<PairStatus | null>(null);
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

  const pollPair = useCallback(async (accountId: string) => {
    try {
      const st = await api<PairStatus>(`/channels/accounts/${accountId}/pair/status`);
      setPair(st);
      if (st.pairing_state === "connected") {
        toast.push("واتساپ متصل شد", "ok");
        setQrAccountId(null);
        void load();
      }
    } catch {
      /* ignore */
    }
  }, [toast]);

  useEffect(() => {
    if (!qrAccountId) return;
    void pollPair(qrAccountId);
    const t = setInterval(() => void pollPair(qrAccountId), 2000);
    return () => clearInterval(t);
  }, [qrAccountId, pollPair]);

  async function createBaileys() {
    setBusy(true);
    try {
      const acc = await api<Account>("/channels/accounts/baileys", { method: "POST" });
      toast.push("اکانت واتساپ سرور ساخته شد", "ok");
      await load();
      await startPair(acc.id);
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setBusy(false);
    }
  }

  async function startPair(accountId: string) {
    setBusy(true);
    try {
      await api(`/channels/accounts/${accountId}/pair/start`, { method: "POST" });
      setQrAccountId(accountId);
      setPair(null);
      toast.push("QR در حال آماده‌سازی… سرویس wa-connector را روشن کنید", "ok");
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setBusy(false);
    }
  }

  async function logoutPair(accountId: string) {
    setBusy(true);
    try {
      await api(`/channels/accounts/${accountId}/pair/logout`, { method: "POST" });
      if (qrAccountId === accountId) setQrAccountId(null);
      toast.push("اتصال قطع شد", "ok");
      await load();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell
      title="کانال‌ها"
      sub="واتساپ سرور (Baileys) با QR در پنل — دیوار همچنان از طریق افزونه"
    >
      {loading ? (
        <PageLoading />
      ) : (
        <>
          <Card
            title="اتصال واتساپ سرور"
            help={{
              title: "Baileys",
              body: "شماره واتساپ کسب‌وکار را با اسکن QR به سرور وصل کنید. افزونه Chrome برای واتساپ لازم نیست.",
              tips: [
                "سرویس platform/wa-connector باید در حال اجرا باشد.",
                "همان شماره را هم‌زمان روی افزونه و Baileys وصل نکنید."
              ]
            }}
          >
            <button type="button" className="btn primary" disabled={busy} onClick={() => void createBaileys()}>
              اتصال واتساپ جدید (QR)
            </button>
            {qrAccountId && (
              <div style={{ marginTop: 16, textAlign: "center" }}>
                <p>QR را با واتساپ موبایل اسکن کنید</p>
                {pair?.qr_payload ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={pair.qr_payload}
                    alt="WhatsApp QR"
                    width={280}
                    height={280}
                    style={{ borderRadius: 12, background: "#fff" }}
                  />
                ) : (
                  <p style={{ opacity: 0.7 }}>در انتظار QR از کانکتور…</p>
                )}
                <p style={{ fontSize: 13, marginTop: 8 }}>
                  وضعیت: {pair?.pairing_state || "qr_pending"}
                </p>
              </div>
            )}
          </Card>

          <Card
            title="اکانت‌های من"
            help={{
              title: "کانال‌ها",
              body: "اکانت‌های واتساپ (سرور یا افزونه) و دیوار.",
              tips: [
                "واتساپ Baileys: وضعیت از سرور.",
                "دیوار: توکن صندلی + تب باز در افزونه."
              ]
            }}
          >
            {accounts.length === 0 ? (
              <EmptyState
                title="هنوز کانالی نیست"
                text="برای واتساپ دکمه اتصال QR را بزنید؛ برای دیوار توکن صندلی را در افزونه وارد کنید."
              />
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>کانال</th>
                    <th>برچسب</th>
                    <th>نوع</th>
                    <th>شناسه</th>
                    <th>وضعیت</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((a) => {
                    const on = isOn(a.status, a.pairing_state);
                    const isBaileys = (a.connector_type || "extension") === "baileys";
                    return (
                      <tr key={a.id}>
                        <td>
                          <Badge tone="accent">{CHANNEL_LABELS[a.channel] || a.channel}</Badge>
                        </td>
                        <td>{a.label}</td>
                        <td>{isBaileys ? "سرور" : "افزونه"}</td>
                        <td>{a.external_id || a.phone || a.wa_jid || "-"}</td>
                        <td>
                          <Badge tone={on ? "online" : "offline"}>
                            {on ? "روشن" : a.pairing_state === "qr_pending" ? "QR" : "خاموش"}
                          </Badge>
                        </td>
                        <td>
                          {isBaileys && a.channel === "whatsapp" ? (
                            on ? (
                              <button type="button" className="btn" disabled={busy} onClick={() => void logoutPair(a.id)}>
                                قطع اتصال
                              </button>
                            ) : (
                              <button type="button" className="btn" disabled={busy} onClick={() => void startPair(a.id)}>
                                اتصال QR
                              </button>
                            )
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </Shell>
  );
}
