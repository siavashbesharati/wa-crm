/**
 * Divar content-bridge (isolated world)
 * =====================================
 * Marshaling path:
 *   MAIN world (inject.js)
 *     → window.postMessage({ type, source, event })
 *   THIS FILE (isolated content script)
 *     → chrome.runtime.sendMessage(...)
 *   background.js (service worker)
 *
 * Why not call chrome.* from inject.js?
 *   Scripts in the page MAIN world do NOT have chrome.runtime access.
 *   postMessage is the standard MV3 bridge across worlds.
 *
 * Injection strategy — two options:
 *
 *   1) PREFERRED (active): <script src=chrome.runtime.getURL('inject.js')>
 *      from this isolated content script at document_start.
 *      Needs web_accessible_resources for inject.js (matches limited to Divar).
 *
 *   2) ALTERNATIVE (Chrome 111+): register inject.js itself as a content_script
 *      with "world": "MAIN" and run_at document_start. Then skip script-tag
 *      injection here (only keep the message listener). Example manifest entry:
 *
 *      {
 *        "matches": ["https://divar.ir/chat/*", "https://chat.divar.ir/*"],
 *        "js": ["inject.js"],
 *        "run_at": "document_start",
 *        "world": "MAIN"
 *      }
 *
 *      Do NOT enable both (1) and (2) at once — double inject is guarded by
 *      engine.__divarAutoHooked but still wasteful.
 *
 *   3) ALTERNATIVE: chrome.scripting.executeScript({ world: "MAIN", files: [...] })
 *      from the service worker (needs "scripting" permission — already declared).
 *      See injectViaScriptingApi() below.
 */
(function () {
  "use strict";

  var LOG_PREFIX = "[DivarAuto:bridge]";
  var SOURCE = "divar-auto-inject";
  var EVENT_TYPE = "DIVAR_AUTO_CHAT_EVENT";
  var FAIL_TYPE = "DIVAR_AUTO_HOOK_FAILED";
  var OK_TYPE = "DIVAR_AUTO_HOOK_OK";

  /** Set true when MAIN-world hook reports failure — enables DOM fallback. */
  var hookFailed = false;
  var hookReady = false;

  function log() {
    try {
      console.log.apply(
        console,
        [LOG_PREFIX].concat(Array.prototype.slice.call(arguments))
      );
    } catch (_e) {}
  }

  function logWarn() {
    try {
      console.warn.apply(
        console,
        [LOG_PREFIX].concat(Array.prototype.slice.call(arguments))
      );
    } catch (_e) {}
  }

  /**
   * PREFERRED: inject inject.js into MAIN world via <script> tag.
   * Must run at document_start so we race Divar's own webpack bootstrap.
   */
  function injectViaScriptTag() {
    try {
      if (document.documentElement.getAttribute("data-divar-auto-inject") === "1") {
        log("inject.js already marked — skip duplicate <script>.");
        return true;
      }
      var s = document.createElement("script");
      s.src = chrome.runtime.getURL("inject.js");
      s.async = false;
      s.setAttribute("data-divar-auto", "inject");
      s.onload = function () {
        // Remove tag after load — code stays in MAIN world memory.
        try {
          s.remove();
        } catch (_e) {}
      };
      s.onerror = function () {
        logWarn(
          "Failed to load inject.js via <script>. Check web_accessible_resources."
        );
        hookFailed = true;
        enableDomFallback("script_load_error");
      };
      (document.documentElement || document.head || document.body).appendChild(s);
      document.documentElement.setAttribute("data-divar-auto-inject", "1");
      log("Injected inject.js into MAIN world via <script> tag.");
      return true;
    } catch (err) {
      logWarn("injectViaScriptTag error:", err);
      return false;
    }
  }

  /**
   * ALTERNATIVE (optional): chrome.scripting.executeScript with world:"MAIN".
   * Requires "scripting" permission + a tab id. Prefer static <script> injection
   * above for document_start reliability; keep this for programmatic re-hooks.
   *
   * Uncomment + call if you prefer the scripting API over WAR + script tag.
   */
  function injectViaScriptingApi() {
    // Example (not used by default):
    // chrome.runtime.sendMessage({ type: "DIVAR_AUTO_REQUEST_MAIN_INJECT" });
    // …and in background:
    // chrome.scripting.executeScript({
    //   target: { tabId },
    //   files: ["inject.js"],
    //   world: "MAIN"
    // });
    log(
      "injectViaScriptingApi is a documented alternative — not active.",
      "Prefer <script> tag (injectViaScriptTag) or manifest world:MAIN."
    );
  }

  function injectIntoMainWorld() {
    // Prefer script-tag injection (see file header).
    var ok = injectViaScriptTag();
    if (!ok) {
      injectViaScriptingApi();
      enableDomFallback("inject_failed");
    }
  }

  /**
   * Optional fallback when webpack hook never attaches.
   * Placeholder: existing content-divar.js already polls DOM; we only signal.
   */
  function enableDomFallback(reason) {
    try {
      window.__divarAutoUseDomFallback = true;
      window.__divarAutoEngineHookLive = false;
      window.__divarAutoHookFailedReason = String(reason || "");
      logWarn(
        "Fallback flag set (__divarAutoUseDomFallback=true). Reason:",
        reason,
        "— content-divar.js DOM loop remains the safety net."
      );
    } catch (_e) {}
  }

  function markEngineHookLive() {
    try {
      window.__divarAutoEngineHookLive = true;
      window.__divarAutoUseDomFallback = false;
    } catch (_e) {}
  }

  /**
   * Security: only accept messages from this window (not iframes),
   * with our known type + source stamp from inject.js.
   */
  function isValidBridgeMessage(event) {
    if (!event || event.source !== window) return false;
    var data = event.data;
    if (!data || typeof data !== "object") return false;
    if (data.source !== SOURCE) return false;
    if (
      data.type !== EVENT_TYPE &&
      data.type !== FAIL_TYPE &&
      data.type !== OK_TYPE
    ) {
      return false;
    }
    return true;
  }

  function forwardChatEventToBackground(data) {
    try {
      chrome.runtime.sendMessage(
        {
          type: EVENT_TYPE,
          source: SOURCE,
          // Full engine event (seq / payload / …) — do NOT filter here.
          event: data.event,
          // Helpful for multi-tab debugging
          pageUrl: String(location.href || "")
        },
        function (res) {
          void chrome.runtime.lastError;
          try {
            if (!res) return;
            if (res.duplicate) return;
            if (res.skipped) return;
            if (res.ingested) {
              log(
                "ingest ابر OK → messages/AI",
                res.external_message_id || "",
                (res && res.error) || ""
              );
            } else if (res.ok === false) {
              logWarn("ingest ابر ناموفق:", res.error || "unknown");
            }
          } catch (_e) {}
        }
      );
    } catch (err) {
      logWarn("sendMessage failed:", err);
    }
  }

  /**
   * Page-console visibility for peer inbound messages (SW console is separate).
   * Still forwards ALL event types to background — this is log-only filtering.
   */
  function logPeerIncomingIfAny(engineEvent) {
    try {
      var payload = engineEvent && engineEvent.payload;
      if (!payload || payload.type !== "message") return;
      var msg = payload.message;
      if (!msg || msg.peer !== true) return;
      log(
        "پیام ورودی (peer)",
        "chatId=",
        msg.chatId,
        "id=",
        msg.id,
        "data=",
        String(msg.data || "").slice(0, 160)
      );
    } catch (_e) {}
  }

  function onWindowMessage(event) {
    try {
      if (!isValidBridgeMessage(event)) return;

      if (event.data.type === OK_TYPE) {
        markEngineHookLive();
        if (!hookReady) {
          hookReady = true;
          log("MAIN-world webpack hook OK — engine ingest path active.");
        }
        return;
      }

      if (event.data.type === FAIL_TYPE) {
        hookFailed = true;
        logWarn(
          "MAIN-world hook FAILED:",
          event.data.reason,
          event.data.detail || "",
          "| moduleId=",
          event.data.moduleId
        );
        logWarn(
          "Divar event stream inactive until inject.js is updated.",
          "Falling back to DOM strategy if available."
        );
        enableDomFallback(event.data.reason || "hook_failed");
        try {
          chrome.runtime.sendMessage({
            type: FAIL_TYPE,
            source: SOURCE,
            reason: event.data.reason,
            detail: event.data.detail,
            moduleId: event.data.moduleId,
            pageUrl: String(location.href || "")
          });
        } catch (_e) {}
        return;
      }

      // DIVAR_AUTO_CHAT_EVENT
      if (!hookReady) {
        hookReady = true;
        markEngineHookLive();
        log("First chat event received — MAIN↔isolated bridge is live.");
      }
      logPeerIncomingIfAny(event.data.event);
      forwardChatEventToBackground(event.data);
    } catch (err) {
      logWarn("onWindowMessage error (non-fatal):", err);
    }
  }

  window.addEventListener("message", onWindowMessage, false);
  injectIntoMainWorld();
  log("content-bridge armed at", location.href);
})();
