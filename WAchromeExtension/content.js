const EXT_VERSION = "5.1.0";
const BRAND = "iranexpedia.ir";

console.log(
    "%c[" + BRAND + " v" + EXT_VERSION + "] LOADED",
    "background:#0b8457;color:#fff;font-size:14px;padding:6px;"
);

/* ================= CONFIG ================= */
const MIN_DELAY_MS = 2500;
const MAX_DELAY_MS = 5000;
const REPLY_COOLDOWN_MS = 10000;
const BATCH_WAIT_MS = 4000;
const SIDEBAR_SCAN_MS = 2500;

const DEFAULT_RULES = [
    { keyword: "hi", reply: "سلام! چطور می‌تونم کمکتون کنم؟" },
    { keyword: "price", reply: "لطفاً کمی صبر کنید، نرخ را ارسال می‌کنم." }
];

/* ================= STATE ================= */
let isEnabled = false;
let keywordRules = DEFAULT_RULES.slice();
let busy = false;

let lastHandledText = "";
let lastBotReply = "";
let lastReplyTime = 0;
let lastStableChat = "";

let replyTimeout = null;
let batchTimeout = null;

const handledSidebarKeys = {};

/* ================= FONT + STYLES ================= */
function injectUiAssets() {
    if (document.getElementById("iranexpedia-font")) return;

    const font = document.createElement("link");
    font.id = "iranexpedia-font";
    font.rel = "stylesheet";
    font.href =
        "https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css";
    document.documentElement.appendChild(font);

    const style = document.createElement("style");
    style.id = "iranexpedia-style";
    style.textContent = `
      #iranexpedia-toggle {
        font-family: Vazirmatn, Tahoma, sans-serif !important;
        direction: rtl;
        min-width: 140px;
        height: 40px;
        padding: 0 14px;
        border: none;
        border-radius: 20px;
        cursor: pointer;
        color: #fff !important;
        font-size: 12px !important;
        font-weight: 700 !important;
        position: fixed;
        bottom: 20px;
        left: 20px;
        z-index: 999999;
        box-shadow: 0 4px 14px rgba(0,0,0,.25);
        transition: background .15s ease;
      }
      #iranexpedia-toggle.is-off { background: #6b7280 !important; }
      #iranexpedia-toggle.is-on { background: #0b8457 !important; }
    `;
    document.documentElement.appendChild(style);
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

function getChatName() {
    const header = document.querySelector("#main header");
    if (!header) return null;

    const spans = header.querySelectorAll("span[title]");
    for (let i = 0; i < spans.length; i++) {
        const t = (spans[i].getAttribute("title") || "").trim();
        if (!isStatusText(t)) return t;
    }
    return null;
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

/* ================= TOGGLE (fixed — works with no chat open) ================= */
function paintButton(btn) {
    if (isEnabled) {
        btn.className = "is-on";
        btn.textContent = "فعال · همه چت‌ها · v" + EXT_VERSION;
        btn.title =
            BRAND +
            " v" +
            EXT_VERSION +
            " — نظارت روی همه چت‌ها و گروه‌ها (حتی بسته)";
    } else {
        btn.className = "is-off";
        btn.textContent = "خاموش · v" + EXT_VERSION;
        btn.title = BRAND + " v" + EXT_VERSION + " — برای روشن کردن کلیک کنید";
    }
}

function ensureButton() {
    injectUiAssets();

    [
        "keyword-toggle-btn",
        "ai-toggle-btn",
        "kw-toggle-btn",
        "keyword-autoreply-version"
    ].forEach(function (id) {
        const el = document.getElementById(id);
        if (el) el.remove();
    });

    let btn = document.getElementById("iranexpedia-toggle");
    if (!btn) {
        btn = document.createElement("button");
        btn.id = "iranexpedia-toggle";
        btn.type = "button";
        document.documentElement.appendChild(btn);

        btn.addEventListener("click", function (e) {
            e.preventDefault();
            e.stopPropagation();

            isEnabled = !isEnabled;
            busy = false;
            resetMessageCache();
            paintButton(btn);

            if (isEnabled) {
                log("روشن شد — نظارت روی چت باز + لیست کناری (گروه و خصوصی)");
            } else {
                log("خاموش شد");
            }
        });
    }

    paintButton(btn);
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
    const spans = cell.querySelectorAll("span[title]");
    for (let i = 0; i < spans.length; i++) {
        const t = (spans[i].getAttribute("title") || "").trim();
        if (!isStatusText(t)) return t;
    }
    return null;
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

    log("چت خوانده‌نشده پیدا شد:", match.chatName, "| پیش‌نمایش:", match.preview);

    const clickable =
        match.cell.querySelector("span[title]") ||
        match.cell.querySelector('[role="gridcell"]') ||
        match.cell;

    clickable.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window })
    );
    clickable.dispatchEvent(
        new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window })
    );
    clickable.click();

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
    } else {
        delete handledSidebarKeys[match.key];
    }
}

async function scanSidebarAndReply() {
    if (!isEnabled || busy) return;

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
function handleOpenChatMessages() {
    if (!isEnabled || busy) return;
    if (!document.querySelector("#main")) return;

    const spans = document.querySelectorAll(
        '#main span[data-testid="selectable-text"]'
    );
    if (!spans.length) return;

    const lastSpan = spans[spans.length - 1];
    const text = (lastSpan.innerText || "").trim();
    if (!text) return;
    if (/^\d{1,2}:\d{2}\s?(am|pm)$/i.test(text)) return;
    if (text === lastBotReply) return;
    if (text === lastHandledText) return;

    lastHandledText = text;
    log("پیام در چت باز:", text);

    const reply = findReply(text);
    if (!reply) {
        log("کلمه‌ای مطابقت نداشت:", text);
        return;
    }

    log("مطابقت در چت باز. پاسخ:", reply);

    if (batchTimeout) clearTimeout(batchTimeout);

    batchTimeout = setTimeout(function () {
        if (!isEnabled || busy) return;
        const now = Date.now();
        if (now - lastReplyTime < REPLY_COOLDOWN_MS) return;
        lastReplyTime = now;

        const delay = randomDelay();
        log("ارسال تا " + (delay / 1000).toFixed(1) + " ثانیه دیگر");

        if (replyTimeout) clearTimeout(replyTimeout);
        replyTimeout = setTimeout(function () {
            if (!isEnabled || busy) return;
            lastBotReply = reply;
            if (insertReply(reply)) {
                setTimeout(sendWhatsAppMessage, 700);
            }
        }, delay);
    }, BATCH_WAIT_MS);
}

/* ================= TIMERS ================= */
setInterval(function () {
    ensureButton();

    const chat = getChatName();
    if (chat && chat !== lastStableChat) {
        lastStableChat = chat;
        if (!busy) resetMessageCache();
        if (isEnabled) log("چت فعال:", chat);
    }
}, 600);

setInterval(function () {
    handleOpenChatMessages();
}, 1200);

setInterval(function () {
    scanSidebarAndReply();
}, SIDEBAR_SCAN_MS);

loadRules();
ensureButton();
