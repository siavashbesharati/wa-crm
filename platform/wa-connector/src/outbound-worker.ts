import pino from "pino";
import { api, type ClaimedJob } from "./api-client.js";
import type { SessionHandle } from "./session.js";

const log = pino({
  level: process.env.LOG_LEVEL || "info",
  base: { source: "whatsapp" },
});

/** Last successful/attempted outbound per account — used for random inter-send gaps. */
const lastOutboundAt = new Map<string, number>();

/** Random pause between outbound sends (ms). */
function randomSendDelayMs(): number {
  const min = Number(process.env.WA_SEND_DELAY_MIN_MS || 4000);
  const max = Number(process.env.WA_SEND_DELAY_MAX_MS || 12000);
  const lo = Math.max(500, Math.min(min, max));
  const hi = Math.max(lo, max);
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function respectSendGap(accountId: string) {
  const prev = lastOutboundAt.get(accountId) || 0;
  if (!prev) return;
  const gap = randomSendDelayMs();
  const wait = gap - (Date.now() - prev);
  if (wait > 200) {
    log.info({ accountId, waitMs: wait }, "outbound send delay");
    await sleep(wait);
  }
}

function resolveJid(job: ClaimedJob): string {
  const jid = (job.target_jid || "").trim();
  if (jid.includes("@")) return jid;
  const name = (job.target_name || "").trim();
  if (name.includes("@")) return name;
  const digits = name.replace(/[^\d+]/g, "");
  if (digits.length >= 8) return `${digits.replace(/^\+/, "")}@s.whatsapp.net`;
  return "";
}

export async function claimAndSend(session: SessionHandle): Promise<number> {
  if (!session.connected) return 0;
  let jobs: ClaimedJob[] = [];
  try {
    // One at a time so inter-message delay is respected
    const res = await api.claimJobs(session.accountId, 1);
    jobs = res.jobs || [];
  } catch (err) {
    log.warn({ err, accountId: session.accountId }, "claim failed");
    return 0;
  }
  let sent = 0;
  for (const job of jobs) {
    await respectSendGap(session.accountId);
    const jid = resolveJid(job);
    try {
      if (!jid) throw new Error(`no jid for job ${job.id} target=${job.target_name}`);
      const waId = await session.sendText(jid, job.body || "");
      await api.completeJob(job.id, true, "", waId || "");
      lastOutboundAt.set(session.accountId, Date.now());
      log.info({ accountId: session.accountId, jobId: job.id, jid, waId }, "sent");
      sent += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lastOutboundAt.set(session.accountId, Date.now());
      log.error({ err, jobId: job.id }, "send failed");
      try {
        await api.completeJob(job.id, false, msg.slice(0, 500));
      } catch {
        /* ignore */
      }
    }
  }
  return sent;
}
