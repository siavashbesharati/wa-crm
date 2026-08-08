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
        seatTokenPrefix: next.seatTokenPrefix || ""
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
    var res = await fetch(String(apiUrl || DEFAULT_API).replace(/\/$/, "") + path, {
      method: options.method || "GET",
      headers: headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    var data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok) {
      return {
        ok: false,
        error: data.detail || data.message || "http_error",
        data: data,
        status: res.status
      };
    }
    return { ok: true, data: data, status: res.status };
  }

  async function request(path, options) {
    var cfg = await getConfig();
    if (!cfg.enabled || !cfg.accessToken || !cfg.orgId) {
      return { ok: false, error: "cloud_disabled" };
    }
    return rawRequest(cfg.apiUrl, path, {
      method: options && options.method,
      body: options && options.body,
      headers: {
        Authorization: "Bearer " + cfg.accessToken,
        "X-Org-Id": cfg.orgId
      }
    });
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
      seatTokenPrefix: prefix
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

  async function ingestMessageImpl(payload) {
    var cfg = await getConfig();
    if (!cfg.enabled || !cfg.accountId) return { ok: false, error: "cloud_disabled" };
    return request("/messages/ingest", {
      method: "POST",
      body: Object.assign({ account_id: cfg.accountId }, payload || {})
    });
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
    var accounts = list.ok && Array.isArray(list.data) ? list.data : [];
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
    status: wrap("status", statusImpl),
    /** Used by background only — never proxied. */
    __impl: {
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
      status: statusImpl,
      getConfig: getConfig,
      setConfig: setConfig
    }
  };

  global.IranexpediaCloudBridge = api;
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this);
