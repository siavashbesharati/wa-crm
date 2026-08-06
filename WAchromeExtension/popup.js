const cloudBadge = document.getElementById("cloud-badge");
const cloudStatus = document.getElementById("cloud-status");
const cloudSeatToken = document.getElementById("cloud-seat-token");
const cloudLoginBtn = document.getElementById("cloud-login-btn");
const cloudDisconnect = document.getElementById("cloud-disconnect");
const loginView = document.getElementById("login-view");
const connectedView = document.getElementById("connected-view");
const connectedOrg = document.getElementById("connected-org");
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

function setConnected(connected, orgName) {
  if (connected) {
    loginView.classList.add("hidden");
    connectedView.classList.remove("hidden");
    connectedOrg.textContent = orgName ? orgName : "";
  } else {
    connectedView.classList.add("hidden");
    loginView.classList.remove("hidden");
    connectedOrg.textContent = "";
  }
}

async function refreshUi() {
  const cfg = await IranexpediaCloudBridge.getConfig();
  if (cfg.seatTokenPrefix && cloudSeatToken && !cloudSeatToken.value) {
    cloudSeatToken.placeholder = cfg.seatTokenPrefix + "…";
  }

  const gate = await IranexpediaAuthGate.verify();
  if (gate.ok && IranexpediaAuthGate.assertUnlocked()) {
    cloudBadge.textContent = "متصل";
    cloudBadge.classList.add("on");
    cloudBadge.classList.remove("off");
    const st = await IranexpediaCloudBridge.status();
    const org = st.me && st.me.org ? st.me.org.name : cfg.orgName || "";
    setConnected(true, org);
  } else {
    cloudBadge.textContent = "قطع";
    cloudBadge.classList.add("off");
    cloudBadge.classList.remove("on");
    setConnected(false);
    if (!cloudStatus.dataset.sticky) {
      cloudStatus.textContent = "توکن را از پنل کسب‌وکار → صندلی‌های افزونه کپی کنید.";
    }
  }
}

cloudLoginBtn.addEventListener("click", async function () {
  const token = (cloudSeatToken.value || "").trim();
  if (!token) {
    cloudStatus.textContent = "توکن صندلی را وارد کنید.";
    return;
  }
  cloudLoginBtn.disabled = true;
  cloudStatus.dataset.sticky = "1";
  try {
    await IranexpediaCloudBridge.setConfig({ apiUrl: DEFAULT_API });
    const res = await IranexpediaCloudBridge.activateSeat(token, DEFAULT_API);
    if (!res.ok) {
      cloudStatus.textContent = errText(res);
      return;
    }
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
    cloudSeatToken.value = "";
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
    phone: "",
    seatId: "",
    seatTokenPrefix: "",
    orgName: "",
    plan: ""
  });
  cloudSeatToken.value = "";
  delete cloudStatus.dataset.sticky;
  await refreshUi();
});

refreshUi();
