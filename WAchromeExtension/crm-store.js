(function (global) {
  var STAGES = ["جدید", "پیگیری", "پیشنهاد", "خرید", "بسته"];
  var MAX_EVENTS = 300;
  var DEFAULT_SETTINGS = {
    maxPerHour: 20,
    minDelayMs: 2500,
    maxDelayMs: 5000,
    riskAcceptedAt: null,
    businessHours: {
      enabled: false,
      start: "09:00",
      end: "18:00",
      awayMessage: "خارج از ساعات پاسخگویی هستیم. به‌زودی پاسخ می‌دهیم."
    }
  };

  function uid(prefix) {
    return (
      (prefix || "id") +
      "_" +
      Date.now().toString(36) +
      "_" +
      Math.random().toString(36).slice(2, 8)
    );
  }

  function storageGet(defaults) {
    return new Promise(function (resolve) {
      chrome.storage.local.get(defaults, function (data) {
        resolve(data || defaults);
      });
    });
  }

  function storageSet(patch) {
    return new Promise(function (resolve) {
      chrome.storage.local.set(patch, function () {
        resolve();
      });
    });
  }

  function normalizeSettings(raw) {
    var s = Object.assign({}, DEFAULT_SETTINGS, raw || {});
    s.businessHours = Object.assign(
      {},
      DEFAULT_SETTINGS.businessHours,
      (raw && raw.businessHours) || {}
    );
    s.maxPerHour = Math.max(1, Number(s.maxPerHour) || 20);
    s.minDelayMs = Math.max(500, Number(s.minDelayMs) || 2500);
    s.maxDelayMs = Math.max(s.minDelayMs, Number(s.maxDelayMs) || 5000);
    return s;
  }

  async function getSettings() {
    var data = await storageGet({ crmSettings: DEFAULT_SETTINGS });
    return normalizeSettings(data.crmSettings);
  }

  async function saveSettings(next) {
    var normalized = normalizeSettings(next);
    await storageSet({ crmSettings: normalized });
    return normalized;
  }

  async function getContacts() {
    var data = await storageGet({ crmContacts: [] });
    return Array.isArray(data.crmContacts) ? data.crmContacts : [];
  }

  async function saveContacts(list) {
    await storageSet({ crmContacts: list || [] });
    return list || [];
  }

  function contactIdFromName(name) {
    return "c_" + String(name || "").trim().toLowerCase();
  }

  async function upsertContact(partial) {
    var name = String((partial && partial.name) || "").trim();
    if (!name) return null;
    var list = await getContacts();
    var id = partial.id || contactIdFromName(name);
    var idx = list.findIndex(function (c) {
      return c.id === id || String(c.name).trim() === name;
    });
    var now = Date.now();
    if (idx >= 0) {
      list[idx] = Object.assign({}, list[idx], partial, {
        id: list[idx].id,
        name: name,
        updatedAt: now
      });
      await saveContacts(list);
      return list[idx];
    }
    var created = {
      id: id,
      name: name,
      phone: partial.phone || "",
      chatType: partial.chatType || "pv",
      tags: Array.isArray(partial.tags) ? partial.tags : [],
      stage: partial.stage || STAGES[0],
      notes: partial.notes || "",
      botPaused: !!partial.botPaused,
      updatedAt: now,
      createdAt: now
    };
    list.unshift(created);
    await saveContacts(list);
    return created;
  }

  async function updateContact(id, patch) {
    var list = await getContacts();
    var idx = list.findIndex(function (c) {
      return c.id === id;
    });
    if (idx < 0) return null;
    list[idx] = Object.assign({}, list[idx], patch, { updatedAt: Date.now() });
    await saveContacts(list);
    return list[idx];
  }

  async function deleteContact(id) {
    var list = await getContacts();
    var next = list.filter(function (c) {
      return c.id !== id;
    });
    await saveContacts(next);
    return next;
  }

  async function getContactByName(name) {
    var n = String(name || "").trim();
    if (!n) return null;
    var list = await getContacts();
    return (
      list.find(function (c) {
        return String(c.name).trim() === n;
      }) || null
    );
  }

  async function getTemplates() {
    var data = await storageGet({ crmTemplates: [] });
    return Array.isArray(data.crmTemplates) ? data.crmTemplates : [];
  }

  async function saveTemplates(list) {
    await storageSet({ crmTemplates: list || [] });
    return list || [];
  }

  async function addTemplate(title, body) {
    var list = await getTemplates();
    var item = {
      id: uid("tpl"),
      title: String(title || "").trim() || "قالب",
      body: String(body || "").trim(),
      createdAt: Date.now()
    };
    list.unshift(item);
    await saveTemplates(list);
    return item;
  }

  async function deleteTemplate(id) {
    var list = await getTemplates();
    var next = list.filter(function (t) {
      return t.id !== id;
    });
    await saveTemplates(next);
    return next;
  }

  async function getTasks() {
    var data = await storageGet({ crmTasks: [] });
    return Array.isArray(data.crmTasks) ? data.crmTasks : [];
  }

  async function saveTasks(list) {
    await storageSet({ crmTasks: list || [] });
    return list || [];
  }

  async function addTask(input) {
    var list = await getTasks();
    var task = {
      id: uid("task"),
      targetName: String(input.targetName || "").trim(),
      targetType: input.targetType || "pv",
      message: String(input.message || "").trim(),
      runAt: Number(input.runAt) || Date.now(),
      status: "queued",
      attempts: 0,
      lastError: "",
      createdAt: Date.now()
    };
    list.unshift(task);
    await saveTasks(list);
    return task;
  }

  async function updateTask(id, patch) {
    var list = await getTasks();
    var idx = list.findIndex(function (t) {
      return t.id === id;
    });
    if (idx < 0) return null;
    list[idx] = Object.assign({}, list[idx], patch);
    await saveTasks(list);
    return list[idx];
  }

  async function cancelTask(id) {
    return updateTask(id, { status: "cancelled", lastError: "" });
  }

  async function getQueuedCount() {
    var list = await getTasks();
    return list.filter(function (t) {
      return t.status === "queued" || t.status === "running";
    }).length;
  }

  async function getEvents() {
    var data = await storageGet({ crmEvents: [] });
    return Array.isArray(data.crmEvents) ? data.crmEvents : [];
  }

  async function addEvent(type, message, meta) {
    var list = await getEvents();
    list.unshift({
      id: uid("evt"),
      type: type || "info",
      message: String(message || ""),
      meta: meta || {},
      at: Date.now()
    });
    if (list.length > MAX_EVENTS) list = list.slice(0, MAX_EVENTS);
    await storageSet({ crmEvents: list });
    return list[0];
  }

  async function clearEvents() {
    await storageSet({ crmEvents: [] });
  }

  async function getKeywordRules() {
    var data = await storageGet({ keywordRules: [] });
    return Array.isArray(data.keywordRules) ? data.keywordRules : [];
  }

  async function saveKeywordRules(list) {
    await storageSet({ keywordRules: list || [] });
    return list || [];
  }

  function applyTemplateVars(body, vars) {
    var out = String(body || "");
    var map = vars || {};
    Object.keys(map).forEach(function (key) {
      out = out.split("{" + key + "}").join(String(map[key] == null ? "" : map[key]));
    });
    return out;
  }

  function isWithinBusinessHours(settings, nowMs) {
    var bh = (settings && settings.businessHours) || DEFAULT_SETTINGS.businessHours;
    if (!bh.enabled) return true;
    var d = new Date(nowMs || Date.now());
    var hh = d.getHours();
    var mm = d.getMinutes();
    var cur = hh * 60 + mm;
    var startParts = String(bh.start || "09:00").split(":");
    var endParts = String(bh.end || "18:00").split(":");
    var start = Number(startParts[0]) * 60 + Number(startParts[1] || 0);
    var end = Number(endParts[0]) * 60 + Number(endParts[1] || 0);
    if (start <= end) return cur >= start && cur <= end;
    return cur >= start || cur <= end;
  }

  async function countSendsInLastHour() {
    var events = await getEvents();
    var since = Date.now() - 60 * 60 * 1000;
    return events.filter(function (e) {
      return (
        e.at >= since &&
        (e.type === "scheduled_sent" || e.type === "manual_sent" || e.type === "auto_reply")
      );
    }).length;
  }

  async function acceptRisk() {
    var settings = await getSettings();
    settings.riskAcceptedAt = Date.now();
    return saveSettings(settings);
  }

  global.IranexpediaCrm = {
    STAGES: STAGES,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    uid: uid,
    getSettings: getSettings,
    saveSettings: saveSettings,
    getContacts: getContacts,
    saveContacts: saveContacts,
    upsertContact: upsertContact,
    updateContact: updateContact,
    deleteContact: deleteContact,
    getContactByName: getContactByName,
    getTemplates: getTemplates,
    saveTemplates: saveTemplates,
    addTemplate: addTemplate,
    deleteTemplate: deleteTemplate,
    getTasks: getTasks,
    saveTasks: saveTasks,
    addTask: addTask,
    updateTask: updateTask,
    cancelTask: cancelTask,
    getQueuedCount: getQueuedCount,
    getEvents: getEvents,
    addEvent: addEvent,
    clearEvents: clearEvents,
    getKeywordRules: getKeywordRules,
    saveKeywordRules: saveKeywordRules,
    applyTemplateVars: applyTemplateVars,
    isWithinBusinessHours: isWithinBusinessHours,
    countSendsInLastHour: countSendsInLastHour,
    acceptRisk: acceptRisk
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
