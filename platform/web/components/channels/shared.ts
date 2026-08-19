export type ChannelAccount = {
  id: string;
  channel: string;
  label: string;
  external_id: string;
  phone: string;
  status: string;
  connector_type?: string;
  pairing_state?: string;
  wa_jid?: string;
  profile?: Record<string, string>;
};

const PAIRING_STATE_FA: Record<string, string> = {
  connected: "متصل",
  disconnected: "قطع‌شده",
  qr_pending: "در انتظار اسکن QR",
  code_pending: "در انتظار کد جفت‌سازی",
  otp_pending: "در انتظار کد تأیید",
  reconnecting: "در حال اتصال مجدد",
  auth_required: "نیاز به ورود دوباره",
  connecting: "در حال اتصال",
  error: "خطا"
  ,authenticating: "در حال ورود"
  ,two_factor_required: "نیاز به کد دومرحله‌ای"
  ,challenge_required: "نیاز به تأیید اینستاگرام"
};

const ACCOUNT_STATUS_FA: Record<string, string> = {
  online: "آنلاین",
  offline: "آفلاین",
  connected: "متصل",
  disconnected: "قطع‌شده",
  ready: "آماده",
  on: "روشن",
  off: "خاموش",
};

/** Translate pairing_state / connector status codes to Persian. */
export function pairingStateLabel(state?: string | null) {
  const key = (state || "").trim().toLowerCase();
  if (!key) return "نامشخص";
  return PAIRING_STATE_FA[key] || ACCOUNT_STATUS_FA[key] || state || "نامشخص";
}

export function accountStatusLabel(status?: string | null) {
  const key = (status || "").trim().toLowerCase();
  if (!key) return "نامشخص";
  return ACCOUNT_STATUS_FA[key] || PAIRING_STATE_FA[key] || status || "نامشخص";
}

export function isAccountOn(status: string, pairing?: string) {
  const s = (status || "").toLowerCase();
  // Live offline always wins — pairing may still say "connected" during reconnect
  if (s === "offline" || s === "disconnected") return false;
  if (s === "online" || s === "connected" || s === "ready" || s === "on") return true;
  const p = (pairing || "").toLowerCase();
  if (p === "reconnecting" || p === "disconnected" || p === "qr_pending" || p === "otp_pending" || p === "code_pending" || p === "auth_required") {
    return false;
  }
  return p === "connected";
}

export function asciiDigits(raw: string): string {
  const fa = "۰۱۲۳۴۵۶۷۸۹";
  const ar = "٠١٢٣٤٥٦٧٨٩";
  let out = "";
  for (const ch of raw || "") {
    const i = fa.indexOf(ch);
    if (i >= 0) {
      out += String(i);
      continue;
    }
    const j = ar.indexOf(ch);
    if (j >= 0) {
      out += String(j);
      continue;
    }
    if (ch >= "0" && ch <= "9") out += ch;
  }
  return out;
}

/** Canonical Iranian mobile 09XXXXXXXXX, or null. */
export function normalizeIrMobile(raw: string): string | null {
  let d = asciiDigits(raw);
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("98") && d.length === 12) d = `0${d.slice(2)}`;
  else if (d.startsWith("9") && d.length === 10) d = `0${d}`;
  return /^09\d{9}$/.test(d) ? d : null;
}

export function accountIdentity(a: ChannelAccount) {
  const raw = a.external_id || a.phone || a.wa_jid || "";
  if (!raw) return "—";
  return normalizeIrMobile(raw) || raw;
}

export function statusLabel(a: ChannelAccount) {
  if (isAccountOn(a.status, a.pairing_state)) return "متصل";
  const p = (a.pairing_state || "").toLowerCase();
  if (p && PAIRING_STATE_FA[p]) return PAIRING_STATE_FA[p];
  const s = (a.status || "").toLowerCase();
  if (s && ACCOUNT_STATUS_FA[s]) return ACCOUNT_STATUS_FA[s];
  return "خاموش";
}

export function statusEmoji(a: ChannelAccount) {
  if (isAccountOn(a.status, a.pairing_state)) return "🟢";
  const p = (a.pairing_state || "").toLowerCase();
  if (p === "reconnecting" || p === "connecting") return "🟡";
  if (p === "qr_pending" || p === "otp_pending" || p === "code_pending") return "🔵";
  if (p === "error") return "🔴";
  return "⚪";
}

export function isAccountNeedsReconnect(a: ChannelAccount) {
  if (isAccountOn(a.status, a.pairing_state)) return false;
  const p = (a.pairing_state || "").toLowerCase();
  // Intentional pairing flows — don't nag with the global banner
  if (p === "qr_pending" || p === "otp_pending" || p === "code_pending") return false;
  return true;
}
