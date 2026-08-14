import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiLocalDir = join(__dirname, "..", "..", "api", ".local");

function readLocalSecret(name: string, fallback: string): string {
  const path = join(apiLocalDir, name);
  if (existsSync(path)) {
    try {
      const v = readFileSync(path, "utf8").trim();
      if (v) return v;
    } catch {
      /* ignore */
    }
  }
  return fallback;
}

export const config = {
  apiBaseUrl: (process.env.WA_API_BASE_URL || "http://127.0.0.1:8000/api").replace(/\/$/, ""),
  connectorKey:
    process.env.WA_CONNECTOR_KEY ||
    readLocalSecret("wa_connector_key", "dev-wa-connector-key-change-me"),
  healthPort: Number(process.env.WA_CONNECTOR_PORT || 8090),
  pollMs: Number(process.env.WA_POLL_MS || 2000),
  sessionRefreshMs: Number(process.env.WA_SESSION_REFRESH_MS || 15000),
  /** Optional: force a single account for Phase 0 spike */
  forceAccountId: (process.env.WA_FORCE_ACCOUNT_ID || "").trim(),
};
