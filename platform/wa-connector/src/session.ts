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
import { phoneFromConnectedUser, phoneFromJid, preferPnJid, isLidJid, isPnJid, stripDevice } from "./jid.js";

const log = pino({
  level: process.env.LOG_LEVEL || "info",
  base: { source: "whatsapp" },
});

export type SessionHandle = {
  accountId: string;
  sock: WASocket | null;
  connected: boolean;
  stop: () => Promise<void>;
  sendText: (jid: string, text: string) => Promise<string>;
  /** Ask WhatsApp for presence updates for this chat. */
  subscribePresence: (jid: string) => Promise<void>;
  /** Broadcast our own presence (composing / paused / …). */
  sendPresence: (state: string, jid?: string) => Promise<void>;
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
  let pairingCodeRequested = false;
  let authFlush: (() => Promise<void>) | null = null;
  const subscribedPresence = new Set<string>();
  /** Keep "typing…" alive while AI prepares a reply (presence expires ~10s). */
  const composingTimers = new Map<string, ReturnType<typeof setInterval>>();
  const composingStartedAt = new Map<string, number>();
  const COMPOSING_REFRESH_MS = 3500;
  const COMPOSING_MAX_MS = 90_000;

  const ensurePresenceSub = async (jid: string) => {
    const j = (jid || "").trim();
    if (!sock || !connected || !j || isJidBroadcast(j)) return;
    if (subscribedPresence.has(j)) return;
    try {
      await sock.presenceSubscribe(j);
      subscribedPresence.add(j);
    } catch (err) {
      log.warn({ err, accountId, jid: j }, "presenceSubscribe failed");
    }
  };

  const broadcastPresence = async (state: string, jid?: string) => {
    if (!sock || !connected) return;
    const st = (state || "").trim().toLowerCase();
    const allowed = new Set([
      "available",
      "unavailable",
      "composing",
      "recording",
      "paused",
    ]);
    if (!allowed.has(st)) return;
    try {
      if (jid) await ensurePresenceSub(jid);
      await sock.sendPresenceUpdate(
        st as "available" | "unavailable" | "composing" | "recording" | "paused",
        jid || undefined
      );
    } catch (err) {
      log.warn({ err, accountId, state: st, jid }, "sendPresenceUpdate failed");
    }
  };

  const stopComposing = async (jid: string) => {
    const j = (jid || "").trim();
    if (!j) return;
    const timer = composingTimers.get(j);
    if (timer) {
      clearInterval(timer);
      composingTimers.delete(j);
    }
    composingStartedAt.delete(j);
    if (sock && connected) {
      try {
        await sock.sendPresenceUpdate("paused", j);
      } catch {
        /* optional */
      }
    }
  };

  const startComposing = (jid: string) => {
    const j = (jid || "").trim();
    if (!j || !sock || !connected || isJidBroadcast(j)) return;
    if (composingTimers.has(j)) return;
    composingStartedAt.set(j, Date.now());
    const tick = () => {
      if (!sock || !connected) {
        void stopComposing(j);
        return;
      }
      const started = composingStartedAt.get(j) || 0;
      if (Date.now() - started > COMPOSING_MAX_MS) {
        void stopComposing(j);
        return;
      }
      void sock.sendPresenceUpdate("composing", j).catch(() => undefined);
    };
    void ensurePresenceSub(j).then(() => {
      tick();
      composingTimers.set(j, setInterval(tick, COMPOSING_REFRESH_MS));
    });
  };

  const clearAllComposing = () => {
    for (const j of [...composingTimers.keys()]) {
      void stopComposing(j);
    }
  };

  const boot = async () => {
    if (stopped) return;
    pairingCodeRequested = false;
    const { state, saveCreds, flush, hasPersistedSession } = await loadAuthState(accountId);
    authFlush = flush;
    const { version } = await fetchLatestBaileysVersion();
    sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        // In-memory cache over DB-backed keys — fewer round-trips per message
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
          const cmd = await api.getPairCommand(accountId).catch(() => null);
          const pairState = (cmd?.pairing_state || "").toLowerCase();
          const phone = String(cmd?.phone || "").replace(/\D/g, "");
          const wantCode =
            pairState === "code_pending" &&
            !!phone &&
            !sock?.authState.creds.registered;

          if (wantCode) {
            if (!pairingCodeRequested && sock) {
              pairingCodeRequested = true;
              const rawCode = await sock.requestPairingCode(phone);
              const code = String(rawCode || "").replace(/\s+/g, "");
              const display =
                code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
              await api.putPairState(accountId, {
                pairing_state: "code_pending",
                qr_payload: display,
                status: "offline",
                external_id: phone,
              });
              log.info({ accountId, phone, code: display }, "pairing code ready");
            }
          } else if (pairState !== "code_pending") {
            // Only surface QR when panel asked for QR, or no persisted session
            if (pairState === "qr_pending" || !hasPersistedSession || !sock?.authState.creds.registered) {
              const dataUrl = await QRCode.toDataURL(qr);
              await api.putPairState(accountId, {
                pairing_state: "qr_pending",
                qr_payload: dataUrl,
                status: "offline",
              });
              log.info({ accountId }, "QR ready for panel");
            }
          }
        } catch (err) {
          pairingCodeRequested = false;
          log.error({ err, accountId }, "pair payload upload failed");
        }
      }
      if (connection === "open") {
        connected = true;
        pairingCodeRequested = false;
        try {
          await saveCreds();
        } catch (err) {
          log.warn({ err, accountId }, "post-open auth save failed");
        }
        const user = sock?.user as
          | { id?: string; lid?: string; jid?: string; phoneNumber?: string }
          | undefined;
        const me = state.creds.me as
          | { id?: string; lid?: string; jid?: string; phoneNumber?: string }
          | undefined;
        // creds.me.id is usually the PN jid; sock.user.id is often @lid now
        let phone =
          phoneFromConnectedUser(me) ||
          phoneFromConnectedUser(user) ||
          phoneFromJid(me?.id) ||
          phoneFromJid(user?.jid);
        const waJid =
          preferPnJid(me?.id, me?.jid, user?.jid, user?.id) ||
          (phone ? `${phone}@s.whatsapp.net` : "");
        if (!phone) phone = phoneFromJid(waJid);
        await api.putPairState(accountId, {
          pairing_state: "connected",
          qr_payload: "",
          wa_jid: waJid,
          external_id: phone,
          status: "online",
        });
        await api.heartbeat(accountId);
        // Keep phone push notifications (docs: markOnlineOnConnect false + unavailable)
        try {
          await sock?.sendPresenceUpdate("unavailable");
        } catch {
          /* optional */
        }
        log.info(
          {
            accountId,
            waJid,
            phone: phone || "(unknown)",
            userId: user?.id,
            userJid: user?.jid,
            meId: me?.id,
            restored: hasPersistedSession,
          },
          "WhatsApp connected"
        );
      }
      if (connection === "close") {
        connected = false;
        subscribedPresence.clear();
        clearAllComposing();
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
        // Transient close (network / 408 / etc): mark offline so the panel can alert,
        // then auto-reconnect. Keep auth — user does not need to re-scan unless loggedOut.
        try {
          await api.putPairState(accountId, {
            pairing_state: "reconnecting",
            status: "offline",
          });
        } catch {
          /* ignore */
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
        await processInbound(msg);
      }
    });

    async function processInbound(msg: WAMessage) {
      try {
        const jid = msg.key.remoteJid || "";
        if (!jid || isJidBroadcast(jid)) return;
        const fromMe = !!msg.key?.fromMe;

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
                reuploadRequest: sock!.updateMediaMessage,
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

        if (!fromMe && sock) {
          // Mark inbound as read, then show typing while AI prepares a reply
          try {
            await sock.readMessages([msg.key]);
          } catch (err) {
            log.warn({ err, accountId, jid }, "readMessages failed");
          }
          try {
            await ensurePresenceSub(jid);
          } catch {
            /* optional */
          }
          startComposing(jid);
        }

        const ingestOut = await api.ingest(accountId, payload);

        if (!fromMe) {
          const jobId = (ingestOut?.job_id || "").trim();
          // Keep composing only while a reply job exists; otherwise clear typing
          if (!jobId) {
            await stopComposing(jid);
          }
        }
      } catch (err) {
        log.error({ err, accountId }, "inbound handle failed");
        try {
          const jid = msg.key.remoteJid || "";
          if (jid) await stopComposing(jid);
        } catch {
          /* ignore */
        }
      }
    }

    sock.ev.on("messages.update", async (updates) => {
      for (const u of updates) {
        try {
          const id = u.key?.id;
          if (!id || u.key?.fromMe === false) {
            // Still process fromMe receipts; inbound read of our msgs has fromMe true
          }
          if (!id) continue;
          // Only care about status on our outbound messages
          if (u.key?.fromMe === false) continue;
          const status = (u.update as { status?: number | string } | undefined)?.status;
          if (status === undefined || status === null) continue;
          await api.reportMessageStatus(accountId, {
            external_message_id: `wa:${id}`,
            status,
          });
        } catch (err) {
          log.warn({ err, accountId }, "message status report failed");
        }
      }
    });

    sock.ev.on("presence.update", async (update) => {
      try {
        const chatJid = (update.id || "").trim();
        if (!chatJid || isJidBroadcast(chatJid)) return;
        const presences = update.presences || {};
        let state = "paused";
        let lastSeen: number | undefined;
        for (const info of Object.values(presences)) {
          const row = info as { lastKnownPresence?: string; lastSeen?: number } | undefined;
          const p = (row?.lastKnownPresence || "").toLowerCase();
          if (typeof row?.lastSeen === "number") lastSeen = row.lastSeen;
          // Prefer activity indicators over available/unavailable
          if (p === "composing" || p === "recording") {
            state = p;
            break;
          }
          if (p === "available") state = "available";
          else if (p === "unavailable" && state !== "available") state = "unavailable";
          else if (p === "paused" && state === "paused") state = "paused";
        }
        // composing/recording expire ~10s on WhatsApp — keep our TTL in that range
        const ttl =
          state === "composing" || state === "recording"
            ? 10
            : state === "available"
              ? 45
              : 2;
        await api.reportPresence(accountId, {
          chat_jid: chatJid,
          state,
          ttl_sec: ttl,
          last_seen: lastSeen,
        });
      } catch (err) {
        log.warn({ err, accountId }, "presence report failed");
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
      clearAllComposing();
      try {
        await authFlush?.();
      } catch {
        /* ignore */
      }
      try {
        sock?.end(undefined);
      } catch {
        /* ignore */
      }
      sock = null;
    },
    sendText: async (jid: string, text: string) => {
      if (!sock || !connected) throw new Error("socket not connected");
      await ensurePresenceSub(jid);
      // AI reply ready (or manual send): stop typing indicator, then deliver
      await stopComposing(jid);
      const sent = await sock.sendMessage(jid, { text });
      // Stay offline-ish so the phone still gets push notifications
      try {
        await sock.sendPresenceUpdate("unavailable");
      } catch {
        /* optional */
      }
      const mid = sent?.key?.id || "";
      return mid;
    },
    subscribePresence: async (jid: string) => {
      await ensurePresenceSub(jid);
    },
    sendPresence: async (state: string, jid?: string) => {
      await broadcastPresence(state, jid);
    },
    listGroups: async () => {
      if (!sock || !connected) return [];
      const all = await sock.groupFetchAllParticipating();
      return Object.values(all)
        .map((g) => ({
          jid: g.id,
          subject: g.subject || "",
          size: g.participants?.length || 0,
          owner: (g as { owner?: string }).owner || "",
        }))
        .sort((a, b) => (a.subject || a.jid).localeCompare(b.subject || b.jid, "fa"));
    },
    groupParticipants: async (jid: string) => {
      if (!sock || !connected) return { subject: "", participants: [] };
      const meta = await sock.groupMetadata(jid);
      const participants = (meta.participants || []).map((p) => {
        const raw = p as {
          id: string;
          lid?: string;
          jid?: string;
          phoneNumber?: string;
          admin?: string | null;
        };
        const phone =
          phoneFromJid(raw.jid) ||
          phoneFromJid(raw.phoneNumber) ||
          (isPnJid(raw.id) ? phoneFromJid(raw.id) : "");
        const pnJid = phone
          ? `${phone}@s.whatsapp.net`
          : isPnJid(raw.id)
            ? stripDevice(raw.id)
            : raw.jid
              ? stripDevice(raw.jid)
              : "";
        return {
          id: raw.id,
          lid: raw.lid || (isLidJid(raw.id) ? stripDevice(raw.id) : ""),
          jid: pnJid,
          phone: phone || "",
          admin: raw.admin || null,
          is_admin: !!raw.admin,
        };
      });
      return {
        subject: meta.subject || "",
        participants,
      };
    },
  };
}
