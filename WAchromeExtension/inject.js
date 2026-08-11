/**
 * Divar Web Chat — MAIN-world Event Sourcing hook
 * =================================================
 * FRAGILE DEPENDENCY (update manually when Divar ships a new bundle):
 *   - Global webpack chunk array: window.webpackChunk_divar_ghased
 *   - Module id: 66478  (Event Sourcing Engine)
 *   - Export: mod.T  → live singleton engine instance
 *   - Hook point: engine.ingest(event)
 *
 * If module id / export shape / ingest signature changes, this file will
 * postMessage { type: "DIVAR_AUTO_HOOK_FAILED" } and log a clear error.
 * Extension must NOT crash — content-bridge falls back gracefully.
 *
 * Runs in the page MAIN world (shares JS globals with Divar SPA).
 * Communicates with the isolated-world content script via window.postMessage
 * (the only safe MV3 bridge between MAIN ↔ isolated worlds).
 */
(function () {
  "use strict";

  var LOG_PREFIX = "[DivarAuto:inject]";
  var SOURCE = "divar-auto-inject";
  var EVENT_TYPE = "DIVAR_AUTO_CHAT_EVENT";
  var FAIL_TYPE = "DIVAR_AUTO_HOOK_FAILED";
  var OK_TYPE = "DIVAR_AUTO_HOOK_OK";
  var HEARTBEAT_TYPE = "DIVAR_AUTO_HOOK_HEARTBEAT";

  /** @type {number} webpack module id — bump when Divar rebundles */
  var ENGINE_MODULE_ID = 66478;

  var POLL_MS = 200;
  var TIMEOUT_MS = 30000;
  var WATCHDOG_MS = 4000;
  var HEARTBEAT_MS = 8000;

  /** Live engine ref for watchdog re-patch after SPA remounts. */
  var hookedEngine = null;

  function log() {
    try {
      var args = [LOG_PREFIX].concat(Array.prototype.slice.call(arguments));
      console.log.apply(console, args);
    } catch (_e) {}
  }

  function logWarn() {
    try {
      var args = [LOG_PREFIX].concat(Array.prototype.slice.call(arguments));
      console.warn.apply(console, args);
    } catch (_e) {}
  }

  function logError() {
    try {
      var args = [LOG_PREFIX].concat(Array.prototype.slice.call(arguments));
      console.error.apply(console, args);
    } catch (_e) {}
  }

  /**
   * postMessage uses the structured-clone algorithm and throws DataCloneError
   * on functions / React elements / DOM nodes. Divar's ingest stream sometimes
   * carries JSX renderers (e.g. restRequest UI helpers). Strip those so the
   * bridge stays alive for real chat payloads.
   */
  function toCloneable(value) {
    if (value == null) return value;
    try {
      return JSON.parse(
        JSON.stringify(value, function (_key, v) {
          var t = typeof v;
          if (t === "function" || t === "symbol" || t === "undefined") {
            return undefined;
          }
          // Drop weird host objects that JSON may stringify poorly.
          if (t === "object" && v !== null) {
            if (typeof Node !== "undefined" && v instanceof Node) return undefined;
            if (typeof Element !== "undefined" && v instanceof Element) {
              return undefined;
            }
          }
          return v;
        })
      );
    } catch (_err) {
      // Circular refs / exotic values — best-effort shallow pick of primitives.
      try {
        if (typeof value !== "object") return value;
        var out = Array.isArray(value) ? [] : {};
        var keys = Object.keys(value);
        for (var i = 0; i < keys.length; i++) {
          var k = keys[i];
          var v2 = value[k];
          var t2 = typeof v2;
          if (
            t2 === "string" ||
            t2 === "number" ||
            t2 === "boolean" ||
            v2 === null
          ) {
            out[k] = v2;
          } else if (t2 === "object" && v2 && !Array.isArray(v2)) {
            // One level of nested plain data (payload.message etc.)
            try {
              out[k] = JSON.parse(JSON.stringify(v2));
            } catch (_e2) {}
          }
        }
        return out;
      } catch (_e3) {
        return null;
      }
    }
  }

  /**
   * Marshal MAIN → isolated world.
   * Content-bridge listens on window "message" and filters by source + type.
   */
  function postToBridge(type, extra) {
    try {
      var safeExtra = toCloneable(extra || {}) || {};
      var payload = Object.assign(
        {
          type: type,
          source: SOURCE
        },
        safeExtra
      );
      // Final guard: ensure the envelope itself is cloneable.
      payload = toCloneable(payload);
      if (!payload) return;
      window.postMessage(payload, window.location.origin);
    } catch (err) {
      // Non-fatal — Divar's own ingest must continue. Avoid spamming console.
      if (err && err.name === "DataCloneError") {
        logWarn("skipped non-cloneable event");
      } else {
        logWarn("postMessage failed:", err);
      }
    }
  }

  function failHook(reason, detail) {
    logError(
      "Hook failed — extension going inactive for Divar event stream.",
      "Reason:",
      reason,
      detail || "",
      "Action: manually re-check webpackChunk_divar_ghased / module",
      ENGINE_MODULE_ID,
      "and update inject.js."
    );
    postToBridge(FAIL_TYPE, {
      reason: String(reason || "unknown"),
      detail: detail != null ? String(detail) : "",
      moduleId: ENGINE_MODULE_ID
    });
  }

  /**
   * Resolve engine from a webpack require fn.
   * Tries known module id first, then scans exports for *.T.ingest.
   */
  function resolveEngineFromRequire(require) {
    if (typeof require !== "function") return null;

    function fromMod(mod, id) {
      if (!mod || !mod.T || typeof mod.T.ingest !== "function") return null;
      return { engine: mod.T, moduleId: id };
    }

    try {
      var known = fromMod(require(ENGINE_MODULE_ID), ENGINE_MODULE_ID);
      if (known) return known;
    } catch (_e) {}

    var cache = require.c || require.cache || null;
    if (cache && typeof cache === "object") {
      var ids = Object.keys(cache);
      for (var i = 0; i < ids.length; i++) {
        try {
          var mod = cache[ids[i]] && cache[ids[i]].exports;
          var hit = fromMod(mod, ids[i]);
          if (hit) {
            log("Discovered engine module id=", ids[i], "(expected", ENGINE_MODULE_ID + ")");
            return hit;
          }
        } catch (_e2) {}
      }
    }
    return null;
  }

  /**
   * Grab the live engine singleton via webpack's chunk push/require API.
   */
  function tryGrabEngine() {
    try {
      var chunks = window.webpackChunk_divar_ghased;
      if (!chunks || typeof chunks.push !== "function") {
        return { ok: false, pending: true };
      }

      var found = null;
      /** @type {string|null} */
      var fatalError = null;
      var moduleNotReady = false;

      chunks.push([
        ["__divar_auto_grab_" + Date.now()],
        {},
        function (require) {
          try {
            if (typeof require !== "function") {
              moduleNotReady = true;
              return;
            }
            found = resolveEngineFromRequire(require);
            if (!found) {
              // Module cache present but shape not found yet / wrong bundle
              moduleNotReady = true;
            }
          } catch (inner) {
            fatalError = String((inner && inner.message) || inner);
          }
        }
      ]);

      if (fatalError) {
        return { ok: false, pending: false, error: fatalError };
      }
      if (!found) {
        return { ok: false, pending: true, deferred: moduleNotReady };
      }
      return { ok: true, engine: found.engine, moduleId: found.moduleId };
    } catch (err) {
      logWarn("tryGrabEngine exception (will retry):", err);
      return { ok: false, pending: true };
    }
  }

  function isIngestPatched(engine) {
    return !!(
      engine &&
      typeof engine.ingest === "function" &&
      engine.ingest.__divarAutoPatched === true
    );
  }

  /**
   * Monkey-patch engine.ingest so every chat event is forwarded outward
   * before Divar's own logic runs.
   */
  function patchIngest(engine) {
    try {
      if (isIngestPatched(engine)) {
        hookedEngine = engine;
        return { ok: true, already: true };
      }

      if (typeof engine.ingest !== "function") {
        return {
          ok: false,
          error:
            "engine.ingest is not a function (type=" +
            typeof engine.ingest +
            "). Module shape changed — update inject.js."
        };
      }

      // If Divar replaced ingest but left our flag, clear and wrap again.
      var previous = engine.ingest;
      var originalIngest =
        previous && previous.__divarAutoOriginal
          ? previous.__divarAutoOriginal
          : previous.bind(engine);

      function patchedIngest(event) {
        try {
          var snapshot = toCloneable(event);
          if (snapshot != null) {
            postToBridge(EVENT_TYPE, { event: snapshot });
          }
        } catch (fwdErr) {
          logWarn("forward failed (non-fatal):", fwdErr);
        }
        return originalIngest(event);
      }
      patchedIngest.__divarAutoPatched = true;
      patchedIngest.__divarAutoOriginal = originalIngest;

      engine.ingest = patchedIngest;
      engine.__divarAutoHooked = true;
      hookedEngine = engine;
      log(
        "Patched engine.ingest on module",
        ENGINE_MODULE_ID,
        "— listening for chat events (incl. closed chats)."
      );
      return { ok: true, already: false };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  }

  function attemptHook() {
    var result = tryGrabEngine();
    if (!result.ok) {
      if (result.pending) return { status: "pending" };
      return { status: "fatal", error: result.error || "grab_failed" };
    }

    var patch = patchIngest(result.engine);
    if (!patch.ok) {
      return { status: "fatal", error: patch.error || "patch_failed" };
    }
    return { status: "ok", already: !!patch.already, moduleId: result.moduleId };
  }

  function startWatchdog() {
    setInterval(function () {
      try {
        var result = tryGrabEngine();
        if (!result.ok || !result.engine) return;
        var engine = result.engine;
        if (isIngestPatched(engine)) {
          hookedEngine = engine;
          return;
        }
        logWarn("Engine ingest not patched — re-wrapping live instance.");
        var patch = patchIngest(engine);
        if (patch.ok) {
          postToBridge(OK_TYPE, {
            moduleId: result.moduleId || ENGINE_MODULE_ID,
            rehooked: true
          });
        } else {
          logWarn("re-patch failed:", patch.error || "unknown");
        }
      } catch (err) {
        logWarn("watchdog error:", err);
      }
    }, WATCHDOG_MS);

    setInterval(function () {
      try {
        var alive = isIngestPatched(hookedEngine);
        postToBridge(HEARTBEAT_TYPE, {
          hooked: alive,
          moduleId: ENGINE_MODULE_ID
        });
      } catch (_e) {}
    }, HEARTBEAT_MS);
  }

  function startPolling() {
    var startedAt = Date.now();
    var done = false;

    function tick() {
      if (done) return;
      try {
        var outcome = attemptHook();
        if (outcome.status === "ok") {
          done = true;
          try {
            postToBridge(OK_TYPE, { moduleId: ENGINE_MODULE_ID });
          } catch (_e) {}
          log("Hook ready.");
          startWatchdog();
          return;
        }
        if (outcome.status === "fatal") {
          done = true;
          failHook("shape_or_module_error", outcome.error);
          return;
        }
        // pending
        if (Date.now() - startedAt >= TIMEOUT_MS) {
          done = true;
          failHook(
            "timeout",
            "webpackChunk_divar_ghased / module " +
              ENGINE_MODULE_ID +
              " not available within " +
              TIMEOUT_MS +
              "ms"
          );
          return;
        }
        setTimeout(tick, POLL_MS);
      } catch (err) {
        done = true;
        failHook("unexpected", String((err && err.message) || err));
      }
    }

    log(
      "Waiting for webpackChunk_divar_ghased + module",
      ENGINE_MODULE_ID,
      "(poll",
      POLL_MS + "ms, timeout",
      TIMEOUT_MS + "ms)…"
    );
    tick();
  }

  try {
    startPolling();
  } catch (bootErr) {
    failHook("boot", String((bootErr && bootErr.message) || bootErr));
  }
})();
