"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import Shell from "@/components/Shell";
import { Badge, Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { PageLoading } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import {
  accountIdentity,
  isAccountOn,
  statusLabel,
  type ChannelAccount
} from "@/components/channels/shared";

type PairStatus = {
  account_id: string;
  pairing_state: string;
  status: string;
  qr_payload: string;
  wa_jid: string;
  connector_type: string;
};

type PairModal =
  | { kind: "whatsapp"; accountId: string }
  | { kind: "divar"; accountId: string; step: "otp" | "code" };

function WaMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2m.01 1.67c2.2 0 4.26.86 5.82 2.42a8.22 8.22 0 0 1 2.41 5.83c0 4.54-3.7 8.23-8.24 8.23-1.48 0-2.93-.39-4.19-1.15l-.3-.17-3.12.82.83-3.04-.2-.32a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24m-2.74 4.25c-.17 0-.44.06-.67.31-.23.26-.88.86-.88 2.1 0 1.24.9 2.44 1.02 2.61.13.17 1.76 2.67 4.25 3.75 2.07.9 2.49.72 2.94.67.45-.04 1.45-.59 1.65-1.16.21-.57.21-1.06.15-1.16-.06-.1-.23-.16-.48-.29-.25-.13-1.47-.73-1.7-.81-.23-.08-.39-.13-.56.13-.17.26-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.13-1.05-.39-2-1.23-.74-.66-1.24-1.47-1.38-1.72-.15-.26-.02-.4.11-.53.11-.11.25-.29.38-.43.12-.14.17-.25.25-.41.09-.17.04-.31-.02-.43-.06-.13-.55-1.33-.76-1.82-.2-.48-.4-.41-.56-.42"
      />
    </svg>
  );
}

function DivarMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5.2v-6.2H10.2V21H5a1 1 0 0 1-1-1z"
      />
    </svg>
  );
}

export default function ChannelsPage() {
  const [accounts, setAccounts] = useState<ChannelAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<PairModal | null>(null);
  const [pair, setPair] = useState<PairStatus | null>(null);
  const [divarPhone, setDivarPhone] = useState("");
  const [divarCode, setDivarCode] = useState("");
  const toast = useToast();

  const waAccounts = useMemo(
    () => accounts.filter((a) => a.channel === "whatsapp"),
    [accounts]
  );
  const divarAccounts = useMemo(
    () => accounts.filter((a) => a.channel === "divar"),
    [accounts]
  );

  async function load() {
    setLoading(true);
    try {
      setAccounts(await api<ChannelAccount[]>("/channels/accounts"));
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const t = setInterval(() => {
      api<ChannelAccount[]>("/channels/accounts").then(setAccounts).catch(() => undefined);
    }, 10000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pollPair = useCallback(
    async (accountId: string) => {
      try {
        const st = await api<PairStatus>(`/channels/accounts/${accountId}/pair/status`);
        setPair(st);
        if (st.pairing_state === "connected") {
          toast.push("واتساپ متصل شد", "ok");
          setModal(null);
          setPair(null);
          void load();
        }
      } catch {
        /* ignore */
      }
    },
    [toast]
  );

  useEffect(() => {
    if (!modal || modal.kind !== "whatsapp") return;
    void pollPair(modal.accountId);
    const t = setInterval(() => void pollPair(modal.accountId), 2000);
    return () => clearInterval(t);
  }, [modal, pollPair]);

  async function startWhatsAppPair(accountId: string) {
    await api(`/channels/accounts/${accountId}/pair/start`, { method: "POST" });
    setPair(null);
    setModal({ kind: "whatsapp", accountId });
  }

  async function addWhatsApp() {
    setBusy(true);
    try {
      const acc = await api<ChannelAccount>("/channels/accounts/baileys", { method: "POST" });
      await load();
      await startWhatsAppPair(acc.id);
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setBusy(false);
    }
  }

  async function reconnectWhatsApp(accountId: string) {
    setBusy(true);
    try {
      await startWhatsAppPair(accountId);
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
      if (modal?.kind === "whatsapp" && modal.accountId === accountId) {
        setModal(null);
        setPair(null);
      }
      toast.push("اتصال قطع شد", "ok");
      await load();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setBusy(false);
    }
  }

  async function addDivar() {
    setBusy(true);
    try {
      const acc = await api<ChannelAccount>("/channels/accounts/divar-api", { method: "POST" });
      setDivarPhone("");
      setDivarCode("");
      setModal({ kind: "divar", accountId: acc.id, step: "otp" });
      await load();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setBusy(false);
    }
  }

  function openDivarOtp(account: ChannelAccount) {
    setDivarPhone(account.external_id || account.phone || "");
    setDivarCode("");
    setModal({ kind: "divar", accountId: account.id, step: "otp" });
  }

  async function startDivarOtp() {
    if (!modal || modal.kind !== "divar") return;
    const phone = divarPhone.trim();
    if (!/^09\d{9}$/.test(phone)) {
      toast.push("شماره را مثل 09123456789 وارد کنید", "err");
      return;
    }
    setBusy(true);
    try {
      await api(`/channels/accounts/${modal.accountId}/divar/pair/start`, {
        method: "POST",
        body: JSON.stringify({ phone })
      });
      setModal({ ...modal, step: "code" });
      toast.push("کد تأیید ارسال شد", "ok");
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا در ارسال کد", "err");
    } finally {
      setBusy(false);
    }
  }

  async function submitDivarCode() {
    if (!modal || modal.kind !== "divar") return;
    const code = divarCode.trim();
    if (!/^\d{4,8}$/.test(code)) {
      toast.push("کد تأیید را وارد کنید", "err");
      return;
    }
    setBusy(true);
    try {
      await api(`/channels/accounts/${modal.accountId}/divar/pair/code`, {
        method: "POST",
        body: JSON.stringify({ code })
      });
      toast.push("دیوار متصل شد", "ok");
      setModal(null);
      setDivarCode("");
      await load();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "کد نامعتبر", "err");
    } finally {
      setBusy(false);
    }
  }

  async function logoutDivar(accountId: string) {
    setBusy(true);
    try {
      await api(`/channels/accounts/${accountId}/divar/pair/logout`, { method: "POST" });
      if (modal?.kind === "divar" && modal.accountId === accountId) setModal(null);
      toast.push("اتصال دیوار قطع شد", "ok");
      await load();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setBusy(false);
    }
  }

  function closeModal() {
    setModal(null);
    setPair(null);
  }

  return (
    <Shell title="کانال‌ها" sub="واتساپ و دیوار را جداگانه وصل کنید">
      {loading ? (
        <PageLoading variant="list" />
      ) : (
        <div className="channel-board">
          <ChannelCard
            channel="whatsapp"
            title="واتساپ"
            hint="اتصال با QR از موبایل"
            accounts={waAccounts}
            busy={busy}
            onAdd={() => void addWhatsApp()}
            extraAction={
              waAccounts.some((a) => isAccountOn(a.status, a.pairing_state)) ? (
                <Link href="/groups" className="channel-card-link">
                  گروه‌ها
                </Link>
              ) : null
            }
            onConnect={(a) => void reconnectWhatsApp(a.id)}
            onDisconnect={(a) => void logoutPair(a.id)}
          />
          <ChannelCard
            channel="divar"
            title="دیوار"
            hint="اتصال با کد تأیید پیامکی"
            accounts={divarAccounts}
            busy={busy}
            onAdd={() => void addDivar()}
            onConnect={(a) => openDivarOtp(a)}
            onDisconnect={(a) => void logoutDivar(a.id)}
          />
        </div>
      )}

      <Modal
        open={modal?.kind === "whatsapp"}
        title="اتصال واتساپ"
        onClose={closeModal}
        panelClassName="pair-modal"
        footer={
          <Button variant="secondary" onClick={closeModal}>
            بستن
          </Button>
        }
      >
        <div className="pair-qr">
          <p className="pair-lead">واتساپ موبایل را باز کنید و QR را اسکن کنید.</p>
          {pair?.qr_payload ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={pair.qr_payload} alt="کد QR واتساپ" width={260} height={260} />
          ) : (
            <div className="pair-qr-wait">در انتظار QR از سرور…</div>
          )}
          <p className="hint">وضعیت: {pair?.pairing_state || "qr_pending"}</p>
        </div>
      </Modal>

      <Modal
        open={modal?.kind === "divar"}
        title={modal?.kind === "divar" && modal.step === "code" ? "کد تأیید دیوار" : "اتصال دیوار"}
        onClose={closeModal}
        panelClassName="pair-modal"
        footer={
          modal?.kind === "divar" && modal.step === "code" ? (
            <>
              <Button variant="ghost" disabled={busy} onClick={() => setModal({ ...modal, step: "otp" })}>
                تغییر شماره
              </Button>
              <Button loading={busy} disabled={divarCode.trim().length < 4} onClick={() => void submitDivarCode()}>
                تأیید و اتصال
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={closeModal}>
                انصراف
              </Button>
              <Button loading={busy} onClick={() => void startDivarOtp()}>
                ارسال کد
              </Button>
            </>
          )
        }
      >
        {modal?.kind === "divar" && modal.step === "otp" ? (
          <div className="pair-form">
            <p className="pair-lead">شماره موبایل حساب دیوار را وارد کنید.</p>
            <label>
              شماره موبایل
              <input
                value={divarPhone}
                onChange={(e) => setDivarPhone(e.target.value)}
                placeholder="09123456789"
                dir="ltr"
                inputMode="tel"
                autoComplete="tel"
              />
            </label>
          </div>
        ) : (
          <div className="pair-form">
            <p className="pair-lead">کد پیامک‌شده به {divarPhone || "شماره"} را وارد کنید.</p>
            <label>
              کد تأیید
              <input
                className="pair-code-input"
                value={divarCode}
                onChange={(e) => setDivarCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
                placeholder="•••••"
                dir="ltr"
                inputMode="numeric"
                autoComplete="one-time-code"
              />
            </label>
          </div>
        )}
      </Modal>
    </Shell>
  );
}

function ChannelCard({
  channel,
  title,
  hint,
  accounts,
  busy,
  onAdd,
  extraAction,
  onConnect,
  onDisconnect
}: {
  channel: "whatsapp" | "divar";
  title: string;
  hint: string;
  accounts: ChannelAccount[];
  busy: boolean;
  onAdd: () => void;
  extraAction?: ReactNode;
  onConnect: (a: ChannelAccount) => void;
  onDisconnect: (a: ChannelAccount) => void;
}) {
  const empty = accounts.length === 0;
  return (
    <Card
      className={`channel-board-card ${channel}`}
      title={title}
      help={
        channel === "whatsapp"
          ? {
              title: "واتساپ سرور",
              body: "شماره واتساپ کسب‌وکار را با اسکن QR به سرور وصل کنید.",
              tips: ["سرویس wa-connector باید روشن باشد."]
            }
          : {
              title: "دیوار سرور",
              body: "با کد تأیید پیامکی شماره دیوار را وصل کنید.",
              tips: ["سرویس divar-connector باید روشن باشد."]
            }
      }
      actions={
        <div className="channel-card-actions">
          {extraAction}
          {!empty ? (
            <Button size="sm" loading={busy} onClick={onAdd}>
              افزودن
            </Button>
          ) : null}
        </div>
      }
    >
      <p className="channel-card-hint">{hint}</p>
      {empty ? (
        <div className="channel-empty">
          <span className={`channel-empty-mark ${channel}`}>
            {channel === "whatsapp" ? <WaMark /> : <DivarMark />}
          </span>
          <strong>هنوز وصل نشده</strong>
          <p>
            {channel === "whatsapp"
              ? "QR را با گوشی اسکن کنید تا پیام‌ها اینجا بیایند."
              : "با یک کد پیامکی حساب دیوار را به پنل وصل کنید."}
          </p>
          <Button loading={busy} onClick={onAdd}>
            {channel === "whatsapp" ? "اتصال واتساپ" : "اتصال دیوار"}
          </Button>
        </div>
      ) : (
        <ul className="channel-account-list">
          {accounts.map((a) => {
            const on = isAccountOn(a.status, a.pairing_state);
            return (
              <li key={a.id} className="channel-account-row">
                <span className={`channel-empty-mark sm ${channel}`} aria-hidden>
                  {channel === "whatsapp" ? <WaMark /> : <DivarMark />}
                </span>
                <div className="channel-account-meta">
                  <strong>{a.label || title}</strong>
                  <span dir="ltr">{accountIdentity(a)}</span>
                </div>
                <Badge tone={on ? "online" : "offline"}>{statusLabel(a)}</Badge>
                {on ? (
                  <Button variant="secondary" size="sm" disabled={busy} onClick={() => onDisconnect(a)}>
                    قطع اتصال
                  </Button>
                ) : (
                  <Button size="sm" disabled={busy} onClick={() => onConnect(a)}>
                    اتصال
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
