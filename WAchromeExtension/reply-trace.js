/**
 * End-to-end reply pipeline tracing (extension content + service worker).
 * Logs: [reply-trace] HH:mm:ss.SSS +123ms <traceId> <stage> key=val ...
 */
(function (global) {
  var traces = {};
  var MAX_TRACES = 40;
  var pollTimers = {};

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function nowIso() {
    var d = new Date();
    return (
      pad2(d.getHours()) +
      ":" +
      pad2(d.getMinutes()) +
      ":" +
      pad2(d.getSeconds()) +
      "." +
      String(d.getMilliseconds()).padStart(3, "0")
    );
  }

  function genId() {
    return (
      "rt_" +
      Date.now().toString(36) +
      "_" +
      Math.random().toString(36).slice(2, 8)
    );
  }

  function fmtExtra(extra) {
    if (!extra) return "";
    var parts = [];
    Object.keys(extra).forEach(function (key) {
      var val = extra[key];
      if (val == null || val === "") return;
      parts.push(key + "=" + String(val).replace(/\s+/g, " ").slice(0, 120));
    });
    return parts.length ? " " + parts.join(" ") : "";
  }

  function prune() {
    var keys = Object.keys(traces);
    if (keys.length <= MAX_TRACES) return;
    keys.sort(function (a, b) {
      return traces[a].t0 - traces[b].t0;
    });
    keys.slice(0, keys.length - 30).forEach(function (k) {
      delete traces[k];
    });
  }

  function event(traceId, stage, extra) {
    if (!traceId) {
      debug(stage, extra || {});
      return;
    }
    var row = traces[traceId];
    if (!row) {
      row = { t0: Date.now(), meta: {} };
      traces[traceId] = row;
    }
    var elapsed = Date.now() - row.t0;
    console.log(
      "[reply-trace] " +
        nowIso() +
        " +" +
        elapsed +
        "ms " +
        traceId +
        " " +
        stage +
        fmtExtra(extra)
    );
  }

  function debug(stage, extra) {
    console.log(
      "[reply-trace] " + nowIso() + " +0ms - " + stage + fmtExtra(extra || {})
    );
  }

  function start(meta) {
    var traceId = genId();
    traces[traceId] = { t0: Date.now(), meta: meta || {} };
    event(traceId, "msg_detected", meta);
    prune();
    return traceId;
  }

  function finish(traceId, stage, extra) {
    event(traceId, stage || "pipeline_done", extra);
    stopPoll(traceId);
    delete traces[traceId];
  }

  function stopPoll(traceId) {
    if (pollTimers[traceId]) {
      clearInterval(pollTimers[traceId]);
      delete pollTimers[traceId];
    }
  }

  /** Poll server-side trace events into browser console until pipeline completes. */
  function pollServer(traceId, opts) {
    opts = opts || {};
    if (!traceId || !global.IranexpediaCloudBridge) return;
    var since = 0;
    var attempts = 0;
    var maxAttempts = opts.maxAttempts || 20;
    var notFoundLogged = false;
    stopPoll(traceId);
    pollTimers[traceId] = setInterval(function () {
      attempts += 1;
      if (attempts > maxAttempts) {
        event(traceId, "server_trace_timeout", { attempts: attempts });
        stopPoll(traceId);
        return;
      }
      var fetchFn = IranexpediaCloudBridge.fetchTrace;
      if (typeof fetchFn !== "function") return;
      fetchFn(traceId, since)
        .then(function (res) {
          if (!res || !res.ok) {
            var err = (res && res.error) || "unknown";
            // Old API without /messages/trace → stop quietly after one notice
            if (
              String(err).indexOf("Not Found") >= 0 ||
              String(err).indexOf("404") >= 0 ||
              (res && res.status === 404)
            ) {
              if (!notFoundLogged) {
                event(traceId, "server_trace_unavailable", {
                  hint: "restart_api_for_trace_endpoint"
                });
                notFoundLogged = true;
              }
              stopPoll(traceId);
              return;
            }
            event(traceId, "server_trace_poll_fail", { error: err });
            return;
          }
          var events = (res.data && res.data.events) || [];
          events.forEach(function (ev) {
            var fields = ev.fields || {};
            var extra = Object.assign({}, fields, {
              server_t: ev.t || "",
              server_ms: ev.elapsed_ms
            });
            event(traceId, "server_" + (ev.stage || "event"), extra);
          });
          since += events.length;
          var last = events.length ? events[events.length - 1].stage : "";
          if (
            last === "pipeline_complete" ||
            last === "pipeline_done" ||
            last === "auto_reply_error" ||
            last === "auto_reply_finished"
          ) {
            stopPoll(traceId);
          }
        })
        .catch(function (err) {
          event(traceId, "server_trace_poll_error", {
            error: String((err && err.message) || err)
          });
        });
    }, opts.intervalMs || 2000);
  }

  global.IranexpediaReplyTrace = {
    start: start,
    event: event,
    finish: finish,
    debug: debug,
    pollServer: pollServer,
    stopPoll: stopPoll
  };
})(
  typeof globalThis !== "undefined"
    ? globalThis
    : typeof self !== "undefined"
      ? self
      : this
);
