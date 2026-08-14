"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

type WaGroup = {
  jid: string;
  subject: string;
  size: number;
  owner?: string;
};

type WaParticipant = {
  id: string;
  lid?: string;
  jid?: string;
  phone?: string;
  admin?: string | null;
  is_admin?: boolean;
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

function downloadCsv(filename: string, rows: string[][]) {
  const esc = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const bom = "\uFEFF";
  const body = rows.map((r) => r.map(esc).join(",")).join("\n");
  const blob = new Blob([bom + body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ChannelsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [qrAccountId, setQrAccountId] = useState<string | null>(null);
  const [pair, setPair] = useState<PairStatus | null>(null);
  const [groupsAccountId, setGroupsAccountId] = useState<string>("");
  const [groups, setGroups] = useState<WaGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [membersBusyJid, setMembersBusyJid] = useState<string>("");
  const toast = useToast();

  const baileysOnline = useMemo(
    () =>
      accounts.filter(
        (a) =>
          a.channel === "whatsapp" &&
          (a.connector_type || "") === "baileys" &&
          isOn(a.status, a.pairing_state)
      ),
    [accounts]
  );

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

  useEffect(() => {
    if (!groupsAccountId && baileysOnline[0]) {
      setGroupsAccountId(baileysOnline[0].id);
    }
  }, [baileysOnline, groupsAccountId]);

  const pollPair = useCallback(
    async (accountId: string) => {
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
    },
    [toast]
  );

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
      if (groupsAccountId === accountId) {
        setGroups([]);
      }
      toast.push("اتصال قطع شد", "ok");
      await load();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setBusy(false);
    }
  }

  async function loadGroups() {
    if (!groupsAccountId) {
      toast.push("یک اکانت واتساپ متصل انتخاب کنید", "err");
      return;
    }
    setGroupsLoading(true);
    try {
      const res = await api<{ groups: WaGroup[] }>(`/channels/accounts/${groupsAccountId}/groups`);
      setGroups(Array.isArray(res.groups) ? res.groups : []);
      toast.push(`${(res.groups || []).length} گروه پیدا شد`, "ok");
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا در دریافت گروه‌ها", "err");
    } finally {
      setGroupsLoading(false);
    }
  }

  async function downloadMembers(group: WaGroup) {
    if (!groupsAccountId) return;
    setMembersBusyJid(group.jid);
    try {
      const q = new URLSearchParams({ jid: group.jid });
      const res = await api<{
        subject?: string;
        group_jid?: string;
        participants: WaParticipant[];
      }>(`/channels/accounts/${groupsAccountId}/groups/participants?${q.toString()}`);
      const rows: string[][] = [
        ["phone", "jid", "id", "lid", "admin", "group_subject", "group_jid"]
      ];
      for (const p of res.participants || []) {
        rows.push([
          p.phone || "",
          p.jid || "",
          p.id || "",
          p.lid || "",
          p.admin || (p.is_admin ? "admin" : ""),
          res.subject || group.subject || "",
          res.group_jid || group.jid
        ]);
      }
      const safeName = (group.subject || "group")
        .replace(/[\\/:*?"<>|]+/g, "_")
        .slice(0, 40);
      downloadCsv(`wa-group-${safeName}-members.csv`, rows);
      toast.push(`${(res.participants || []).length} عضو دانلود شد`, "ok");
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا در دانلود اعضا", "err");
    } finally {
      setMembersBusyJid("");
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
                              <button
                                type="button"
                                className="btn"
                                disabled={busy}
                                onClick={() => void logoutPair(a.id)}
                              >
                                قطع اتصال
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="btn"
                                disabled={busy}
                                onClick={() => void startPair(a.id)}
                              >
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

          <Card
            title="گروه‌های واتساپ"
            help={{
              title: "لیست و اعضا",
              body: "گروه‌هایی که این شماره عضو آن‌هاست را ببینید و لیست اعضا را CSV دانلود کنید.",
              tips: [
                "فقط اکانت Baileys متصل.",
                "بعضی اعضا ممکن است فقط شناسه LID داشته باشند (بدون شماره).",
                "دانلود زیاد/پیاپی می‌تواند محدودیت واتساپ ایجاد کند."
              ]
            }}
          >
            {baileysOnline.length === 0 ? (
              <EmptyState
                title="واتساپ متصل نیست"
                text="ابتدا یک اکانت واتساپ سرور را با QR وصل کنید."
              />
            ) : (
              <>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                  <label>
                    اکانت:{" "}
                    <select
                      value={groupsAccountId}
                      onChange={(e) => {
                        setGroupsAccountId(e.target.value);
                        setGroups([]);
                      }}
                    >
                      {baileysOnline.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.label || a.external_id || a.id.slice(0, 8)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="btn primary"
                    disabled={groupsLoading || !groupsAccountId}
                    onClick={() => void loadGroups()}
                  >
                    {groupsLoading ? "در حال دریافت…" : "دریافت لیست گروه‌ها"}
                  </button>
                </div>

                {groups.length > 0 ? (
                  <table style={{ marginTop: 16 }}>
                    <thead>
                      <tr>
                        <th>نام گروه</th>
                        <th>تعداد اعضا</th>
                        <th>JID</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {groups.map((g) => (
                        <tr key={g.jid}>
                          <td>{g.subject || "(بدون نام)"}</td>
                          <td>{g.size}</td>
                          <td style={{ fontSize: 12, opacity: 0.75 }}>{g.jid}</td>
                          <td>
                            <button
                              type="button"
                              className="btn"
                              disabled={membersBusyJid === g.jid}
                              onClick={() => void downloadMembers(g)}
                            >
                              {membersBusyJid === g.jid ? "…" : "دانلود اعضا (CSV)"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="hint" style={{ marginTop: 12 }}>
                    روی «دریافت لیست گروه‌ها» بزنید.
                  </p>
                )}
              </>
            )}
          </Card>
        </>
      )}
    </Shell>
  );
}
