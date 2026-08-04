const versionEl = document.getElementById("ext-version");
const openCrmBtn = document.getElementById("open-crm");

const cloudBadge = document.getElementById("cloud-badge");
const cloudStatus = document.getElementById("cloud-status");
const cloudApi = document.getElementById("cloud-api");
const cloudPhone = document.getElementById("cloud-phone");
const cloudCode = document.getElementById("cloud-code");
const cloudCodeWrap = document.getElementById("cloud-code-wrap");
const cloudRole = document.getElementById("cloud-role");
const cloudChannel = document.getElementById("cloud-channel");
const cloudAccount = document.getElementById("cloud-account");
const cloudOtpBtn = document.getElementById("cloud-otp-btn");
const cloudLoginBtn = document.getElementById("cloud-login-btn");
const cloudSaveBtn = document.getElementById("cloud-save-btn");
const cloudDisconnect = document.getElementById("cloud-disconnect");
const cloudSyncBtn = document.getElementById("cloud-sync-btn");

const CHANNEL_LABEL = { whatsapp: "واتساپ", divar: "دیوار" };

const manifest = chrome.runtime.getManifest();
versionEl.textContent = "v" + manifest.version;
const footerVersion = document.getElementById("footer-version");
if (footerVersion) footerVersion.textContent = manifest.version;

function updateOpenButton() {
  openCrmBtn.disabled = !cloudBadge.classList.contains("on");
}

function selectedChannel() {
  return (cloudChannel && cloudChannel.value) || "whatsapp";
}

async function fillAccounts() {
  cloudAccount.innerHTML = '<option value="">— انتخاب کنید —</option>';
  const ch = selectedChannel();
  const res = await IranexpediaCloudBridge.listAccounts();
  if (!res.ok || !Array.isArray(res.data)) return;
  res.data.forEach(function (acc) {
    if (acc.channel && acc.channel !== ch) return;
    const opt = document.createElement("option");
    opt.value = acc.id;
    const idLabel = acc.external_id || acc.phone || acc.id;
    opt.textContent =
      (CHANNEL_LABEL[acc.channel] || acc.channel || "") +
      " · " +
      (acc.label || idLabel) +
      " · " +
      (acc.status || "");
    opt.dataset.channel = acc.channel || ch;
    cloudAccount.appendChild(opt);
  });
}

async function refreshCloudUi() {
  const cfg = await IranexpediaCloudBridge.getConfig();
  cloudApi.value = cfg.apiUrl || "http://localhost:8000/api";
  cloudPhone.value = cfg.phone || "";
  cloudRole.value = cfg.role || "connector";
  if (cloudChannel) cloudChannel.value = cfg.channel || "whatsapp";
  if (cfg.accessToken) {
    cloudCodeWrap.classList.remove("hidden");
  }
  const gate = await IranexpediaAuthGate.verify();
  if (gate.ok && IranexpediaAuthGate.assertUnlocked()) {
    cloudBadge.textContent = "متصل";
    cloudBadge.classList.add("on");
    cloudBadge.classList.remove("off");
    const st = await IranexpediaCloudBridge.status();
    const org = st.me && st.me.org ? st.me.org.name : cfg.orgName || "";
    const plan = st.me && st.me.org ? st.me.org.plan : cfg.plan || "";
    const chLabel = CHANNEL_LABEL[cfg.channel] || cfg.channel || "کانال";
    cloudStatus.textContent =
      "سازمان: " +
      org +
      (plan ? " · پلن " + plan : "") +
      (st.heartbeatOk
        ? " · کانکتور " + chLabel + " آنلاین"
        : " · اکانت کانال را انتخاب/ذخیره کنید");
    await fillAccounts();
    if (cfg.accountId) cloudAccount.value = cfg.accountId;
  } else {
    cloudBadge.textContent = "قطع";
    cloudBadge.classList.add("off");
    cloudBadge.classList.remove("on");
    cloudStatus.textContent =
      gate.reason === "not_enabled" || gate.reason === "not_configured"
        ? "برای استفاده، با کد OTP به سرور وصل شوید."
        : "سرور در دسترس نیست یا ورود نامعتبر است: " + (gate.reason || "خطا");
  }
  updateOpenButton();
}

if (cloudChannel) {
  cloudChannel.addEventListener("change", async function () {
    await fillAccounts();
  });
}

cloudOtpBtn.addEventListener("click", async function () {
  cloudOtpBtn.disabled = true;
  try {
    const res = await IranexpediaCloudBridge.requestOtp(
      cloudPhone.value.trim(),
      cloudApi.value.trim()
    );
    if (!res.ok) {
      cloudStatus.textContent = "خطا: " + (res.error || "ارسال کد ناموفق — سرور را چک کنید");
      return;
    }
    cloudCodeWrap.classList.remove("hidden");
    cloudStatus.textContent =
      res.data && res.data.dev_code
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
      role: cloudRole.value,
      channel: selectedChannel()
    });
    if (globalThis.IranexpediaAuthGate) {
      await IranexpediaAuthGate.verify(true);
    }
    await refreshCloudUi();
  } finally {
    cloudLoginBtn.disabled = false;
  }
});

cloudSaveBtn.addEventListener("click", async function () {
  const ch = selectedChannel();
  let accountId = cloudAccount.value;
  if (!accountId) {
    const defaultLabel = ch === "divar" ? "دیوار اصلی" : "واتساپ اصلی";
    const created = await IranexpediaCloudBridge.createAccount(
      defaultLabel,
      cloudPhone.value.trim() || (ch === "divar" ? "divar-main" : ""),
      ch
    );
    if (created.ok && created.data) {
      accountId = created.data.id;
      await fillAccounts();
      cloudAccount.value = accountId;
    }
  }
  const selectedOpt = cloudAccount.options[cloudAccount.selectedIndex];
  const accountChannel =
    (selectedOpt && selectedOpt.dataset && selectedOpt.dataset.channel) || ch;
  await IranexpediaCloudBridge.setConfig({
    enabled: true,
    apiUrl: cloudApi.value.trim(),
    role: cloudRole.value,
    accountId: accountId || "",
    channel: accountChannel
  });
  const hb = await IranexpediaCloudBridge.heartbeat();
  cloudStatus.textContent = hb.ok
    ? "اتصال ذخیره و کانکتور آنلاین شد."
    : "ذخیره شد. هارت‌بیت: " + (hb.error || "نیاز به اکانت");
  chrome.runtime.sendMessage({ type: "cloudSyncContacts" });
  await refreshCloudUi();
});

cloudDisconnect.addEventListener("click", async function () {
  if (globalThis.IranexpediaAuthGate) IranexpediaAuthGate.revoke();
  await IranexpediaCloudBridge.setConfig({
    enabled: false,
    accessToken: "",
    refreshToken: "",
    orgId: "",
    accountId: "",
    channel: "whatsapp"
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

refreshCloudUi();
