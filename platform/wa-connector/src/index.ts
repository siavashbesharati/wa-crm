import http from "node:http";
import pino from "pino";
import { api, type WaSessionInfo } from "./api-client.js";
import { config } from "./config.js";
import { claimAndSend } from "./outbound-worker.js";
import { startSession, type SessionHandle } from "./session.js";

const log = pino({ level: process.env.LOG_LEVEL || "info" });

const sessions = new Map<string, SessionHandle>();
const lastPairState = new Map<string, string>();

async function ensureSession(info: WaSessionInfo) {
  if (sessions.has(info.id)) return;
  log.info({ accountId: info.id, label: info.label }, "starting session");
  const handle = await startSession(info.id);
  sessions.set(info.id, handle);
}

async function stopSession(accountId: string) {
  const s = sessions.get(accountId);
  if (!s) return;
  await s.stop();
  sessions.delete(accountId);
  lastPairState.delete(accountId);
  log.info({ accountId }, "session stopped");
}

async function syncSessions() {
  let list: WaSessionInfo[] = [];
  try {
    list = await api.listSessions();
  } catch (err) {
    log.warn({ err }, "listSessions failed — is API up?");
    return;
  }
  if (config.forceAccountId) {
    list = list.filter((s) => s.id === config.forceAccountId);
  }
  const wanted = new Set(list.map((s) => s.id));
  for (const id of [...sessions.keys()]) {
    if (!wanted.has(id)) await stopSession(id);
  }
  for (const info of list) {
    // Start session when qr_pending or connected (or unknown with saved auth)
    const state = (info.pairing_state || "").toLowerCase();
    if (state === "disconnected" && !sessions.has(info.id)) {
      // Only auto-start if not explicitly logged out — wait for pair/start
      continue;
    }
    if (state === "qr_pending" || state === "connected" || sessions.has(info.id)) {
      await ensureSession(info);
    }
    // Detect logout request from panel
    const prev = lastPairState.get(info.id);
    lastPairState.set(info.id, state);
    if (prev && prev !== "disconnected" && state === "disconnected") {
      await stopSession(info.id);
      try {
        await api.clearAuth(info.id);
      } catch {
        /* ignore */
      }
    }
  }
}

async function pollPairCommands() {
  for (const [accountId] of sessions) {
    try {
      const cmd = await api.getPairCommand(accountId);
      if (cmd.pairing_state === "disconnected") {
        await stopSession(accountId);
      }
    } catch {
      /* ignore */
    }
  }
  // Also pick up qr_pending accounts not yet started
  try {
    let list = await api.listSessions();
    if (config.forceAccountId) {
      list = list.filter((s) => s.id === config.forceAccountId);
    }
    for (const info of list) {
      if (info.pairing_state === "qr_pending" && !sessions.has(info.id)) {
        await ensureSession(info);
      }
    }
  } catch {
    /* ignore */
  }
}

async function tickOutbound() {
  for (const session of sessions.values()) {
    if (session.connected) {
      try {
        await api.heartbeat(session.accountId);
      } catch {
        /* ignore */
      }
      await claimAndSend(session);
    }
  }
}

function startHealthServer() {
  const server = http.createServer((req, res) => {
    if (req.url === "/health" || req.url === "/") {
      const body = JSON.stringify({
        ok: true,
        sessions: [...sessions.keys()],
        connected: [...sessions.values()].filter((s) => s.connected).map((s) => s.accountId),
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(body);
      return;
    }
    if (req.url?.startsWith("/groups/") && req.method === "GET") {
      void (async () => {
        try {
          const url = new URL(req.url || "/", "http://127.0.0.1");
          const parts = url.pathname.split("/").filter(Boolean);
          // /groups/:accountId  OR  /groups/:accountId/participants?jid=
          const accountId = parts[1] || "";
          const session = sessions.get(accountId);
          if (!session?.connected) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "session not connected" }));
            return;
          }
          if (parts[2] === "participants") {
            const groupJid = (url.searchParams.get("jid") || "").trim();
            if (!groupJid) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "jid query required" }));
              return;
            }
            const data = await session.groupParticipants(groupJid);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ group_jid: groupJid, ...data }));
            return;
          }
          if (parts.length === 2) {
            const groups = await session.listGroups();
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ groups }));
            return;
          }
          // Legacy path: /groups/:accountId/:groupJid
          const groupJid = parts[2] ? decodeURIComponent(parts.slice(2).join("/")) : "";
          if (groupJid) {
            const data = await session.groupParticipants(groupJid);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ group_jid: groupJid, ...data }));
            return;
          }
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "not found" }));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: String(err) }));
        }
      })();
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
  server.listen(config.healthPort, "127.0.0.1", () => {
    log.info({ port: config.healthPort }, "wa-connector health listening");
  });
}

async function main() {
  log.info(
    {
      api: config.apiBaseUrl,
      pollMs: config.pollMs,
    },
    "wa-connector starting"
  );
  startHealthServer();
  await syncSessions();
  setInterval(() => void syncSessions(), config.sessionRefreshMs);
  setInterval(() => void pollPairCommands(), Math.max(2000, config.pollMs));
  setInterval(() => void tickOutbound(), config.pollMs);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
