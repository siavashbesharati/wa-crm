(function (global) {
  const cfg = global.IRANEXPEDIA_LICENSE_CONFIG || {
    salt: "iranexpedia.ir::wa-license-v1",
    requireNetworkTime: true,
    allowLocalTimeFallback: false,
    entries: []
  };

  function normalizeKey(key) {
    return String(key || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");
  }

  function toHex(buffer) {
    return Array.from(new Uint8Array(buffer))
      .map(function (b) {
        return b.toString(16).padStart(2, "0");
      })
      .join("");
  }

  async function sha256Hex(text) {
    const data = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return toHex(digest);
  }

  async function hashLicenseKey(rawKey) {
    const key = normalizeKey(rawKey);
    return sha256Hex(cfg.salt + "|" + key);
  }

  function sendBg(message) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(message, function (response) {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(response || { ok: false });
        });
      } catch (err) {
        resolve({ ok: false, error: String(err.message || err) });
      }
    });
  }

  async function getTrustedNowMs() {
    const res = await sendBg({ type: "getTrustedTime" });
    if (res && res.ok && typeof res.nowMs === "number") {
      return { nowMs: res.nowMs, source: res.source || "network" };
    }

    if (cfg.requireNetworkTime && !cfg.allowLocalTimeFallback) {
      throw new Error(
        "برای اعتبارسنجی به اینترنت نیاز است."
      );
    }

    return { nowMs: Date.now(), source: "local" };
  }

  async function verifyKeyAgainstHardcoded(rawKey) {
    const key = normalizeKey(rawKey);
    if (!key) {
      return {
        valid: false,
        reason: "EMPTY",
        message: "کلید فعال‌سازی را وارد کنید."
      };
    }

    const hash = await hashLicenseKey(key);
    const entry = (cfg.entries || []).find(function (item) {
      return String(item.hash || "").toLowerCase() === hash;
    });

    if (!entry) {
      return {
        valid: false,
        reason: "NOT_FOUND",
        message: "کلید فعال‌سازی نامعتبر است."
      };
    }

    let nowInfo;
    try {
      nowInfo = await getTrustedNowMs();
    } catch (err) {
      return {
        valid: false,
        reason: "TIME_UNAVAILABLE",
        message: err.message || "امکان بررسی تاریخ انقضا وجود ندارد. اتصال اینترنت را بررسی کنید."
      };
    }

    const expiresAt = entry.expiresAt ? new Date(entry.expiresAt).getTime() : null;
    if (expiresAt && Number.isFinite(expiresAt) && nowInfo.nowMs > expiresAt) {
      return {
        valid: false,
        reason: "EXPIRED",
        message: "اعتبار کلید به پایان رسیده است.",
        expiresAt: entry.expiresAt,
        nowSource: nowInfo.source
      };
    }

    return {
      valid: true,
      reason: "OK",
      message: "فعال‌سازی با موفقیت انجام شد.",
      expiresAt: entry.expiresAt || null,
      label: entry.label || null,
      nowSource: nowInfo.source,
      hash: hash
    };
  }

  async function activateLicense(rawKey) {
    const result = await verifyKeyAgainstHardcoded(rawKey);
    if (!result.valid) {
      await chrome.storage.local.set({
        licenseActivated: false,
        licenseHash: "",
        licenseExpiresAt: null,
        licenseCheckedAt: Date.now(),
        licenseMessage: result.message
      });
      return result;
    }

    await chrome.storage.local.set({
      licenseActivated: true,
      licenseHash: result.hash,
      licenseExpiresAt: result.expiresAt || null,
      licenseCheckedAt: Date.now(),
      licenseMessage: result.message
    });

    return result;
  }

  async function getStoredLicenseStatus() {
    const data = await chrome.storage.local.get({
      licenseActivated: false,
      licenseHash: "",
      licenseExpiresAt: null,
      licenseMessage: ""
    });

    if (!data.licenseActivated || !data.licenseHash) {
      return {
        valid: false,
        reason: "NOT_ACTIVATED",
        message: data.licenseMessage || "هنوز فعال‌سازی نشده است."
      };
    }

    const entry = (cfg.entries || []).find(function (item) {
      return String(item.hash || "").toLowerCase() === String(data.licenseHash).toLowerCase();
    });

    if (!entry) {
      return {
        valid: false,
        reason: "NOT_FOUND",
        message: "کلید فعال‌سازی نامعتبر است."
      };
    }

    let nowInfo;
    try {
      nowInfo = await getTrustedNowMs();
    } catch (err) {
      return {
        valid: false,
        reason: "TIME_UNAVAILABLE",
        message: err.message || "امکان بررسی تاریخ انقضا وجود ندارد. اتصال اینترنت را بررسی کنید."
      };
    }

    const expiresAt = entry.expiresAt ? new Date(entry.expiresAt).getTime() : null;
    if (expiresAt && Number.isFinite(expiresAt) && nowInfo.nowMs > expiresAt) {
      return {
        valid: false,
        reason: "EXPIRED",
        message: "اعتبار کلید به پایان رسیده است.",
        expiresAt: entry.expiresAt,
        nowSource: nowInfo.source
      };
    }

    return {
      valid: true,
      reason: "OK",
      message: "فعال است.",
      expiresAt: entry.expiresAt || null,
      label: entry.label || null,
      nowSource: nowInfo.source
    };
  }

  async function clearLicense() {
    await chrome.storage.local.set({
      licenseActivated: false,
      licenseHash: "",
      licenseExpiresAt: null,
      licenseCheckedAt: Date.now(),
      licenseMessage: "کلید حذف شد."
    });
  }

  global.IranexpediaLicense = {
    hashLicenseKey: hashLicenseKey,
    verifyKeyAgainstHardcoded: verifyKeyAgainstHardcoded,
    activateLicense: activateLicense,
    getStoredLicenseStatus: getStoredLicenseStatus,
    clearLicense: clearLicense,
    getTrustedNowMs: getTrustedNowMs,
    normalizeKey: normalizeKey
  };
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this);
