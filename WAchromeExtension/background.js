const DEFAULT_API_BASE = "http://localhost:3000";

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get({ apiBaseUrl: "" }, (data) => {
    if (!data.apiBaseUrl) {
      chrome.storage.local.set({ apiBaseUrl: DEFAULT_API_BASE });
    }
  });
});

async function getApiBase() {
  const data = await chrome.storage.local.get({ apiBaseUrl: DEFAULT_API_BASE });
  return String(data.apiBaseUrl || DEFAULT_API_BASE).replace(/\/$/, "");
}

async function verifyLicenseOnServer(key) {
  const apiBase = await getApiBase();
  const deviceData = await chrome.storage.local.get({ deviceId: "" });
  let deviceId = deviceData.deviceId;
  if (!deviceId) {
    deviceId = "dev-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    await chrome.storage.local.set({ deviceId });
  }

  const res = await fetch(apiBase + "/api/license/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, deviceId })
  });

  let body = null;
  try {
    body = await res.json();
  } catch (_e) {
    body = null;
  }

  if (!body) {
    throw new Error("پاسخ سرور نامعتبر است. بک‌اند را بررسی کنید.");
  }

  return body;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "verifyLicense") {
    (async () => {
      try {
        const key = String(message.key || "").trim();
        if (!key) {
          sendResponse({
            ok: false,
            valid: false,
            message: "کلید لایسنس خالی است."
          });
          return;
        }

        const result = await verifyLicenseOnServer(key);
        await chrome.storage.local.set({
          licenseKey: key,
          licenseValid: !!result.valid,
          licenseInfo: result,
          licenseCheckedAt: Date.now()
        });

        sendResponse({
          ok: true,
          valid: !!result.valid,
          message: result.message,
          info: result
        });
      } catch (err) {
        await chrome.storage.local.set({
          licenseValid: false,
          licenseInfo: {
            valid: false,
            message: err.message || "خطا در ارتباط با سرور"
          },
          licenseCheckedAt: Date.now()
        });
        sendResponse({
          ok: false,
          valid: false,
          message: err.message || "خطا در ارتباط با سرور لایسنس"
        });
      }
    })();
    return true;
  }

  if (message?.type === "getLicenseStatus") {
    chrome.storage.local.get(
      {
        licenseKey: "",
        licenseValid: false,
        licenseInfo: null,
        licenseCheckedAt: 0,
        apiBaseUrl: DEFAULT_API_BASE
      },
      (data) => {
        sendResponse({
          ok: true,
          key: data.licenseKey,
          valid: !!data.licenseValid,
          info: data.licenseInfo,
          checkedAt: data.licenseCheckedAt,
          apiBaseUrl: data.apiBaseUrl
        });
      }
    );
    return true;
  }

  if (message?.type === "clearLicense") {
    chrome.storage.local.set(
      {
        licenseKey: "",
        licenseValid: false,
        licenseInfo: null,
        licenseCheckedAt: Date.now()
      },
      () => sendResponse({ ok: true })
    );
    return true;
  }

  if (message?.type === "revalidateLicense") {
    (async () => {
      try {
        const stored = await chrome.storage.local.get({ licenseKey: "" });
        if (!stored.licenseKey) {
          sendResponse({
            ok: false,
            valid: false,
            message: "لایسنسی ذخیره نشده است."
          });
          return;
        }
        const result = await verifyLicenseOnServer(stored.licenseKey);
        await chrome.storage.local.set({
          licenseValid: !!result.valid,
          licenseInfo: result,
          licenseCheckedAt: Date.now()
        });
        sendResponse({
          ok: true,
          valid: !!result.valid,
          message: result.message,
          info: result
        });
      } catch (err) {
        await chrome.storage.local.set({
          licenseValid: false,
          licenseCheckedAt: Date.now()
        });
        sendResponse({
          ok: false,
          valid: false,
          message: err.message || "خطا در اعتبارسنجی دوباره"
        });
      }
    })();
    return true;
  }
});
