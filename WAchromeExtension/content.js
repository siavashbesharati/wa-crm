const EXT_VERSION = "7.7.2";
const BRAND = "iranexpedia.ir";

console.log(
    "%c[" + BRAND + " v" + EXT_VERSION + "] LOADED",
    "background:#2563eb;color:#fff;font-size:14px;padding:6px;"
);

/* ================= CONFIG ================= */
let MIN_DELAY_MS = 2500;
let MAX_DELAY_MS = 5000;
const SIDEBAR_SCAN_MS = 2500;
let crmSettingsCache = null;
let taskRunnerBusy = false;

/* ================= STATE ================= */
let isEnabled = false;
let licenseValid = false;
let licenseMessage = "هنوز بررسی نشده";
let busy = false;

let lastHandledText = "";
let lastBotReply = "";
let lastStableChat = "";
let lastCapturedMsgKey = "";
let lastCloudIngestKey = "";
/** Latest active-chat id from MAIN-world wa-inject.js (@c.us / @g.us). */
let waInjectIdentity = null;
const recentOutboundTexts = {};
const recentIngestKeys = {};
const OUTBOUND_TTL_MS = 20 * 60 * 1000;
const INGEST_DEDUPE_MS = 10 * 60 * 1000;
const sidebarContactSaved = {};
/** Cache chatType from WA info panel (Group info / Contact info). */
const chatInfoPanelCache = {};
const INFO_PANEL_CACHE_MS = 45 * 60 * 1000;
let infoPanelDetectBusy = false;

function injectWaMainWorld() {
    try {
        if (document.documentElement.getAttribute("data-iranexpedia-wa-inject") === "1") {
            return;
        }
        const s = document.createElement("script");
        s.src = chrome.runtime.getURL("wa-inject.js");
        s.onload = function () {
            try {
                s.remove();
            } catch (_e) {}
        };
        s.onerror = function () {
            log("wa-inject.js load failed — check web_accessible_resources");
        };
        (document.documentElement || document.head).appendChild(s);
        document.documentElement.setAttribute("data-iranexpedia-wa-inject", "1");
        log("wa-inject MAIN world hooked");
    } catch (err) {
        log("wa-inject error", err);
    }
}

function requestWaInjectIdentity() {
    try {
        window.postMessage(
            { source: "iranexpedia-wa-content", type: "IRANEXPEDIA_WA_ACTIVE_CHAT_REQ" },
            "*"
        );
    } catch (_e) {}
}

window.addEventListener("message", function (ev) {
    const d = ev && ev.data;
    if (!d || d.source !== "iranexpedia-wa-inject") return;
    if (d.type === "IRANEXPEDIA_WA_ACTIVE_CHAT" && d.data) {
        const hit = d.data;
        if (hit.groupId || hit.phone || hit.wid) {
            waInjectIdentity = hit;
        }
    }
});

function normalizeMsgText(text) {
    return String(text || "")
        .trim()
        .replace(/\s+/g, " ");
}

function pruneRecentMap(map, ttlMs) {
    const now = Date.now();
    Object.keys(map).forEach(function (key) {
        if (now - map[key] > ttlMs) delete map[key];
    });
}

/** Track bot / template / cloud job replies so we never ingest them as inbound */
function rememberOutboundText(text) {
    const n = normalizeMsgText(text);
    if (!n) return;
    lastBotReply = n;
    recentOutboundTexts[n] = Date.now();
    if (n.length > 60) {
        recentOutboundTexts[n.slice(0, 60)] = Date.now();
        recentOutboundTexts[n.slice(0, 120)] = Date.now();
    }
    pruneRecentMap(recentOutboundTexts, OUTBOUND_TTL_MS);
}

function isOurOutboundText(text) {
    const n = normalizeMsgText(text);
    if (!n) return false;
    if (normalizeMsgText(lastBotReply) === n) return true;
    pruneRecentMap(recentOutboundTexts, OUTBOUND_TTL_MS);
    if (recentOutboundTexts[n]) return true;
    if (n.length >= 60 && recentOutboundTexts[n.slice(0, 60)]) return true;
    if (n.length >= 120 && recentOutboundTexts[n.slice(0, 120)]) return true;
    const keys = Object.keys(recentOutboundTexts);
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        if (key.length < 24) continue;
        if (n.indexOf(key) === 0 || key.indexOf(n) === 0) return true;
    }
    return false;
}

function shouldSkipIngest(msgKey) {
    if (msgKey && msgKey === lastCloudIngestKey) return true;
    pruneRecentMap(recentIngestKeys, INGEST_DEDUPE_MS);
    return !!(msgKey && recentIngestKeys[msgKey]);
}

function markIngested(msgKey) {
    if (!msgKey) return;
    lastCloudIngestKey = msgKey;
    recentIngestKeys[msgKey] = Date.now();
    pruneRecentMap(recentIngestKeys, INGEST_DEDUPE_MS);
}

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
            ? "افزونه روشن شد — اسکن برای AI ابری فعال (" + (source || "ui") + ")"
            : "افزونه خاموش شد — اسکن خودکار غیرفعال (" + (source || "ui") + ")"
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

/** Match server bot_commands.py — exact + soft handoff/restart intents */
function parseBotCommand(text) {
    const t = String(text || "").trim();
    if (!t) return null;
    if (/^(stop|pause|halt|\/stop|#stop|توقف|قطع|بس|ایست|خاموش)$/i.test(t)) return "stop";
    if (/^(start|resume|go|\/start|#start|شروع|ادامه|روشن|فعال)$/i.test(t)) return "start";
    if (
        /ربات\s*(?:را\s*)?(?:روشن|فعال)|(?:روشن|فعال)\s*(?:کن|کنید)?\s*ربات|برگشت\s*به\s*ربات|بازگشت\s*به\s*ربات|شروع\s*(?:کن|کنید)?\s*ربات|ادامه\s*(?:بده|بدهید)|enable\s*(?:the\s*)?bot|start\s*(?:the\s*)?bot|resume\s*(?:the\s*)?bot|turn\s*(?:the\s*)?bot\s*on|\bunpause\b/i.test(
            t
        )
    ) {
        return "start";
    }
    if (
        /اپراتور|پشتیبان|کارشناس|انسان|آدم\s*واقعی|شخص\s*واقعی|صحبت\s*با\s*(?:انسان|آدم|شخص|اپراتور|پشتیبان|کارشناس)|حرف\s*با\s*(?:انسان|آدم|شخص|اپراتور|پشتیبان)|وصل(?:م|مان)?\s*(?:کن|کنید)?\s*(?:به\s*)?(?:اپراتور|پشتیبان|کارشناس)|منشی|\boperator\b|\b(?:live\s*)?agent\b|\bhuman\b|talk\s*to\s*(?:a\s*)?(?:human|person|agent|operator)|speak\s*(?:to|with)\s*(?:a\s*)?(?:human|person|agent|operator)|customer\s*support/i.test(
            t
        )
    ) {
        return "handoff";
    }
    return null;
}

/** Apply stop/start/handoff locally only — server owns pause + ack on ingest. */
async function applyBotCommandFromMessage(chatInfo, text) {
    const cmd = parseBotCommand(text);
    if (!cmd) return false;
    const name = cleanChatLabel((chatInfo && chatInfo.name) || "");
    if (!name || !globalThis.IranexpediaCrm) return true;

    const chatType = (chatInfo && chatInfo.chatType) || "pv";
    const phone =
        chatType === "group" ? "" : sanitizePhoneField((chatInfo && chatInfo.phone) || "");
    const groupId = chatType === "group" ? (chatInfo && chatInfo.groupId) || "" : "";
    const pause = cmd === "stop" || cmd === "handoff";

    let contact = await IranexpediaCrm.getContactByName(name);
    if (contact) {
        contact = await IranexpediaCrm.updateContact(contact.id, { botPaused: pause });
    } else {
        contact = await IranexpediaCrm.upsertContact({
            name: name,
            phone: phone,
            groupId: groupId,
            chatType: chatType,
            botPaused: pause
        });
    }

    // Do NOT upsertLead(botPaused) here — that raced ingest and skipped server ack
    // (server saw already-paused and never queued the handoff message).

    log(
        cmd === "handoff"
            ? "درخواست اپراتور (handoff) ←"
            : pause
              ? "دستور توقف ربات ←"
              : "دستور فعال‌سازی ربات ←",
        name
    );
    await logCrmEvent(
        "bot_pause",
        (cmd === "handoff"
            ? "درخواست اپراتور: "
            : pause
              ? "ربات متوقف (دستور چت): "
              : "ربات فعال (دستور چت): ") + name,
        { command: cmd }
    );
    return true;
}

async function syncLocalBotPaused(chatInfo, paused) {
    const name = cleanChatLabel((chatInfo && chatInfo.name) || "");
    if (!name || !globalThis.IranexpediaCrm || typeof paused !== "boolean") return;
    try {
        let contact = await IranexpediaCrm.getContactByName(name);
        if (!contact) return;
        if (!!contact.botPaused === paused) return;
        await IranexpediaCrm.updateContact(contact.id, { botPaused: paused });
        log(paused ? "sync pause ← پاسخ ابر:" : "sync resume ← پاسخ ابر:", name);
    } catch (_e) {}
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

function log() {
    const args = Array.prototype.slice.call(arguments);
    args.unshift("[" + BRAND + " v" + EXT_VERSION + "]");
    console.log.apply(console, args);
}

/* ================= AUTH (OTP/cloud only via hardened AuthGate) ================= */
async function refreshLicenseStatus() {
    try {
        if (!globalThis.IranexpediaAuthGate) {
            licenseValid = false;
            licenseMessage = "ماژول احراز هویت بارگذاری نشد.";
            return false;
        }
        const res = await IranexpediaAuthGate.verify();
        licenseValid = !!(res && res.ok && IranexpediaAuthGate.assertUnlocked());
        licenseMessage = licenseValid
            ? "فعال با ورود OTP ابری"
            : "سرور در دسترس نیست یا وارد نشده‌اید — از پاپ‌آپ با OTP وصل شوید (" +
              ((res && res.reason) || IranexpediaAuthGate.getReason()) +
              ")";
        if (!licenseValid && isEnabled) {
            isEnabled = false;
            log("اتصال ابری قطع — پاسخ خودکار خاموش شد");
        }
        return licenseValid;
    } catch (err) {
        licenseValid = false;
        licenseMessage = err.message || "خطا در بررسی اتصال ابری";
        isEnabled = false;
        return false;
    }
}

async function requireLicense(featureName) {
    const ok = await refreshLicenseStatus();
    if (!ok || !isCloudAuthorized()) {
        alert(
            "برای استفاده از «" +
                featureName +
                "» ابتدا با OTP به سرور وصل شوید.\n\n" +
                (licenseMessage || "") +
                "\n\nاز آیکون افزونه وارد شوید."
        );
        return false;
    }
    return true;
}

function isCloudAuthorized() {
    return (
        !!licenseValid &&
        globalThis.IranexpediaAuthGate &&
        IranexpediaAuthGate.assertUnlocked()
    );
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
    let n = String(value || "").replace(/[\s\-()]/g, "").trim();
    // Convert 0098… → +98…
    if (/^00\d{8,}$/.test(n)) n = "+" + n.slice(2);
    // Iranian local 09xxxxxxxxx → +989xxxxxxxxx
    if (/^09\d{9}$/.test(n)) n = "+98" + n.slice(1);
    // Bare 98xxxxxxxxxx (no +) when looks like IR country code
    if (/^98\d{10}$/.test(n)) n = "+" + n;
    return n;
}

/** Only real phone digits — never a contact/group display name. */
function sanitizePhoneField(value) {
    const n = normalizePhone(value);
    return looksLikePhone(n) ? n : "";
}

/**
 * Open conversation header — WA layouts vary; #main is not always present.
 * Matches paths like: …/div[4]/div/header/…/span (subtitle member list).
 */
function getConversationHeader() {
    return (
        document.querySelector("#main header") ||
        document.querySelector('[data-testid="conversation-header"]') ||
        document.querySelector("#main [data-testid='conversation-panel-wrapper'] header") ||
        document.querySelector("#app header") ||
        (function () {
            const headers = document.querySelectorAll("header");
            for (let i = 0; i < headers.length; i++) {
                const h = headers[i];
                if (!h || !h.querySelector) continue;
                // Prefer header that has a long member-list title (open group)
                const titled = h.querySelectorAll("span[title]");
                for (let j = 0; j < titled.length; j++) {
                    const t = titled[j].getAttribute("title") || "";
                    if (isMemberListText(t)) return h;
                }
                if (h.querySelector('[data-testid="conversation-info-header"]')) return h;
            }
            return null;
        })()
    );
}

function headerLooksLikeGroup() {
    const header = getConversationHeader();
    if (!header) return false;
    if (
        header.querySelector(
            '[data-testid="default-group"], [data-icon="default-group"], span[data-icon="default-group"]'
        )
    ) {
        return true;
    }
    // Group info drawer / subtitle cues
    if (document.querySelector('[data-testid="group-info-drawer-subject-input"]')) return true;
    if (getHeaderMemberListText()) return true;
    // Subtitle: selectable-text with comma list / "N more"
    const subs = header.querySelectorAll(
        'span[data-testid="selectable-text"][title], span[title]'
    );
    for (let i = 0; i < subs.length; i++) {
        if (isMemberListText(subs[i].getAttribute("title") || "")) return true;
        if (isMemberListText(subs[i].textContent || "")) return true;
    }
    return false;
}

/**
 * Stable external id for cloud matching.
 * Never fall back to a bare display name (that polluted lead.phone).
 */
function buildExternalChatId(chatType, groupId, phone, name) {
    if (chatType === "group") {
        if (groupId) return groupId;
        const n = cleanChatLabel(name);
        return n ? "gname:" + n : "";
    }
    const p = sanitizePhoneField(phone);
    if (p) return p;
    return "";
}

function isMemberListText(value) {
    const t = String(value || "").trim();
    if (!t) return false;
    // Explicit WA group subtitle: "…, 521 more" / "۵۲۱ نفر دیگر"
    if (/\d+\s*more\b/i.test(t)) return true;
    if (/\d+\s*(نفر\s*دیگر|عضو\s*دیگر|دیگه)/.test(t)) return true;
    if (/\d+\s*(participants?|members?|اعضا|عضو)\b/i.test(t)) return true;
    if (/participant|اعضا|عضو|members?/i.test(t)) return true;
    const phones = t.match(/\+\d[\d\s\-()]{6,}\d/g);
    if (phones && phones.length >= 2) return true;
    // Mixed list: phones + @handles + names separated by commas
    const commas = (t.match(/,/g) || []).length;
    if (commas >= 2 && (phones || /@[\w.]+/.test(t) || t.length > 60)) return true;
    if (commas >= 2) return true;
    if (t.length > 80) return true;
    return false;
}

function getHeaderTitleSpans() {
    const header = getConversationHeader();
    if (!header) return [];
    return Array.from(
        header.querySelectorAll(
            "span[title], span[data-testid='selectable-text'], span[dir='auto'], span[dir='rtl'], span[dir='ltr']"
        )
    );
}

function cleanChatLabel(value) {
    return String(value || "")
        .normalize("NFC")
        .replace(/[\u200c\u200d\ufeff]/g, "")
        .trim()
        .replace(/\s+/g, " ");
}

function extractPhoneFromDataId(id) {
    const s = String(id || "");
    let m = s.match(/(?:^|[_\s])(\d{8,15})@c\.us\b/);
    if (m) return normalizePhone(m[1]);
    m = s.match(/(?:^|[_\s])(\d{8,15})@s\.whatsapp\.net\b/);
    if (m) return normalizePhone(m[1]);
    m = s.match(/(\d{8,15})@c\.us/);
    if (m) return normalizePhone(m[1]);
    // true_<phone>@c.us_<msgid> / false_<phone>@c.us_…
    m = s.match(/(?:true|false)_(\d{8,15})@/);
    if (m) return normalizePhone(m[1]);
    return "";
}

/**
 * Pull phone from Contact info drawer.
 * Real WA DOM (your xpath): …/section/div[1]/div[2]/div[2]/span/div/span
 * Text: "+98 919 541 0188" — plain span, no title/dir/data-testid.
 */
function readPhoneFromInfoPanel(root) {
    const scope = root || getChatInfoDrawerRoot();
    if (!scope) return "";

    function pickPhone(raw) {
        const cleaned = cleanChatLabel(raw);
        if (!cleaned || isMemberListText(cleaned) || isStatusText(cleaned)) return "";
        if ((cleaned.match(/,/g) || []).length >= 1) return "";
        return sanitizePhoneField(cleaned);
    }

    const tel = scope.querySelector('a[href^="tel:"]');
    if (tel) {
        const telPhone = pickPhone((tel.getAttribute("href") || "").replace(/^tel:/i, ""));
        if (telPhone) return telPhone;
    }

    // Exact Contact info layout: first section, profile block, phone line under name
    const profileSections = scope.querySelectorAll("section");
    for (let si = 0; si < profileSections.length; si++) {
        const sec = profileSections[si];
        // div[1]/div[2]/div[2]/span/div/span pattern
        const blocks = sec.querySelectorAll(":scope > div > div:nth-child(2) span, :scope > div span");
        for (let bi = 0; bi < blocks.length; bi++) {
            const phone = pickPhone(blocks[bi].innerText || blocks[bi].textContent || "");
            if (phone) return phone;
        }
    }

    // Any span in drawer whose visible text is a phone (matches your +98 … span)
    const allSpans = scope.querySelectorAll("span");
    let best = "";
    for (let i = 0; i < allSpans.length; i++) {
        const el = allSpans[i];
        // Prefer leaf spans (phone is usually innermost)
        if (el.children && el.children.length > 0) continue;
        const phone = pickPhone(el.innerText || el.textContent || "");
        if (phone && phone.length > best.length) best = phone;
    }

    // Fallback: full drawer text
    if (!best) {
        const body = (scope.innerText || scope.textContent || "").replace(/\s+/g, " ");
        const m = body.match(/\+\d[\d\s\-()]{7,18}\d/);
        if (m) best = pickPhone(m[0]);
    }
    return best || "";
}

function extractPeerIdsFromOpenChat() {
    const result = { phone: "", groupId: "", chatType: "" };

    function scanId(id) {
        const s = String(id || "");
        const groupMatch = s.match(/(\d{5,24})@g\.us/i);
        if (groupMatch) {
            result.groupId = groupMatch[1] + "@g.us";
            result.chatType = "group";
            return true;
        }
        // Some WA builds encode group as …-…@g.us inside a longer data-id
        if (/@g\.us\b/i.test(s)) {
            const m2 = s.match(/([\w.-]+)@g\.us/i);
            if (m2) {
                result.groupId = m2[1] + "@g.us";
                result.chatType = "group";
                return true;
            }
        }
        const phone = extractPhoneFromDataId(s);
        if (phone && !result.phone) {
            result.phone = phone;
            if (!result.chatType) result.chatType = "pv";
        }
        return false;
    }

    // Header first — often has the peer id without needing scrolled messages.
    const header = getConversationHeader() || document.querySelector("#main");
    if (header) {
        const headerNodes = header.querySelectorAll("[data-id], [data-testid]");
        for (let i = 0; i < headerNodes.length; i++) {
            const el = headerNodes[i];
            if (scanId(el.getAttribute("data-id") || "")) return result;
        }
        const tel = header.querySelector('a[href^="tel:"]');
        if (tel && !result.phone) {
            const telPhone = normalizePhone((tel.getAttribute("href") || "").replace(/^tel:/i, ""));
            if (looksLikePhone(telPhone)) {
                result.phone = telPhone;
                if (!result.chatType) result.chatType = "pv";
            }
        }
    }

    // Message rows — peer phone is in data-id even when header only shows display name
    const nodes = document.querySelectorAll(
        '#main [data-id], #main [data-testid="msg-container"], #main div.copyable-text'
    );
    if (!nodes.length) return result;

    const start = Math.max(0, nodes.length - 150);
    for (let i = nodes.length - 1; i >= start; i--) {
        const el = nodes[i];
        if (scanId(el.getAttribute("data-id") || "")) return result;
        // Some builds put id on nested attrs
        const nested = el.querySelector("[data-id]");
        if (nested && scanId(nested.getAttribute("data-id") || "")) return result;
        const pre = el.getAttribute("data-pre-plain-text") || "";
        if (pre) {
            const pm = pre.match(/\+?\d[\d\s\-()]{7,}\d/);
            if (pm && !result.phone) {
                const p = sanitizePhoneField(pm[0]);
                if (p) {
                    result.phone = p;
                    if (!result.chatType) result.chatType = "pv";
                }
            }
        }
    }
    return result;
}

function getChatIdentity() {
    requestWaInjectIdentity();
    const spans = getHeaderTitleSpans();
    let name = "";
    let phone = "";
    const memberList = getHeaderMemberListText();
    const peer = extractPeerIdsFromOpenChat();
    const inj = waInjectIdentity;

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

    // MAIN-world inject has real @c.us / @g.us when DOM only shows display names.
    if (inj) {
        if (inj.name && !name) name = cleanChatLabel(inj.name);
        if (inj.chatType === "group" || inj.groupId) {
            return {
                name: name || cleanChatLabel(inj.name) || "",
                phone: "",
                groupId: inj.groupId || peer.groupId || "",
                chatType: "group"
            };
        }
        if (sanitizePhoneField(inj.phone)) {
            phone = sanitizePhoneField(inj.phone);
        }
    }

    // Always prefer peer id phone when available (saved contacts rarely show number in title).
    if (!sanitizePhoneField(phone) && peer.phone) phone = peer.phone;
    phone = sanitizePhoneField(phone);

    // Unsaved chat: title is the number — keep both fields (name editable later).
    if (!name && phone) name = phone;

    const isGroup = !!(
        memberList ||
        peer.groupId ||
        peer.chatType === "group" ||
        headerLooksLikeGroup() ||
        (inj && inj.chatType === "group")
    );
    if (isGroup) {
        return {
            name: name || "",
            phone: "",
            groupId: (inj && inj.groupId) || peer.groupId || "",
            chatType: "group"
        };
    }

    return {
        name: name || "",
        phone: phone || "",
        groupId: "",
        chatType: "pv"
    };
}

function getChatName() {
    return getChatIdentity().name || null;
}

function isVisiblePanel(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    return r.width > 60 && r.height > 60 && r.bottom > 0 && r.right > 0;
}

/** Right-hand WA drawer: Group info / Contact info panel. */
function getChatInfoDrawerRoot() {
    const candidates = [
        document.querySelector('[data-testid="drawer-right"]'),
        document.querySelector('[data-testid="contact-info-drawer"]'),
        document.querySelector('[data-testid="group-info-drawer"]')
    ];
    for (let i = 0; i < candidates.length; i++) {
        if (isVisiblePanel(candidates[i])) return candidates[i];
    }
    // WA builds without data-testid — panel with h2 "Group info" / "Contact info"
    const headers = document.querySelectorAll("header");
    for (let j = 0; j < headers.length; j++) {
        const h = headers[j];
        const t = (h.innerText || h.textContent || "").replace(/\s+/g, " ").trim();
        if (!/group info|contact info|اطلاعات گروه|اطلاعات مخاطب/i.test(t)) continue;
        const root =
            h.closest('[data-testid="drawer-right"]') ||
            h.closest('div[role="dialog"]') ||
            h.closest("section")?.parentElement ||
            h.closest("div");
        if (root && isVisiblePanel(root)) return root;
    }
    // Contact info body: …/section/div[1]/div[2]/…/span (phone under name)
    const sections = document.querySelectorAll("section");
    for (let s = 0; s < sections.length; s++) {
        const sec = sections[s];
        if (!isVisiblePanel(sec)) continue;
        const parent = sec.parentElement;
        if (!parent) continue;
        const headerText = (parent.querySelector("header")?.innerText || "").replace(/\s+/g, " ");
        if (/group info|contact info|اطلاعات گروه|اطلاعات مخاطب/i.test(headerText)) {
            return parent;
        }
    }
    return null;
}

/**
 * Read chat type from open WA info sidebar header.
 * Returns "group" | "pv" | null.
 */
function readOpenInfoPanelChatType() {
    const drawer = getChatInfoDrawerRoot();
    const roots = drawer ? [drawer] : [];

    if (!roots.length) {
        const headers = document.querySelectorAll("header h2, header h2 span, header span");
        for (let i = 0; i < headers.length; i++) {
            const el = headers[i];
            if (!isVisiblePanel(el)) continue;
            const t = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
            if (/^group info$/i.test(t) || /^اطلاعات گروه$/i.test(t)) return "group";
            if (/^contact info$/i.test(t) || /^اطلاعات مخاطب$/i.test(t)) return "pv";
        }
        return null;
    }

    for (let r = 0; r < roots.length; r++) {
        const root = roots[r];
        const headerSpans = root.querySelectorAll(
            "header h2 span, header h2, header span, header div span"
        );
        for (let i = 0; i < headerSpans.length; i++) {
            const t = (headerSpans[i].innerText || headerSpans[i].textContent || "")
                .replace(/\s+/g, " ")
                .trim();
            if (/^group info$/i.test(t) || /^اطلاعات گروه$/i.test(t)) return "group";
            if (/^contact info$/i.test(t) || /^اطلاعات مخاطب$/i.test(t)) return "pv";
        }
        const body = (root.innerText || root.textContent || "").replace(/\s+/g, " ");
        if (/\bgroup\b\s*·\s*\d+\s*members?\b/i.test(body)) return "group";
        if (/\bگروه\b\s*·\s*[\d۰-۹]+\s*عضو/.test(body)) return "group";
        if (/\bcontact\b\s*·/i.test(body) && !/\bgroup\b/i.test(body.slice(0, 120))) return "pv";
    }
    return null;
}

function isChatInfoPanelOpen() {
    return !!readOpenInfoPanelChatType();
}

/** Click chat header → open Group info / Contact info sidebar (same as member download). */
async function openChatInfoSidebar() {
    const header =
        getConversationHeader() ||
        document.querySelector('#main [data-testid="conversation-info-header"]');
    if (!header) {
        throw new Error("ابتدا یک چت را در واتساپ باز کنید.");
    }
    const clickTarget =
        header.querySelector("span[title]") ||
        header.querySelector('[data-testid="conversation-info-header"]') ||
        header;
    clickEl(clickTarget);
    await sleep(900);

    let tries = 0;
    while (tries < 10) {
        if (readOpenInfoPanelChatType()) return getChatInfoDrawerRoot();
        await sleep(250);
        tries += 1;
    }
    return getChatInfoDrawerRoot();
}

async function closeChatInfoSidebar() {
    const drawer = getChatInfoDrawerRoot();
    const scope = drawer || document.body;
    const closeBtn =
        (drawer &&
            (drawer.querySelector('[data-testid="x"]') ||
                drawer.querySelector('[data-icon="x"]') ||
                drawer.querySelector('span[data-icon="x"]'))) ||
        findByText(scope, [/^close$/i, /^بستن$/i, /^×$/]) ||
        scope.querySelector('[aria-label="Close"]') ||
        scope.querySelector('[aria-label="بستن"]');
    if (closeBtn) {
        clickEl(closeBtn);
    } else {
        try {
            document.dispatchEvent(
                new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true })
            );
        } catch (_e) {}
    }
    await sleep(450);
}

/**
 * Open WA info panel briefly and read Group info vs Contact info (+ phone for PV).
 * Cached per chat name to avoid reopening on every message.
 */
async function detectChatTypeFromInfoPanel(chatName) {
    const key = cleanChatLabel(chatName || "");
    if (key && chatInfoPanelCache[key]) {
        const cached = chatInfoPanelCache[key];
        if (Date.now() - cached.ts < INFO_PANEL_CACHE_MS) {
            return {
                chatType: cached.chatType,
                phone: cached.phone || "",
                source: "info_panel_cache"
            };
        }
    }

    function snapshotPanel() {
        const chatType = readOpenInfoPanelChatType();
        const phone =
            chatType === "pv" ? readPhoneFromInfoPanel(getChatInfoDrawerRoot()) : "";
        return { chatType: chatType, phone: phone };
    }

    const already = snapshotPanel();
    if (already.chatType) {
        if (key) {
            chatInfoPanelCache[key] = {
                chatType: already.chatType,
                phone: already.phone || "",
                ts: Date.now()
            };
        }
        return {
            chatType: already.chatType,
            phone: already.phone || "",
            source: "info_panel_open"
        };
    }

    while (infoPanelDetectBusy) {
        await sleep(200);
    }
    infoPanelDetectBusy = true;
    try {
        const wasOpen = isChatInfoPanelOpen();
        await openChatInfoSidebar();
        let hit = { chatType: null, phone: "" };
        for (let i = 0; i < 12; i++) {
            hit = snapshotPanel();
            if (hit.chatType) {
                // Give Contact info a moment to render the number line
                if (hit.chatType === "pv" && !hit.phone) {
                    await sleep(350);
                    hit = snapshotPanel();
                }
                break;
            }
            await sleep(250);
        }
        if (!wasOpen && hit.chatType) {
            await closeChatInfoSidebar();
        }
        if (hit.chatType && key) {
            chatInfoPanelCache[key] = {
                chatType: hit.chatType,
                phone: hit.phone || "",
                ts: Date.now()
            };
            log(
                "نوع چت از پنل WA:",
                key,
                "→",
                hit.chatType === "group" ? "گروه" : "خصوصی",
                hit.phone ? "(" + hit.phone + ")" : ""
            );
        }
        return hit.chatType
            ? { chatType: hit.chatType, phone: hit.phone || "", source: "info_panel" }
            : null;
    } catch (err) {
        log("تشخیص پنل اطلاعات چت:", err && err.message ? err.message : err);
        return null;
    } finally {
        infoPanelDetectBusy = false;
    }
}

/** Wait briefly for MAIN-world inject to report @c.us phone. */
async function waitForInjectPhone(maxMs) {
    requestWaInjectIdentity();
    const deadline = Date.now() + (maxMs || 1200);
    while (Date.now() < deadline) {
        const inj = waInjectIdentity;
        if (inj && sanitizePhoneField(inj.phone) && inj.chatType !== "group") {
            return sanitizePhoneField(inj.phone);
        }
        if (inj && (inj.groupId || inj.chatType === "group")) return "";
        await sleep(150);
        requestWaInjectIdentity();
    }
    const inj = waInjectIdentity;
    return inj && inj.chatType !== "group" ? sanitizePhoneField(inj.phone || "") : "";
}

/** Merge DOM/inject identity with reliable WA info-panel group/contact detection. */
async function resolveChatIdentity(baseInfo) {
    const base = baseInfo || getChatIdentity();
    const name = cleanChatLabel((base && base.name) || "");
    let phone = sanitizePhoneField((base && base.phone) || "");

    if (!phone) {
        const injPhone = await waitForInjectPhone(900);
        if (injPhone) phone = injPhone;
    }
    if (!phone) {
        const peer = extractPeerIdsFromOpenChat();
        if (peer.phone) phone = sanitizePhoneField(peer.phone);
    }

    if (name && chatInfoPanelCache[name]) {
        const cached = chatInfoPanelCache[name];
        if (Date.now() - cached.ts < INFO_PANEL_CACHE_MS) {
            const ct = cached.chatType;
            const cachedPhone = sanitizePhoneField(cached.phone || "");
            // If PV but phone still missing, reopen panel once to scrape number
            if (ct === "pv" && !phone && !cachedPhone) {
                delete chatInfoPanelCache[name];
            } else {
                return {
                    name: name,
                    phone: ct === "group" ? "" : phone || cachedPhone || "",
                    groupId: ct === "group" ? (base.groupId || "") : "",
                    chatType: ct
                };
            }
        }
    }

    if (base.chatType === "group" && base.groupId) {
        if (name) {
            chatInfoPanelCache[name] = {
                chatType: "group",
                phone: "",
                ts: Date.now()
            };
        }
        return {
            name: name || base.name || "",
            phone: "",
            groupId: base.groupId || "",
            chatType: "group"
        };
    }

    const panel = await detectChatTypeFromInfoPanel(name);
    if (!panel || !panel.chatType) {
        return {
            name: name || base.name || "",
            phone: phone || "",
            groupId: "",
            chatType: base.chatType || "pv"
        };
    }

    if (panel.chatType === "group") {
        return {
            name: name || base.name || "",
            phone: "",
            groupId: base.groupId || "",
            chatType: "group"
        };
    }

    const panelPhone = sanitizePhoneField(panel.phone || "");
    const finalPhone = phone || panelPhone || "";
    if (name && finalPhone && chatInfoPanelCache[name]) {
        chatInfoPanelCache[name].phone = finalPhone;
    }
    if (finalPhone) {
        log("تلفن مخاطب:", name || "(بدون نام)", "→", finalPhone);
    }
    return {
        name: name || base.name || "",
        phone: finalPhone,
        groupId: "",
        chatType: "pv"
    };
}

async function saveContactFromIncoming(chatInfo, source) {
    if (!globalThis.IranexpediaCrm) return null;
    if (!isCloudAuthorized()) return null;
    const name = cleanChatLabel((chatInfo && chatInfo.name) || "");
    if (!name) return null;

    const chatType = (chatInfo && chatInfo.chatType) || "pv";
    const phone =
        chatType === "group" ? "" : sanitizePhoneField((chatInfo && chatInfo.phone) || "");
    const groupId = chatType === "group" ? (chatInfo && chatInfo.groupId) || "" : "";

    let existing = null;
    if (phone && IranexpediaCrm.getContactByPhone) {
        existing = await IranexpediaCrm.getContactByPhone(phone);
    }
    if (!existing) {
        existing = await IranexpediaCrm.getContactByName(name);
    }
    if (existing) {
        const mergedType =
            chatType === "group" || existing.chatType === "group" ? "group" : chatType || existing.chatType || "pv";
        const mergedGroupId =
            mergedType === "group"
                ? groupId || existing.groupId || ""
                : "";
        const existingPhone = sanitizePhoneField(existing.phone || "");
        const updated = await IranexpediaCrm.upsertContact({
            id: existing.id,
            name:
                looksLikePhone(existing.name) && name && !looksLikePhone(name)
                    ? name
                    : existing.name || name,
            phone: mergedType === "group" ? "" : phone || existingPhone || "",
            groupId: mergedGroupId,
            chatType: mergedType,
            lastMessageAt: Date.now()
        });
        const contact = updated || existing;
        await syncContactToCloud(contact, source);
        return contact;
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

    await syncContactToCloud(created || { name: name, phone: phone, groupId: groupId, chatType: chatType }, source);

    return created;
}

async function syncContactToCloud(contact, source) {
    if (!globalThis.IranexpediaCloudBridge || !contact || !contact.name) return;
    try {
        const res = await IranexpediaCloudBridge.upsertLead({
            name: contact.name,
            phone: sanitizePhoneField(contact.phone || ""),
            groupId: contact.groupId || "",
            chatType: contact.chatType || "pv",
            stage: contact.stage || "جدید",
            tags: contact.tags || [],
            notes: contact.notes || "",
            botPaused: !!contact.botPaused
        });
        if (!res || !res.ok) {
            log("همگام‌سازی ابر ناموفق:", (res && res.error) || "unknown", contact.name);
            return;
        }
        // Do NOT fake-ingest "(sync)" — that queued useless auto_reply jobs.
        // Real inbound text is ingested via ingestCloudInbound().
    } catch (cloudErr) {
        log("خطای همگام‌سازی ابر:", cloudErr && cloudErr.message ? cloudErr.message : cloudErr);
    }
}

/**
 * Push real inbound WhatsApp text to CRM so cloud AI auto-reply can run.
 * opts: { source, traceId }
 */
async function ingestCloudInbound(chatInfo, text, opts) {
    opts = opts || {};
    if (!globalThis.IranexpediaCloudBridge || !isCloudAuthorized()) return null;
    const body = normalizeMsgText(text);
    if (!body || body === "(sync)") return null;
    if (isOurOutboundText(body)) return null;
    if (/^\d{1,2}:\d{2}\s?(am|pm)?$/i.test(body)) return null;

    const name = cleanChatLabel((chatInfo && chatInfo.name) || "");
    if (!name) return null;

    const RT = globalThis.IranexpediaReplyTrace;
    let traceId = opts.traceId || "";
    if (!traceId && RT) {
        traceId = RT.start({
            chat: name,
            source: opts.source || "ingest",
            text: body.slice(0, 80)
        });
    } else if (traceId && RT) {
        RT.event(traceId, "ingest_prepare", {
            source: opts.source || "ingest",
            text: body.slice(0, 80)
        });
    }

    const chatType = (chatInfo && chatInfo.chatType) || "pv";
    const phone =
        chatType === "group" ? "" : sanitizePhoneField((chatInfo && chatInfo.phone) || "");
    const groupId = chatType === "group" ? (chatInfo && chatInfo.groupId) || "" : "";
    const externalChatId = buildExternalChatId(chatType, groupId, phone, name);
    const msgKey = [name, phone, groupId, body].join("||");
    if (shouldSkipIngest(msgKey)) return null;

    // Unique per send attempt — same text on another day must not block auto-reply forever.
    // Keep short-window client dedupe via shouldSkipIngest(msgKey) above.
    const extMsgId =
        "wa:" +
        String(Date.now()) +
        ":" +
        msgKey.replace(/\s+/g, " ").slice(0, 140);

    try {
        if (RT) RT.event(traceId, "ingest_api_start", { chat: name });
        if (IranexpediaCloudBridge.ensureChannelAccount) {
            await IranexpediaCloudBridge.ensureChannelAccount("whatsapp");
        }
        if (RT) RT.event(traceId, "channel_ready", { chat: name });
        await applyBotCommandFromMessage(chatInfo, body);
        await IranexpediaCloudBridge.upsertLead({
            name: name,
            phone: phone,
            groupId: groupId,
            chatType: chatType
        });
        const ing = await IranexpediaCloudBridge.ingestMessage({
            chat_name: name,
            body: body,
            direction: "inbound",
            phone: phone,
            group_id: groupId,
            chat_type: chatType,
            external_chat_id: externalChatId,
            sender_type: "customer",
            external_message_id: extMsgId,
            trace_id: traceId || ""
        });
        if (!ing || !ing.ok) {
            // cloud-bridge returns { ok, error } — detail may be object
            var errMsg = (ing && ing.error) || "unknown";
            if (errMsg && typeof errMsg === "object") {
                try {
                    errMsg = JSON.stringify(errMsg);
                } catch (_e) {
                    errMsg = String(errMsg);
                }
            }
            log("ingest ابر ناموفق:", errMsg);
            if (RT) RT.event(traceId, "ingest_api_fail", { error: errMsg });
            // allow retry on next scan
            if (lastCloudIngestKey === msgKey) lastCloudIngestKey = "";
            return null;
        }
        log("ingest ابر OK ←", name, ":", body.slice(0, 80));
        if (RT) {
            const data = ing.data || {};
            RT.event(traceId, "ingest_api_ok", {
                message_id: data.id || "",
                auto_reply_status: data.auto_reply_status || "",
                auto_reply_reason: data.auto_reply_reason || "",
                job_id: data.job_id || "",
                bot_command: data.bot_command || "",
                bot_paused:
                    typeof data.bot_paused === "boolean" ? data.bot_paused : ""
            });
            if (data.bot_command === "handoff") {
                RT.event(traceId, "handoff_to_operator", {
                    paused: data.bot_paused
                });
            } else if (data.bot_command === "start") {
                RT.event(traceId, "bot_resumed", { paused: data.bot_paused });
            } else if (data.bot_command === "stop") {
                RT.event(traceId, "bot_stopped", { paused: data.bot_paused });
            }
            if (data.auto_reply_status === "queued" && data.job_id) {
                RT.event(traceId, "auto_reply_queued", {
                    job_id: data.job_id,
                    reason: data.auto_reply_reason || ""
                });
            } else if (data.auto_reply_status === "skipped") {
                RT.event(traceId, "auto_reply_skipped", {
                    reason: data.auto_reply_reason || "unknown"
                });
            } else if (data.auto_reply_status === "error") {
                RT.event(traceId, "auto_reply_error", {
                    error: data.auto_reply_reason || "unknown"
                });
            }
            RT.pollServer(traceId);
        }
        if (ing.data && typeof ing.data.bot_paused === "boolean") {
            await syncLocalBotPaused(chatInfo, ing.data.bot_paused);
        }
        try {
            chrome.runtime.sendMessage({ type: "pollCloudBridgeNow" });
        } catch (_e) {}
        markIngested(msgKey);
        return ing;
    } catch (err) {
        if (RT) {
            RT.event(traceId, "ingest_api_error", {
                error: err && err.message ? err.message : String(err)
            });
        }
        if (lastCloudIngestKey === msgKey) lastCloudIngestKey = "";
        log("ingest ابر خطا:", err && err.message ? err.message : err);
        return null;
    }
}

let cloudBulkSyncDone = false;
async function syncAllLocalContactsToCloud() {
    if (cloudBulkSyncDone || !globalThis.IranexpediaCloudBridge || !globalThis.IranexpediaCrm) return;
    try {
        const cfg = await IranexpediaCloudBridge.getConfig();
        if (!cfg.enabled || !cfg.accessToken) return;
        const contacts = await IranexpediaCrm.getContacts();
        if (!contacts || !contacts.length) {
            cloudBulkSyncDone = true;
            return;
        }
        log("همگام‌سازی " + contacts.length + " مخاطب محلی به ابر…");
        let ok = 0;
        for (let i = 0; i < contacts.length; i++) {
            const c = contacts[i];
            if (!c || !c.name) continue;
            const res = await IranexpediaCloudBridge.upsertLead({
                name: c.name,
                phone: c.phone || "",
                groupId: c.groupId || "",
                chatType: c.chatType || "pv",
                stage: c.stage || "جدید",
                tags: c.tags || [],
                notes: c.notes || "",
                botPaused: !!c.botPaused
            });
            if (res && res.ok) ok += 1;
        }
        cloudBulkSyncDone = true;
        log("همگام‌سازی ابر تمام شد:", ok + "/" + contacts.length);
    } catch (err) {
        log("همگام‌سازی گروهی ابر خطا:", err && err.message ? err.message : err);
    }
}

/** Capture contacts on new messages even when auto-reply is OFF */
async function captureContactsFromOpenChat() {
    if (!isCloudAuthorized()) return;
    if (!document.querySelector("#main")) return;

    const text = getLastIncomingText();
    if (!text) return;
    if (/^\d{1,2}:\d{2}\s?(am|pm)?$/i.test(text)) return;
    if (isOurOutboundText(text)) return;

    const info = await resolveChatIdentity(getChatIdentity());
    if (!info.name) return;

    const key = info.name + "||" + text;
    if (key === lastCapturedMsgKey) return;
    lastCapturedMsgKey = key;

    if (globalThis.IranexpediaCrm) {
        await saveContactFromIncoming(info, "incoming");
    }
    await ingestCloudInbound(info, text);
}

function getHeaderMemberListText() {
    const header = getConversationHeader();
    if (!header) return "";
    let best = "";

    function consider(raw) {
        const t = String(raw || "").trim();
        if (!isMemberListText(t)) return;
        if (t.length > best.length) best = t;
    }

    // Prefer subtitle selectable-text (user's DOM: header/…/div[2]/span title=member list)
    const selectable = header.querySelectorAll(
        'span[data-testid="selectable-text"][title], span[title]'
    );
    for (let i = 0; i < selectable.length; i++) {
        consider(selectable[i].getAttribute("title") || "");
        consider(selectable[i].innerText || selectable[i].textContent || "");
    }

    const spans = getHeaderTitleSpans();
    for (let i = 0; i < spans.length; i++) {
        consider(spans[i].getAttribute("title") || "");
        consider(spans[i].innerText || spans[i].textContent || "");
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
    lastCapturedMsgKey = "";
    // Keep lastBotReply / recentOutboundTexts / ingest dedupe — avoid re-reading our sends
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
        rememberOutboundText(msg);
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

async function sendTemplateNowAction(targetName, message, traceId) {
    const name = String(targetName || "").trim();
    const msg = String(message || "").trim();
    const RT = globalThis.IranexpediaReplyTrace;
    if (!name || !msg) {
        return { ok: false, error: "مخاطب و متن پیام الزامی است." };
    }
    if (RT && traceId) {
        RT.event(traceId, "wa_send_start", { target: name });
    }
    rememberOutboundText(msg);
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
        if (!ok) {
            if (RT && traceId) RT.event(traceId, "wa_send_fail", { target: name });
            return { ok: false, error: "ارسال پیام انجام نشد." };
        }
        if (RT && traceId) {
            RT.event(traceId, "wa_send_done", { target: name });
            RT.finish(traceId, "pipeline_complete", { target: name });
        }
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

        rememberOutboundText(task.message);
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
window.__iranexpediaResolveChatIdentity = resolveChatIdentity;

async function clearLocalCrmContacts() {
    let deleted = 0;
    if (globalThis.IranexpediaCrm && IranexpediaCrm.getContacts) {
        const before = await IranexpediaCrm.getContacts();
        deleted = Array.isArray(before) ? before.length : 0;
    }
    if (globalThis.IranexpediaCrm && IranexpediaCrm.clearAllContacts) {
        await IranexpediaCrm.clearAllContacts();
    } else {
        await new Promise(function (resolve) {
            chrome.storage.local.set({ crmContacts: [] }, resolve);
        });
    }
    cloudBulkSyncDone = false;
    Object.keys(sidebarContactSaved).forEach(function (k) {
        delete sidebarContactSaved[k];
    });
    Object.keys(chatInfoPanelCache).forEach(function (k) {
        delete chatInfoPanelCache[k];
    });
    lastCapturedMsgKey = "";
    lastHandledText = "";
    lastStableChat = "";
    log("مخاطبین محلی پاک شد:", deleted);
    return { ok: true, deleted: deleted };
}
window.__iranexpediaClearLocalContacts = clearLocalCrmContacts;

window.__iranexpediaSendNow = function (text) {
    sendTextNow(text).then(function (ok) {
        if (!ok) alert("ارسال انجام نشد. چت را باز کنید و دوباره تلاش کنید.");
    });
};

chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
    if (!message || !message.type) return;
    if (message.type === "replyTraceRelay") {
        const RT = globalThis.IranexpediaReplyTrace;
        if (RT) RT.debug(String(message.stage || "relay"), message.extra || {});
        return false;
    }
    if (message.type === "runScheduledTask") {
        runScheduledTask(message.task || {}).then(sendResponse);
        return true;
    }
    if (message.type === "openContactChat") {
        openContactChatAction(message.targetName).then(sendResponse);
        return true;
    }
    if (message.type === "sendTemplateNow") {
        sendTemplateNowAction(message.targetName, message.message, message.traceId).then(
            sendResponse
        );
        return true;
    }
    if (message.type === "clearLocalCrmContacts") {
        clearLocalCrmContacts().then(sendResponse);
        return true;
    }
    if (message.type === "cloudScanSidebarChats") {
        sendResponse({
            ok: true,
            scanned: 0,
            saved: 0,
            disabled: true,
            note: "Bulk sidebar import disabled — contacts save only on incoming messages."
        });
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
    await openChatInfoSidebar();
    await sleep(300);

    const drawer =
        getChatInfoDrawerRoot() ||
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

function cellLooksLikeGroup(cell) {
    if (!cell) return false;
    if (
        cell.querySelector(
            '[data-testid="default-group"], [data-icon="default-group"], span[data-icon="default-group"]'
        )
    ) {
        return true;
    }
    // Sidebar sometimes shows truncated member list / "N more" in secondary line
    const titled = cell.querySelectorAll("span[title], span[data-testid='selectable-text']");
    for (let i = 0; i < titled.length; i++) {
        const t =
            titled[i].getAttribute("title") ||
            titled[i].innerText ||
            titled[i].textContent ||
            "";
        if (isMemberListText(t)) return true;
    }
    const secondary =
        cell.querySelector('[data-testid="cell-frame-secondary"]') ||
        cell.querySelector('[data-testid="cell-frame-secondary-subtitle"]');
    if (secondary && isMemberListText(secondary.innerText || secondary.textContent || "")) {
        return true;
    }
    return false;
}

async function captureContactsFromSidebarUnread() {
    // Disabled: contacts are saved only when an inbound message is processed.
    return;
}

/** @deprecated Bulk sidebar import disabled — use inbound message paths only. */
async function captureContactsFromSidebarVisible() {
    return { saved: 0, scanned: 0, disabled: true };
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

function findUnreadSidebarChats() {
    const cells = getSidebarCells();
    const matches = [];

    for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        if (!cellHasUnread(cell)) continue;

        const chatName = getCellChatName(cell);
        if (!chatName) continue;

        const preview = getCellPreview(cell, chatName);
        if (!preview) continue;
        if (isOurOutboundText(preview)) continue;

        const key = chatName + "||" + preview;
        if (handledSidebarKeys[key]) continue;

        matches.push({
            cell: cell,
            chatName: chatName,
            preview: preview,
            key: key
        });
    }

    return matches;
}

async function processSidebarUnreadForCloud(match) {
    const cmd = parseBotCommand(match.preview);
    const paused = await isChatBotPaused(match.chatName);

    // Always ingest (DB history). When paused, only AI is skipped on the server.
    // Still prioritize start/handoff/stop so resume/handoff are never stuck.
    if (paused && !cmd) {
        log("ربات متوقف — فقط ذخیره پیام (بدون AI):", match.chatName, "|", match.preview);
    }

    handledSidebarKeys[match.key] = Date.now();

    const keys = Object.keys(handledSidebarKeys);
    if (keys.length > 80) {
        keys.sort(function (a, b) {
            return handledSidebarKeys[a] - handledSidebarKeys[b];
        });
        keys.slice(0, keys.length - 40).forEach(function (k) {
            delete handledSidebarKeys[k];
        });
    }

    log("چت خوانده‌نشده برای AI ابری:", match.chatName, "|", match.preview);

    clickSidebarCell(match.cell);

    const ready = await waitForChatReady(match.chatName, 10000);
    if (!ready) {
        log("باز شدن چت ناموفق بود:", match.chatName);
        delete handledSidebarKeys[match.key];
        return;
    }

    await sleep(1200);

    const text = getLastIncomingText() || match.preview;
    if (!text || isOurOutboundText(text)) {
        delete handledSidebarKeys[match.key];
        return;
    }

    lastHandledText = text;
    const chatInfo = await resolveChatIdentity(getChatIdentity());
    await saveContactFromIncoming(chatInfo, "incoming");
    const RT = globalThis.IranexpediaReplyTrace;
    let traceId = "";
    if (RT) {
        traceId = RT.start({
            chat: match.chatName,
            source: "sidebar",
            text: String(text).slice(0, 80)
        });
    }
    const ing = await ingestCloudInbound(chatInfo, text, {
        source: "sidebar",
        traceId: traceId
    });
    if (ing && ing.ok) {
        log("ingest ابر از سایدبار OK ←", match.chatName);
    } else if (paused && cmd === "start") {
        // Local unpause even if cloud ingest failed — avoid permanent stuck pause
        await applyBotCommandFromMessage(chatInfo, text);
        log("ربات محلی فعال شد (شروع) ←", match.chatName);
    }
}

async function scanSidebarForCloud() {
    if (!isEnabled || busy || taskRunnerBusy) return;

    const matches = findUnreadSidebarChats();
    if (!matches.length) return;

    busy = true;
    try {
        await processSidebarUnreadForCloud(matches[0]);
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

function isOutgoingMessageNode(el) {
    if (!el) return false;
    let node = el;
    for (let depth = 0; depth < 8 && node; depth++) {
        const cls = (node.className || "").toString();
        if (cls.indexOf("message-out") !== -1) return true;
        if (cls.indexOf("message-in") !== -1) return false;
        const testId = node.getAttribute && node.getAttribute("data-testid");
        if (testId === "msg-out") return true;
        node = node.parentElement;
    }
    return false;
}

function getLastIncomingText() {
    const main = document.querySelector("#main");
    if (!main) return "";

    const selectors = [
        'div.message-in span[data-testid="selectable-text"]',
        'div.message-in span.selectable-text',
        'div[data-testid="msg-container"].message-in span[data-testid="selectable-text"]',
        'div[data-testid="msg-container"].message-in span.selectable-text'
    ];

    let incoming = [];
    for (let s = 0; s < selectors.length; s++) {
        incoming = main.querySelectorAll(selectors[s]);
        if (incoming.length) break;
    }

    if (incoming.length) {
        const last = incoming[incoming.length - 1];
        const text = normalizeMsgText(last.innerText || last.textContent || "");
        if (text && !isOurOutboundText(text)) return text;
    }

    const containers = main.querySelectorAll('div[data-testid="msg-container"]');
    for (let i = containers.length - 1; i >= 0; i--) {
        const c = containers[i];
        const cls = (c.className || "").toString();
        if (cls.indexOf("message-out") !== -1) continue;
        if (cls.indexOf("message-in") === -1 && containers.length > 1) continue;
        const span =
            c.querySelector('[data-testid="selectable-text"]') ||
            c.querySelector("span.selectable-text");
        if (!span) continue;
        const text = normalizeMsgText(span.innerText || span.textContent || "");
        if (!text || isOurOutboundText(text)) continue;
        return text;
    }

    return "";
}

function handleOpenChatMessages() {
    if (!document.querySelector("#main")) return;

    const text = getLastIncomingText();
    if (!text) return;
    if (/^\d{1,2}:\d{2}\s?(am|pm)?$/i.test(text)) return;
    if (isOurOutboundText(text)) return;
    if (text === lastHandledText) return;

    const chatInfo = getChatIdentity();
    const chatName = cleanChatLabel((chatInfo && chatInfo.name) || "");
    const cmd = parseBotCommand(text);

    (async function () {
        try {
            const resolved = await resolveChatIdentity(chatInfo);
            const captureKey = resolved.name + "||" + text;
            if (captureKey !== lastCapturedMsgKey) {
                lastCapturedMsgKey = captureKey;
                if (globalThis.IranexpediaCrm) {
                    await saveContactFromIncoming(resolved, "incoming");
                }
            }

            if (busy || taskRunnerBusy) return;

            if (isEnabled) {
                if (chatName && (await isChatBotPaused(chatName)) && !cmd) {
                    log("ربات متوقف — ذخیره پیام بدون AI:", chatName, "|", text.slice(0, 60));
                }
                log("پیام در چت باز (AI ابری):", text);
                await ingestCloudInbound(resolved, text, { source: "open_chat" });
            } else if (isCloudAuthorized()) {
                await ingestCloudInbound(resolved, text);
            }
            lastHandledText = text;
        } catch (err) {
            log("handleOpenChatMessages:", err && err.message ? err.message : err);
        }
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
        // Do not save contacts on chat switch — incoming messages only.
    }
}, 600);

setInterval(function () {
    handleOpenChatMessages();
}, 1200);

// Sidebar: process unread for cloud ingest only (no bulk contact import).
setInterval(function () {
    scanSidebarForCloud();
}, SIDEBAR_SCAN_MS);

async function activateWhatsAppChannel() {
    if (!globalThis.IranexpediaCloudBridge) return;
    try {
        const cfg = await IranexpediaCloudBridge.getConfig();
        if (!cfg.enabled || !cfg.accessToken) return;
        const res = await IranexpediaCloudBridge.ensureChannelAccount("whatsapp");
        if (res && res.ok) {
            log("channel active: whatsapp", res.account && res.account.id);
            if (res.error) {
                log("channel heartbeat:", res.error);
            }
            await syncBotPausedFromCloud();
        } else {
            log("channel activate failed", res && res.error);
            if (res && res.error && String(res.error).indexOf("نامعتبر") !== -1) {
                log("توکن منقضی شده — از پنل CRM دوباره seat token وارد کنید");
            }
        }
    } catch (err) {
        log("channel activate error", err);
    }
}

/** Pull server bot_paused → local CRM so «شروع» / panel resume isn't stuck after «توقف». */
async function syncBotPausedFromCloud() {
    if (!globalThis.IranexpediaCloudBridge || !globalThis.IranexpediaCrm) return;
    if (typeof IranexpediaCloudBridge.listLeads !== "function") return;
    try {
        const res = await IranexpediaCloudBridge.listLeads();
        if (!res || !res.ok) return;
        const leads = Array.isArray(res.data) ? res.data : [];
        let synced = 0;
        for (let i = 0; i < leads.length; i++) {
            const lead = leads[i];
            const name = cleanChatLabel((lead && lead.name) || "");
            if (!name) continue;
            const paused = !!(lead.bot_paused || lead.botPaused);
            let contact = await IranexpediaCrm.getContactByName(name);
            if (!contact) continue;
            if (!!contact.botPaused === paused) continue;
            await IranexpediaCrm.updateContact(contact.id, { botPaused: paused });
            synced += 1;
            log(paused ? "sync pause ← ابر:" : "sync resume ← ابر:", name);
        }
        if (synced) log("همگام‌سازی وضعیت ربات از ابر:", synced, "مخاطب");
    } catch (_e) {
        // ignore
    }
}

refreshCrmSettings();
injectWaMainWorld();
activateWhatsAppChannel().then(function () {
    return refreshLicenseStatus();
}).then(function () {
    ensureButton();
    log("وضعیت فعال‌سازی:", licenseValid ? "فعال" : "غیرفعال", "-", licenseMessage);
    // Contacts sync to server only when an inbound message is ingested (not on startup bulk).

    chrome.storage.local.get({ autoReplyEnabled: false }, function (data) {
        if (data.autoReplyEnabled && licenseValid) {
            applyAutoReplyEnabled(true, "restore");
        } else if (data.autoReplyEnabled && !licenseValid) {
            persistAutoReplyEnabled(false);
            log("اسکن خودکار ذخیره شده بود اما لایسنس فعال نیست");
        } else {
            log("اسکن خودکار خاموش است — از پنل CRM روشن کنید");
        }
    });
});
setInterval(activateWhatsAppChannel, 12000);

chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== "local") return;
    if (changes.cloudBridgeConfig) {
        cloudBulkSyncDone = false;
        refreshLicenseStatus().then(function () {
            ensureButton();
            if (!licenseValid && isEnabled) applyAutoReplyEnabled(false, "cloud-lost");
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
