import makeWASocket, {
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  isJidBroadcast,
  makeCacheableSignalKeyStore,
  type WASocket,
  type WAMessage,
} from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import pino from "pino";
import { api } from "./api-client.js";
import { loadAuthState } from "./auth-state.js";
import { mapBaileysMessage } from "./inbound-mapper.js";
import { maybeTranscribeAudio } from "./media.js";

const log = pino({ level: process.env.LOG_LEVEL || "info" });

export type SessionHandle = {
  accountId: string;
  sock: WASocket | null;
  connected: boolean;
  stop: () => Promise<void>;
  sendText: (jid: string, text: string) => Promise<void>;
  listGroups: () => Promise<Array<{ jid: string; subject: string; size: number }>>;
  groupParticipants: (
    jid: string
  ) => Promise<{ subject: string; participants: Array<Record<string, unknown>> }>;
};

export async function startSession(accountId: string): Promise<SessionHandle> {
  let sock: WASocket | null = null;
  let stopped = false;
  let connected = false;
  let restarting = false;

  const boot = async () => {
    if (stopped) return;
    const { state, saveCreds } = await loadAuthState(accountId);
    const { version } = await fetchLatestBaileysVersion();
    sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, log),
      },
      logger: log.child({ accountId }),
      printQRInTerminal: false,
      syncFullHistory: false,
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
    });

    sock.ev.on("creds.update", async () => {
      try {
        await saveCreds();
      } catch (err) {
        log.error({ err, accountId }, "saveCreds failed");
      }
    });

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        try {
          const dataUrl = await QRCode.toDataURL(qr);
          await api.putPairState(accountId, {
            pairing_state: "qr_pending",
            qr_payload: dataUrl,
            status: "offline",
          });
          log.info({ accountId }, "QR ready for panel");
        } catch (err) {
          log.error({ err, accountId }, "QR upload failed");
        }
      }
      if (connection === "open") {
        connected = true;
        const jid = sock?.user?.id || "";
        const phone = (jid.split(":")[0] || "").split("@")[0] || "";
        await api.putPairState(accountId, {
          pairing_state: "connected",
          qr_payload: "",
          wa_jid: jid.includes("@") ? jid.replace(/:\d+@/, "@") : jid,
          external_id: phone,
          status: "online",
        });
        await api.heartbeat(accountId);
        log.info({ accountId, jid }, "WhatsApp connected");
      }
      if (connection === "close") {
        connected = false;
        const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)
          ?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;
        log.warn({ accountId, statusCode }, "connection closed");
        if (loggedOut) {
          await api.putPairState(accountId, {
            pairing_state: "disconnected",
            qr_payload: "",
            status: "offline",
          });
          try {
            await api.clearAuth(accountId);
          } catch {
            /* ignore */
          }
          return;
        }
        if (!stopped && !restarting) {
          restarting = true;
          setTimeout(() => {
            restarting = false;
            void boot();
          }, 3000);
        }
      }
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify" && type !== "append") return;
      for (const msg of messages) {
        await handleInbound(accountId, sock!, msg);
      }
    });
  };

  await boot();

  return {
    accountId,
    get sock() {
      return sock;
    },
    get connected() {
      return connected;
    },
    stop: async () => {
      stopped = true;
      connected = false;
      try {
        sock?.end(undefined);
      } catch {
        /* ignore */
      }
      sock = null;
    },
    sendText: async (jid: string, text: string) => {
      if (!sock || !connected) throw new Error("socket not connected");
      await sock.sendMessage(jid, { text });
    },
    listGroups: async () => {
      if (!sock || !connected) return [];
      const all = await sock.groupFetchAllParticipating();
      return Object.values(all).map((g) => ({
        jid: g.id,
        subject: g.subject || "",
        size: g.participants?.length || 0,
      }));
    },
    groupParticipants: async (jid: string) => {
      if (!sock || !connected) return { subject: "", participants: [] };
      const meta = await sock.groupMetadata(jid);
      return {
        subject: meta.subject || "",
        participants: (meta.participants || []).map((p) => ({
          id: p.id,
          admin: p.admin || null,
        })),
      };
    },
  };
}

async function handleInbound(accountId: string, sock: WASocket, msg: WAMessage) {
  try {
    const jid = msg.key.remoteJid || "";
    if (!jid || isJidBroadcast(jid)) return;

    let mediaUrl = "";
    let transcribed = "";
    const m = msg.message;
    if (m?.imageMessage || m?.audioMessage || m?.documentMessage || m?.videoMessage) {
      try {
        const buffer = (await downloadMediaMessage(
          msg,
          "buffer",
          {},
          {
            logger: log,
            reuploadRequest: sock.updateMediaMessage,
          }
        )) as Buffer;
        const mime =
          m.imageMessage?.mimetype ||
          m.audioMessage?.mimetype ||
          m.videoMessage?.mimetype ||
          m.documentMessage?.mimetype ||
          "application/octet-stream";
        mediaUrl = `data:${mime};base64,${buffer.toString("base64")}`;
        if (m.audioMessage) {
          transcribed = await maybeTranscribeAudio(buffer, mime);
        }
      } catch (err) {
        log.warn({ err, accountId }, "media download failed");
      }
    }

    const payload = mapBaileysMessage(accountId, msg, {
      mediaUrl,
      transcribedBody: transcribed || undefined,
    });
    if (!payload) return;
    // fromMe outbound: store history, AI skipped by direction
    await api.ingest(accountId, payload);
  } catch (err) {
    log.error({ err, accountId }, "inbound handle failed");
  }
}
