import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LICENSES_FILE = path.join(__dirname, "..", "licenses.json");

function loadLicenses() {
  // Prefer env on Vercel so you can keep keys private
  if (process.env.LICENSES_JSON) {
    try {
      const data = JSON.parse(process.env.LICENSES_JSON);
      return Array.isArray(data) ? data : [];
    } catch (err) {
      console.error("Invalid LICENSES_JSON env:", err.message);
      return [];
    }
  }

  try {
    const raw = fs.readFileSync(LICENSES_FILE, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error("Failed to read licenses.json:", err.message);
    return [];
  }
}

function normalizeKey(key) {
  return String(key || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function isExpired(expiresAt) {
  if (!expiresAt) return false;
  const end = new Date(expiresAt);
  if (Number.isNaN(end.getTime())) return false;
  return end.getTime() < Date.now();
}

export function verifyLicense(rawKey) {
  const key = normalizeKey(rawKey);
  if (!key) {
    return {
      valid: false,
      reason: "LICENSE_REQUIRED",
      message: "لطفاً کلید لایسنس را وارد کنید."
    };
  }

  const licenses = loadLicenses();
  const found = licenses.find((item) => normalizeKey(item.key) === key);

  if (!found) {
    return {
      valid: false,
      reason: "NOT_FOUND",
      message: "کلید لایسنس نامعتبر است."
    };
  }

  if (found.active === false) {
    return {
      valid: false,
      reason: "DISABLED",
      message: "این لایسنس غیرفعال شده است."
    };
  }

  if (isExpired(found.expiresAt)) {
    return {
      valid: false,
      reason: "EXPIRED",
      message: "اعتبار این لایسنس به پایان رسیده است."
    };
  }

  return {
    valid: true,
    reason: "OK",
    message: "لایسنس معتبر است.",
    customer: found.customer || null,
    expiresAt: found.expiresAt || null,
    features: Array.isArray(found.features)
      ? found.features
      : ["autoreply", "members"]
  };
}
