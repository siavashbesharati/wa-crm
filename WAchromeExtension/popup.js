const cloudBadge = document.getElementById("cloud-badge");
const cloudStatus = document.getElementById("cloud-status");
const cloudPhone = document.getElementById("cloud-phone");
const cloudCode = document.getElementById("cloud-code");
const cloudCodeWrap = document.getElementById("cloud-code-wrap");
const cloudOtpBtn = document.getElementById("cloud-otp-btn");
const cloudLoginBtn = document.getElementById("cloud-login-btn");
const cloudDisconnect = document.getElementById("cloud-disconnect");
const versionEl = document.getElementById("ext-version");
const footerVersion = document.getElementById("footer-version");

const DEFAULT_API = "http://localhost:8000/api";

const manifest = chrome.runtime.getManifest();
if (versionEl) versionEl.textContent = "v" + manifest.version;
if (footerVersion) footerVersion.textContent = manifest.version;

function errText(res) {
  if (!res) return "خطای ناشناخته";
  if (typeof res.error === "string") return res.error;
  if (res.data && typeof res.data.detail === "string") return res.data.detail;
  return "خطا";
}

async function refreshUi() {
  const cfg = await IranexpediaCloudBridge.getConfig();
  if (cfg.phone) cloudPhone.value = cfg.phone;

  const gate = await IranexpediaAuthGate.verify();
  if (gate.ok && IranexpediaAuthGate.assertUnlocked()) {
    cloudBadge.textContent = "متصل";
    cloudBadge.classList.add("on");
    cloudBadge.classList.remove("off");
    cloudCodeWrap.classList.add("hidden");
    const st = await IranexpediaCloudBridge.status();
    const org = st.me && st.me.org ? st.me.org.name : "";
    cloudStatus.textContent = org
      ? "متصل — «" + org + "». کانال از تب باز فعال می‌شود."
      : "متصل. کانال از تب واتساپ/دیوار فعال می‌شود.";
  } else {
    cloudBadge.textContent = "قطع";
    cloudBadge.classList.add("off");
    cloudBadge.classList.remove("on");
    if (!cloudStatus.dataset.sticky) {
      cloudStatus.textContent = "شماره را وارد کنید.";
    }
  }
}

cloudOtpBtn.addEventListener("click", async function () {
  const phone = cloudPhone.value.trim();
  if (!phone) {
    cloudStatus.textContent = "شماره را وارد کنید.";
    return;
  }
  cloudOtpBtn.disabled = true;
  cloudStatus.dataset.sticky = "1";
  try {
    await IranexpediaCloudBridge.setConfig({ apiUrl: DEFAULT_API });
    const res = await IranexpediaCloudBridge.requestOtp(phone, DEFAULT_API);
    if (!res.ok) {
      cloudStatus.textContent = errText(res);
      cloudCodeWrap.classList.add("hidden");
      return;
    }
    cloudCodeWrap.classList.remove("hidden");
    if (res.data && res.data.dev_code) {
      cloudCode.value = String(res.data.dev_code);
      cloudStatus.textContent = "کد: " + res.data.dev_code;
    } else {
      cloudStatus.textContent = "کد را وارد کنید.";
    }
  } finally {
    cloudOtpBtn.disabled = false;
  }
});

cloudLoginBtn.addEventListener("click", async function () {
  const phone = cloudPhone.value.trim();
  const code = cloudCode.value.trim();
  if (!phone || !code) {
    cloudStatus.textContent = "شماره و کد لازم است.";
    return;
  }
  cloudLoginBtn.disabled = true;
  cloudStatus.dataset.sticky = "1";
  try {
    const res = await IranexpediaCloudBridge.verifyOtp(phone, code, "", DEFAULT_API);
    if (!res.ok) {
      cloudStatus.textContent = errText(res);
      return;
    }
    // Verification only — no channel / account / role UI
    await IranexpediaCloudBridge.setConfig({
      enabled: true,
      apiUrl: DEFAULT_API,
      role: "connector",
      accountId: "",
      channel: ""
    });
    if (globalThis.IranexpediaAuthGate) {
      await IranexpediaAuthGate.verify(true);
    }
    cloudStatus.textContent = "ورود موفق. واتساپ یا دیوار را باز کنید.";
    delete cloudStatus.dataset.sticky;
    await refreshUi();
  } finally {
    cloudLoginBtn.disabled = false;
  }
});

cloudDisconnect.addEventListener("click", async function () {
  if (globalThis.IranexpediaAuthGate) IranexpediaAuthGate.revoke();
  await IranexpediaCloudBridge.setConfig({
    enabled: false,
    accessToken: "",
    refreshToken: "",
    orgId: "",
    accountId: "",
    channel: "",
    phone: ""
  });
  cloudCode.value = "";
  cloudCodeWrap.classList.add("hidden");
  delete cloudStatus.dataset.sticky;
  await refreshUi();
});

refreshUi();
