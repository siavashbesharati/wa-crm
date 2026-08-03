const versionEl = document.getElementById("ext-version");
const licenseForm = document.getElementById("license-form");
const licenseKeyInput = document.getElementById("license-key");
const licenseBtn = document.getElementById("license-btn");
const licenseClearBtn = document.getElementById("license-clear");
const licenseBadge = document.getElementById("license-badge");
const licenseMessage = document.getElementById("license-message");
const licenseExpiry = document.getElementById("license-expiry");
const openCrmBtn = document.getElementById("open-crm");

const cloudBadge = document.getElementById("cloud-badge");
const cloudStatus = document.getElementById("cloud-status");
const cloudApi = document.getElementById("cloud-api");
const cloudPhone = document.getElementById("cloud-phone");
const cloudCode = document.getElementById("cloud-code");
const cloudCodeWrap = document.getElementById("cloud-code-wrap");
const cloudRole = document.getElementById("cloud-role");
const cloudAccount = document.getElementById("cloud-account");
const cloudOtpBtn = document.getElementById("cloud-otp-btn");
const cloudLoginBtn = document.getElementById("cloud-login-btn");
const cloudSaveBtn = document.getElementById("cloud-save-btn");
const cloudDisconnect = document.getElementById("cloud-disconnect");
const cloudSyncBtn = document.getElementById("cloud-sync-btn");

const manifest = chrome.runtime.getManifest();
versionEl.textContent = "v" + manifest.version;
const footerVersion = document.getElementById("footer-version");
if (footerVersion) footerVersion.textContent = manifest.version;

function setLicenseUi(status) {
  const valid = !!status?.valid;
  licenseBadge.textContent = valid ? "فعال" : "غیرفعال";
  licenseBadge.classList.toggle("on", valid);
  licenseBadge.classList.toggle("off", !valid);
  licenseMessage.textContent =
    status?.message || "برای استفاده، کلید فعال‌سازی را وارد کنید.";

  if (valid && status.expiresAt) {
    licenseExpiry.textContent =
      "تاریخ انقضا: " + new Date(status.expiresAt).toLocaleString("fa-IR");
  } else {
    licenseExpiry.textContent = "";
  }
}

async function refreshLicenseUi() {
  const status = await IranexpediaLicense.getStoredLicenseStatus();
  setLicenseUi(status);
  updateOpenButton();
}

function updateOpenButton() {
  const licenseOn = licenseBadge.classList.contains("on");
  const cloudOn = cloudBadge.classList.contains("on");
  openCrmBtn.disabled = !(licenseOn || cloudOn);
}

async function fillAccounts() {
  cloudAccount.innerHTML = '<option value="">— انتخاب کنید —</option>';
  const res = await IranexpediaCloudBridge.listAccounts();
  if (!res.ok || !Array.isArray(res.data)) return;
  res.data.forEach(function (acc) {
    const opt = document.createElement("option");
    opt.value = acc.id;
    opt.textContent = (acc.label || acc.phone || acc.id) + " · " + (acc.status || "");
    cloudAccount.appendChild(opt);
  });
}

async function refreshCloudUi() {
  const cfg = await IranexpediaCloudBridge.getConfig();
  cloudApi.value = cfg.apiUrl || "http://localhost:8000/api";
  cloudPhone.value = cfg.phone || "";
  cloudRole.value = cfg.role || "connector";
  if (cfg.accessToken) {
    cloudCodeWrap.classList.remove("hidden");
  }
  const st = await IranexpediaCloudBridge.status();
  if (st.connected) {
    cloudBadge.textContent = "متصل";
    cloudBadge.classList.add("on");
    cloudBadge.classList.remove("off");
    const org = st.me && st.me.org ? st.me.org.name : cfg.orgName || "";
    const plan = st.me && st.me.org ? st.me.org.plan : cfg.plan || "";
    cloudStatus.textContent =
      "سازمان: " +
      org +
      (plan ? " · پلن " + plan : "") +
      (st.heartbeatOk ? " · کانکتور آنلاین" : " · اکانت واتساپ را انتخاب/ذخیره کنید");
    await fillAccounts();
    if (cfg.accountId) cloudAccount.value = cfg.accountId;
  } else {
    cloudBadge.textContent = "قطع";
    cloudBadge.classList.add("off");
    cloudBadge.classList.remove("on");
    cloudStatus.textContent =
      st.reason === "not_configured"
        ? "برای کار تیمی به سرور ابری وصل شوید."
        : "اتصال ناموفق: " + (st.reason || "خطا");
  }
  updateOpenButton();
}

licenseForm.addEventListener("submit", async function (event) {
  event.preventDefault();
  const key = licenseKeyInput.value.trim();
  licenseBtn.disabled = true;
  licenseBtn.textContent = "در حال بررسی...";
  try {
    const result = await IranexpediaLicense.activateLicense(key);
    setLicenseUi(result);
    updateOpenButton();
  } catch (err) {
    setLicenseUi({
      valid: false,
      message: err.message || "خطا در فعال‌سازی. دوباره تلاش کنید."
    });
  } finally {
    licenseBtn.disabled = false;
    licenseBtn.textContent = "فعال‌سازی";
  }
});

licenseClearBtn.addEventListener("click", async function () {
  await IranexpediaLicense.clearLicense();
  licenseKeyInput.value = "";
  setLicenseUi({
    valid: false,
    message: "کلید حذف شد."
  });
  updateOpenButton();
});

cloudOtpBtn.addEventListener("click", async function () {
  cloudOtpBtn.disabled = true;
  try {
    const res = await IranexpediaCloudBridge.requestOtp(
      cloudPhone.value.trim(),
      cloudApi.value.trim()
    );
    if (!res.ok) {
      cloudStatus.textContent = "خطا: " + (res.error || "ارسال کد ناموفق");
      return;
    }
    cloudCodeWrap.classList.remove("hidden");
    cloudStatus.textContent = res.data && res.data.dev_code
      ? "کد mock: " + res.data.dev_code
      : "کد ارسال شد.";
  } finally {
    cloudOtpBtn.disabled = false;
  }
});

cloudLoginBtn.addEventListener("click", async function () {
  cloudLoginBtn.disabled = true;
  try {
    const res = await IranexpediaCloudBridge.verifyOtp(
      cloudPhone.value.trim(),
      cloudCode.value.trim(),
      "",
      cloudApi.value.trim()
    );
    if (!res.ok) {
      cloudStatus.textContent = "ورود ناموفق: " + (res.error || "");
      return;
    }
    await IranexpediaCloudBridge.setConfig({
      enabled: true,
      role: cloudRole.value
    });
    await refreshCloudUi();
  } finally {
    cloudLoginBtn.disabled = false;
  }
});

cloudSaveBtn.addEventListener("click", async function () {
  let accountId = cloudAccount.value;
  if (!accountId) {
    const created = await IranexpediaCloudBridge.createAccount(
      "واتساپ اصلی",
      cloudPhone.value.trim()
    );
    if (created.ok && created.data) {
      accountId = created.data.id;
      await fillAccounts();
      cloudAccount.value = accountId;
    }
  }
  await IranexpediaCloudBridge.setConfig({
    enabled: true,
    apiUrl: cloudApi.value.trim(),
    role: cloudRole.value,
    accountId: accountId || ""
  });
  const hb = await IranexpediaCloudBridge.heartbeat();
  cloudStatus.textContent = hb.ok
    ? "اتصال ذخیره و کانکتور آنلاین شد."
    : "ذخیره شد. هارت‌بیت: " + (hb.error || "نیاز به اکانت");
  chrome.runtime.sendMessage({ type: "cloudSyncContacts" });
  await refreshCloudUi();
});

cloudDisconnect.addEventListener("click", async function () {
  await IranexpediaCloudBridge.setConfig({
    enabled: false,
    accessToken: "",
    refreshToken: "",
    orgId: "",
    accountId: ""
  });
  cloudCode.value = "";
  await refreshCloudUi();
});

cloudSyncBtn.addEventListener("click", async function () {
  cloudSyncBtn.disabled = true;
  cloudStatus.textContent = "در حال اسکن واتساپ و ارسال به سرور…";
  try {
    const scan = await new Promise(function (resolve) {
      chrome.runtime.sendMessage({ type: "cloudScanWhatsAppChats" }, function (res) {
        resolve(res || { ok: false, error: "no_response" });
      });
    });
    if (!scan.ok && scan.error === "whatsapp_tab_not_found") {
      // Still push whatever is already in local CRM.
      const syncOnly = await new Promise(function (resolve) {
        chrome.runtime.sendMessage({ type: "cloudSyncContacts" }, function (res) {
          resolve(res || { ok: false });
        });
      });
      cloudStatus.textContent = syncOnly.ok
        ? "واتساپ باز نیست — " + (syncOnly.synced || 0) + " مخاطب محلی به سرور ارسال شد."
        : "واتساپ وب را باز کنید، بعد همگام‌سازی را بزنید.";
      return;
    }
    if (!scan.ok) {
      cloudStatus.textContent = "همگام‌سازی ناموفق: " + (scan.error || "");
      return;
    }
    const synced = (scan.sync && scan.sync.synced) || 0;
    cloudStatus.textContent =
      "اسکن " +
      (scan.scanned || 0) +
      " چت — " +
      synced +
      " لید به سرور ارسال شد. پنل ابری را رفرش کنید.";
  } finally {
    cloudSyncBtn.disabled = false;
    await refreshCloudUi();
  }
});

openCrmBtn.addEventListener("click", function () {
  chrome.runtime.sendMessage({ type: "openDashboard" });
});

refreshLicenseUi();
refreshCloudUi();
