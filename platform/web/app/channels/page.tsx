"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import Shell from "@/components/Shell";
import { Card, HelpTip } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { PageLoading, Spinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import {
  accountIdentity,
  isAccountOn,
  normalizeIrMobile,
  pairingStateLabel,
  statusEmoji,
  statusLabel,
  type ChannelAccount
} from "@/components/channels/shared";
import { ChannelBrand } from "@/components/channels/brand";
import { OtpBoxes } from "@/components/auth/OtpBoxes";

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
  | { kind: "divar"; accountId: string; step: "otp" | "code" }
  | { kind: "bale"; accountId: string; step: "phone" | "otp" | "done" };

type BalePairStatus = {
  account_id: string;
  pairing_state: string;
  status: string;
  phone?: string;
  display_name?: string;
  user_id?: string;
  message?: string;
};

export default function ChannelsPage() {
  const searchParams = useSearchParams();
  const connectHint = (searchParams.get("connect") || "").toLowerCase();
  const autoConnectRef = useRef(false);
  const [accounts, setAccounts] = useState<ChannelAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<PairModal | null>(null);
  const [pair, setPair] = useState<PairStatus | null>(null);
  const [divarPhone, setDivarPhone] = useState("");
  const [divarCode, setDivarCode] = useState("");
  const [balePhone, setBalePhone] = useState("");
  const [baleCode, setBaleCode] = useState("");
  const [baleProfile, setBaleProfile] = useState<{ name: string; userId: string; phone: string } | null>(null);
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
  const baleAccounts = useMemo(
    () => accounts.filter((a) => a.channel === "bale"),
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
    const phone = normalizeIrMobile(waPhone) || waPhone.trim();
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

  useEffect(() => {
    if (loading || autoConnectRef.current) return;
    if (connectHint !== "whatsapp" && connectHint !== "divar" && connectHint !== "bale") return;
    const list =
      connectHint === "whatsapp" ? waAccounts : connectHint === "divar" ? divarAccounts : baleAccounts;
    if (list.some((a) => isAccountOn(a.status, a.pairing_state))) {
      autoConnectRef.current = true;
      return;
    }
    autoConnectRef.current = true;
    const existing = list[0];
    if (existing) {
      if (connectHint === "whatsapp") openWhatsAppPair(existing.id);
      else if (connectHint === "divar") openDivarOtp(existing);
      else openBaleOtp(existing);
      return;
    }
    if (connectHint === "whatsapp") void addWhatsApp();
    else if (connectHint === "divar") void addDivar();
    else void addBale();
    // Open the matching pair flow once when arriving from a setup task.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, connectHint, waAccounts, divarAccounts, baleAccounts]);

  async function startDivarOtp() {
    if (!modal || modal.kind !== "divar") return;
    const phone = normalizeIrMobile(divarPhone);
    if (!phone) {
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
    if (!/^\d{6}$/.test(code)) {
      toast.push("کد ۶رقمی دیوار را وارد کنید", "err");
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

  async function addBale() {
    setBusy(true);
    try {
      const acc = await api<ChannelAccount>("/channels/accounts/bale-api", { method: "POST" });
      setBalePhone("");
      setBaleCode("");
      setBaleProfile(null);
      setModal({ kind: "bale", accountId: acc.id, step: "phone" });
      await load();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setBusy(false);
    }
  }

  function openBaleOtp(account: ChannelAccount) {
    setBalePhone(account.external_id || account.phone || "");
    setBaleCode("");
    setBaleProfile(null);
    setModal({ kind: "bale", accountId: account.id, step: "phone" });
  }

  async function startBaleOtp() {
    if (!modal || modal.kind !== "bale") return;
    const phone = normalizeIrMobile(balePhone) || balePhone.trim();
    if (!phone) {
      toast.push("شماره موبایل را وارد کنید", "err");
      return;
    }
    setBusy(true);
    try {
      await api(`/channels/accounts/${modal.accountId}/bale/pair/start`, {
        method: "POST",
        body: JSON.stringify({ phone })
      });
      setBaleCode("");
      setModal({ ...modal, step: "otp" });
      toast.push("کد ورود ارسال شد", "ok");
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا در ارسال کد", "err");
    } finally {
      setBusy(false);
    }
  }

  async function submitBaleCode() {
    if (!modal || modal.kind !== "bale") return;
    const code = baleCode.trim();
    if (!/^\d{5}$/.test(code)) {
      toast.push("کد ۵رقمی بله را وارد کنید", "err");
      return;
    }
    setBusy(true);
    try {
      const st = await api<BalePairStatus>(`/channels/accounts/${modal.accountId}/bale/pair/code`, {
        method: "POST",
        body: JSON.stringify({ code })
      });
      setBaleProfile({
        name: st.display_name || "",
        userId: st.user_id || "",
        phone: st.phone || balePhone
      });
      setModal({ ...modal, step: "done" });
      toast.push("بله متصل شد", "ok");
      await load();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "کد نامعتبر", "err");
    } finally {
      setBusy(false);
    }
  }

  async function logoutBale(accountId: string) {
    setBusy(true);
    try {
      await api(`/channels/accounts/${accountId}/bale/pair/logout`, { method: "POST" });
      if (modal?.kind === "bale" && modal.accountId === accountId) setModal(null);
      toast.push("اتصال بله قطع شد", "ok");
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
    setBaleProfile(null);
  }

  const connectedCount = accounts.filter((a) => isAccountOn(a.status, a.pairing_state)).length;

  return (
    <Shell
      title="کانال‌ها"
      sub={
        accounts.length
          ? `${connectedCount} حساب متصل از ${accounts.length}`
          : "واتساپ، دیوار و بله را جدا وصل کنید"
      }
    >
      {loading ? (
        <PageLoading variant="list" />
      ) : (
        <div className="channel-studio">
          <div className="channel-board">
            <ChannelCard
              channel="whatsapp"
              title="واتساپ"
              hint="اتصال با QR یا کد ۸رقمی"
              accounts={waAccounts}
              busy={busy}
              highlight={connectHint === "whatsapp"}
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
              highlight={connectHint === "divar"}
              onAdd={() => void addDivar()}
              onConnect={(a) => openDivarOtp(a)}
              onDisconnect={(a) => void logoutDivar(a.id)}
              onRemove={setRemoveTarget}
            />
            <ChannelCard
              channel="bale"
              title="بله"
              hint="اتصال با کد ورود برنامه بله"
              accounts={baleAccounts}
              busy={busy}
              highlight={connectHint === "bale"}
              onAdd={() => void addBale()}
              onConnect={(a) => openBaleOtp(a)}
              onDisconnect={(a) => void logoutBale(a.id)}
              onRemove={setRemoveTarget}
            />
          </div>
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
              <PairWait label="در حال دریافت کد جفت‌سازی…" />
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
              <PairWait label="در انتظار QR از سرور…" />
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
              <Button loading={busy} disabled={divarCode.trim().length !== 6} onClick={() => void submitDivarCode()}>
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
            <OtpBoxes length={6} value={divarCode} onChange={setDivarCode} autoFocus disabled={busy} />
          </div>
        )}
      </Modal>

      <Modal
        open={modal?.kind === "bale"}
        title={
          modal?.kind === "bale" && modal.step === "done"
            ? "بله متصل شد"
            : modal?.kind === "bale" && modal.step === "otp"
              ? "تأیید حساب بله"
              : "اتصال بله"
        }
        onClose={closeModal}
        panelClassName="pair-modal"
        footer={
          modal?.kind === "bale" && modal.step === "otp" ? (
            <>
              <Button variant="ghost" disabled={busy} onClick={() => setModal({ ...modal, step: "phone" })}>
                تغییر شماره
              </Button>
              <Button loading={busy} disabled={baleCode.trim().length !== 5} onClick={() => void submitBaleCode()}>
                تأیید و اتصال
              </Button>
            </>
          ) : modal?.kind === "bale" && modal.step === "done" ? (
            <Button onClick={closeModal}>تمام</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={closeModal}>
                انصراف
              </Button>
              <Button loading={busy} onClick={() => void startBaleOtp()}>
                ادامه
              </Button>
            </>
          )
        }
      >
        {modal?.kind === "bale" && modal.step === "phone" ? (
          <div className="pair-form">
            <p className="pair-lead">شماره موبایل حساب بله را وارد کنید.</p>
            <label>
              شماره موبایل
              <input
                className="ltr-text"
                value={balePhone}
                onChange={(e) => setBalePhone(e.target.value)}
                placeholder="+98 912 123 4567"
                dir="ltr"
                inputMode="tel"
                autoComplete="tel"
                autoFocus
              />
            </label>
            <p className="hint">۰۹۱۲…، +۹۸ یا ۹۸۹۱۲… پذیرفته می‌شود.</p>
          </div>
        ) : modal?.kind === "bale" && modal.step === "otp" ? (
          <div className="pair-form">
            <p className="pair-lead">
              کد ورود به برنامه بله شما ارسال شده است. آن را اینجا وارد کنید.
            </p>
            <p className="hint">اگر در شرایطی پیامک هم آمد، همان کد را وارد کنید.</p>
            <OtpBoxes length={5} value={baleCode} onChange={setBaleCode} autoFocus disabled={busy} />
          </div>
        ) : (
          <div className="pair-form">
            <p className="pair-lead">حساب بله با موفقیت وصل شد.</p>
            <ul className="bale-pair-summary">
              <li>
                حساب: <strong>{baleProfile?.name || "—"}</strong>
              </li>
              <li>
                شناسه بله:{" "}
                <strong dir="ltr">{baleProfile?.userId || "—"}</strong>
              </li>
              <li>
                شماره: <strong dir="ltr">{baleProfile?.phone || balePhone || "—"}</strong>
              </li>
            </ul>
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

const STATUS_HELP = [
  "🟢 سبز: متصل — پیام‌ها به پنل می‌آیند.",
  "🟡 زرد: در حال اتصال مجدد؛ کمی صبر کنید.",
  "🔵 آبی: در انتظار تأیید (QR یا کد).",
  "⚪ خاکستری: قطع یا خاموش — از آیکون دوشاخه دوباره وصل کنید.",
  "🔴 قرمز: خطا؛ اتصال را از نو بزنید یا حساب را حذف کنید.",
  "آیکون دوشاخه: اتصال / قطع · سطل زباله: حذف نشست."
];

const CHANNEL_CARD_COPY: Record<
  "whatsapp" | "divar" | "bale",
  { helpTitle: string; helpBody: string; helpTips: string[]; connect: string }
> = {
  whatsapp: {
    helpTitle: "واتساپ سرور",
    helpBody:
      "با «اتصال» یا «افزودن» یک نشست بسازید. در موبایل واتساپ: تنظیمات ← دستگاه‌های متصل ← پیوند دستگاه، بعد QR را اسکن کنید یا کد ۸رقمی را وارد کنید. عدد کنار نام (مثلاً ۰/۱) یعنی چند حساب از این کانال الان متصل است.",
    helpTips: ["سرویس wa-connector روی سرور باید روشن باشد.", ...STATUS_HELP],
    connect: "اتصال"
  },
  divar: {
    helpTitle: "دیوار سرور",
    helpBody:
      "شماره موبایل حساب دیوار را وارد کنید؛ کد ۶رقمی پیامک می‌شود. همان کد را در پنجره تأیید بنویسید. عدد کنار نام (مثلاً ۱/۱) تعداد حساب‌های متصل این کانال است.",
    helpTips: ["سرویس divar-connector روی سرور باید روشن باشد.", ...STATUS_HELP],
    connect: "اتصال"
  },
  bale: {
    helpTitle: "بله سرور",
    helpBody:
      "شماره موبایل حساب بله را وارد کنید. کد ۵رقمی معمولاً داخل برنامه بله می‌آید (گاهی پیامک). همان را وارد کنید تا نشست وصل شود. عدد کنار نام تعداد حساب‌های متصل است.",
    helpTips: ["سرویس bale-connector روی سرور باید روشن باشد.", ...STATUS_HELP],
    connect: "اتصال"
  }
};

function ChannelCard({
  channel,
  title,
  hint,
  accounts,
  busy,
  highlight,
  onAdd,
  extraAction,
  onConnect,
  onDisconnect,
  onRemove
}: {
  channel: "whatsapp" | "divar" | "bale";
  title: string;
  hint: string;
  accounts: ChannelAccount[];
  busy: boolean;
  highlight?: boolean;
  onAdd: () => void;
  extraAction?: ReactNode;
  onConnect: (a: ChannelAccount) => void;
  onDisconnect: (a: ChannelAccount) => void;
  onRemove: (a: ChannelAccount) => void;
}) {
  const empty = accounts.length === 0;
  const copy = CHANNEL_CARD_COPY[channel];
  const liveCount = accounts.filter((a) => isAccountOn(a.status, a.pairing_state)).length;
  return (
    <Card className={`channel-board-card${highlight ? " is-focus" : ""}`}>
      <header className="channel-card-head">
        <ChannelBrand channel={channel} size="xs" />
        <div className="channel-card-head-copy">
          <div className="channel-card-head-title">
            <h3>{title}</h3>
            <span className="channel-card-count">
              {liveCount}/{accounts.length}
            </span>
            <HelpTip
              help={{
                title: copy.helpTitle,
                body: copy.helpBody,
                tips: copy.helpTips
              }}
            />
          </div>
          <p className="channel-card-hint">{hint}</p>
        </div>
        <div className="channel-card-head-aside">
          {extraAction}
          <Button variant={empty ? "primary" : "ghost"} size="sm" loading={busy} onClick={onAdd}>
            {empty ? copy.connect : "افزودن"}
          </Button>
        </div>
      </header>

      <div className="channel-session-wrap">
        <table className="channel-session-table">
          <thead>
            <tr>
              <th>وضعیت</th>
              <th>نام</th>
              <th>شماره</th>
              <th>عمل</th>
            </tr>
          </thead>
          <tbody>
            {empty ? (
              <tr>
                <td className="channel-session-empty" colSpan={4}>
                  جلسه‌ای نیست
                </td>
              </tr>
            ) : (
              accounts.map((a) => {
                const on = isAccountOn(a.status, a.pairing_state);
                const label = statusLabel(a);
                return (
                  <tr key={a.id}>
                    <td className="channel-session-status">
                      <span title={label} aria-label={label}>
                        {statusEmoji(a)}
                      </span>
                    </td>
                    <td className="channel-session-name">{a.label || title}</td>
                    <td className="channel-session-num" dir="ltr">
                      {accountIdentity(a)}
                    </td>
                    <td className="channel-session-actions">
                      {on ? (
                        <button
                          type="button"
                          className="channel-icon-btn"
                          disabled={busy}
                          aria-label="قطع اتصال"
                          title="قطع اتصال"
                          onClick={() => onDisconnect(a)}
                        >
                          <IconUnplug />
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="channel-icon-btn"
                          disabled={busy}
                          aria-label="اتصال"
                          title="اتصال"
                          onClick={() => onConnect(a)}
                        >
                          <IconPlug />
                        </button>
                      )}
                      <button
                        type="button"
                        className="channel-icon-btn danger"
                        disabled={busy}
                        aria-label="حذف"
                        title="حذف"
                        onClick={() => onRemove(a)}
                      >
                        <IconTrash />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function PairWait({ label }: { label: string }) {
  return (
    <div className="pair-qr-wait" role="status" aria-live="polite" aria-busy="true">
      <span className="pair-qr-scan" aria-hidden />
      <Spinner dark lg />
      <span>{label}</span>
    </div>
  );
}

function IconPlug() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 22v-5" />
      <path d="M8 8V2" />
      <path d="M16 8V2" />
      <path d="M18 8v4a6 6 0 0 1-12 0V8Z" />
    </svg>
  );
}

function IconUnplug() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 22v-3" />
      <path d="M8 8V2" />
      <path d="M16 8V2" />
      <path d="M18 8v2.5" />
      <path d="M6 8v2.5a6 6 0 0 0 8.5 5.5" />
      <path d="m18 18-2-2" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}
