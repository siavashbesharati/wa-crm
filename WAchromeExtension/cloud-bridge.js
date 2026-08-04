/**
 * Cloud bridge for B2B platform API.
 * Hybrid connector: auth, heartbeat, claim jobs, ingest, lead sync.
 *
 * Content scripts on https://web.whatsapp.com cannot call localhost/API
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
      cloudDeviceId: null
    });
    if (!data.cloudDeviceId) {
      data.cloudDeviceId = uuid();
      await chrome.storage.local.set({ cloudDeviceId: data.cloudDeviceId });
    }
    var cfg = data.cloudBridgeConfig || {};
    return {
      enabled: !!cfg.enabled,
      apiUrl: cfg.apiUrl || DEFAULT_API,
      accessToken: cfg.accessToken || "",
      refreshToken: cfg.refreshToken || "",
      orgId: cfg.orgId || "",
      accountId: cfg.accountId || "",
      role: cfg.role || "connector",
      phone: cfg.phone || "",
      orgName: cfg.orgName || "",
      plan: cfg.plan || "",
      deviceId: data.cloudDeviceId
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
        role: next.role,
        phone: next.phone,
        orgName: next.orgName,
        plan: next.plan
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
    return rawRequest(apiUrl || cfg.apiUrl, "/auth/otp/request", {
      method: "POST",
      body: { phone: phone }
    });
  }

  async function verifyOtpImpl(phone, code, orgName, apiUrl) {
    var cfg = await getConfig();
    var res = await rawRequest(apiUrl || cfg.apiUrl, "/auth/otp/verify", {
      method: "POST",
      body: {
        phone: phone,
        code: code,
        org_name: orgName || ""
      }
    });
    if (!res.ok) return res;
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

  async function listAccountsImpl() {
    return request("/whatsapp/accounts", { method: "GET" });
  }

  async function createAccountImpl(label, phone) {
    return request("/whatsapp/accounts", {
      method: "POST",
      body: { label: label || phone || "واتساپ", phone: phone || "" }
    });
  }

  async function heartbeatImpl() {
    var cfg = await getConfig();
    if (!cfg.enabled || !cfg.accountId) return { ok: false, error: "no_account" };
    return request("/whatsapp/heartbeat", {
      method: "POST",
      body: {
        account_id: cfg.accountId,
        device_id: cfg.deviceId,
        role: cfg.role || "connector"
      }
    });
  }

  async function claimJobsImpl(limit) {
    var cfg = await getConfig();
    if (!cfg.enabled || !cfg.accountId) return [];
    var q =
      "/whatsapp/jobs/claim?account_id=" +
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
      "/whatsapp/jobs/" +
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
    return request("/leads", {
      method: "POST",
      body: {
        name: lead.name || "",
        phone: lead.phone || "",
        group_id: lead.groupId || lead.group_id || "",
        chat_type: lead.chatType || lead.chat_type || "pv",
        stage: lead.stage || "جدید",
        tags: lead.tags || [],
        notes: lead.notes || "",
        bot_paused: !!lead.botPaused,
        account_id: cfg.accountId || null,
        chat_name: lead.name || ""
      }
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
    var hb = cfg.accountId ? await heartbeatImpl() : { ok: false, error: "no_account" };
    return {
      connected: true,
      heartbeatOk: !!hb.ok,
      me: me.data,
      config: cfg,
      heartbeatError: hb.ok ? "" : hb.error || ""
    };
  }

  var api = {
    getConfig: getConfig,
    setConfig: setConfig,
    requestOtp: wrap("requestOtp", requestOtpImpl),
    verifyOtp: wrap("verifyOtp", verifyOtpImpl),
    listAccounts: wrap("listAccounts", listAccountsImpl),
    createAccount: wrap("createAccount", createAccountImpl),
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
      listAccounts: listAccountsImpl,
      createAccount: createAccountImpl,
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
})(typeof globalThis !== "undefined" ? globalThis : window);
