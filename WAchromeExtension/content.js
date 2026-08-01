const EXT_VERSION = "6.1.0";
const BRAND = "iranexpedia.ir";
const LICENSE_RECHECK_MS = 5 * 60 * 1000;

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
let licenseValid = false;
let licenseMessage = "لایسنس بررسی نشده";
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
    if (!document.getElementById("iranexpedia-font")) {
        const font = document.createElement("link");
        font.id = "iranexpedia-font";
        font.rel = "stylesheet";
        font.href =
            "https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css";
        document.documentElement.appendChild(font);
    }

    let style = document.getElementById("iranexpedia-style");
    if (!style) {
        style = document.createElement("style");
        style.id = "iranexpedia-style";
        document.documentElement.appendChild(style);
    }

    style.textContent = `
      #iranexpedia-toggle,
      #iranexpedia-members {
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
        left: 20px;
        z-index: 999999;
        box-shadow: 0 4px 14px rgba(0,0,0,.25);
        transition: background .15s ease, opacity .15s ease;
      }
      #iranexpedia-toggle { bottom: 20px; }
      #iranexpedia-members { bottom: 70px; background: #0f766e !important; }
      #iranexpedia-members:disabled { opacity: .6; cursor: wait; }
      #iranexpedia-toggle.is-off { background: #6b7280 !important; }
      #iranexpedia-toggle.is-on { background: #0b8457 !important; }
    `;
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

/* ================= LICENSE ================= */
function sendBg(message) {
    return new Promise(function (resolve) {
        try {
            chrome.runtime.sendMessage(message, function (response) {
                if (chrome.runtime.lastError) {
                    resolve({
                        ok: false,
                        valid: false,
                        message: chrome.runtime.lastError.message
                    });
                    return;
                }
                resolve(response || { ok: false, valid: false });
            });
        } catch (err) {
            resolve({
                ok: false,
                valid: false,
                message: String(err.message || err)
            });
        }
    });
}

async function refreshLicense(forceServer) {
    if (forceServer) {
        const result = await sendBg({ type: "revalidateLicense" });
        licenseValid = !!result.valid;
        licenseMessage = result.message || (licenseValid ? "معتبر" : "نامعتبر");
        if (!licenseValid && isEnabled) {
            isEnabled = false;
            log("لایسنس نامعتبر — پاسخ خودکار خاموش شد");
        }
        return licenseValid;
    }

    const status = await sendBg({ type: "getLicenseStatus" });
    licenseValid = !!status.valid;
    licenseMessage =
        (status.info && status.info.message) ||
        (licenseValid ? "لایسنس معتبر است" : "لایسنس فعال نیست");
    if (!licenseValid && isEnabled) {
        isEnabled = false;
    }
    return licenseValid;
}

async function requireLicense(featureName) {
    const ok = await refreshLicense(true);
    if (!ok) {
        alert(
            "برای استفاده از «" +
                featureName +
                "» باید لایسنس معتبر داشته باشید.\n\n" +
                (licenseMessage || "")
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
    return Array.from(header.querySelectorAll("span[title]"));
}

function getChatName() {
    const spans = getHeaderTitleSpans();
    for (let i = 0; i < spans.length; i++) {
        const t = (spans[i].getAttribute("title") || "").trim();
        if (!t || isStatusText(t) || isMemberListText(t)) continue;
        if (looksLikePhone(t)) continue;
        return t;
    }
    return null;
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

/* ================= TOGGLE (fixed — works with no chat open) ================= */
function paintButton(btn) {
    if (!licenseValid) {
        btn.className = "is-off";
        btn.textContent = "نیاز به لایسنس · v" + EXT_VERSION;
        btn.title = licenseMessage || "ابتدا لایسنس را در پاپ‌آپ فعال کنید";
        return;
    }

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

        btn.addEventListener("click", async function (e) {
            e.preventDefault();
            e.stopPropagation();

            if (!isEnabled) {
                const ok = await requireLicense("پاسخ خودکار");
                paintButton(btn);
                if (!ok) return;
            }

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
    ensureMembersButton();
}

/* ================= GROUP MEMBERS DOWNLOAD ================= */
function ensureMembersButton() {
    let btn = document.getElementById("iranexpedia-members");
    if (!btn) {
        btn = document.createElement("button");
        btn.id = "iranexpedia-members";
        btn.type = "button";
        btn.textContent = "دانلود اعضای گروه";
        btn.title =
            BRAND +
            " v" +
            EXT_VERSION +
            " — دانلود لیست اعضای گروه باز به‌صورت CSV";
        document.documentElement.appendChild(btn);

        btn.addEventListener("click", async function (e) {
            e.preventDefault();
            e.stopPropagation();
            const ok = await requireLicense("دانلود اعضای گروه");
            if (!ok) return;
            downloadGroupMembers(btn);
        });
    }
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
refreshLicense(false).then(function () {
    ensureButton();
    log("وضعیت لایسنس:", licenseValid ? "معتبر" : "نامعتبر", "-", licenseMessage);
});

chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== "local") return;
    if (changes.licenseValid || changes.licenseInfo || changes.licenseKey) {
        refreshLicense(false).then(function () {
            ensureButton();
        });
    }
});

setInterval(function () {
    refreshLicense(true).then(function () {
        ensureButton();
    });
}, LICENSE_RECHECK_MS);
