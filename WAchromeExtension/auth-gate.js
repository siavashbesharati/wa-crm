/**
 * Cloud OTP auth gate — single enforcement point for extension unlock.
 * Dist build applies HARD obfuscation to this file.
 *
 * Bypass friction: dual opaque seals + session integrity fingerprint.
 * Real authority remains server OTP/JWT; this only raises client patch cost.
 */
(function (global) {
  var SEAL_A = 0xa5a5;
  var SEAL_B = 0x5a5a;
  var sealA = 0;
  var sealB = 0;
  var integrity = 0;
  var lastReason = "not_checked";
  var lastCheckAt = 0;
  var CACHE_MS = 8000;

  function fnv1a(parts) {
    var h = 0x811c9dc5;
    for (var p = 0; p < parts.length; p++) {
      var s = String(parts[p] || "");
      for (var i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
      }
      h ^= 0x7f;
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  function setFailed(reason) {
    sealA = 0;
    sealB = 0;
    integrity = 0;
    lastReason = reason || "auth_failed";
    return { ok: false, reason: lastReason };
  }

  function setPassed(token, orgId, orgKey) {
    sealA = SEAL_A;
    sealB = SEAL_B;
    integrity = fnv1a([token, orgId, orgKey, "otp-v1"]);
    lastReason = "ok";
    return { ok: true, reason: "ok" };
  }

  function sealsOk() {
    return (
      sealA !== 0 &&
      sealB !== 0 &&
      (sealA ^ SEAL_A) === 0 &&
      (sealB ^ SEAL_B) === 0 &&
      integrity !== 0
    );
  }

  function assertUnlocked() {
    // Flipping a lone boolean elsewhere is not enough
    return sealsOk();
  }

  function getReason() {
    return lastReason;
  }

  function revoke() {
    sealA = 0;
    sealB = 0;
    integrity = 0;
    lastCheckAt = 0;
    lastReason = "revoked";
  }

  async function verify(force) {
    var now = Date.now();
    if (!force && sealsOk() && now - lastCheckAt < CACHE_MS) {
      return { ok: true, reason: "ok" };
    }
    lastCheckAt = now;

    try {
      var bridge = global.IranexpediaCloudBridge;
      if (!bridge || typeof bridge.status !== "function") {
        return setFailed("bridge_missing");
      }

      var st = await bridge.status();
      if (!st) return setFailed("empty_status");

      var cfg = st.config || {};
      var token = cfg.accessToken ? String(cfg.accessToken) : "";
      var orgId = cfg.orgId ? String(cfg.orgId) : "";
      var hasToken = token.length > 12;
      var hasOrg = orgId.length > 4;
      var enabled = cfg.enabled === true;
      var connected = st.connected === true;
      var org = st.me && st.me.org ? st.me.org : null;
      var orgKey = org ? String(org.id || org.name || "") : "";
      var meOk = !!(org && orgKey.length > 0);

      // Fail closed: every sensitive condition must hold
      if (!enabled) return setFailed("not_enabled");
      if (!hasToken) return setFailed("no_token");
      if (!hasOrg) return setFailed("no_org");
      if (!connected) return setFailed(st.reason || "not_connected");
      if (!meOk) return setFailed("invalid_session");
      // Config org must match session org id when server returns an id
      if (org.id && String(org.id) !== orgId) {
        return setFailed("org_mismatch");
      }

      var passed = setPassed(token, orgId, orgKey);
      // Integrity must still read as unlocked after write
      if (!sealsOk()) return setFailed("seal_corrupt");
      return passed;
    } catch (err) {
      return setFailed(err && err.message ? String(err.message) : "verify_exception");
    }
  }

  global.IranexpediaAuthGate = {
    verify: verify,
    assertUnlocked: assertUnlocked,
    getReason: getReason,
    revoke: revoke,
    isAuthorized: assertUnlocked,
    getMessage: function () {
      if (assertUnlocked()) return "فعال با ورود OTP ابری";
      if (lastReason === "not_configured" || lastReason === "not_enabled") {
        return "با OTP از پاپ‌آپ افزونه وارد شوید";
      }
      return "سرور قطع یا نشست نامعتبر است (" + lastReason + ")";
    }
  };
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this);
