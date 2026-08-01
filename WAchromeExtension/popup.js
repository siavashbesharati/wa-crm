const versionEl = document.getElementById("ext-version");
const licenseForm = document.getElementById("license-form");
const licenseKeyInput = document.getElementById("license-key");
const licenseBtn = document.getElementById("license-btn");
const licenseClearBtn = document.getElementById("license-clear");
const licenseBadge = document.getElementById("license-badge");
const licenseMessage = document.getElementById("license-message");
const licenseExpiry = document.getElementById("license-expiry");
const openCrmBtn = document.getElementById("open-crm");

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

  openCrmBtn.disabled = !valid;
}

async function refreshLicenseUi() {
  const status = await IranexpediaLicense.getStoredLicenseStatus();
  setLicenseUi(status);
}

licenseForm.addEventListener("submit", async function (event) {
  event.preventDefault();
  const key = licenseKeyInput.value.trim();
  licenseBtn.disabled = true;
  licenseBtn.textContent = "در حال بررسی...";
  try {
    const result = await IranexpediaLicense.activateLicense(key);
    setLicenseUi(result);
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
});

openCrmBtn.addEventListener("click", function () {
  chrome.runtime.sendMessage({ type: "openDashboard" });
});

refreshLicenseUi();
