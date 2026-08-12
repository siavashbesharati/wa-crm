const EXT_VERSION = "7.5.0";
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
const recentOutboundTexts = {};
const recentIngestKeys = {};
const OUTBOUND_TTL_MS = 20 * 60 * 1000;
const INGEST_DEDUPE_MS = 10 * 60 * 1000;
const sidebarContactSaved = {};

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

/** Match server bot_commands.py — whole message only */
function parseBotCommand(text) {
    const t = String(text || "").trim();
    if (!t) return null;
    if (/^(stop|pause|halt|\/stop|#stop|توقف|قطع|بس|ایست|خاموش)$/i.test(t)) return "stop";
    if (/^(start|resume|go|\/start|#start|شروع|ادامه|روشن|فعال)$/i.test(t)) return "start";
    return null;
}

/** Sync stop/start to local CRM + cloud lead before ingest */
async function applyBotCommandFromMessage(chatInfo, text) {
    const cmd = parseBotCommand(text);
    if (!cmd) return false;
    const name = cleanChatLabel((chatInfo && chatInfo.name) || "");
    if (!name || !globalThis.IranexpediaCrm) return true;

    const chatType = (chatInfo && chatInfo.chatType) || "pv";
    const phone = chatType === "group" ? "" : (chatInfo && chatInfo.phone) || "";
    const groupId = chatType === "group" ? (chatInfo && chatInfo.groupId) || "" : "";
    const pause = cmd === "stop";

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

    if (globalThis.IranexpediaCloudBridge && isCloudAuthorized()) {
        try {
            await IranexpediaCloudBridge.upsertLead({
                name: name,
                phone: phone,
                groupId: groupId,
                chatType: chatType,
                botPaused: pause
            });
        } catch (_e) {
            // ingest will still apply on server
        }
    }

    log(
        pause ? "دستور توقف ربات ←" : "دستور فعال‌سازی ربات ←",
        name
    );
    await logCrmEvent(
        "bot_pause",
        (pause ? "ربات متوقف (دستور چت): " : "ربات فعال (دستور چت): ") + name,
        { command: cmd }
    );
    return true;
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

function extractPhoneFromDataId(id) {
    const s = String(id || "");
    let m = s.match(/(?:^|[_\s])(\d{8,15})@c\.us\b/);
    if (m) return normalizePhone(m[1]);
    m = s.match(/(?:^|[_\s])(\d{8,15})@s\.whatsapp\.net\b/);
    if (m) return normalizePhone(m[1]);
    m = s.match(/(\d{8,15})@c\.us/);
    if (m) return normalizePhone(m[1]);
    return "";
}

function extractPeerIdsFromOpenChat() {
    const result = { phone: "", groupId: "", chatType: "" };

    // Header first — often has the peer id without needing scrolled messages.
    const header = document.querySelector("#main header") || document.querySelector("#main");
    if (header) {
        const headerNodes = header.querySelectorAll("[data-id]");
        for (let i = 0; i < headerNodes.length; i++) {
            const id = headerNodes[i].getAttribute("data-id") || "";
            const groupMatch = id.match(/(\d{10,24})@g\.us/);
            if (groupMatch) {
                result.groupId = groupMatch[1] + "@g.us";
                result.chatType = "group";
                return result;
            }
            const phone = extractPhoneFromDataId(id);
            if (phone && !result.phone) {
                result.phone = phone;
                result.chatType = "pv";
            }
        }
        const tel = header.querySelector('a[href^="tel:"]');
        if (tel && !result.phone) {
            const telPhone = normalizePhone((tel.getAttribute("href") || "").replace(/^tel:/i, ""));
            if (looksLikePhone(telPhone)) {
                result.phone = telPhone;
                result.chatType = "pv";
            }
        }
    }

    const nodes = document.querySelectorAll("#main [data-id]");
    if (!nodes.length) return result;

    const start = Math.max(0, nodes.length - 120);
    for (let i = nodes.length - 1; i >= start; i--) {
        const id = nodes[i].getAttribute("data-id") || "";
        const groupMatch = id.match(/(\d{10,24})@g\.us/);
        if (groupMatch) {
            result.groupId = groupMatch[1] + "@g.us";
            result.chatType = "group";
            return result;
        }
        const phone = extractPhoneFromDataId(id);
        if (phone && !result.phone) {
            result.phone = phone;
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

    // Always prefer peer id phone when available (saved contacts rarely show number in title).
    if (!phone && peer.phone) phone = peer.phone;

    // Unsaved chat: title is the number — keep both fields (name editable later).
    if (!name && phone) name = phone;
    // If title was a display name and phone still empty, last try: any phone-looking title already handled;
    // leave phone blank so user can edit manually.

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
        phone: phone || "",
        groupId: "",
        chatType: "pv"
    };
}

function getChatName() {
    return getChatIdentity().name || null;
}

async function saveContactFromIncoming(chatInfo, source) {
    if (!globalThis.IranexpediaCrm) return null;
    if (!isCloudAuthorized()) return null;
    const name = cleanChatLabel((chatInfo && chatInfo.name) || "");
    if (!name) return null;

    const chatType = (chatInfo && chatInfo.chatType) || "pv";
    const phone = chatType === "group" ? "" : (chatInfo && chatInfo.phone) || "";
    const groupId = chatType === "group" ? (chatInfo && chatInfo.groupId) || "" : "";

    let existing = null;
    if (phone && IranexpediaCrm.getContactByPhone) {
        existing = await IranexpediaCrm.getContactByPhone(phone);
    }
    if (!existing) {
        existing = await IranexpediaCrm.getContactByName(name);
    }
    if (existing) {
        const updated = await IranexpediaCrm.upsertContact({
            id: existing.id,
            name:
                looksLikePhone(existing.name) && name && !looksLikePhone(name)
                    ? name
                    : existing.name || name,
            phone: phone || existing.phone || "",
            groupId: groupId || existing.groupId || "",
            chatType: chatType || existing.chatType || "pv",
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
            phone: contact.phone || "",
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
    const phone = chatType === "group" ? "" : (chatInfo && chatInfo.phone) || "";
    const groupId = chatType === "group" ? (chatInfo && chatInfo.groupId) || "" : "";
    const externalChatId = groupId || phone || name;
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
                job_id: data.job_id || ""
            });
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
function captureContactsFromOpenChat() {
    if (!isCloudAuthorized()) return;
    if (!document.querySelector("#main")) return;

    const text = getLastIncomingText();
    if (!text) return;
    if (/^\d{1,2}:\d{2}\s?(am|pm)?$/i.test(text)) return;
    if (isOurOutboundText(text)) return;

    const info = getChatIdentity();
    if (!info.name) return;

    const key = info.name + "||" + text;
    if (key === lastCapturedMsgKey) return;
    lastCapturedMsgKey = key;

    if (globalThis.IranexpediaCrm) {
        saveContactFromIncoming(info, "incoming");
    }
    // Cloud AI path: always ingest real message text
    ingestCloudInbound(info, text);
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
    if (message.type === "cloudScanSidebarChats") {
        (async function () {
            await refreshLicenseStatus();
            if (!licenseValid || !isCloudAuthorized()) {
                sendResponse({ ok: false, error: "license_or_cloud_required" });
                return;
            }
            const scan = await captureContactsFromSidebarVisible();
            // Force push local → API via background (reliable).
            chrome.runtime.sendMessage({ type: "cloudSyncContacts" }, function (syncRes) {
                sendResponse({
                    ok: true,
                    scanned: (scan && scan.scanned) || 0,
                    saved: (scan && scan.saved) || 0,
                    sync: syncRes || null
                });
            });
        })();
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
    if (!isCloudAuthorized() || !globalThis.IranexpediaCrm) return;
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

/** Capture visible chat list → local CRM → cloud (not only unread). */
async function captureContactsFromSidebarVisible() {
    if (!isCloudAuthorized() || !globalThis.IranexpediaCrm) return { saved: 0 };
    const cells = getSidebarCells();
    let saved = 0;
    for (let i = 0; i < cells.length; i++) {
        const chatName = getCellChatName(cells[i]);
        if (!chatName) continue;
        const key = cleanChatLabel(chatName);
        if (!key) continue;
        const phone = looksLikePhone(key) ? normalizePhone(key) : "";
        const before = await IranexpediaCrm.getContactByName(key);
        await saveContactFromIncoming(
            { name: key, phone: phone, chatType: "pv" },
            "sidebar-visible"
        );
        if (!before) saved += 1;
        else saved += 1;
    }
    return { saved: saved, scanned: cells.length };
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

    // After «توقف», still allow «شروع» through — otherwise resume never reaches the server.
    if (paused && cmd !== "start" && cmd !== "stop") {
        log("ربات برای این چت متوقف است (سایدبار رد شد):", match.chatName, "|", match.preview);
        return;
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
    const chatInfo = getChatIdentity();
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

    const chatInfo = getChatIdentity();
    const chatName = cleanChatLabel((chatInfo && chatInfo.name) || "");

    // Always try to save contact on new incoming message (Farsi-safe)
    if (text !== lastHandledText) {
        captureContactsFromOpenChat();
    }

    if (busy || taskRunnerBusy) return;
    if (text === lastHandledText) return;
    if (isOurOutboundText(text)) return;

    lastHandledText = text;
    const cmd = parseBotCommand(text);

    (async function () {
        // When paused, still process start/stop; skip normal messages locally
        if (chatName && (await isChatBotPaused(chatName)) && cmd !== "start" && cmd !== "stop") {
            log("ربات متوقف — پیام رد شد:", chatName, "|", text.slice(0, 60));
            return;
        }
        log("پیام در چت باز (AI ابری):", text);
        await saveContactFromIncoming(chatInfo, "incoming");
        await ingestCloudInbound(chatInfo, text, { source: "open_chat" });
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
    scanSidebarForCloud();
    captureContactsFromSidebarUnread();
}, SIDEBAR_SCAN_MS);

// Every ~45s push visible chat list into CRM → cloud (backend feed).
setInterval(function () {
    if (!isCloudAuthorized()) return;
    captureContactsFromSidebarVisible().then(function () {
        chrome.runtime.sendMessage({ type: "cloudSyncContacts" });
    });
}, 45 * 1000);

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
activateWhatsAppChannel().then(function () {
    return refreshLicenseStatus();
}).then(function () {
    ensureButton();
    log("وضعیت فعال‌سازی:", licenseValid ? "فعال" : "غیرفعال", "-", licenseMessage);
    if (licenseValid) syncAllLocalContactsToCloud();

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
            if (licenseValid) syncAllLocalContactsToCloud();
            else if (isEnabled) applyAutoReplyEnabled(false, "cloud-lost");
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
