const cloudBadge = document.getElementById("cloud-badge");
const cloudStatus = document.getElementById("cloud-status");
const cloudDisconnect = document.getElementById("cloud-disconnect");
const loginView = document.getElementById("login-view");
const connectedView = document.getElementById("connected-view");
const connectedOrg = document.getElementById("connected-org");
const versionEl = document.getElementById("ext-version");
const footerVersion = document.getElementById("footer-version");

const manifest = chrome.runtime.getManifest();
if (versionEl) versionEl.textContent = "v" + manifest.version;
if (footerVersion) footerVersion.textContent = manifest.version;

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
  const gate = await IranexpediaAuthGate.verify();
  if (gate.ok && IranexpediaAuthGate.assertUnlocked()) {
    if (cloudBadge) {
      cloudBadge.textContent = "متصل";
      cloudBadge.classList.add("on");
      cloudBadge.classList.remove("off");
    }
    const st = await IranexpediaCloudBridge.status();
    const cfg = await IranexpediaCloudBridge.getConfig();
    const org = st.me && st.me.org ? st.me.org.name : cfg.orgName || "";
    setConnected(true, org);
  } else {
    if (cloudBadge) {
      cloudBadge.textContent = "قطع";
      cloudBadge.classList.add("off");
      cloudBadge.classList.remove("on");
    }
    setConnected(false);
  }
}

if (cloudDisconnect) {
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
    await refreshUi();
  });
}

refreshUi();
