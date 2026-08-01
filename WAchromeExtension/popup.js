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
const apiBaseInput = document.getElementById("api-base");
const licenseBtn = document.getElementById("license-btn");
const licenseClearBtn = document.getElementById("license-clear");
const licenseBadge = document.getElementById("license-badge");
const licenseMessage = document.getElementById("license-message");

const manifest = chrome.runtime.getManifest();
versionEl.textContent = "v" + manifest.version;

let rules = [];

function setLicenseUi(valid, message, key, apiBase) {
  licenseBadge.textContent = valid ? "معتبر" : "غیرفعال";
  licenseBadge.classList.toggle("on", !!valid);
  licenseBadge.classList.toggle("off", !valid);
  licenseMessage.textContent = message || "";
  if (typeof key === "string") licenseKeyInput.value = key;
  if (typeof apiBase === "string") apiBaseInput.value = apiBase;
}

function sendBg(message) {
  return new Promise(function (resolve) {
    chrome.runtime.sendMessage(message, function (response) {
      if (chrome.runtime.lastError) {
        resolve({
          ok: false,
          valid: false,
          message: chrome.runtime.lastError.message
        });
        return;
      }
      resolve(response || { ok: false, valid: false, message: "بدون پاسخ" });
    });
  });
}

async function refreshLicenseStatus() {
  const status = await sendBg({ type: "getLicenseStatus" });
  setLicenseUi(
    !!status.valid,
    status.info?.message ||
      (status.valid ? "لایسنس معتبر است." : "برای استفاده، کلید لایسنس را وارد کنید."),
    status.key || "",
    status.apiBaseUrl || "http://localhost:3000"
  );
}

licenseForm.addEventListener("submit", async function (event) {
  event.preventDefault();
  const key = licenseKeyInput.value.trim();
  const apiBase = apiBaseInput.value.trim() || "http://localhost:3000";

  licenseBtn.disabled = true;
  licenseBtn.textContent = "در حال بررسی...";

  try {
    await chrome.storage.local.set({ apiBaseUrl: apiBase.replace(/\/$/, "") });
    const result = await sendBg({ type: "verifyLicense", key: key });
    setLicenseUi(
      !!result.valid,
      result.message || (result.valid ? "فعال شد" : "نامعتبر"),
      key,
      apiBase
    );
  } finally {
    licenseBtn.disabled = false;
    licenseBtn.textContent = "فعال‌سازی";
  }
});

licenseClearBtn.addEventListener("click", async function () {
  await sendBg({ type: "clearLicense" });
  setLicenseUi(false, "لایسنس حذف شد.", "", apiBaseInput.value.trim());
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

refreshLicenseStatus();
loadRules();
