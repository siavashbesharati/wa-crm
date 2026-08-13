/**
 * WhatsApp Web — MAIN-world active-chat identity helper.
 * Tries webpack modules + React fiber to read real @c.us / @g.us ids
 * (DOM alone often only exposes display names).
 *
 * Bridge: window.postMessage({ source: "iranexpedia-wa-inject", ... })
 */
(function () {
  "use strict";

  var SOURCE = "iranexpedia-wa-inject";
  var REQ_TYPE = "IRANEXPEDIA_WA_ACTIVE_CHAT_REQ";
  var RES_TYPE = "IRANEXPEDIA_WA_ACTIVE_CHAT";
  var lastPayload = null;

  function post(type, data) {
    try {
      window.postMessage({ source: SOURCE, type: type, data: data || {} }, "*");
    } catch (_e) {}
  }

  function asWid(raw) {
    if (!raw) return "";
    if (typeof raw === "object") {
      if (raw._serialized) return String(raw._serialized);
      if (raw.user && raw.server) return String(raw.user) + "@" + String(raw.server);
      if (raw.id) return asWid(raw.id);
    }
    return String(raw || "");
  }

  function parseWid(wid) {
    var s = asWid(wid);
    var out = { phone: "", groupId: "", chatType: "", wid: s };
    if (!s) return out;
    if (/@g\.us\b/i.test(s)) {
      out.chatType = "group";
      out.groupId = s;
      return out;
    }
    var m =
      s.match(/^(\d{8,15})@(?:c\.us|s\.whatsapp\.net)\b/i) ||
      s.match(/(\d{8,15})@(?:c\.us|s\.whatsapp\.net)\b/i);
    if (m) {
      out.chatType = "pv";
      out.phone = m[1];
    }
    return out;
  }

  function fromChatObj(chat) {
    if (!chat) return null;
    var wid = asWid(chat.id || chat.wid || (chat.contact && chat.contact.id));
    var parsed = parseWid(wid);
    if (!parsed.wid) return null;
    var name =
      chat.formattedTitle ||
      chat.name ||
      chat.title ||
      (chat.contact && (chat.contact.name || chat.contact.pushname || chat.contact.verifiedName)) ||
      "";
    if (chat.isGroup || chat.groupMetadata || /@g\.us\b/i.test(parsed.wid)) {
      parsed.chatType = "group";
      parsed.groupId = parsed.groupId || parsed.wid;
      parsed.phone = "";
    }
    parsed.name = String(name || "").trim();
    return parsed;
  }

  function walkFiber(root, depth) {
    if (!root || depth > 30) return null;
    try {
      var q = [root];
      var seen = 0;
      while (q.length && seen < 2500) {
        var n = q.shift();
        seen += 1;
        if (!n) continue;
        var pend = n.memoizedProps || n.pendingProps || null;
        if (pend) {
          var cand =
            pend.chat ||
            pend.data ||
            (pend.children && pend.children.props && pend.children.props.chat) ||
            null;
          var hit = fromChatObj(cand);
          if (hit && (hit.groupId || hit.phone)) return hit;
          if (pend.id) {
            var p = parseWid(pend.id);
            if (p.groupId || p.phone) return p;
          }
        }
        var st = n.memoizedState;
        var guard = 0;
        while (st && guard < 40) {
          guard += 1;
          if (st.memoizedState && typeof st.memoizedState === "object") {
            hit = fromChatObj(st.memoizedState);
            if (hit && (hit.groupId || hit.phone)) return hit;
          }
          st = st.next;
        }
        if (n.child) q.push(n.child);
        if (n.sibling) q.push(n.sibling);
      }
    } catch (_e) {}
    return null;
  }

  function fiberFromDom(el) {
    if (!el) return null;
    var keys = Object.keys(el);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (k.indexOf("__reactFiber$") === 0 || k.indexOf("__reactInternalInstance$") === 0) {
        return el[k];
      }
    }
    return null;
  }

  function tryFiberActiveChat() {
    var main = document.querySelector("#main");
    if (!main) return null;
    var header = main.querySelector("header") || main;
    return walkFiber(fiberFromDom(header), 0) || walkFiber(fiberFromDom(main), 0);
  }

  function tryWebpackActiveChat() {
    try {
      var chunkKey = null;
      for (var k in window) {
        if (Object.prototype.hasOwnProperty.call(window, k) && /^webpackChunk/i.test(k)) {
          chunkKey = k;
          break;
        }
      }
      if (!chunkKey || !window[chunkKey]) return null;
      var req = null;
      window[chunkKey].push([
        [String(Date.now()) + ".iranexpedia"],
        {},
        function (r) {
          req = r;
        }
      ]);
      if (!req) return null;

      var mods = req.c || req.m || {};
      var keys = Object.keys(mods);
      for (var i = 0; i < keys.length; i++) {
        var mod = mods[keys[i]];
        var exp = mod && (mod.exports || mod);
        if (!exp) continue;
        var store = exp.Chat || exp.default || exp;
        var models =
          (store && store.models) ||
          (store && store._models) ||
          (exp.Chat && exp.Chat.models) ||
          null;
        var getActive =
          (store && (store.getActive || store.active)) ||
          (exp.Chat && (exp.Chat.getActive || exp.Chat.active)) ||
          null;
        var active = null;
        if (typeof getActive === "function") {
          try {
            active = getActive.call(store);
          } catch (_e) {}
        } else if (getActive && typeof getActive === "object") {
          active = getActive;
        }
        if (!active && models && models.length) {
          for (var j = 0; j < models.length; j++) {
            if (models[j] && (models[j].active || models[j].__x_active)) {
              active = models[j];
              break;
            }
          }
        }
        var hit = fromChatObj(active);
        if (hit && (hit.groupId || hit.phone)) return hit;
      }
    } catch (_e) {}
    return null;
  }

  function readActiveChat() {
    return tryFiberActiveChat() || tryWebpackActiveChat() || lastPayload;
  }

  window.addEventListener("message", function (ev) {
    var d = ev && ev.data;
    if (!d || d.source !== "iranexpedia-wa-content") return;
    if (d.type !== REQ_TYPE) return;
    var hit = readActiveChat();
    if (hit) lastPayload = hit;
    post(RES_TYPE, hit || {});
  });

  // Keep a warm cache while chatting
  setInterval(function () {
    var hit = readActiveChat();
    if (hit && (hit.groupId || hit.phone || hit.wid)) {
      lastPayload = hit;
      post(RES_TYPE, hit);
    }
  }, 2500);

  post("IRANEXPEDIA_WA_INJECT_READY", { ok: true });
})();
