/**
 * Divar chat channel adapter — DOM scrape / auto-reply / outbound jobs.
 * Spec: divarref/divar-auto.md
 */
(function () {
  const EXT_VERSION = "7.2.0";
  const BRAND = "iranexpedia.ir";
  const CHANNEL = "divar";

  console.log(
    "%c[" + BRAND + " Divar v" + EXT_VERSION + "] LOADED",
    "background:#a62626;color:#fff;font-size:14px;padding:6px;"
  );

  let MIN_DELAY_MS = 2500;
  let MAX_DELAY_MS = 5000;
  const REPLY_COOLDOWN_MS = 10000;
  const SCAN_MS = 3500;

  const DEFAULT_RULES = [
    { keyword: "سلام", reply: "سلام، در خدمتم. لطفاً سوالتون رو بفرمایید." },
    { keyword: "قیمت", reply: "برای اعلام قیمت دقیق، جزئیات بیشتری بفرستید." }
  ];

  let isEnabled = false;
  let licenseValid = false;
  let keywordRules = DEFAULT_RULES.slice();
  let busy = false;
  let lastReplyTime = 0;
  const handledKeys = {};

  function log() {
    try {
      console.log.apply(console, ["[DivarAuto]"].concat([].slice.call(arguments)));
    } catch (_e) {}
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function randomDelay() {
    return MIN_DELAY_MS + Math.floor(Math.random() * Math.max(1, MAX_DELAY_MS - MIN_DELAY_MS));
  }

  async function refreshLicenseStatus() {
    try {
      if (globalThis.IranexpediaAuthGate) {
        const res = await IranexpediaAuthGate.verify(false);
        licenseValid = !!(res && res.ok && IranexpediaAuthGate.assertUnlocked());
        return licenseValid;
      }
    } catch (_e) {}
    licenseValid = false;
    return false;
  }

  function persistAutoReplyEnabled(enabled) {
    try {
      chrome.storage.local.set({ autoReplyEnabled: !!enabled });
    } catch (_err) {}
  }

  async function applyAutoReplyEnabled(enabled, source) {
    const want = !!enabled;
    if (want) {
      const ok = await refreshLicenseStatus();
      if (!ok) {
        isEnabled = false;
        persistAutoReplyEnabled(false);
        log("روشن نشد — نیاز به فعال‌سازی (", source || "ui", ")");
        return false;
      }
    }
    isEnabled = want;
    persistAutoReplyEnabled(isEnabled);
    busy = false;
    log(isEnabled ? "افزونه دیوار روشن شد" : "افزونه دیوار خاموش شد");
    return isEnabled;
  }

  window.__iranexpediaGetAutoReplyEnabled = function () {
    return !!isEnabled;
  };
  window.__iranexpediaSetAutoReplyEnabled = function (enabled) {
    return applyAutoReplyEnabled(enabled, "crm-panel");
  };

  function loadRulesFromStorage() {
    try {
      chrome.storage.local.get({ keywordRules: null }, function (data) {
        if (Array.isArray(data.keywordRules) && data.keywordRules.length) {
          keywordRules = data.keywordRules;
        }
      });
    } catch (_e) {}
  }

  function matchReply(text) {
    const t = String(text || "").toLowerCase();
    for (let i = 0; i < keywordRules.length; i++) {
      const rule = keywordRules[i];
      if (!rule || !rule.keyword) continue;
      if (t.indexOf(String(rule.keyword).toLowerCase()) !== -1) {
        return rule.reply || "";
      }
    }
    return "";
  }

  function getOpenChatId() {
    const m = String(location.pathname || "").match(/\/chat\/([^/?#]+)/);
    if (!m) return "";
    const id = decodeURIComponent(m[1]);
    if (!id || id === "postchi") return "";
    return id;
  }

  function getContactName() {
    const el = document.querySelector(".kt-chat-nav-bar__title");
    return el ? String(el.textContent || "").trim() : "";
  }

  function getAdTitle() {
    const el = document.querySelector("a.kt-post-preview-bar .kt-post-preview-bar__title");
    return el ? String(el.textContent || "").trim() : "";
  }

  function getPostToken() {
    const a = document.querySelector("a.kt-post-preview-bar");
    if (!a) return "";
    const href = a.getAttribute("href") || "";
    const m = href.match(/\/v\/([^/?#]+)/);
    return m ? m[1] : "";
  }

  window.__iranexpediaGetChatIdentity = function () {
    const chatId = getOpenChatId();
    return {
      name: getContactName() || getAdTitle() || chatId,
      chatType: "pv",
      phone: "",
      groupId: "",
      externalChatId: chatId,
      chatId: chatId,
      postToken: getPostToken(),
      adTitle: getAdTitle(),
      channel: CHANNEL
    };
  };

  function stripMessageInfo(el) {
    if (!el) return "";
    const clone = el.cloneNode(true);
    clone.querySelectorAll(".kt-message-info").forEach(function (n) {
      n.remove();
    });
    return String(clone.innerText || clone.textContent || "").trim();
  }

  function getMessages() {
    return Array.prototype.slice.call(document.querySelectorAll(".kt-message"));
  }

  function getLastPeerMessage() {
    const peers = document.querySelectorAll(".kt-message.kt-message--peer");
    if (!peers.length) return null;
    const last = peers[peers.length - 1];
    const body = last.querySelector('[data-testid="message-body"]') || last.querySelector(".kt-message__body");
    const timeEl = last.querySelector(".kt-message-info__text");
    return {
      text: stripMessageInfo(body),
      time: timeEl ? String(timeEl.textContent || "").trim() : "",
      el: last
    };
  }

  function lastMessageIsPeer() {
    const msgs = getMessages();
    if (!msgs.length) return false;
    return msgs[msgs.length - 1].classList.contains("kt-message--peer");
  }

  function collectUnreadChats() {
    const unreadIcons = document.querySelectorAll(".kt-conversation__icon--new-message");
    const out = [];
    const seen = {};
    unreadIcons.forEach(function (icon) {
      const row = icon.closest(".kt-conversation");
      if (!row || row.classList.contains("kt-conversation--postman")) return;
      const a = icon.closest("a[href^='/chat/']") || (row.parentElement && row.parentElement.closest("a[href^='/chat/']"));
      if (!a) return;
      const href = a.getAttribute("href") || "";
      const m = href.match(/\/chat\/([^/?#]+)/);
      if (!m) return;
      const id = decodeURIComponent(m[1]);
      if (!id || id === "postchi" || seen[id]) return;
      seen[id] = true;
      const preview = row.querySelector(".kt-conversation__message");
      const name = row.querySelector(".kt-conversation__name");
      const ad = row.querySelector(".kt-conversation__body");
      out.push({
        id: id,
        href: href,
        preview: preview ? String(preview.textContent || "").trim() : "",
        name: name ? String(name.textContent || "").trim() : "",
        adTitle: ad ? String(ad.textContent || "").trim() : "",
        el: a
      });
    });
    return out;
  }

  async function openChat(chatIdOrHref) {
    const id = String(chatIdOrHref || "").replace(/^\/chat\//, "");
    if (!id) return false;
    if (getOpenChatId() === id) return true;
    const link = document.querySelector('a[href="/chat/' + id + '"], a[href="/chat/' + encodeURIComponent(id) + '"]');
    if (link) {
      link.click();
    } else {
      location.href = "/chat/" + id;
    }
    for (let i = 0; i < 20; i++) {
      await sleep(250);
      if (getOpenChatId() === id && document.querySelector("#chat-input")) return true;
    }
    return getOpenChatId() === id;
  }

  async function goToInbox() {
    const back = document.querySelector('button[aria-label="بازگشت"]');
    if (back) {
      back.click();
      await sleep(400);
      return;
    }
    if (!/\/chat\/?$/.test(location.pathname)) {
      location.href = "/chat";
      await sleep(800);
    }
  }

  function setNativeValue(el, value) {
    const proto = window.HTMLTextAreaElement && window.HTMLTextAreaElement.prototype;
    const desc = proto && Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
  }

  async function sendText(text) {
    const input = document.querySelector("#chat-input") || document.querySelector(".kt-chat-input__input");
    if (!input) return { ok: false, error: "input_not_found" };
    input.focus();
    setNativeValue(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(120);

    const sendBtn =
      document.querySelector('button[aria-label="ارسال پیام"]') ||
      document.querySelector('button[aria-label="ارسال"]');
    if (sendBtn && !sendBtn.disabled) {
      sendBtn.click();
      await sleep(300);
      return { ok: true };
    }

    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true
      })
    );
    input.dispatchEvent(
      new KeyboardEvent("keyup", {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true
      })
    );
    await sleep(350);
    return { ok: true };
  }

  async function ingestPeer(chatId, peer) {
    if (!globalThis.IranexpediaCloudBridge || !peer || !peer.text) return;
    try {
      const name = getContactName() || getAdTitle() || chatId;
      await IranexpediaCloudBridge.ingestMessage({
        chat_name: name,
        body: peer.text,
        direction: "inbound",
        external_chat_id: chatId,
        post_token: getPostToken(),
        ad_title: getAdTitle(),
        chat_type: "pv",
        sender_type: "customer",
        external_message_id: chatId + ":" + peer.time + ":" + peer.text.slice(0, 40)
      });
    } catch (err) {
      log("ingest failed", err);
    }
  }

  async function replyInOpenChat() {
    const chatId = getOpenChatId();
    if (!chatId) return false;
    if (!lastMessageIsPeer()) return false;
    const peer = getLastPeerMessage();
    if (!peer || !peer.text) return false;

    const key = chatId + "|" + peer.time + "|" + peer.text;
    if (handledKeys[key]) return false;
    if (Date.now() - lastReplyTime < REPLY_COOLDOWN_MS) return false;

    await ingestPeer(chatId, peer);

    const reply = matchReply(peer.text);
    if (!reply) {
      handledKeys[key] = true;
      return false;
    }

    await sleep(randomDelay());
    const sent = await sendText(reply);
    if (sent.ok) {
      handledKeys[key] = true;
      lastReplyTime = Date.now();
      try {
        await IranexpediaCloudBridge.ingestMessage({
          chat_name: getContactName() || getAdTitle() || chatId,
          body: reply,
          direction: "outbound",
          external_chat_id: chatId,
          post_token: getPostToken(),
          ad_title: getAdTitle(),
          chat_type: "pv",
          sender_type: "ai"
        });
      } catch (_e) {}
      log("replied in", chatId);
      return true;
    }
    return false;
  }

  async function processLoop() {
    if (!isEnabled || busy) return;
    const ok = await refreshLicenseStatus();
    if (!ok) return;
    busy = true;
    try {
      if (getOpenChatId() && document.querySelector("#chat-input")) {
        await replyInOpenChat();
        return;
      }

      const unread = collectUnreadChats();
      if (!unread.length) return;
      const next = unread[0];
      const opened = await openChat(next.id);
      if (!opened) return;
      await sleep(500);
      await replyInOpenChat();
      await sleep(400);
      await goToInbox();
    } catch (err) {
      log("loop error", err);
    } finally {
      busy = false;
    }
  }

  async function handleSendJob(message) {
    const chatId = String(message.chatId || message.targetName || "").replace(/^\/chat\//, "");
    const body = String(message.message || "").trim();
    if (!chatId || !body) return { ok: false, error: "missing_chat_or_body" };
    const opened = await openChat(chatId);
    if (!opened) return { ok: false, error: "open_failed" };
    await sleep(400);
    return sendText(body);
  }

  chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
    if (!message || !message.type) return;
    if (message.type === "sendDivarMessage") {
      handleSendJob(message).then(sendResponse);
      return true;
    }
    if (message.type === "pingDivar") {
      sendResponse({ ok: true, channel: CHANNEL, chatId: getOpenChatId() });
      return true;
    }
  });

  chrome.storage.onChanged.addListener(function (changes) {
    if (changes.autoReplyEnabled) {
      isEnabled = !!changes.autoReplyEnabled.newValue;
    }
    if (changes.keywordRules && Array.isArray(changes.keywordRules.newValue)) {
      keywordRules = changes.keywordRules.newValue;
    }
  });

  async function boot() {
    loadRulesFromStorage();
    try {
      const data = await chrome.storage.local.get({ autoReplyEnabled: false });
      if (data.autoReplyEnabled) {
        await applyAutoReplyEnabled(true, "boot");
      }
    } catch (_e) {}

    try {
      if (globalThis.IranexpediaCloudBridge) {
        const cfg = await IranexpediaCloudBridge.getConfig();
        if (cfg.enabled && cfg.channel !== CHANNEL) {
          // Prefer keeping explicit user choice; only set if empty/whatsapp default on Divar tab
          if (!cfg.accountId || cfg.channel === "whatsapp") {
            await IranexpediaCloudBridge.setConfig({ channel: CHANNEL });
          }
        }
      }
    } catch (_e) {}

    setInterval(function () {
      processLoop();
    }, SCAN_MS);
  }

  boot();
})();
