/**
 * Admin helper: create a hashed license entry for license-config.js
 *
 * Usage:
 *   node scripts/generate-license-key.mjs --key "IRAN-CUSTOMER-001" --expires "2026-12-31T23:59:59Z"
 *   node scripts/generate-license-key.mjs --key "IRAN-CUSTOMER-001" --expires "2026-12-31" --label "ali"
 */
import crypto from "crypto";

const SALT = "iranexpedia.ir::wa-license-v1";

function arg(name, fallback) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] || fallback;
}

function normalizeKey(key) {
  return String(key || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function toIsoEndOfDayIfDateOnly(value) {
  const v = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    return v + "T23:59:59.000Z";
  }
  return v;
}

const key = normalizeKey(arg("--key", ""));
const expiresRaw = arg("--expires", "");
const label = arg("--label", "customer");

if (!key || !expiresRaw) {
  console.error(
    'Usage: node scripts/generate-license-key.mjs --key "MY-KEY" --expires "2026-12-31T23:59:59Z" [--label "name"]'
  );
  process.exit(1);
}

const expiresAt = toIsoEndOfDayIfDateOnly(expiresRaw);
const expiresMs = Date.parse(expiresAt);
if (Number.isNaN(expiresMs)) {
  console.error("Invalid --expires datetime");
  process.exit(1);
}

const hash = crypto
  .createHash("sha256")
  .update(SALT + "|" + key)
  .digest("hex");

const entry = {
  hash,
  expiresAt: new Date(expiresMs).toISOString(),
  label
};

console.log("\nPlaintext key (give to customer):");
console.log(" ", key);
console.log("\nPaste this into WAchromeExtension/license-config.js → entries:\n");
console.log(JSON.stringify(entry, null, 2));
console.log("");
