const EXT_VERSION = "6.1.8";
const BRAND = "iranexpedia.ir";

console.log(
    "%c[" + BRAND + " v" + EXT_VERSION + "] LOADED",
    "background:#2563eb;color:#fff;font-size:14px;padding:6px;"
);

/* ================= CONFIG ================= */
let MIN_DELAY_MS = 2500;
let MAX_DELAY_MS = 5000;
const REPLY_COOLDOWN_MS = 10000;
const BATCH_WAIT_MS = 4000;
const SIDEBAR_SCAN_MS = 2500;
let crmSettingsCache = null;
let taskRunnerBusy = false;

const DEFAULT_RULES = [
    { keyword: "hi", reply: "سلام! چطور می‌تونم کمکتون کنم؟" },
    { keyword: "price", reply: "لطفاً کمی صبر کنید، نرخ را ارسال می‌کنم." }
];

/* ================= STATE ================= */
let isEnabled = false;
let licenseValid = false;
let licenseMessage = "هنوز بررسی نشده";
let keywordRules = DEFAULT_RULES.slice();
let busy = false;

let lastHandledText = "";
let lastBotReply = "";
let lastReplyTime = 0;
let lastStableChat = "";
let lastCapturedMsgKey = "";
const sidebarContactSaved = {};

let replyTimeout = null;
let batchTimeout = null;

const handledSidebarKeys = {};

/* ================= UI (controls live in CRM side panel) ================= */
function removeLegacyFloatingButtons() {
    [
        "iranexpedia-toggle",
        "iranexpedia-members",
        "keyword-toggle-btn",
        "ai-toggle-btn",
        "kw-toggle-btn",
        "keyword-autoreply-version",
        "iranexpedia-style",
        "iranexpedia-font"
    ].forEach(function (id) {
        const el = document.getElementById(id);
        if (el) el.remove();
    });
}

function persistAutoReplyEnabled(enabled) {
    try {
        chrome.storage.local.set({ autoReplyEnabled: !!enabled });
    } catch (_err) {
        // ignore
    }
}

async function applyAutoReplyEnabled(enabled, source) {
    const want = !!enabled;
    if (want) {
        const ok = await refreshLicenseStatus();
        if (!ok) {
            isEnabled = false;
            persistAutoReplyEnabled(false);
            log("روشن نشد — نیاز به فعال‌سازی (", source || "ui", ")");
            removeLegacyFloatingButtons();
            return false;
        }
    }
    isEnabled = want;
    persistAutoReplyEnabled(isEnabled);
    busy = false;
    if (isEnabled) resetMessageCache();
    log(
        isEnabled
            ? "افزونه روشن شد — پاسخ خودکار فعال (" + (source || "ui") + ")"
            : "افزونه خاموش شد — پاسخ خودکار غیرفعال (" + (source || "ui") + ")"
    );
    removeLegacyFloatingButtons();
    return isEnabled;
}

window.__iranexpediaGetAutoReplyEnabled = function () {
    return !!isEnabled;
};
window.__iranexpediaSetAutoReplyEnabled = function (enabled) {
    return applyAutoReplyEnabled(enabled, "crm-panel");
};
window.__iranexpediaDownloadGroupMembers = async function (btn) {
    const ok = await requireLicense("دانلود اعضای گروه");
    if (!ok) return false;
    const target = btn || {
        disabled: false,
        textContent: "",
        set disabled(_v) {},
        get disabled() {
            return false;
        }
    };
    await downloadGroupMembers(target);
    return true;
};

async function refreshCrmSettings() {
    if (!globalThis.IranexpediaCrm) return;
    try {
        crmSettingsCache = await IranexpediaCrm.getSettings();
        MIN_DELAY_MS = crmSettingsCache.minDelayMs || 2500;
        MAX_DELAY_MS = crmSettingsCache.maxDelayMs || 5000;
    } catch (_err) {
        // keep defaults
    }
}

async function isChatBotPaused(chatName) {
    if (!globalThis.IranexpediaCrm || !chatName) return false;
    const contact = await IranexpediaCrm.getContactByName(chatName);
    return !!(contact && contact.botPaused);
}

async function logCrmEvent(type, message, meta) {
    if (!globalThis.IranexpediaCrm) return;
    try {
        await IranexpediaCrm.addEvent(type, message, meta || {});
    } catch (_err) {
        // ignore
    }
}

/* ================= HELPERS ================= */
function sleep(ms) {
    return new Promise(function (resolve) {
        setTimeout(resolve, ms);
    });
}

function randomDelay() {
    return (
        Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS + 1)) +
        MIN_DELAY_MS
    );
}

function log() {
    const args = Array.prototype.slice.call(arguments);
    args.unshift("[" + BRAND + " v" + EXT_VERSION + "]");
    console.log.apply(console, args);
}

/* ================= LICENSE (hashed key + expiry + web time) ================= */
async function refreshLicenseStatus() {
    try {
        if (!globalThis.IranexpediaLicense) {
            licenseValid = false;
            licenseMessage = "خطا در بارگذاری. صفحه را تازه کنید.";
            return false;
        }
        const status = await IranexpediaLicense.getStoredLicenseStatus();
        licenseValid = !!status.valid;
        licenseMessage = status.message || (licenseValid ? "فعال" : "غیرفعال");
        if (!licenseValid && isEnabled) {
            isEnabled = false;
            log("فعال‌سازی نامعتبر/منقضی — پاسخ خودکار خاموش شد");
        }
        return licenseValid;
    } catch (err) {
        licenseValid = false;
        licenseMessage = err.message || "خطا در بررسی فعال‌سازی";
        isEnabled = false;
        return false;
    }
}

async function requireLicense(featureName) {
    const ok = await refreshLicenseStatus();
    if (!ok) {
        alert(
            "برای استفاده از «" +
                featureName +
                "» ابتدا برنامه را فعال کنید.\n\n" +
                (licenseMessage || "") +
                "\n\nکلید را از آیکون افزونه وارد کنید."
        );
        return false;
    }
    return true;
}

/* ================= RULES ================= */
function loadRules() {
    try {
        chrome.storage.local.get({ keywordRules: null }, function (data) {
            if (chrome.runtime.lastError) return;
            if (Array.isArray(data.keywordRules) && data.keywordRules.length) {
                keywordRules = data.keywordRules;
            } else {
                keywordRules = DEFAULT_RULES.slice();
            }
            log(
                "قوانین:",
                keywordRules.map(function (r) {
                    return r.keyword;
                })
            );
        });
    } catch (e) {
        keywordRules = DEFAULT_RULES.slice();
    }
}

chrome.storage.onChanged.addListener(function (changes, area) {
    if (area === "local" && changes.keywordRules) {
        const next = changes.keywordRules.newValue;
        keywordRules =
            Array.isArray(next) && next.length ? next : DEFAULT_RULES.slice();
        log(
            "قوانین به‌روز شد:",
            keywordRules.map(function (r) {
                return r.keyword;
            })
        );
    }
});

function findReply(text) {
    const msg = String(text || "").toLowerCase();
    for (let i = 0; i < keywordRules.length; i++) {
        const k = String(keywordRules[i].keyword || "")
            .toLowerCase()
            .trim();
        if (k && msg.indexOf(k) !== -1) {
            return String(keywordRules[i].reply || "").trim();
        }
    }
    return null;
}

/* ================= CHAT NAME ================= */
function isStatusText(value) {
    const t = String(value || "").trim();
    if (!t) return true;
    return (
        /^(online|offline|typing|last seen|click here|recording)/i.test(t) ||
        /^(آنلاین|آفلاین|آخرین بازدید|در حال نوشتن|درحال نوشتن|کلیک کنید)/.test(t)
    );
}

function looksLikePhone(value) {
    const t = String(value || "").replace(/[\s\-()]/g, "");
    return /^\+?\d{8,15}$/.test(t);
}

function normalizePhone(value) {
    return String(value || "").replace(/[\s\-()]/g, "").trim();
}

function isMemberListText(value) {
    const t = String(value || "").trim();
    if (!t) return false;
    const phones = t.match(/\+\d[\d\s\-()]{6,}\d/g);
    if (phones && phones.length >= 2) return true;
    if ((t.match(/,/g) || []).length >= 3) return true;
    if (t.length > 120) return true;
    return false;
}

function getHeaderTitleSpans() {
    const header = document.querySelector("#main header");
    if (!header) return [];
    return Array.from(
        header.querySelectorAll("span[title], span[dir='auto'], span[dir='rtl']")
    );
}

function cleanChatLabel(value) {
    return String(value || "")
        .normalize("NFC")
        .replace(/[\u200c\u200d\ufeff]/g, "")
        .trim()
        .replace(/\s+/g, " ");
}

function extractPeerIdsFromOpenChat() {
    const result = { phone: "", groupId: "", chatType: "" };
    const nodes = document.querySelectorAll("#main [data-id]");
    if (!nodes.length) return result;

    const start = Math.max(0, nodes.length - 60);
    for (let i = nodes.length - 1; i >= start; i--) {
        const id = nodes[i].getAttribute("data-id") || "";
        const groupMatch = id.match(/(\d{10,24})@g\.us/);
        if (groupMatch) {
            result.groupId = groupMatch[1] + "@g.us";
            result.chatType = "group";
            return result;
        }
        const phoneMatch = id.match(/(\d{8,15})@c\.us/);
        if (phoneMatch && !result.phone) {
            result.phone = normalizePhone(phoneMatch[1]);
            result.chatType = "pv";
        }
    }
    return result;
}

function getChatIdentity() {
    const spans = getHeaderTitleSpans();
    let name = "";
    let phone = "";
    const memberList = getHeaderMemberListText();
    const peer = extractPeerIdsFromOpenChat();

    for (let i = 0; i < spans.length; i++) {
        const raw = cleanChatLabel(
            spans[i].getAttribute("title") || spans[i].innerText || spans[i].textContent || ""
        );
        if (!raw || isStatusText(raw) || isMemberListText(raw)) continue;
        if (looksLikePhone(raw)) {
            if (!phone) phone = normalizePhone(raw);
            continue;
        }
        // Prefer first non-phone title (supports Farsi names)
        if (!name) name = raw;
    }

    if (!name && phone) name = phone;

    const isGroup = !!(memberList || peer.groupId || peer.chatType === "group");
    if (isGroup) {
        return {
            name: name || "",
            phone: "",
            groupId: peer.groupId || "",
            chatType: "group"
        };
    }

    return {
        name: name || "",
        phone: phone || peer.phone || "",
        groupId: "",
        chatType: "pv"
    };
}

function getChatName() {
    return getChatIdentity().name || null;
}

async function saveContactFromIncoming(chatInfo, source) {
    if (!globalThis.IranexpediaCrm) return null;
    if (!licenseValid) return null;
    const name = cleanChatLabel((chatInfo && chatInfo.name) || "");
    if (!name) return null;

    const chatType = (chatInfo && chatInfo.chatType) || "pv";
    const phone = chatType === "group" ? "" : (chatInfo && chatInfo.phone) || "";
    const groupId = chatType === "group" ? (chatInfo && chatInfo.groupId) || "" : "";

    const existing = await IranexpediaCrm.getContactByName(name);
    if (existing) {
        const updated = await IranexpediaCrm.upsertContact({
            name: existing.name || name,
            phone: phone || existing.phone || "",
            groupId: groupId || existing.groupId || "",
            chatType: chatType || existing.chatType || "pv",
            lastMessageAt: Date.now()
        });
        return updated || existing;
    }

    const created = await IranexpediaCrm.upsertContact({
        name: name,
        phone: phone,
        groupId: groupId,
        chatType: chatType,
        lastMessageAt: Date.now()
    });
    log(
        "مخاطب جدید ذخیره شد (",
        source || "message",
        "):",
        name,
        chatType === "group" ? groupId || "(بدون group id)" : phone || "(بدون تلفن)"
    );
    await logCrmEvent("contact_new", "مخاطب جدید: " + name, {
        source: source || "message",
        chatType: chatType,
        phone: phone,
        groupId: groupId
    });
    return created;
}

/** Capture contacts on new messages even when auto-reply is OFF */
function captureContactsFromOpenChat() {
    if (!licenseValid || !globalThis.IranexpediaCrm) return;
    if (!document.querySelector("#main")) return;

    const text = getLastIncomingText();
    if (!text) return;
    if (/^\d{1,2}:\d{2}\s?(am|pm)?$/i.test(text)) return;
    if (text === lastBotReply) return;

    const info = getChatIdentity();
    if (!info.name) return;

    const key = info.name + "||" + text;
    if (key === lastCapturedMsgKey) return;
    lastCapturedMsgKey = key;

    saveContactFromIncoming(info, "incoming");
}

function getHeaderMemberListText() {
    const spans = getHeaderTitleSpans();
    let best = "";
    for (let i = 0; i < spans.length; i++) {
        const t = (spans[i].getAttribute("title") || "").trim();
        if (!isMemberListText(t)) continue;
        if (t.length > best.length) best = t;
    }
    return best;
}

function parseMemberListText(text) {
    const parts = String(text || "")
        .split(",")
        .map(function (s) {
            return s.trim();
        })
        .filter(Boolean);

    const members = [];
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (isStatusText(part)) continue;
        if (looksLikePhone(part)) {
            members.push({ name: "", phone: normalizePhone(part) });
        } else {
            members.push({ name: part, phone: "" });
        }
    }
    return members;
}

function mergeMembers(listA, listB) {
    const map = {};
    function add(m) {
        if (!m) return;
        const phone = normalizePhone(m.phone || "");
        const name = String(m.name || "").trim();
        if (!phone && !name) return;
        const key = (phone || name).toLowerCase();
        if (!map[key]) {
            map[key] = { name: name, phone: phone };
            return;
        }
        if (phone && !map[key].phone) map[key].phone = phone;
        if (name && !map[key].name) map[key].name = name;
        if (name && phone && map[key].name === map[key].phone) {
            map[key].name = name;
        }
    }
    (listA || []).forEach(add);
    (listB || []).forEach(add);
    return Object.keys(map).map(function (k) {
        return map[k];
    });
}

function resetMessageCache() {
    lastHandledText = "";
    lastBotReply = "";
    lastReplyTime = 0;

    if (replyTimeout) {
        clearTimeout(replyTimeout);
        replyTimeout = null;
    }
    if (batchTimeout) {
        clearTimeout(batchTimeout);
        batchTimeout = null;
    }
}

/* ================= INPUT + SEND ================= */
function insertReply(text) {
    const input =
        document.querySelector(
            '#main footer div[contenteditable="true"][role="textbox"]'
        ) ||
        document.querySelector(
            'div[contenteditable="true"][data-tab="10"][role="textbox"]'
        );
    if (!input) return false;
    input.focus();
    document.execCommand("insertText", false, text);
    return true;
}

function sendWhatsAppMessage() {
    const btn =
        document.querySelector('#main footer button[aria-label="Send"]') ||
        document.querySelector('button[aria-label="Send"]') ||
        document.querySelector('button[aria-label="ارسال"]');
    if (btn && !btn.disabled) {
        btn.click();
        return true;
    }
    return false;
}

async function waitForChatReady(expectedName, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const input = document.querySelector(
            '#main footer div[contenteditable="true"][role="textbox"]'
        );
        const name = getChatName();
        if (input && (!expectedName || !name || name === expectedName)) {
            return true;
        }
        await sleep(300);
    }
    return false;
}

function clickSidebarCell(cell) {
    const clickable =
        cell.querySelector("span[title]") ||
        cell.querySelector('[role="gridcell"]') ||
        cell;
    clickable.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window })
    );
    clickable.dispatchEvent(
        new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window })
    );
    clickable.click();
}

function chatNamesEqual(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    if (
        globalThis.IranexpediaCrm &&
        typeof IranexpediaCrm.namesMatch === "function"
    ) {
        return IranexpediaCrm.namesMatch(a, b);
    }
    return cleanChatLabel(a) === cleanChatLabel(b);
}

async function openChatByName(targetName, timeoutMs) {
    const want = String(targetName || "").trim();
    if (!want) return false;

    const current = getChatName();
    if (current && chatNamesEqual(current, want)) {
        return waitForChatReady(current, timeoutMs || 8000);
    }

    const cells = getSidebarCells();
    for (let i = 0; i < cells.length; i++) {
        const name = getCellChatName(cells[i]);
        if (name && chatNamesEqual(name, want)) {
            clickSidebarCell(cells[i]);
            return waitForChatReady(name, timeoutMs || 12000);
        }
    }

    // Try search box if available
    const search =
        document.querySelector('div[contenteditable="true"][data-tab="3"]') ||
        document.querySelector('[data-testid="chat-list-search"]') ||
        document.querySelector('div[contenteditable="true"][role="textbox"][data-tab="3"]');
    if (search) {
        search.focus();
        document.execCommand("selectAll", false, null);
        document.execCommand("insertText", false, want);
        await sleep(1200);
        const afterSearch = getSidebarCells();
        for (let j = 0; j < afterSearch.length; j++) {
            const name2 = getCellChatName(afterSearch[j]);
            if (name2 && chatNamesEqual(name2, want)) {
                clickSidebarCell(afterSearch[j]);
                return waitForChatReady(name2, timeoutMs || 12000);
            }
        }
    }

    return false;
}

async function sendTextNow(text) {
    const msg = String(text || "").trim();
    if (!msg) return false;
    await refreshCrmSettings();
    const delay =
        Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS + 1)) + MIN_DELAY_MS;
    await sleep(Math.min(delay, 3000));
    if (!insertReply(msg)) return false;
    await sleep(700);
    const ok = sendWhatsAppMessage();
    if (ok) {
        lastBotReply = msg;
        await logCrmEvent("manual_sent", "ارسال دستی/قالب: " + (getChatName() || ""), {
            text: msg,
            contactName: getChatName() || ""
        });
    }
    return ok;
}

async function openContactChatAction(targetName) {
    const name = String(targetName || "").trim();
    if (!name) return { ok: false, error: "نام مخاطب مشخص نیست." };
    const opened = await openChatByName(name, 14000);
    if (!opened) {
        return {
            ok: false,
            error: "چت «" + name + "» پیدا نشد. نام باید دقیقاً مثل واتساپ باشد."
        };
    }
    return { ok: true };
}

async function sendTemplateNowAction(targetName, message) {
    const name = String(targetName || "").trim();
    const msg = String(message || "").trim();
    if (!name || !msg) {
        return { ok: false, error: "مخاطب و متن پیام الزامی است." };
    }
    if (taskRunnerBusy || busy) {
        return { ok: false, error: "سیستم مشغول است. کمی بعد دوباره تلاش کنید." };
    }

    taskRunnerBusy = true;
    busy = true;
    try {
        await refreshCrmSettings();
        if (globalThis.IranexpediaCrm) {
            const sentHour = await IranexpediaCrm.countSendsInLastHour();
            const max = (crmSettingsCache && crmSettingsCache.maxPerHour) || 20;
            if (sentHour >= max) {
                return {
                    ok: false,
                    error: "سقف ارسال ساعتی (" + max + ") پر شده است."
                };
            }
        }

        const opened = await openChatByName(name, 14000);
        if (!opened) {
            return {
                ok: false,
                error: "چت «" + name + "» پیدا نشد یا باز نشد."
            };
        }
        await sleep(800);
        resetMessageCache();
        const ok = await sendTextNow(msg);
        if (!ok) return { ok: false, error: "ارسال پیام انجام نشد." };
        if (globalThis.IranexpediaCrm) {
            await IranexpediaCrm.upsertContact({
                name: name,
                lastMessageAt: Date.now()
            });
        }
        return { ok: true };
    } catch (err) {
        return { ok: false, error: String((err && err.message) || err) };
    } finally {
        taskRunnerBusy = false;
        busy = false;
    }
}

async function runScheduledTask(task) {
    if (!task || !task.targetName || !task.message) {
        return { ok: false, error: "وظیفه ناقص است." };
    }
    if (taskRunnerBusy || busy) {
        return { ok: false, error: "سیستم مشغول است. کمی بعد دوباره تلاش می‌شود." };
    }

    taskRunnerBusy = true;
    busy = true;
    try {
        await refreshCrmSettings();
        if (globalThis.IranexpediaCrm) {
            const sentHour = await IranexpediaCrm.countSendsInLastHour();
            const max = (crmSettingsCache && crmSettingsCache.maxPerHour) || 20;
            if (sentHour >= max) {
                return {
                    ok: false,
                    error: "سقف ارسال ساعتی (" + max + ") پر شده است."
                };
            }
        }

        const opened = await openChatByName(task.targetName, 14000);
        if (!opened) {
            return {
                ok: false,
                error: "چت «" + task.targetName + "» در لیست پیدا نشد یا باز نشد."
            };
        }

        await sleep(900);
        resetMessageCache();

        const delay =
            Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS + 1)) +
            MIN_DELAY_MS;
        await sleep(delay);

        if (!insertReply(task.message)) {
            return { ok: false, error: "باکس پیام پیدا نشد." };
        }
        await sleep(700);
        const sent = sendWhatsAppMessage();
        if (!sent) return { ok: false, error: "دکمه ارسال پیدا نشد." };

        lastBotReply = task.message;
        lastReplyTime = Date.now();
        if (globalThis.IranexpediaCrm) {
            await IranexpediaCrm.upsertContact({
                name: task.targetName,
                chatType: task.targetType || "pv"
            });
        }
        return { ok: true };
    } catch (err) {
        return { ok: false, error: String((err && err.message) || err) };
    } finally {
        taskRunnerBusy = false;
        busy = false;
    }
}

window.__iranexpediaGetChatName = getChatName;
window.__iranexpediaGetChatIdentity = getChatIdentity;
window.__iranexpediaSendNow = function (text) {
    sendTextNow(text).then(function (ok) {
        if (!ok) alert("ارسال انجام نشد. چت را باز کنید و دوباره تلاش کنید.");
    });
};

chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
    if (!message || !message.type) return;
    if (message.type === "runScheduledTask") {
        runScheduledTask(message.task || {}).then(sendResponse);
        return true;
    }
    if (message.type === "openContactChat") {
        openContactChatAction(message.targetName).then(sendResponse);
        return true;
    }
    if (message.type === "sendTemplateNow") {
        sendTemplateNowAction(message.targetName, message.message).then(sendResponse);
        return true;
    }
    if (message.type === "pingRunner") {
        sendResponse({ ok: true, chat: getChatName() || "" });
        return;
    }
});

/* ================= GROUP MEMBERS DOWNLOAD ================= */
function ensureButton() {
    // Floating buttons removed — controls are in the CRM side panel.
    removeLegacyFloatingButtons();
}

function clickEl(el) {
    if (!el) return;
    el.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window })
    );
    el.dispatchEvent(
        new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window })
    );
    el.click();
}

function findByText(root, patterns) {
    const nodes = root.querySelectorAll("div, span, button, li");
    for (let i = 0; i < nodes.length; i++) {
        const txt = (nodes[i].innerText || nodes[i].textContent || "")
            .replace(/\s+/g, " ")
            .trim();
        if (!txt || txt.length > 80) continue;
        for (let p = 0; p < patterns.length; p++) {
            if (patterns[p].test(txt)) return nodes[i];
        }
    }
    return null;
}

function collectMemberRows(root) {
    const map = {};
    const spans = root.querySelectorAll("span[title], span[dir='auto']");

    for (let i = 0; i < spans.length; i++) {
        const title = (
            spans[i].getAttribute("title") ||
            spans[i].innerText ||
            ""
        ).trim();
        if (!title) continue;
        if (isStatusText(title)) continue;
        if (isMemberListText(title)) {
            parseMemberListText(title).forEach(function (m) {
                const key = ((m.phone || "") + "|" + m.name).toLowerCase();
                if (!map[key]) map[key] = m;
            });
            continue;
        }
        if (/participant|اعضا|عضو|about|درباره|description|توضیح/i.test(title)) {
            continue;
        }

        let phone = "";
        let name = title;

        if (looksLikePhone(title)) {
            phone = normalizePhone(title);
            name = "";
            const parent =
                spans[i].closest('[data-testid="cell-frame-container"]') ||
                spans[i].closest('[role="listitem"]') ||
                spans[i].parentElement;
            if (parent) {
                const other = parent.querySelectorAll("span[title], span[dir='auto']");
                for (let j = 0; j < other.length; j++) {
                    const n = (
                        other[j].getAttribute("title") ||
                        other[j].innerText ||
                        ""
                    ).trim();
                    if (
                        n &&
                        n !== title &&
                        !looksLikePhone(n) &&
                        !isStatusText(n) &&
                        !isMemberListText(n)
                    ) {
                        name = n;
                        break;
                    }
                }
            }
        } else {
            const parent =
                spans[i].closest('[data-testid="cell-frame-container"]') ||
                spans[i].closest('[role="listitem"]') ||
                spans[i].parentElement;
            if (parent) {
                const other = parent.querySelectorAll("span[title], span[dir='auto']");
                for (let j = 0; j < other.length; j++) {
                    const n = (
                        other[j].getAttribute("title") ||
                        other[j].innerText ||
                        ""
                    ).trim();
                    if (looksLikePhone(n)) {
                        phone = normalizePhone(n);
                        break;
                    }
                }
            }
        }

        if (!phone && !name) continue;
        const key = (phone || name).toLowerCase();
        if (!map[key]) {
            map[key] = { name: name, phone: phone };
        } else if (phone && !map[key].phone) {
            map[key].phone = phone;
        } else if (name && !map[key].name) {
            map[key].name = name;
        }
    }

    return Object.keys(map).map(function (k) {
        return map[k];
    });
}

async function openGroupInfoPanel() {
    const header =
        document.querySelector("#main header") ||
        document.querySelector('#main [data-testid="conversation-info-header"]');
    if (!header) {
        throw new Error("ابتدا یک گروه را در واتساپ باز کنید.");
    }

    clickEl(header.querySelector("span[title]") || header);
    await sleep(1000);

    const drawer =
        document.querySelector('[data-testid="drawer-right"]') ||
        document.querySelector("#app .two > div:last-child") ||
        document.body;

    const participantsBtn = findByText(drawer, [
        /\d+\s+participants?/i,
        /\d+\s+اعضا/,
        /\d+\s+عضو/,
        /participants?/i,
        /اعضای گروه/,
        /مشاهده همه/,
        /View all/
    ]);

    if (participantsBtn) {
        clickEl(participantsBtn);
        await sleep(1200);
    }
}

async function scrollAndCollectMembers() {
    const roots = [
        document.querySelector('[data-testid="drawer-right"]'),
        document.querySelector('[data-testid="popup-contents"]'),
        document.querySelector('div[role="dialog"]'),
        document.querySelector("#app")
    ].filter(Boolean);

    const root = roots[0] || document.body;
    const scrollBoxes = root.querySelectorAll("div");
    let scroller = null;
    let best = 0;

    for (let i = 0; i < scrollBoxes.length; i++) {
        const el = scrollBoxes[i];
        if (el.scrollHeight - el.clientHeight > best && el.clientHeight > 120) {
            best = el.scrollHeight - el.clientHeight;
            scroller = el;
        }
    }

    const all = {};
    let stableRounds = 0;
    let lastCount = 0;

    for (let round = 0; round < 50; round++) {
        const batch = collectMemberRows(root);
        batch.forEach(function (m) {
            const key = ((m.phone || "") + "|" + m.name).toLowerCase();
            all[key] = m;
        });

        const count = Object.keys(all).length;
        if (count === lastCount) stableRounds += 1;
        else stableRounds = 0;
        lastCount = count;

        if (stableRounds >= 4) break;

        if (scroller) {
            scroller.scrollTop =
                scroller.scrollTop + Math.max(220, scroller.clientHeight * 0.85);
        }
        await sleep(400);
    }

    return Object.keys(all).map(function (k) {
        return all[k];
    });
}

function downloadCsv(members, groupName) {
    const header = "name,phone,group";
    const lines = members.map(function (m) {
        const name = '"' + String(m.name || "").replace(/"/g, '""') + '"';
        const phone = '"' + String(m.phone || "").replace(/"/g, '""') + '"';
        const group = '"' + String(groupName || "").replace(/"/g, '""') + '"';
        return name + "," + phone + "," + group;
    });

    const csv = "\uFEFF" + header + "\n" + lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safe = String(groupName || "group")
        .replace(/[\\/:*?"<>|]+/g, "_")
        .slice(0, 40);
    a.href = url;
    a.download = "iranexpedia-group-members-" + safe + ".csv";
    a.click();
    URL.revokeObjectURL(url);
}

async function downloadGroupMembers(btn) {
    if (btn.disabled) return;
    btn.disabled = true;
    const oldText = btn.textContent;
    btn.textContent = "در حال دریافت...";

    try {
        if (!document.querySelector("#main")) {
            throw new Error("ابتدا یک گروه را باز کنید.");
        }

        const groupName = getChatName() || "group";
        log("شروع دانلود اعضای گروه:", groupName);

        // 1) Fast path: members listed under group header subtitle
        const headerListText = getHeaderMemberListText();
        let headerMembers = [];
        if (headerListText) {
            headerMembers = parseMemberListText(headerListText);
            log("اعضای موجود در هدر گروه:", headerMembers.length);
        }

        // 2) Also try group info panel + scroll
        let panelMembers = [];
        try {
            await openGroupInfoPanel();
            panelMembers = await scrollAndCollectMembers();
            log("اعضای جمع‌شده از پنل گروه:", panelMembers.length);
        } catch (panelErr) {
            log("پنل گروه در دسترس نبود، از لیست هدر استفاده می‌شود:", panelErr.message || panelErr);
        }

        const members = mergeMembers(headerMembers, panelMembers).filter(function (m) {
            // drop the group title itself if it slipped in
            if (!m.phone && m.name && m.name === groupName) return false;
            return true;
        });

        if (!members.length) {
            throw new Error(
                "عضوی پیدا نشد. مطمئن شوید چت یک گروه است."
            );
        }

        downloadCsv(members, groupName);
        log("دانلود شد:", members.length, "عضو از گروه", groupName);
        btn.textContent = "دانلود شد (" + members.length + ")";
        await sleep(1800);
    } catch (err) {
        console.error(err);
        log("خطا در دانلود اعضا:", err.message || err);
        alert(err.message || String(err));
        btn.textContent = oldText;
    } finally {
        btn.disabled = false;
        setTimeout(function () {
            btn.textContent = "دانلود اعضای گروه";
        }, 1200);
    }
}

/* ================= SIDEBAR: unread closed chats/groups ================= */
function cellHasUnread(cell) {
    if (
        cell.querySelector(
            '[data-testid="icon-unread-count"], [data-testid="unread-count"]'
        )
    ) {
        return true;
    }

    const labeled = cell.querySelectorAll("[aria-label]");
    for (let i = 0; i < labeled.length; i++) {
        const a = (labeled[i].getAttribute("aria-label") || "").toLowerCase();
        if (
            a.indexOf("unread") !== -1 ||
            a.indexOf("خوانده نشده") !== -1 ||
            a.indexOf("خوانده‌نشده") !== -1 ||
            a.indexOf("پیام خوانده") !== -1
        ) {
            return true;
        }
    }

    // circular numeric badge heuristic
    const spans = cell.querySelectorAll("span");
    for (let i = 0; i < spans.length; i++) {
        const t = (spans[i].textContent || "").trim();
        if (!/^[1-9]\d{0,2}$/.test(t)) continue;
        const rect = spans[i].getBoundingClientRect();
        if (rect.width > 0 && rect.width <= 36 && rect.height > 0 && rect.height <= 36) {
            return true;
        }
    }

    return false;
}

function getCellChatName(cell) {
    const spans = cell.querySelectorAll(
        "span[title], span[dir='auto'], span[dir='rtl'], span[dir='ltr']"
    );
    let phone = "";
    for (let i = 0; i < spans.length; i++) {
        const t = cleanChatLabel(
            spans[i].getAttribute("title") || spans[i].innerText || spans[i].textContent || ""
        );
        if (!t || isStatusText(t) || isMemberListText(t)) continue;
        if (looksLikePhone(t)) {
            if (!phone) phone = normalizePhone(t);
            continue;
        }
        return t;
    }
    return phone || null;
}

async function captureContactsFromSidebarUnread() {
    if (!licenseValid || !globalThis.IranexpediaCrm) return;
    const cells = getSidebarCells();
    for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        if (!cellHasUnread(cell)) continue;
        const chatName = getCellChatName(cell);
        if (!chatName) continue;
        const key = cleanChatLabel(chatName);
        if (!key || sidebarContactSaved[key]) continue;
        sidebarContactSaved[key] = Date.now();
        const phone = looksLikePhone(key) ? normalizePhone(key) : "";
        await saveContactFromIncoming(
            { name: key, phone: phone, chatType: "pv" },
            "sidebar-unread"
        );
    }

    // keep map small
    const keys = Object.keys(sidebarContactSaved);
    if (keys.length > 120) {
        keys
            .sort(function (a, b) {
                return sidebarContactSaved[a] - sidebarContactSaved[b];
            })
            .slice(0, keys.length - 60)
            .forEach(function (k) {
                delete sidebarContactSaved[k];
            });
    }
}

function getCellPreview(cell, chatName) {
    const secondary =
        cell.querySelector('[data-testid="cell-frame-secondary"]') ||
        cell.querySelector('[data-testid="cell-frame-secondary-subtitle"]') ||
        cell.querySelector('[data-testid="last-msg-status"]');

    if (secondary) {
        const txt = (secondary.innerText || "").trim();
        if (txt) return txt.replace(/\s+/g, " ");
    }

    const autos = cell.querySelectorAll("span[dir='auto']");
    let preview = "";
    for (let i = 0; i < autos.length; i++) {
        const title = (autos[i].getAttribute("title") || "").trim();
        if (title && title === chatName) continue;
        const txt = (autos[i].innerText || "").trim();
        if (!txt || txt === chatName || isStatusText(txt)) continue;
        if (/^\d{1,2}:\d{2}/.test(txt)) continue;
        preview = txt;
    }
    return preview.replace(/\s+/g, " ");
}

function getSidebarCells() {
    const pane = document.querySelector("#pane-side");
    if (!pane) return [];

    let cells = pane.querySelectorAll('[data-testid="cell-frame-container"]');
    if (!cells.length) {
        cells = pane.querySelectorAll('[role="listitem"]');
    }
    if (!cells.length) {
        cells = pane.querySelectorAll('div[aria-selected="true"], div[aria-selected="false"]');
    }
    return Array.from(cells);
}

function findSidebarMatches() {
    const cells = getSidebarCells();
    const matches = [];

    for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        if (!cellHasUnread(cell)) continue;

        const chatName = getCellChatName(cell);
        if (!chatName) continue;

        const preview = getCellPreview(cell, chatName);
        if (!preview) continue;

        const reply = findReply(preview);
        if (!reply) continue;

        const key = chatName + "||" + preview;
        if (handledSidebarKeys[key]) continue;

        matches.push({
            cell: cell,
            chatName: chatName,
            preview: preview,
            reply: reply,
            key: key
        });
    }

    return matches;
}

async function replyInOpenChat(reply) {
    const delay = randomDelay();
    log("ارسال تا " + (delay / 1000).toFixed(1) + " ثانیه دیگر");
    await sleep(delay);

    if (!isEnabled) return false;

    lastBotReply = reply;
    lastHandledText = reply;
    if (!insertReply(reply)) {
        log("باکس پیام پیدا نشد");
        return false;
    }
    await sleep(700);
    return sendWhatsAppMessage();
}

async function processSidebarMatch(match) {
    handledSidebarKeys[match.key] = Date.now();

    // cleanup old keys
    const keys = Object.keys(handledSidebarKeys);
    if (keys.length > 80) {
        keys.sort(function (a, b) {
            return handledSidebarKeys[a] - handledSidebarKeys[b];
        });
        keys.slice(0, keys.length - 40).forEach(function (k) {
            delete handledSidebarKeys[k];
        });
    }

    if (await isChatBotPaused(match.chatName)) {
        log("ربات برای این چت متوقف است:", match.chatName);
        return;
    }

    log("چت خوانده‌نشده پیدا شد:", match.chatName, "| پیش‌نمایش:", match.preview);

    clickSidebarCell(match.cell);

    const ready = await waitForChatReady(match.chatName, 10000);
    if (!ready) {
        log("باز شدن چت ناموفق بود:", match.chatName);
        return;
    }

    await sleep(1200);
    resetMessageCache();

    // Prefer exact last message in opened chat; fall back to sidebar preview reply
    const spans = document.querySelectorAll(
        '#main span[data-testid="selectable-text"]'
    );
    let reply = match.reply;
    if (spans.length) {
        const lastText = (spans[spans.length - 1].innerText || "").trim();
        const fromOpen = findReply(lastText);
        if (fromOpen) reply = fromOpen;
        lastHandledText = lastText;
        log("آخرین پیام چت بازشده:", lastText);
    }

    await refreshCrmSettings();
    if (
        globalThis.IranexpediaCrm &&
        crmSettingsCache &&
        !IranexpediaCrm.isWithinBusinessHours(crmSettingsCache)
    ) {
        const away =
            (crmSettingsCache.businessHours &&
                crmSettingsCache.businessHours.awayMessage) ||
            "";
        if (away) reply = away;
        else {
            log("خارج از ساعات کاری — بدون پیام away");
            delete handledSidebarKeys[match.key];
            return;
        }
    }

    const now = Date.now();
    if (now - lastReplyTime < REPLY_COOLDOWN_MS) {
        log("کول‌داون فعال است، بعداً دوباره تلاش می‌شود");
        delete handledSidebarKeys[match.key];
        return;
    }
    lastReplyTime = now;

    const ok = await replyInOpenChat(reply);
    if (ok) {
        log("پاسخ به چت بسته/گروه ارسال شد:", match.chatName);
        await logCrmEvent("auto_reply", "پاسخ خودکار به «" + match.chatName + "»", {
            preview: match.preview
        });
        if (globalThis.IranexpediaCrm) {
            await IranexpediaCrm.upsertContact({ name: match.chatName });
        }
    } else {
        delete handledSidebarKeys[match.key];
    }
}

async function scanSidebarAndReply() {
    if (!isEnabled || busy || taskRunnerBusy) return;

    const matches = findSidebarMatches();
    if (!matches.length) return;

    busy = true;
    try {
        await processSidebarMatch(matches[0]);
    } catch (err) {
        console.error("[" + BRAND + " v" + EXT_VERSION + "] sidebar error:", err);
    } finally {
        busy = false;
    }
}

/* ================= OPEN CHAT LOOP ================= */
function collectMessageNodes() {
    const main = document.querySelector("#main");
    if (!main) return [];

    const nodes = [];
    const seen = new Set();

    function pushNode(el) {
        if (!el || seen.has(el)) return;
        const text = (el.innerText || el.textContent || "").trim();
        if (!text) return;
        seen.add(el);
        nodes.push(el);
    }

    main
        .querySelectorAll(
            'div[data-testid="msg-container"] span[data-testid="selectable-text"], ' +
                'div.message-in span[data-testid="selectable-text"], ' +
                'div.message-in span.selectable-text, ' +
                'span[data-testid="selectable-text"], ' +
                "span.selectable-text.copyable-text, " +
                'div.copyable-text span.selectable-text'
        )
        .forEach(pushNode);

    // Fallback: rows that look like incoming bubbles
    if (!nodes.length) {
        main
            .querySelectorAll(
                'div[role="row"] span[dir="auto"], div[role="row"] span[dir="ltr"], div[role="row"] span[dir="rtl"]'
            )
            .forEach(function (el) {
                const t = (el.innerText || "").trim();
                if (!t || t.length > 500) return;
                if (/^\d{1,2}:\d{2}/.test(t)) return;
                if (isStatusText(t)) return;
                pushNode(el);
            });
    }

    return nodes;
}

function getLastIncomingText() {
    const nodes = collectMessageNodes();
    if (!nodes.length) return "";

    // Prefer last node inside an incoming container
    for (let i = nodes.length - 1; i >= 0; i--) {
        const el = nodes[i];
        const wrap =
            el.closest('div[data-testid="msg-container"]') ||
            el.closest("div.message-in") ||
            el.closest("div.message-out") ||
            el.parentElement;
        const cls = ((wrap && wrap.className) || "").toString();
        const isOut = cls.indexOf("message-out") !== -1;
        // Prefer incoming; skip clear outgoing when older messages exist
        if (isOut && i > 0) continue;
        const text = (el.innerText || el.textContent || "").trim();
        if (text) return text.replace(/\s+/g, " ");
    }

    const last = nodes[nodes.length - 1];
    return ((last && (last.innerText || last.textContent)) || "")
        .trim()
        .replace(/\s+/g, " ");
}

function handleOpenChatMessages() {
    if (!document.querySelector("#main")) return;

    const text = getLastIncomingText();
    if (!text) return;
    if (/^\d{1,2}:\d{2}\s?(am|pm)?$/i.test(text)) return;
    if (text === lastBotReply) return;

    const chatInfo = getChatIdentity();
    const chatName = chatInfo.name || "";

    // Always try to save contact on new incoming message (Farsi-safe)
    if (text !== lastHandledText) {
        captureContactsFromOpenChat();
    }

    if (!isEnabled || busy || taskRunnerBusy) return;
    if (text === lastHandledText) return;

    lastHandledText = text;
    log("پیام در چت باز:", text);

    (async function () {
        await saveContactFromIncoming(chatInfo, "incoming");

        if (await isChatBotPaused(chatName)) {
            log("ربات برای این چت متوقف است:", chatName);
            return;
        }

        await refreshCrmSettings();
        let reply = findReply(text);
        const outside =
            globalThis.IranexpediaCrm &&
            crmSettingsCache &&
            !IranexpediaCrm.isWithinBusinessHours(crmSettingsCache);

        if (outside) {
            reply =
                (crmSettingsCache.businessHours &&
                    crmSettingsCache.businessHours.awayMessage) ||
                "";
            if (!reply) {
                log("خارج از ساعات کاری");
                return;
            }
        } else if (!reply) {
            log("کلمه‌ای مطابقت نداشت:", text);
            return;
        }

        log("مطابقت در چت باز. پاسخ:", reply);

        if (batchTimeout) clearTimeout(batchTimeout);

        batchTimeout = setTimeout(function () {
            if (!isEnabled || busy || taskRunnerBusy) return;
            const now = Date.now();
            if (now - lastReplyTime < REPLY_COOLDOWN_MS) return;
            lastReplyTime = now;

            const delay = randomDelay();
            log("ارسال تا " + (delay / 1000).toFixed(1) + " ثانیه دیگر");

            if (replyTimeout) clearTimeout(replyTimeout);
            replyTimeout = setTimeout(function () {
                if (!isEnabled || busy || taskRunnerBusy) return;
                lastBotReply = reply;
                if (insertReply(reply)) {
                    setTimeout(function () {
                        if (sendWhatsAppMessage()) {
                            log(
                                "پاسخ خودکار ارسال شد به",
                                chatName || "(بدون نام)",
                                "←",
                                reply
                            );
                            logCrmEvent(
                                "auto_reply",
                                "پاسخ خودکار به «" + chatName + "»",
                                { text: text }
                            );
                            saveContactFromIncoming(chatInfo, "auto_reply");
                        } else {
                            log("دکمه ارسال پیدا نشد");
                        }
                    }, 700);
                } else {
                    log("باکس پیام برای ارسال پیدا نشد");
                }
            }, delay);
        }, BATCH_WAIT_MS);
    })();
}

/* ================= TIMERS ================= */
setInterval(function () {
    ensureButton();

    const info = getChatIdentity();
    const chat = info.name;
    if (chat && chat !== lastStableChat) {
        lastStableChat = chat;
        lastCapturedMsgKey = "";
        if (!busy) resetMessageCache();
        if (isEnabled) log("چت فعال:", chat);
        // Save when user opens a chat (Farsi names / phone titles supported)
        saveContactFromIncoming(info, "open-chat");
    }
}, 600);

setInterval(function () {
    handleOpenChatMessages();
}, 1200);

setInterval(function () {
    scanSidebarAndReply();
    captureContactsFromSidebarUnread();
}, SIDEBAR_SCAN_MS);

loadRules();
refreshCrmSettings();
refreshLicenseStatus().then(function () {
    ensureButton();
    log("وضعیت فعال‌سازی:", licenseValid ? "فعال" : "غیرفعال", "-", licenseMessage);

    chrome.storage.local.get({ autoReplyEnabled: false }, function (data) {
        if (data.autoReplyEnabled && licenseValid) {
            applyAutoReplyEnabled(true, "restore");
        } else if (data.autoReplyEnabled && !licenseValid) {
            persistAutoReplyEnabled(false);
            log("پاسخ خودکار ذخیره شده بود اما لایسنس فعال نیست");
        } else {
            log("پاسخ خودکار خاموش است — از دکمه سبز یا پنل CRM روشن کنید");
        }
    });
});

chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== "local") return;
    if (
        changes.licenseActivated ||
        changes.licenseHash ||
        changes.licenseExpiresAt
    ) {
        refreshLicenseStatus().then(function () {
            ensureButton();
            if (!licenseValid && isEnabled) {
                applyAutoReplyEnabled(false, "license-lost");
            }
        });
    }
    if (changes.crmSettings) {
        refreshCrmSettings();
    }
    if (changes.autoReplyEnabled) {
        const want = !!changes.autoReplyEnabled.newValue;
        if (want !== isEnabled) {
            applyAutoReplyEnabled(want, "storage");
        }
    }
});

// Re-check expiry periodically with network time
setInterval(function () {
    refreshLicenseStatus().then(function () {
        ensureButton();
    });
}, 5 * 60 * 1000);

setInterval(function () {
    refreshCrmSettings();
}, 60 * 1000);
