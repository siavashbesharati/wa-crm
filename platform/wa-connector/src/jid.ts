/** JID / LID helpers for Baileys WhatsApp identities. */

export function jidServer(jid: string): string {
  const at = jid.indexOf("@");
  return at >= 0 ? jid.slice(at + 1) : "";
}

export function isLidJid(jid: string): boolean {
  return jidServer(jid) === "lid" || jid.endsWith("@lid");
}

export function isPnJid(jid: string): boolean {
  const s = jidServer(jid);
  return s === "s.whatsapp.net" || s === "c.us";
}

/** Strip device suffix: 98912:12@s.whatsapp.net → 98912@s.whatsapp.net */
export function stripDevice(jid: string): string {
  const [userHost, server] = jid.split("@");
  if (!server) return jid;
  const user = (userHost || "").split(":")[0] || "";
  return `${user}@${server}`;
}

/**
 * Extract a real phone number only from PN JIDs.
 * Returns "" for @lid / @g.us / unknown — never treat LID digits as a phone.
 */
export function phoneFromJid(jid: string | null | undefined): string {
  const raw = (jid || "").trim();
  if (!raw || isLidJid(raw) || raw.endsWith("@g.us") || raw.endsWith("@broadcast")) {
    return "";
  }
  if (!isPnJid(raw)) return "";
  const user = (raw.split("@")[0] || "").split(":")[0] || "";
  // Basic sanity: phone-like digits
  if (!/^\d{8,15}$/.test(user)) return "";
  return user;
}

export function preferPnJid(...candidates: Array<string | null | undefined>): string {
  for (const c of candidates) {
    const j = (c || "").trim();
    if (j && isPnJid(j)) return stripDevice(j);
  }
  for (const c of candidates) {
    const j = (c || "").trim();
    if (j) return stripDevice(j);
  }
  return "";
}

export type BaileysUserLike = {
  id?: string;
  lid?: string;
  jid?: string;
  phoneNumber?: string;
};

/** Resolve the connected account's phone number from sock.user. */
export function phoneFromConnectedUser(user: BaileysUserLike | null | undefined): string {
  if (!user) return "";
  // Prefer explicit phone JID / phoneNumber fields over opaque id (often @lid now)
  const fromJid = phoneFromJid(user.jid);
  if (fromJid) return fromJid;
  if (user.phoneNumber) {
    const digits = String(user.phoneNumber).replace(/\D/g, "");
    if (/^\d{8,15}$/.test(digits)) return digits;
  }
  const fromId = phoneFromJid(user.id);
  if (fromId) return fromId;
  return "";
}

export type MessageKeyLike = {
  remoteJid?: string | null;
  participant?: string | null;
  senderPn?: string | null;
  senderLid?: string | null;
  participantPn?: string | null;
  participantLid?: string | null;
  remoteJidAlt?: string | null;
  participantAlt?: string | null;
};

/** Prefer a Linked-ID (@lid) from candidates. */
export function preferLidJid(...candidates: Array<string | null | undefined>): string {
  for (const c of candidates) {
    const j = (c || "").trim();
    if (j && isLidJid(j)) return stripDevice(j);
  }
  return "";
}

/**
 * Chat identity for CRM:
 * - Prefer phone JID for DMs when available (senderPn / remoteJidAlt / PN remoteJid)
 * - Keep @lid as external_chat_id fallback when no PN known
 * - Always return `lid` when known so API can merge LID↔PN duplicates
 * - phone field only set when we have a real PN
 */
export function resolveChatIdentity(key: MessageKeyLike, isGroup: boolean) {
  const remoteJid = (key.remoteJid || "").trim();
  if (isGroup) {
    return {
      externalChatId: remoteJid,
      phone: "",
      groupId: remoteJid,
      lid: "",
    };
  }

  const pnCandidate = preferPnJid(
    key.senderPn,
    key.remoteJidAlt,
    key.participantPn,
    key.participantAlt,
    isPnJid(remoteJid) ? remoteJid : ""
  );
  const phone = phoneFromJid(pnCandidate);
  const lid = preferLidJid(
    isLidJid(remoteJid) ? remoteJid : "",
    key.senderLid,
    key.participantLid,
    // Alt fields are usually PN, but keep for completeness
    isLidJid(key.remoteJidAlt || "") ? key.remoteJidAlt : "",
    isLidJid(key.participantAlt || "") ? key.participantAlt : ""
  );
  // Stable chat id: prefer PN jid so leads merge correctly; else keep LID/remote
  const externalChatId = phone
    ? `${phone}@s.whatsapp.net`
    : lid || preferPnJid(remoteJid) || remoteJid;

  return {
    externalChatId,
    phone,
    groupId: "",
    lid,
  };
}
