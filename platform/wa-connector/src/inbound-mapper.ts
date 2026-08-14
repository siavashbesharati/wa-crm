import type { proto, WAMessage } from "@whiskeysockets/baileys";
import { phoneFromJid, resolveChatIdentity } from "./jid.js";

function extractText(msg: proto.IMessage | null | undefined): string {
  if (!msg) return "";
  if (msg.conversation) return msg.conversation;
  if (msg.extendedTextMessage?.text) return msg.extendedTextMessage.text;
  if (msg.imageMessage?.caption) return msg.imageMessage.caption;
  if (msg.videoMessage?.caption) return msg.videoMessage.caption;
  if (msg.documentMessage?.caption) return msg.documentMessage.caption;
  if (msg.buttonsResponseMessage?.selectedDisplayText) {
    return msg.buttonsResponseMessage.selectedDisplayText;
  }
  if (msg.listResponseMessage?.title) return msg.listResponseMessage.title;
  return "";
}

function mediaTypeOf(msg: proto.IMessage | null | undefined): string {
  if (!msg) return "";
  if (msg.imageMessage) return "image";
  if (msg.audioMessage) return "audio";
  if (msg.videoMessage) return "video";
  if (msg.documentMessage) return "document";
  if (msg.stickerMessage) return "sticker";
  return "text";
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
  // Skip empty non-media protocol noise
  if (!text && mType === "text") return null;

  const identity = resolveChatIdentity(key, isGroup);
  const pushName = (waMsg.pushName || "").trim();
  const chatName = isGroup
    ? pushName || remoteJid
    : pushName || identity.phone || phoneFromJid(identity.externalChatId) || remoteJid;

  return {
    account_id: accountId,
    chat_name: chatName || remoteJid,
    body: text || (mType !== "text" ? `[${mType}]` : ""),
    direction: fromMe ? "outbound" : "inbound",
    phone: identity.phone,
    group_id: identity.groupId,
    external_chat_id: identity.externalChatId,
    chat_type: isGroup ? "group" : "pv",
    external_message_id: `wa:${key.id}`,
    sender_type: fromMe ? "agent" : "customer",
    media_type: mType === "text" ? "" : mType,
    media_url: opts?.mediaUrl || "",
    trace_id: "",
  };
}
