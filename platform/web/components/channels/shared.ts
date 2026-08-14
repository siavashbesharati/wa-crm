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
};

export function isAccountOn(status: string, pairing?: string) {
  const s = (status || "").toLowerCase();
  if (s === "online" || s === "connected" || s === "ready" || s === "on") return true;
  return (pairing || "").toLowerCase() === "connected";
}

export function accountIdentity(a: ChannelAccount) {
  return a.external_id || a.phone || a.wa_jid || "—";
}

export function statusLabel(a: ChannelAccount) {
  if (isAccountOn(a.status, a.pairing_state)) return "روشن";
  const p = (a.pairing_state || "").toLowerCase();
  if (p === "qr_pending") return "در انتظار QR";
  if (p === "otp_pending") return "در انتظار کد";
  return "خاموش";
}
