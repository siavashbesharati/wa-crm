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

  function isExtAlive() {
    try {
      return !!(chrome && chrome.runtime && chrome.runtime.id);
    } catch (_e) {
      return false;
    }
  }

  function storageGet(defaults) {
    return new Promise(function (resolve) {
      if (!isExtAlive()) {
        resolve(defaults || {});
        return;
      }
      try {
        chrome.storage.local.get(defaults, function (data) {
          if (chrome.runtime && chrome.runtime.lastError) {
            resolve(defaults || {});
            return;
          }
          resolve(data || defaults);
        });
      } catch (_e) {
        resolve(defaults || {});
      }
    });
  }

  function storageSet(patch) {
    return new Promise(function (resolve) {
      if (!isExtAlive()) {
        resolve();
        return;
      }
      try {
        chrome.storage.local.set(patch, function () {
          resolve();
        });
      } catch (_e) {
        resolve();
      }
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

  // Farsi/Arabic-compatible key (ي/ی, ك/ک, ZWNJ, NFC)
  function normalizeContactKey(name) {
    return String(name || "")
      .normalize("NFC")
      .replace(/[\u200c\u200d\ufeff]/g, "")
      .replace(/ي/g, "ی")
      .replace(/ك/g, "ک")
      .replace(/ة/g, "ه")
      .trim()
      .replace(/\s+/g, " ")
      .toLocaleLowerCase("fa-IR");
  }

  function contactIdFromName(name) {
    var key = normalizeContactKey(name);
    var h = 2166136261;
    for (var i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return "c_" + (h >>> 0).toString(36);
  }

  function namesMatch(a, b) {
    return normalizeContactKey(a) === normalizeContactKey(b);
  }

  function looksLikePhoneLocal(value) {
    var t = String(value || "").replace(/[\s\-()]/g, "");
    return /^\+?\d{8,15}$/.test(t);
  }

  function normalizePhoneLocal(value) {
    return String(value || "").replace(/[\s\-()]/g, "").trim();
  }

  async function upsertContact(partial) {
    var name = String((partial && partial.name) || "")
      .normalize("NFC")
      .replace(/[\u200c\u200d\ufeff]/g, "")
      .trim()
      .replace(/\s+/g, " ");
    if (!name) return null;
    var list = await getContacts();
    var id = partial.id || contactIdFromName(name);
    var phone = partial.phone
      ? String(partial.phone).replace(/[\s\-()]/g, "").trim()
      : "";
    var groupId = partial.groupId ? String(partial.groupId).trim() : "";
    var idx = list.findIndex(function (c) {
      if (c.id === id) return true;
      if (namesMatch(c.name, name)) return true;
      if (phone && c.phone && String(c.phone).replace(/[\s\-()]/g, "") === phone) {
        return true;
      }
      if (groupId && c.groupId && String(c.groupId) === groupId) {
        return true;
      }
      return false;
    });
    var now = Date.now();
    if (idx >= 0) {
      var prev = list[idx];
      var nextName = name || prev.name;
      // Upgrade placeholder name (was only a number) when a real display name arrives.
      if (
        name &&
        prev.name &&
        looksLikePhoneLocal(prev.name) &&
        !looksLikePhoneLocal(name)
      ) {
        nextName = name;
      } else if (namesMatch(prev.name, name)) {
        nextName = prev.name || name;
      } else if (name) {
        nextName = name;
      }
      list[idx] = Object.assign({}, prev, partial, {
        id: prev.id,
        name: nextName,
        phone: phone || prev.phone || "",
        groupId: groupId || prev.groupId || "",
        chatType: partial.chatType || prev.chatType || "pv",
        channel: partial.channel || prev.channel || "",
        updatedAt: now,
        lastMessageAt: partial.lastMessageAt || prev.lastMessageAt || now
      });
      await saveContacts(list);
      return list[idx];
    }
    var created = {
      id: id,
      name: name,
      phone: phone || "",
      groupId: groupId || "",
      chatType: partial.chatType || "pv",
      channel: partial.channel || "",
      tags: Array.isArray(partial.tags) ? partial.tags : [],
      stage: partial.stage || STAGES[0],
      notes: partial.notes || "",
      botPaused: !!partial.botPaused,
      updatedAt: now,
      createdAt: now,
      lastMessageAt: partial.lastMessageAt || now
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
    var key = normalizeContactKey(n);
    var list = await getContacts();
    return (
      list.find(function (c) {
        return normalizeContactKey(c.name) === key;
      }) || null
    );
  }

  async function getContactByPhone(phone) {
    var p = normalizePhoneLocal(phone);
    if (!p || p.length < 8) return null;
    var list = await getContacts();
    return (
      list.find(function (c) {
        return normalizePhoneLocal(c.phone) === p;
      }) || null
    );
  }

  async function getContactById(id) {
    var list = await getContacts();
    return (
      list.find(function (c) {
        return c.id === id;
      }) || null
    );
  }

  async function getEventsForContact(name) {
    var key = normalizeContactKey(name);
    if (!key) return [];
    var list = await getEvents();
    return list.filter(function (e) {
      var metaName = e.meta && e.meta.contactName ? e.meta.contactName : "";
      var msg = String(e.message || "");
      if (metaName && normalizeContactKey(metaName) === key) return true;
      if (msg.indexOf(String(name || "").trim()) !== -1) return true;
      // Farsi-normalized contains check against message
      return normalizeContactKey(msg).indexOf(key) !== -1;
    });
  }

  async function setContactStage(id, stage) {
    var contact = await getContactById(id);
    if (!contact) return null;
    var nextStage = String(stage || "").trim() || STAGES[0];
    if (contact.stage === nextStage) return contact;
    var updated = await updateContact(id, { stage: nextStage });
    await addEvent(
      "stage_change",
      "مرحله «" + contact.name + "»: " + (contact.stage || "-") + " ← " + nextStage,
      { contactName: contact.name, contactId: id, from: contact.stage, to: nextStage }
    );
    return updated;
  }

  async function saveContactDetails(id, patch) {
    var contact = await getContactById(id);
    if (!contact) return null;
    var nextName =
      patch.name != null
        ? String(patch.name)
            .normalize("NFC")
            .replace(/[\u200c\u200d\ufeff]/g, "")
            .trim()
            .replace(/\s+/g, " ")
        : contact.name;
    if (!nextName) nextName = contact.name;
    var next = {
      name: nextName,
      stage: patch.stage != null ? patch.stage : contact.stage,
      tags: Array.isArray(patch.tags) ? patch.tags : contact.tags,
      notes: patch.notes != null ? String(patch.notes) : contact.notes,
      botPaused: patch.botPaused != null ? !!patch.botPaused : contact.botPaused,
      phone:
        patch.phone != null
          ? normalizePhoneLocal(patch.phone)
          : contact.phone || "",
      groupId: patch.groupId != null ? String(patch.groupId) : contact.groupId || ""
    };
    var stageChanged = next.stage && next.stage !== contact.stage;
    var updated = await updateContact(id, next);
    if (stageChanged) {
      await addEvent(
        "stage_change",
        "مرحله «" + nextName + "»: " + (contact.stage || "-") + " ← " + next.stage,
        {
          contactName: nextName,
          contactId: id,
          from: contact.stage,
          to: next.stage
        }
      );
    } else {
      await addEvent("contact_update", "به‌روزرسانی مخاطب: " + nextName, {
        contactName: nextName,
        contactId: id
      });
    }
    return updated;
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
    normalizeContactKey: normalizeContactKey,
    namesMatch: namesMatch,
    getSettings: getSettings,
    saveSettings: saveSettings,
    getContacts: getContacts,
    saveContacts: saveContacts,
    upsertContact: upsertContact,
    updateContact: updateContact,
    deleteContact: deleteContact,
    getContactByName: getContactByName,
    getContactByPhone: getContactByPhone,
    getContactById: getContactById,
    getEventsForContact: getEventsForContact,
    setContactStage: setContactStage,
    saveContactDetails: saveContactDetails,
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
    applyTemplateVars: applyTemplateVars,
    isWithinBusinessHours: isWithinBusinessHours,
    countSendsInLastHour: countSendsInLastHour,
    acceptRisk: acceptRisk
  };
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this);
