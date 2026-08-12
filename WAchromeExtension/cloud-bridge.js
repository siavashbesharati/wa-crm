/**
 * Cloud bridge for B2B multi-channel platform API.
 * Hybrid connector: auth, heartbeat, claim jobs, ingest, lead sync.
 *
 * Content scripts on WhatsApp / Divar cannot call localhost/API
 * directly (CORS / mixed-content). Those calls are proxied through the
 * background service worker, which has host_permissions.
 */
(function (global) {
  var DEFAULT_API = "http://localhost:8000/api";

  function uuid() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /** True only inside a real web page content script (not SW / popup / dashboard). */
  function inPageContentScript() {
    try {
      return typeof location !== "undefined" && /^https?:$/i.test(location.protocol);
    } catch (_e) {
      return false;
    }
  }

  function viaBackground(method, args) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(
          { type: "cloudBridgeInvoke", method: method, args: args || [] },
          function (res) {
            if (chrome.runtime.lastError) {
              resolve({ ok: false, error: chrome.runtime.lastError.message });
              return;
            }
            resolve(res || { ok: false, error: "no_response" });
          }
        );
      } catch (err) {
        resolve({ ok: false, error: String(err && err.message ? err.message : err) });
      }
    });
  }

  function wrap(methodName, impl) {
    return function () {
      var args = Array.prototype.slice.call(arguments);
      if (inPageContentScript()) {
        return viaBackground(methodName, args);
      }
      return impl.apply(null, args);
    };
  }

  async function getConfig() {
    var data = await chrome.storage.local.get({
      cloudBridgeConfig: null,
      cloudDeviceId: null,
      cloudInstallId: null
    });
    var patchLocal = {};
    if (!data.cloudDeviceId) {
      data.cloudDeviceId = uuid();
      patchLocal.cloudDeviceId = data.cloudDeviceId;
    }
    if (!data.cloudInstallId) {
      data.cloudInstallId = uuid();
      patchLocal.cloudInstallId = data.cloudInstallId;
    }
    if (Object.keys(patchLocal).length) {
      await chrome.storage.local.set(patchLocal);
    }
    var cfg = data.cloudBridgeConfig || {};
    return {
      enabled: !!cfg.enabled,
      apiUrl: cfg.apiUrl || DEFAULT_API,
      accessToken: cfg.accessToken || "",
      refreshToken: cfg.refreshToken || "",
      orgId: cfg.orgId || "",
      accountId: cfg.accountId || "",
      channel: cfg.channel || "whatsapp",
      role: cfg.role || "connector",
      phone: cfg.phone || "",
      orgName: cfg.orgName || "",
      plan: cfg.plan || "",
      seatId: cfg.seatId || "",
      seatTokenPrefix: cfg.seatTokenPrefix || "",
      seatToken: cfg.seatToken || "",
      deviceId: data.cloudDeviceId,
      installId: data.cloudInstallId
    };
  }

  async function setConfig(patch) {
    var current = await getConfig();
    var next = Object.assign({}, current, patch || {});
    await chrome.storage.local.set({
      cloudBridgeConfig: {
        enabled: next.enabled,
        apiUrl: next.apiUrl,
        accessToken: next.accessToken,
        refreshToken: next.refreshToken,
        orgId: next.orgId,
        accountId: next.accountId,
        channel: next.channel || "whatsapp",
        role: next.role,
        phone: next.phone,
        orgName: next.orgName,
        plan: next.plan,
        seatId: next.seatId || "",
        seatTokenPrefix: next.seatTokenPrefix || "",
        seatToken: next.seatToken || ""
      }
    });
    return getConfig();
  }

  async function rawRequest(apiUrl, path, options) {
    options = options || {};
    var headers = Object.assign(
      { "Content-Type": "application/json" },
      options.headers || {}
    );
    var url = String(apiUrl || DEFAULT_API).replace(/\/$/, "") + path;
    var res = await fetch(url, {
      method: options.method || "GET",
      headers: headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    var rawText = await res.text().catch(function () {
      return "";
    });
    var data = {};
    if (rawText) {
      try {
        data = JSON.parse(rawText);
      } catch (_e) {
        data = { message: rawText.slice(0, 200) };
      }
    }
    if (!res.ok) {
      var err = data.detail || data.message || "";
      if (Array.isArray(err)) {
        err = err
          .map(function (item) {
            return (item && (item.msg || item.message)) || String(item);
          })
          .join("; ");
      }
      if (!err) {
        err = res.status === 500 ? "server_error" : "http_error:" + res.status;
      }
      return {
        ok: false,
        error: err,
        data: data,
        status: res.status
      };
    }
    return { ok: true, data: data, status: res.status };
  }

  var refreshInFlight = null;

  async function refreshAccessTokenImpl() {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async function () {
      var cfg = await getConfig();
      if (!cfg.refreshToken) {
        if (cfg.seatToken) {
          return activateSeatImpl(cfg.seatToken, cfg.apiUrl);
        }
        return { ok: false, error: "no_refresh" };
      }
      var res = await rawRequest(cfg.apiUrl, "/auth/refresh", {
        method: "POST",
        body: {
          refresh_token: cfg.refreshToken,
          org_id: cfg.orgId,
          install_id: cfg.installId
        }
      });
      if (!res.ok && cfg.seatToken) {
        return activateSeatImpl(cfg.seatToken, cfg.apiUrl);
      }
      if (!res.ok) return res;
      var token = res.data || {};
      await setConfig({
        enabled: true,
        accessToken: token.access_token || "",
        refreshToken: token.refresh_token || cfg.refreshToken,
        orgId: token.org_id || cfg.orgId,
        role: token.role || cfg.role
      });
      return { ok: true, data: token };
    })();
    try {
      return await refreshInFlight;
    } finally {
      refreshInFlight = null;
    }
  }

  async function request(path, options) {
    var cfg = await getConfig();
    if (!cfg.enabled || !cfg.accessToken || !cfg.orgId) {
      return { ok: false, error: "cloud_disabled" };
    }
    var t0 = Date.now();
    var method = (options && options.method) || "GET";
    var RT = global.IranexpediaReplyTrace;
    var reqOpts = {
      method: method,
      body: options && options.body,
      headers: {
        Authorization: "Bearer " + cfg.accessToken,
        "X-Org-Id": cfg.orgId
      }
    };
    var res = await rawRequest(cfg.apiUrl, path, reqOpts);
    if (res.status === 401 && (cfg.refreshToken || cfg.seatToken)) {
      var refreshed = await refreshAccessTokenImpl();
      if (refreshed && refreshed.ok) {
        cfg = await getConfig();
        reqOpts.headers.Authorization = "Bearer " + cfg.accessToken;
        res = await rawRequest(cfg.apiUrl, path, reqOpts);
      }
    }
    if (RT) {
      RT.debug("api_" + method.toLowerCase(), {
        path: path.split("?")[0],
        ok: !!res.ok,
        ms: Date.now() - t0,
        status: res.status || 0,
        error: res.ok ? "" : res.error || ""
      });
    }
    return res;
  }

  async function fetchTraceImpl(traceId, since) {
    var tid = String(traceId || "").trim();
    if (!tid) return { ok: false, error: "no_trace_id" };
    var q =
      "/messages/trace/" +
      encodeURIComponent(tid) +
      "?since=" +
      encodeURIComponent(String(since || 0));
    return request(q, { method: "GET" });
  }

  async function requestOtpImpl(phone, apiUrl) {
    var cfg = await getConfig();
    var res = await rawRequest(apiUrl || cfg.apiUrl, "/auth/otp/request", {
      method: "POST",
      body: { phone: phone }
    });
    // Normalize FastAPI detail string onto error for popup UX
    if (!res.ok && res.data && typeof res.data.detail === "string") {
      res.error = res.data.detail;
    }
    return res;
  }

  async function verifyOtpImpl(phone, code, orgName, apiUrl) {
    // Legacy web-style OTP — kept for bridge compatibility; popup uses seat tokens.
    var cfg = await getConfig();
    var res = await rawRequest(apiUrl || cfg.apiUrl, "/auth/otp/verify", {
      method: "POST",
      body: {
        phone: phone,
        code: code,
        org_name: orgName || ""
      }
    });
    if (!res.ok) {
      if (res.data && typeof res.data.detail === "string") {
        res.error = res.data.detail;
      }
      return res;
    }
    var token = res.data;
    await setConfig({
      enabled: true,
      apiUrl: apiUrl || cfg.apiUrl,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      orgId: token.org_id,
      phone: phone,
      role: cfg.role || "connector"
    });
    var me = await request("/auth/me", { method: "GET" });
    if (me.ok && me.data && me.data.org) {
      await setConfig({
        orgName: me.data.org.name,
        plan: me.data.org.plan
      });
    }
    return { ok: true, data: token };
  }

  async function activateSeatImpl(seatToken, apiUrl) {
    var cfg = await getConfig();
    var res = await rawRequest(apiUrl || cfg.apiUrl, "/seats/activate", {
      method: "POST",
      body: {
        token: String(seatToken || "").trim(),
        install_id: cfg.installId,
        device_id: cfg.deviceId,
        label_hint: ""
      }
    });
    if (!res.ok) {
      if (res.data && typeof res.data.detail === "string") {
        res.error = res.data.detail;
      }
      return res;
    }
    var token = res.data;
    var prefix = String(seatToken || "").trim().slice(0, 12);
    await setConfig({
      enabled: true,
      apiUrl: apiUrl || cfg.apiUrl,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      orgId: token.org_id,
      role: "connector",
      seatId: "",
      seatTokenPrefix: prefix,
      seatToken: String(seatToken || "").trim()
    });
    var me = await request("/auth/me", { method: "GET" });
    if (me.ok && me.data && me.data.org) {
      await setConfig({
        orgId: me.data.org.id || token.org_id,
        orgName: me.data.org.name || "",
        plan: me.data.org.plan || ""
      });
    }
    try {
      await request("/seats/heartbeat", { method: "POST", body: {} });
    } catch (_e) {}
    return { ok: true, data: token };
  }

  async function listAccountsImpl(channel) {
    var q = "/channels/accounts";
    if (channel) q += "?channel=" + encodeURIComponent(channel);
    return request(q, { method: "GET" });
  }

  async function createAccountImpl(label, phoneOrExternalId, channel) {
    var ch = channel || "whatsapp";
    var externalId = phoneOrExternalId || "";
    return request("/channels/accounts", {
      method: "POST",
      body: {
        channel: ch,
        label: label || (ch === "divar" ? "دیوار" : "واتساپ"),
        external_id: externalId,
        phone: ch === "whatsapp" ? externalId : ""
      }
    });
  }

  async function heartbeatImpl() {
    var cfg = await getConfig();
    if (!cfg.enabled || !cfg.accountId) return { ok: false, error: "no_account" };
    var deviceId = cfg.deviceId || cfg.installId || "ext-device";
    return request("/channels/heartbeat", {
      method: "POST",
      body: {
        account_id: cfg.accountId,
        device_id: deviceId,
        role: cfg.role || "connector"
      }
    });
  }

  async function claimJobsImpl(limit) {
    var cfg = await getConfig();
    if (!cfg.enabled || !cfg.accountId) return [];
    var q =
      "/channels/jobs/claim?account_id=" +
      encodeURIComponent(cfg.accountId) +
      "&device_id=" +
      encodeURIComponent(cfg.deviceId) +
      "&limit=" +
      (limit || 5);
    var res = await request(q, { method: "POST" });
    if (!res.ok) return [];
    return (res.data && res.data.jobs) || [];
  }

  async function completeJobImpl(jobId, ok, error) {
    return request(
      "/channels/jobs/" +
        encodeURIComponent(jobId) +
        "/complete?ok=" +
        (ok ? "true" : "false") +
        "&error=" +
        encodeURIComponent(error || ""),
      { method: "POST" }
    );
  }

  /** Background-only SSE client — pushes job_ready so we claim without 5s polling. */
  var _sse = {
    abort: null,
    accountId: "",
    running: false,
    backoffMs: 2000,
    onEvent: null
  };

  function parseSseChunk(buffer, onEvent) {
    var parts = buffer.split("\n\n");
    var rest = parts.pop() || "";
    for (var i = 0; i < parts.length; i++) {
      var block = parts[i];
      if (!block || block.charAt(0) === ":") continue;
      var eventName = "message";
      var dataLines = [];
      var lines = block.split("\n");
      for (var j = 0; j < lines.length; j++) {
        var line = lines[j];
        if (line.indexOf("event:") === 0) {
          eventName = line.slice(6).trim();
        } else if (line.indexOf("data:") === 0) {
          dataLines.push(line.slice(5).trim());
        }
      }
      if (!dataLines.length) continue;
      var raw = dataLines.join("\n");
      var data = {};
      try {
        data = JSON.parse(raw);
      } catch (_e) {
        data = { raw: raw };
      }
      if (typeof onEvent === "function") onEvent(eventName, data);
    }
    return rest;
  }

  async function stopSseEventsImpl() {
    _sse.running = false;
    if (_sse.abort) {
      try {
        _sse.abort.abort();
      } catch (_e) {}
    }
    _sse.abort = null;
    _sse.accountId = "";
    return { ok: true };
  }

  async function startSseEventsImpl(onEvent) {
    if (typeof onEvent === "function") _sse.onEvent = onEvent;
    if (_sse.running) return { ok: true, already: true };
    _sse.running = true;
    _sse.backoffMs = 2000;

    (async function loop() {
      while (_sse.running) {
        var cfg = await getConfig();
        if (!cfg.enabled || !cfg.accessToken || !cfg.orgId) {
          await new Promise(function (r) {
            setTimeout(r, 5000);
          });
          continue;
        }
        _sse.accountId = cfg.accountId || "";
        var ctrl = new AbortController();
        _sse.abort = ctrl;
        var url =
          String(cfg.apiUrl || DEFAULT_API).replace(/\/$/, "") +
          "/channels/events/stream?device_id=" +
          encodeURIComponent(cfg.deviceId || "");
        // Org-wide stream (covers WhatsApp + Divar accounts). Optional account filter unused.
        try {
          var res = await fetch(url, {
            method: "GET",
            headers: {
              Authorization: "Bearer " + cfg.accessToken,
              "X-Org-Id": cfg.orgId,
              Accept: "text/event-stream"
            },
            signal: ctrl.signal
          });
          if (res.status === 401 && (cfg.refreshToken || cfg.seatToken)) {
            var refreshed = await refreshAccessTokenImpl();
            if (refreshed && refreshed.ok) continue;
          }
          if (!res.ok || !res.body) {
            throw new Error("sse_http_" + res.status);
          }
          _sse.backoffMs = 2000;
          var reader = res.body.getReader();
          var decoder = new TextDecoder();
          var buf = "";
          while (_sse.running) {
            var chunk = await reader.read();
            if (chunk.done) break;
            buf += decoder.decode(chunk.value, { stream: true });
            buf = parseSseChunk(buf, function (ev, data) {
              if (_sse.onEvent) _sse.onEvent(ev, data);
            });
          }
        } catch (err) {
          if (ctrl.signal.aborted) {
            // stopped intentionally
          } else if (_sse.onEvent) {
            _sse.onEvent("sse_error", {
              error: String((err && err.message) || err)
            });
          }
        }
        if (!_sse.running) break;
        var wait = _sse.backoffMs;
        _sse.backoffMs = Math.min(30000, Math.floor(_sse.backoffMs * 1.6));
        await new Promise(function (r) {
          setTimeout(r, wait);
        });
      }
    })();

    return { ok: true };
  }

  async function ingestMessageImpl(payload) {
    var cfg = await getConfig();
    if (!cfg.enabled || !cfg.accountId) return { ok: false, error: "cloud_disabled" };
    return request("/messages/ingest", {
      method: "POST",
      body: Object.assign({ account_id: cfg.accountId }, payload || {})
    });
  }

  async function listLeadsImpl() {
    return request("/leads", { method: "GET" });
  }

  async function upsertLeadImpl(lead) {
    var cfg = await getConfig();
    if (!cfg.enabled) return { ok: false, error: "cloud_disabled" };
    var body = {
      name: lead.name || "",
      phone: lead.phone || "",
      group_id: lead.groupId || lead.group_id || "",
      external_chat_id: lead.externalChatId || lead.external_chat_id || "",
      post_token: lead.postToken || lead.post_token || "",
      source_channel: lead.sourceChannel || lead.source_channel || cfg.channel || "",
      chat_type: lead.chatType || lead.chat_type || "pv",
      tags: lead.tags || [],
      notes: lead.notes || "",
      account_id: cfg.accountId || null,
      chat_name: lead.name || lead.chatName || ""
    };
    // Only send stage / bot_paused when caller explicitly sets them (avoid resetting on every ingest)
    if (lead.stage != null && String(lead.stage).trim()) {
      body.stage = lead.stage;
    }
    if (typeof lead.botPaused === "boolean") {
      body.bot_paused = lead.botPaused;
    } else if (typeof lead.bot_paused === "boolean") {
      body.bot_paused = lead.bot_paused;
    }
    return request("/leads", {
      method: "POST",
      body: body
    });
  }

  async function statusImpl() {
    var cfg = await getConfig();
    // Fail closed — same conditions AuthGate expects
    if (!cfg.enabled) {
      return { connected: false, reason: "not_enabled", config: cfg };
    }
    if (!cfg.accessToken || String(cfg.accessToken).length <= 12) {
      return { connected: false, reason: "no_token", config: cfg };
    }
    if (!cfg.orgId || String(cfg.orgId).length <= 4) {
      return { connected: false, reason: "no_org", config: cfg };
    }
    var me = await request("/auth/me", { method: "GET" });
    if (!me.ok) {
      return { connected: false, reason: me.error || "auth_failed", config: cfg };
    }
    var org = me.data && me.data.org;
    if (!org || !(org.id || org.name)) {
      return { connected: false, reason: "invalid_session", config: cfg };
    }
    // Account/channel is bound later by the open tab — not part of login.
    var hb = cfg.accountId ? await heartbeatImpl() : { ok: true, error: "" };
    return {
      connected: true,
      heartbeatOk: !!hb.ok,
      me: me.data,
      config: cfg,
      heartbeatError: hb.ok ? "" : hb.error || ""
    };
  }

  /**
   * Bind the connector to a channel based on the open page.
   * Called by WA / Divar content scripts — never from the popup login UI.
   */
  async function ensureChannelAccountImpl(channel) {
    var ch = String(channel || "whatsapp").toLowerCase();
    if (ch !== "whatsapp" && ch !== "divar") ch = "whatsapp";
    var cfg = await getConfig();
    if (!cfg.enabled || !cfg.accessToken || !cfg.orgId) {
      return { ok: false, error: "not_logged_in" };
    }

    var list = await listAccountsImpl();
    if (!list.ok) {
      return { ok: false, error: list.error || "list_accounts_failed" };
    }
    var accounts = Array.isArray(list.data) ? list.data : [];
    var acc = null;
    for (var i = 0; i < accounts.length; i++) {
      if (accounts[i] && accounts[i].channel === ch) {
        acc = accounts[i];
        break;
      }
    }
    if (!acc) {
      var created = await createAccountImpl(
        ch === "divar" ? "دیوار" : "واتساپ",
        ch === "divar" ? "divar-auto" : cfg.phone || "",
        ch
      );
      if (!created.ok || !created.data) {
        return {
          ok: false,
          error:
            (created && created.data && created.data.detail) ||
            (created && created.error) ||
            "create_account_failed"
        };
      }
      acc = created.data;
    }

    await setConfig({
      enabled: true,
      accountId: acc.id,
      channel: ch,
      role: "connector"
    });
    var hb = await heartbeatImpl();
    if (!hb || !hb.ok) {
      // Retry once — first bind sometimes races storage write
      hb = await heartbeatImpl();
    }
    return {
      ok: true,
      channel: ch,
      account: acc,
      heartbeatOk: !!(hb && hb.ok),
      error: hb && hb.ok ? "" : (hb && hb.error) || "heartbeat_failed"
    };
  }

  var api = {
    getConfig: getConfig,
    setConfig: setConfig,
    requestOtp: wrap("requestOtp", requestOtpImpl),
    verifyOtp: wrap("verifyOtp", verifyOtpImpl),
    activateSeat: wrap("activateSeat", activateSeatImpl),
    listAccounts: wrap("listAccounts", listAccountsImpl),
    createAccount: wrap("createAccount", createAccountImpl),
    ensureChannelAccount: wrap("ensureChannelAccount", ensureChannelAccountImpl),
    heartbeat: wrap("heartbeat", heartbeatImpl),
    claimJobs: wrap("claimJobs", claimJobsImpl),
    completeJob: wrap("completeJob", completeJobImpl),
    ingestMessage: wrap("ingestMessage", ingestMessageImpl),
    upsertLead: wrap("upsertLead", upsertLeadImpl),
    listLeads: wrap("listLeads", listLeadsImpl),
    fetchTrace: wrap("fetchTrace", fetchTraceImpl),
    /** Background SW only — long-lived fetch stream. */
    startSseEvents: startSseEventsImpl,
    stopSseEvents: stopSseEventsImpl,
    status: wrap("status", statusImpl),
    /** Used by background only — never proxied. */
    __impl: {
      request: request,
      rawRequest: rawRequest,
      refreshAccessToken: refreshAccessTokenImpl,
      requestOtp: requestOtpImpl,
      verifyOtp: verifyOtpImpl,
      activateSeat: activateSeatImpl,
      listAccounts: listAccountsImpl,
      createAccount: createAccountImpl,
      ensureChannelAccount: ensureChannelAccountImpl,
      heartbeat: heartbeatImpl,
      claimJobs: claimJobsImpl,
      completeJob: completeJobImpl,
      ingestMessage: ingestMessageImpl,
      upsertLead: upsertLeadImpl,
      listLeads: listLeadsImpl,
      fetchTrace: fetchTraceImpl,
      startSseEvents: startSseEventsImpl,
      stopSseEvents: stopSseEventsImpl,
      status: statusImpl,
      getConfig: getConfig,
      setConfig: setConfig
    }
  };

  global.IranexpediaCloudBridge = api;
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this);
