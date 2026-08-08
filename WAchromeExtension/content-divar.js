/**
 * Divar chat channel adapter — DOM scrape / auto-reply / outbound jobs.
 * Spec: divarref/divar-auto.md
 */
(function () {
  const EXT_VERSION = "7.2.7";
  const BRAND = "iranexpedia.ir";
  const CHANNEL = "divar";

  console.log(
    "%c[" + BRAND + " Divar v" + EXT_VERSION + "] LOADED",
    "background:#a62626;color:#fff;font-size:14px;padding:6px;"
  );

  const SCAN_MS = 3500;

  let isEnabled = false;
  let licenseValid = false;
  let busy = false;
  const handledKeys = {};
  const ingestedKeys = {};

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
  window.__iranexpediaGetChatName = function () {
    return getContactName() || getAdTitle() || getOpenChatId() || "";
  };
  window.__iranexpediaSendNow = function (text) {
    return sendText(String(text || "")).then(function (res) {
      if (!res || !res.ok) {
        alert(
          "ارسال انجام نشد" +
            (res && res.error ? " (" + res.error + ")" : "") +
            ". چت را باز بگذارید و دوباره تلاش کنید."
        );
      }
      return res;
    });
  };

  function getOpenChatId() {
    const m = String(location.pathname || "").match(/\/chat\/([^/?#]+)/);
    if (!m) return "";
    const id = decodeURIComponent(m[1]);
    if (!id || id === "postchi") return "";
    return id;
  }

  /** "~ کاربر: یاسر سپهری" → "یاسر سپهری" */
  function cleanDivarPeerName(raw) {
    var t = String(raw || "")
      .replace(/\u200c/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!t || t === "چت و تماس") return "";
    t = t.replace(/^~\s*/, "");
    t = t.replace(/^کاربر\s*[:：]\s*/i, "");
    t = t.replace(/^user\s*[:：]\s*/i, "");
    return t.trim();
  }

  function getContactName() {
    // Open-chat title: h2.kt-chat-nav-bar__title (e.g. "~ کاربر: یاسر سپهری")
    const h2 = document.querySelector("h2.kt-chat-nav-bar__title");
    if (h2) {
      const cleaned = cleanDivarPeerName(h2.textContent);
      if (cleaned) return cleaned;
    }
    const titles = document.querySelectorAll(".kt-chat-nav-bar__title");
    for (let i = 0; i < titles.length; i++) {
      const cleaned = cleanDivarPeerName(titles[i].textContent);
      if (cleaned) return cleaned;
    }
    return "";
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
    const pretty = getContactName() || getAdTitle() || "";
    return {
      name: pretty || chatId,
      chatType: "pv",
      // Stable CRM key for Divar (phone field reused as chatId)
      phone: chatId || "",
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
    // Prefer in-SPA click — hard location.href remounts the CRM sidebar.
    const link = document.querySelector(
      'a[href="/chat/' +
        id +
        '"], a[href="/chat/' +
        encodeURIComponent(id) +
        '"], a[href^="/chat/' +
        id +
        '"]'
    );
    if (link) {
      link.click();
    } else {
      try {
        history.pushState({}, "", "/chat/" + id);
        window.dispatchEvent(new PopStateEvent("popstate"));
      } catch (_e) {
        location.href = "/chat/" + id;
      }
    }
    for (let i = 0; i < 20; i++) {
      await sleep(250);
      if (getOpenChatId() === id && document.querySelector("#chat-input")) return true;
    }
    return getOpenChatId() === id;
  }

  async function goToInbox() {
    // Soft navigation only — avoid full reload that wipes the CRM panel.
    const back =
      document.querySelector('button[aria-label="بازگشت"]') ||
      document.querySelector('a[href="/chat"]') ||
      document.querySelector('a[href="/chat/"]');
    if (back) {
      back.click();
      await sleep(400);
      return;
    }
    if (!/\/chat\/?$/.test(location.pathname)) {
      try {
        history.pushState({}, "", "/chat");
        window.dispatchEvent(new PopStateEvent("popstate"));
        await sleep(500);
      } catch (_e) {}
    }
  }

  function setNativeValue(el, value) {
    const proto = window.HTMLTextAreaElement && window.HTMLTextAreaElement.prototype;
    const desc = proto && Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    // React controlled inputs often keep an internal value tracker
    try {
      const tracker = el._valueTracker;
      if (tracker && typeof tracker.setValue === "function") {
        tracker.setValue(value === "" ? " " : "");
      }
    } catch (_e) {}
  }

  function findChatInput() {
    return (
      document.querySelector("#chat-input") ||
      document.querySelector("textarea.kt-chat-input__input") ||
      document.querySelector(".kt-chat-input__input")
    );
  }

  function findSendButton() {
    return (
      document.querySelector('button.kt-chat-input__button[aria-label="ارسال پیام"]') ||
      document.querySelector('button[aria-label="ارسال پیام"]') ||
      document.querySelector("button.kt-chat-input__button.kt-button--primary") ||
      document.querySelector("button.kt-chat-input__button")
    );
  }

  function fillChatInput(input, text) {
    input.focus();
    setNativeValue(input, "");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    setNativeValue(input, text);
    try {
      input.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          cancelable: true,
          data: text,
          inputType: "insertText"
        })
      );
    } catch (_e) {
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    input.dispatchEvent(new Event("change", { bubbles: true }));
    // Fallback for editors that only accept execCommand / beforeinput
    if (!String(input.value || "").trim() && typeof document.execCommand === "function") {
      try {
        input.select();
        document.execCommand("selectAll", false, null);
        document.execCommand("insertText", false, text);
      } catch (_e2) {}
    }
  }

  async function waitForSendButton(timeoutMs) {
    const until = Date.now() + (timeoutMs || 2500);
    while (Date.now() < until) {
      const btn = findSendButton();
      if (btn && !btn.disabled) return btn;
      await sleep(80);
    }
    return findSendButton();
  }

  async function pressEnterToSend(input) {
    const opts = {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true
    };
    input.dispatchEvent(new KeyboardEvent("keydown", opts));
    input.dispatchEvent(new KeyboardEvent("keypress", opts));
    input.dispatchEvent(new KeyboardEvent("keyup", opts));
  }

  async function sendText(text) {
    const msg = String(text || "").trim();
    if (!msg) return { ok: false, error: "empty_message" };
    const input = findChatInput();
    if (!input) return { ok: false, error: "input_not_found" };

    fillChatInput(input, msg);
    await sleep(150);

    // Divar only mounts the send button after React sees non-empty text.
    let sendBtn = await waitForSendButton(2500);
    if (!sendBtn) {
      // Retry fill once — some SPA frames drop the first synthetic input.
      fillChatInput(input, msg);
      sendBtn = await waitForSendButton(2000);
    }

    if (sendBtn && !sendBtn.disabled) {
      sendBtn.click();
      await sleep(350);
      return { ok: true };
    }

    await pressEnterToSend(input);
    await sleep(400);
    // Confirm button disappeared / input cleared as soft success signal
    const still = findSendButton();
    if (!still || String(input.value || "").trim() === "") {
      return { ok: true };
    }
    return { ok: false, error: "send_button_not_found" };
  }

  async function resolveChatId(targetName) {
    const raw = String(targetName || "").replace(/^\/chat\//, "").trim();
    if (!raw) return "";
    if (getOpenChatId() === raw) return raw;
    if (
      document.querySelector(
        'a[href="/chat/' + raw + '"], a[href="/chat/' + encodeURIComponent(raw) + '"]'
      )
    ) {
      return raw;
    }
    try {
      if (globalThis.IranexpediaCrm) {
        if (IranexpediaCrm.getContactByPhone) {
          const byPhone = await IranexpediaCrm.getContactByPhone(raw);
          if (byPhone && byPhone.phone) return String(byPhone.phone);
        }
        const byName = await IranexpediaCrm.getContactByName(raw);
        if (byName && byName.phone) return String(byName.phone);
      }
    } catch (_e) {}
    return raw;
  }

  async function runScheduledTask(task) {
    const target = (task && (task.targetName || task.chatId)) || "";
    const body = String((task && task.message) || "").trim();
    const chatId = await resolveChatId(target);
    if (!chatId || !body) return { ok: false, error: "missing_chat_or_body" };
    if (busy) return { ok: false, error: "busy" };
    busy = true;
    try {
      const opened = await openChat(chatId);
      if (!opened) return { ok: false, error: "open_failed" };
      await sleep(600);
      const sent = await sendText(body);
      if (!sent.ok) return sent;
      try {
        if (globalThis.IranexpediaCloudBridge) {
          await IranexpediaCloudBridge.ingestMessage({
            chat_name: getContactName() || getAdTitle() || chatId,
            body: body,
            direction: "outbound",
            external_chat_id: chatId,
            post_token: getPostToken(),
            ad_title: getAdTitle(),
            chat_type: "pv",
            sender_type: "ai"
          });
        }
      } catch (_e) {}
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    } finally {
      busy = false;
    }
  }

  async function ingestPeer(chatId, peer) {
    if (!globalThis.IranexpediaCloudBridge || !peer || !peer.text) return false;
    const key = chatId + "|" + peer.time + "|" + peer.text;
    if (ingestedKeys[key]) return true;
    try {
      const name = getContactName() || getAdTitle() || chatId;
      const ing = await IranexpediaCloudBridge.ingestMessage({
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
      if (ing && ing.ok) {
        ingestedKeys[key] = true;
        log("ingest ابر OK ←", name, ":", String(peer.text).slice(0, 80));
        return true;
      }
      log("ingest ابر ناموفق:", (ing && ing.error) || "unknown");
      return false;
    } catch (err) {
      log("ingest failed", err);
      return false;
    }
  }

  /** Cloud AI path: ingest peer text (replies come only from cloud outbound jobs). */
  async function ingestOpenChatToCloud() {
    const chatId = getOpenChatId();
    if (!chatId) return;
    if (!(await refreshLicenseStatus())) return;
    if (!lastMessageIsPeer()) return;
    const peer = getLastPeerMessage();
    if (!peer || !peer.text) return;
    await ingestPeer(chatId, peer);
  }

  async function processOpenChatForCloud() {
    const chatId = getOpenChatId();
    if (!chatId) return false;
    if (!lastMessageIsPeer()) return false;
    const peer = getLastPeerMessage();
    if (!peer || !peer.text) return false;

    const key = chatId + "|" + peer.time + "|" + peer.text;
    if (handledKeys[key]) return false;

    await ingestPeer(chatId, peer);
    handledKeys[key] = true;
    log("پیام برای AI ابری ارسال شد — بدون پاسخ محلی");
    return true;
  }

  async function processLoop() {
    // Always ingest open chat for cloud AI
    try {
      if (getOpenChatId() && document.querySelector("#chat-input")) {
        await ingestOpenChatToCloud();
      }
    } catch (err) {
      log("cloud ingest error", err);
    }

    if (!isEnabled || busy) return;
    const ok = await refreshLicenseStatus();
    if (!ok) return;
    busy = true;
    try {
      // If a chat is already open, only ingest there — do not bounce inbox↔chat
      if (getOpenChatId() && document.querySelector("#chat-input")) {
        await processOpenChatForCloud();
        return;
      }

      const unread = collectUnreadChats();
      if (!unread.length) return;
      const next = unread[0];
      const opened = await openChat(next.id);
      if (!opened) return;
      await sleep(500);
      await ingestOpenChatToCloud();
      await processOpenChatForCloud();
      await sleep(400);
      await goToInbox();
    } catch (err) {
      log("loop error", err);
    } finally {
      busy = false;
    }
  }

  async function handleSendJob(message) {
    const chatId = await resolveChatId(message.chatId || message.targetName || "");
    const body = String(message.message || "").trim();
    if (!chatId || !body) return { ok: false, error: "missing_chat_or_body" };
    const opened = await openChat(chatId);
    if (!opened) return { ok: false, error: "open_failed" };
    await sleep(400);
    return sendText(body);
  }

  chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
    if (!message || !message.type) return;
    if (message.type === "runScheduledTask") {
      runScheduledTask(message.task || message).then(sendResponse);
      return true;
    }
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
  });

  async function activateDivarChannel() {
    if (!globalThis.IranexpediaCloudBridge || !IranexpediaCloudBridge.ensureChannelAccount) {
      return;
    }
    try {
      const res = await IranexpediaCloudBridge.ensureChannelAccount(CHANNEL);
      if (res && res.ok) {
        log("channel active: divar", res.account && res.account.id);
      } else {
        log("channel bind skipped:", (res && res.error) || "not_logged_in");
      }
    } catch (err) {
      log("channel bind error", err);
    }
  }

  async function boot() {
    log("boot on", location.href, "chatId=", getOpenChatId());
    await activateDivarChannel();
    try {
      const data = await chrome.storage.local.get({ autoReplyEnabled: false });
      if (data.autoReplyEnabled) {
        await applyAutoReplyEnabled(true, "boot");
      }
    } catch (_e) {}

    setInterval(function () {
      processLoop();
    }, SCAN_MS);
    // Keep channel heartbeat fresh for panel "روشن" status
    setInterval(activateDivarChannel, 12000);
  }

  boot();
})();
