import type { proto, WAMessage } from "@whiskeysockets/baileys";
import { phoneFromJid, resolveChatIdentity } from "./jid.js";

/** Unwrap ephemeral / view-once wrappers Baileys nests around real content. */
function unwrapMessage(msg: proto.IMessage | null | undefined): proto.IMessage | null | undefined {
  if (!msg) return msg;
  const anyMsg = msg as Record<string, { message?: proto.IMessage } | undefined>;
  for (const key of [
    "ephemeralMessage",
    "viewOnceMessage",
    "viewOnceMessageV2",
    "viewOnceMessageV2Extension",
    "documentWithCaptionMessage",
    "editedMessage",
  ]) {
    const nested = anyMsg[key]?.message;
    if (nested) return unwrapMessage(nested);
  }
  return msg;
}

function extractText(msg: proto.IMessage | null | undefined): string {
  const m = unwrapMessage(msg);
  if (!m) return "";
  if (m.conversation) return m.conversation;
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
  if (m.imageMessage?.caption) return m.imageMessage.caption;
  if (m.videoMessage?.caption) return m.videoMessage.caption;
  if (m.documentMessage?.caption) return m.documentMessage.caption || m.documentMessage.fileName || "";
  if (m.buttonsResponseMessage?.selectedDisplayText) {
    return m.buttonsResponseMessage.selectedDisplayText;
  }
  if (m.templateButtonReplyMessage?.selectedDisplayText) {
    return m.templateButtonReplyMessage.selectedDisplayText;
  }
  if (m.listResponseMessage?.title) return m.listResponseMessage.title;
  // Reactions are often a single emoji — keep them as real text
  if (m.reactionMessage?.text) return m.reactionMessage.text;
  const interactive = (m as { interactiveResponseMessage?: { body?: { text?: string } } })
    .interactiveResponseMessage;
  if (interactive?.body?.text) return interactive.body.text;
  return "";
}

const MEDIA_LABEL_FA: Record<string, string> = {
  image: "تصویر",
  audio: "پیام صوتی",
  video: "ویدیو",
  document: "سند",
  sticker: "استیکر",
  reaction: "واکنش",
  contact: "مخاطب",
  location: "موقعیت",
  unknown: "رسانه",
};

function mediaTypeOf(msg: proto.IMessage | null | undefined): string {
  const m = unwrapMessage(msg);
  if (!m) return "";
  if (m.imageMessage) return "image";
  if (m.audioMessage) return "audio";
  if (m.videoMessage) return "video";
  if (m.documentMessage) return "document";
  if (m.stickerMessage) return "sticker";
  if (m.reactionMessage) return "reaction";
  if (m.contactMessage || m.contactsArrayMessage) return "contact";
  if (m.locationMessage || m.liveLocationMessage) return "location";
  // Real text-bearing types
  if (
    m.conversation ||
    m.extendedTextMessage ||
    m.buttonsResponseMessage ||
    m.listResponseMessage ||
    m.templateButtonReplyMessage
  ) {
    return "text";
  }
  // Protocol / empty envelopes — not useful chat content
  return "";
}

function placeholderFor(mType: string): string {
  const label = MEDIA_LABEL_FA[mType] || MEDIA_LABEL_FA.unknown;
  return `[${label}]`;
}

export type IngestPayload = {
  account_id: string;
  chat_name: string;
  body: string;
  direction: "inbound" | "outbound";
  phone: string;
  group_id: string;
  external_chat_id: string;
  chat_type: "pv" | "group";
  external_message_id: string;
  sender_type: "customer" | "agent" | "ai" | "system";
  media_type: string;
  media_url: string;
  trace_id: string;
};

export function mapBaileysMessage(
  accountId: string,
  waMsg: WAMessage,
  opts?: { mediaUrl?: string; transcribedBody?: string }
): IngestPayload | null {
  const key = waMsg.key as typeof waMsg.key & {
    senderPn?: string;
    senderLid?: string;
    participantPn?: string;
    participantLid?: string;
    remoteJidAlt?: string;
    participantAlt?: string;
  };
  if (!key?.remoteJid || !key.id) return null;
  // Ignore status / broadcast
  if (key.remoteJid === "status@broadcast") return null;

  const remoteJid = key.remoteJid;
  const isGroup = remoteJid.endsWith("@g.us");
  const fromMe = !!key.fromMe;
  const text = (opts?.transcribedBody || extractText(waMsg.message)).trim();
  const mType = mediaTypeOf(waMsg.message);

  // Skip empty protocol noise (never store "[]")
  if (!text && (!mType || mType === "text")) return null;

  const identity = resolveChatIdentity(key, isGroup);
  const pushName = (waMsg.pushName || "").trim();
  // Groups must use a stable group identity — never the sender pushName
  // (that would merge the private contact chat with the group).
  let chatName: string;
  let bodyText = text || (mType && mType !== "text" ? placeholderFor(mType) : "");
  if (!bodyText || bodyText === "[]") return null;

  if (isGroup) {
    chatName = identity.externalChatId || remoteJid;
    if (pushName && bodyText && !fromMe) {
      bodyText = `${pushName}: ${bodyText}`;
    }
  } else {
    chatName =
      pushName || identity.phone || phoneFromJid(identity.externalChatId) || remoteJid;
  }

  return {
    account_id: accountId,
    chat_name: chatName || remoteJid,
    body: bodyText,
    direction: fromMe ? "outbound" : "inbound",
    phone: isGroup ? "" : identity.phone,
    group_id: identity.groupId,
    external_chat_id: identity.externalChatId,
    chat_type: isGroup ? "group" : "pv",
    external_message_id: `wa:${key.id}`,
    sender_type: fromMe ? "agent" : "customer",
    media_type: !mType || mType === "text" ? "" : mType,
    media_url: opts?.mediaUrl || "",
    trace_id: "",
  };
}
