const DEFAULT_RULES = [
  { keyword: "hi", reply: "سلام! چطور می‌تونم کمکتون کنم؟" },
  { keyword: "price", reply: "لطفاً کمی صبر کنید، نرخ را ارسال می‌کنم." }
];

const form = document.getElementById("rule-form");
const keywordInput = document.getElementById("keyword");
const replyInput = document.getElementById("reply");
const rulesList = document.getElementById("rules-list");
const emptyState = document.getElementById("empty");
const countBadge = document.getElementById("count");
const versionEl = document.getElementById("ext-version");

const licenseForm = document.getElementById("license-form");
const licenseKeyInput = document.getElementById("license-key");
const licenseBtn = document.getElementById("license-btn");
const licenseClearBtn = document.getElementById("license-clear");
const licenseBadge = document.getElementById("license-badge");
const licenseMessage = document.getElementById("license-message");
const licenseExpiry = document.getElementById("license-expiry");

const manifest = chrome.runtime.getManifest();
versionEl.textContent = "v" + manifest.version;
const footerVersion = document.getElementById("footer-version");
if (footerVersion) footerVersion.textContent = manifest.version;

let rules = [];

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

function saveRules(next) {
  return new Promise(function (resolve) {
    chrome.storage.local.set({ keywordRules: next }, function () {
      resolve();
    });
  });
}

function loadRules() {
  chrome.storage.local.get({ keywordRules: DEFAULT_RULES }, function (data) {
    rules =
      Array.isArray(data.keywordRules) && data.keywordRules.length
        ? data.keywordRules
        : DEFAULT_RULES.slice();
    renderRules();
  });
}

function renderRules() {
  rulesList.innerHTML = "";
  countBadge.textContent = String(rules.length);
  emptyState.classList.toggle("hidden", rules.length > 0);

  rules.forEach(function (rule, index) {
    const li = document.createElement("li");
    li.className = "rule";

    const keyword = document.createElement("div");
    keyword.className = "rule-keyword";
    keyword.textContent = rule.keyword;

    const reply = document.createElement("div");
    reply.className = "rule-reply";
    reply.textContent = rule.reply;

    const actions = document.createElement("div");
    actions.className = "rule-actions";

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "delete-btn";
    deleteBtn.textContent = "حذف";
    deleteBtn.addEventListener("click", async function () {
      rules = rules.filter(function (_, i) {
        return i !== index;
      });
      await saveRules(rules);
      renderRules();
    });

    actions.appendChild(deleteBtn);
    li.appendChild(keyword);
    li.appendChild(reply);
    li.appendChild(actions);
    rulesList.appendChild(li);
  });
}

form.addEventListener("submit", async function (event) {
  event.preventDefault();

  const keyword = keywordInput.value.trim();
  const reply = replyInput.value.trim();
  if (!keyword || !reply) return;

  const existing = rules.findIndex(function (rule) {
    return String(rule.keyword).toLowerCase() === keyword.toLowerCase();
  });

  if (existing >= 0) {
    rules[existing] = { keyword: keyword, reply: reply };
  } else {
    rules.push({ keyword: keyword, reply: reply });
  }

  await saveRules(rules);
  keywordInput.value = "";
  replyInput.value = "";
  keywordInput.focus();
  renderRules();
});

refreshLicenseUi();
loadRules();
