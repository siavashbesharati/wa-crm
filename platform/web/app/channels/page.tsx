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
  pairingStateLabel,
  statusLabel,
  type ChannelAccount
} from "@/components/channels/shared";
import { ChannelBrand } from "@/components/channels/brand";

type PairStatus = {
  account_id: string;
  pairing_state: string;
  status: string;
  qr_payload: string;
  wa_jid: string;
  connector_type: string;
  phone?: string;
};

type PairModal =
  | { kind: "whatsapp"; accountId: string; mode: "qr" | "code"; step: "choose" | "active" }
  | { kind: "divar"; accountId: string; step: "otp" | "code" };

export default function ChannelsPage() {
  const [accounts, setAccounts] = useState<ChannelAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<PairModal | null>(null);
  const [pair, setPair] = useState<PairStatus | null>(null);
  const [divarPhone, setDivarPhone] = useState("");
  const [divarCode, setDivarCode] = useState("");
  const [waPhone, setWaPhone] = useState("");
  const [removeTarget, setRemoveTarget] = useState<ChannelAccount | null>(null);
  const toast = useToast();

  const waAccounts = useMemo(
    () => accounts.filter((a) => a.channel === "whatsapp"),
    [accounts]
  );
  const divarAccounts = useMemo(
    () => accounts.filter((a) => a.channel === "divar"),
    [accounts]
  );

  async function load(opts?: { quiet?: boolean }) {
    if (!opts?.quiet) setLoading(true);
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
    if (!modal || modal.kind !== "whatsapp" || modal.step !== "active") return;
    void pollPair(modal.accountId);
    const t = setInterval(() => void pollPair(modal.accountId), 2000);
    return () => clearInterval(t);
  }, [modal, pollPair]);

  async function startWhatsAppQr(accountId: string) {
    await api(`/channels/accounts/${accountId}/pair/start`, { method: "POST" });
    setPair(null);
    setModal({ kind: "whatsapp", accountId, mode: "qr", step: "active" });
  }

  async function startWhatsAppCode(accountId: string) {
    const phone = waPhone.trim();
    if (!phone) {
      toast.push("شماره واتساپ را وارد کنید", "err");
      return;
    }
    setBusy(true);
    try {
      await api(`/channels/accounts/${accountId}/pair/code/start`, {
        method: "POST",
        body: JSON.stringify({ phone })
      });
      setPair(null);
      setModal({ kind: "whatsapp", accountId, mode: "code", step: "active" });
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setBusy(false);
    }
  }

  function openWhatsAppPair(accountId: string) {
    setWaPhone("");
    setPair(null);
    setModal({ kind: "whatsapp", accountId, mode: "qr", step: "choose" });
  }

  async function addWhatsApp() {
    setBusy(true);
    try {
      const acc = await api<ChannelAccount>("/channels/accounts/baileys", { method: "POST" });
      await load();
      openWhatsAppPair(acc.id);
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setBusy(false);
    }
  }

  async function reconnectWhatsApp(accountId: string) {
    openWhatsAppPair(accountId);
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

  async function removeAccount() {
    if (!removeTarget) return;
    const id = removeTarget.id;
    setBusy(true);
    try {
      await api(`/channels/accounts/${id}`, { method: "DELETE" });
      if (modal?.accountId === id) {
        setModal(null);
        setPair(null);
      }
      setRemoveTarget(null);
      toast.push("کانال و ورود آن حذف شد", "ok");
      await load({ quiet: true });
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا در حذف کانال", "err");
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
            hint="اتصال با QR یا کد ۸رقمی"
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
            onRemove={setRemoveTarget}
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
            onRemove={setRemoveTarget}
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
        {modal?.kind === "whatsapp" && modal.step === "choose" ? (
          <div className="wa-pair-choose">
            <p className="pair-lead">چطور می‌خواهید وصل شوید؟</p>
            <div className="wa-pair-mode-tabs">
              <button
                type="button"
                className={`wa-pair-mode${modal.mode === "qr" ? " active" : ""}`}
                onClick={() => setModal({ ...modal, mode: "qr" })}
              >
                اسکن QR
              </button>
              <button
                type="button"
                className={`wa-pair-mode${modal.mode === "code" ? " active" : ""}`}
                onClick={() => setModal({ ...modal, mode: "code" })}
              >
                کد جفت‌سازی
              </button>
            </div>
            {modal.mode === "qr" ? (
              <div className="wa-pair-pane">
                <p className="hint">
                  در واتساپ موبایل: تنظیمات ← دستگاه‌های متصل ← پیوند دستگاه، سپس QR را اسکن کنید.
                </p>
                <Button
                  loading={busy}
                  onClick={() => void startWhatsAppQr(modal.accountId)}
                >
                  نمایش QR
                </Button>
              </div>
            ) : (
              <div className="wa-pair-pane">
                <p className="hint">
                  شماره واتساپ را با کد کشور وارد کنید، سپس کد ۸رقمی را در موبایل در
                  «پیوند با شماره تلفن» وارد کنید.
                </p>
                <label className="wa-pair-phone">
                  شماره (مثلاً 0912… یا 98912…)
                  <input
                    className="ltr-text"
                    dir="ltr"
                    value={waPhone}
                    onChange={(e) => setWaPhone(e.target.value)}
                    placeholder="989121234567"
                    autoFocus
                  />
                </label>
                <Button loading={busy} onClick={() => void startWhatsAppCode(modal.accountId)}>
                  دریافت کد
                </Button>
              </div>
            )}
          </div>
        ) : modal?.kind === "whatsapp" && modal.mode === "code" ? (
          <div className="pair-qr">
            <p className="pair-lead">
              در واتساپ: تنظیمات ← دستگاه‌های متصل ← پیوند دستگاه ← پیوند با شماره تلفن
            </p>
            {pair?.qr_payload && !pair.qr_payload.startsWith("data:") ? (
              <div className="wa-pair-code-display" dir="ltr">
                {pair.qr_payload}
              </div>
            ) : (
              <div className="pair-qr-wait">در حال دریافت کد جفت‌سازی…</div>
            )}
            <p className="hint">
              شماره: {pair?.phone || waPhone || "—"} · وضعیت:{" "}
              {pairingStateLabel(pair?.pairing_state || "code_pending")}
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setModal({ kind: "whatsapp", accountId: modal.accountId, mode: "code", step: "choose" })
              }
            >
              تغییر روش / شماره
            </Button>
          </div>
        ) : (
          <div className="pair-qr">
            <p className="pair-lead">واتساپ موبایل را باز کنید و QR را اسکن کنید.</p>
            {pair?.qr_payload && pair.qr_payload.startsWith("data:") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={pair.qr_payload} alt="کد QR واتساپ" width={260} height={260} />
            ) : (
              <div className="pair-qr-wait">در انتظار QR از سرور…</div>
            )}
            <p className="hint">
              وضعیت: {pairingStateLabel(pair?.pairing_state || "qr_pending")}
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setModal({ kind: "whatsapp", accountId: modal!.accountId, mode: "qr", step: "choose" })
              }
            >
              تغییر روش اتصال
            </Button>
          </div>
        )}
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
      <Modal
        open={!!removeTarget}
        title="حذف کانال"
        onClose={() => setRemoveTarget(null)}
        panelClassName="pair-modal"
        footer={
          <>
            <Button variant="secondary" disabled={busy} onClick={() => setRemoveTarget(null)}>
              انصراف
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void removeAccount()}>
              حذف کانال
            </Button>
          </>
        }
      >
        {removeTarget ? (
          <p className="pair-lead" style={{ textAlign: "start" }}>
            «{removeTarget.label || accountIdentity(removeTarget)}» و نشست ورود آن حذف می‌شود.
            برای وصل دوباره باید دوباره QR یا کد تأیید بزنید.
          </p>
        ) : null}
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
  onDisconnect,
  onRemove
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
  onRemove: (a: ChannelAccount) => void;
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
          <ChannelBrand channel={channel} size="lg" />
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
                <ChannelBrand channel={channel} size="sm" />
                <div className="channel-account-meta">
                  <strong>{a.label || title}</strong>
                  <span dir="ltr">{accountIdentity(a)}</span>
                </div>
                <Badge tone={on ? "online" : "offline"}>{statusLabel(a)}</Badge>
                <div className="channel-account-actions">
                  {on ? (
                    <Button variant="secondary" size="sm" disabled={busy} onClick={() => onDisconnect(a)}>
                      قطع اتصال
                    </Button>
                  ) : (
                    <Button size="sm" disabled={busy} onClick={() => onConnect(a)}>
                      اتصال
                    </Button>
                  )}
                  <Button variant="danger" size="sm" disabled={busy} onClick={() => onRemove(a)}>
                    حذف
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
