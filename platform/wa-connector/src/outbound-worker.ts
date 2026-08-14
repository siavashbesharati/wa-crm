import pino from "pino";
import { api, type ClaimedJob } from "./api-client.js";
import type { SessionHandle } from "./session.js";

const log = pino({ level: process.env.LOG_LEVEL || "info" });

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
    const res = await api.claimJobs(session.accountId, 5);
    jobs = res.jobs || [];
  } catch (err) {
    log.warn({ err, accountId: session.accountId }, "claim failed");
    return 0;
  }
  for (const job of jobs) {
    const jid = resolveJid(job);
    try {
      if (!jid) throw new Error(`no jid for job ${job.id} target=${job.target_name}`);
      const waId = await session.sendText(jid, job.body || "");
      await api.completeJob(job.id, true, "", waId || "");
      log.info({ accountId: session.accountId, jobId: job.id, jid, waId }, "sent");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ err, jobId: job.id }, "send failed");
      try {
        await api.completeJob(job.id, false, msg.slice(0, 500));
      } catch {
        /* ignore */
      }
    }
  }
  return jobs.length;
}
