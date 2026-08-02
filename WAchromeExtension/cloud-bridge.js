/**
 * Cloud bridge for B2B platform API.
 * Hybrid connector: heartbeat + claim outbound jobs + ingest inbound messages.
 */
(function (global) {
  var DEFAULT_API = "http://localhost:8000/api";
  var DEVICE_KEY = "cloudDeviceId";
  var CFG_KEY = "cloudBridgeConfig";

  function uuid() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
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
      orgId: cfg.orgId || "",
      accountId: cfg.accountId || "",
      role: cfg.role || "agent",
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
        orgId: next.orgId,
        accountId: next.accountId,
        role: next.role
      }
    });
    return next;
  }

  async function request(path, options) {
    var cfg = await getConfig();
    if (!cfg.enabled || !cfg.accessToken || !cfg.orgId) {
      return { ok: false, error: "cloud_disabled" };
    }
    var headers = {
      "Content-Type": "application/json",
      Authorization: "Bearer " + cfg.accessToken,
      "X-Org-Id": cfg.orgId
    };
    var res = await fetch(cfg.apiUrl.replace(/\/$/, "") + path, {
      method: (options && options.method) || "GET",
      headers: headers,
      body: options && options.body ? JSON.stringify(options.body) : undefined
    });
    var data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok) return { ok: false, error: data.detail || "http_error", data: data };
    return { ok: true, data: data };
  }

  async function heartbeat() {
    var cfg = await getConfig();
    if (!cfg.enabled || !cfg.accountId) return { ok: false, error: "no_account" };
    return request("/whatsapp/heartbeat", {
      method: "POST",
      body: {
        account_id: cfg.accountId,
        device_id: cfg.deviceId,
        role: cfg.role || "agent"
      }
    });
  }

  async function claimJobs(limit) {
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

  async function completeJob(jobId, ok, error) {
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

  async function ingestMessage(payload) {
    var cfg = await getConfig();
    if (!cfg.enabled || !cfg.accountId) return { ok: false };
    return request("/messages/ingest", {
      method: "POST",
      body: Object.assign({ account_id: cfg.accountId }, payload || {})
    });
  }

  global.IranexpediaCloudBridge = {
    getConfig: getConfig,
    setConfig: setConfig,
    heartbeat: heartbeat,
    claimJobs: claimJobs,
    completeJob: completeJob,
    ingestMessage: ingestMessage
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
