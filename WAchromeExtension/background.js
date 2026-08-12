/**
 * Trusted time + CRM task scheduler dispatcher + cloud bridge.
 */

importScripts("reply-trace.js", "cloud-bridge.js", "auth-gate.js");

var SWEEP_ALARM = "crm_task_sweep";
var CLOUD_ALARM = "cloud_bridge_poll";
var lastCloudContactSyncAt = 0;

async function requireCloudAuth(force) {
  try {
    if (typeof IranexpediaAuthGate === "undefined") return false;
    var res = await IranexpediaAuthGate.verify(!!force);
    return !!(res && res.ok && IranexpediaAuthGate.assertUnlocked());
  } catch (_e) {
    return false;
  }
}

function alarmNameForTask(taskId) {
  return "crm_task_" + taskId;
}

async function storageGet(defaults) {
  return chrome.storage.local.get(defaults);
}

async function storageSet(patch) {
  return chrome.storage.local.set(patch);
}

async function getTasks() {
  var data = await storageGet({ crmTasks: [] });
  return Array.isArray(data.crmTasks) ? data.crmTasks : [];
}

async function saveTasks(list) {
  await storageSet({ crmTasks: list || [] });
  return list || [];
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

async function addEvent(type, message, meta) {
  var data = await storageGet({ crmEvents: [] });
  var list = Array.isArray(data.crmEvents) ? data.crmEvents : [];
  list.unshift({
    id: "evt_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6),
    type: type || "info",
    message: String(message || ""),
    meta: meta || {},
    at: Date.now()
  });
  if (list.length > 300) list = list.slice(0, 300);
  await storageSet({ crmEvents: list });
}

async function findWhatsAppTab() {
  var tabs = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
  if (!tabs || !tabs.length) return null;
  return tabs[0];
}

async function findDivarTab() {
  var tabs = await chrome.tabs.query({
    url: [
      "https://divar.ir/chat",
      "https://divar.ir/chat/*",
      "https://chat.divar.ir/*",
      "https://chat.divar.ir/chat",
      "https://chat.divar.ir/chat/*"
    ]
  });
  if (!tabs || !tabs.length) return null;
  return tabs[0];
}

function taskChannel(task) {
  var ch = String((task && task.channel) || "").toLowerCase();
  if (ch === "divar" || ch === "whatsapp") return ch;
  return "whatsapp";
}

async function findChannelTab(channel) {
  if (channel === "divar") return findDivarTab();
  return findWhatsAppTab();
}

async function openContactChat(targetName) {
  var name = String(targetName || "").trim();
  if (!name) return { ok: false, error: "نام مخاطب خالی است." };
  var tab = await findWhatsAppTab();
  if (!tab) {
    return { ok: false, error: "واتساپ وب باز نیست. ابتدا web.whatsapp.com را باز کنید." };
  }
  try {
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId != null) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    var res = await chrome.tabs.sendMessage(tab.id, {
      type: "openContactChat",
      targetName: name
    });
    if (res && res.ok) {
      await addEvent("contact_open", "باز کردن چت: " + name, { contactName: name });
      return { ok: true };
    }
    return {
      ok: false,
      error: (res && res.error) || "چت پیدا نشد یا باز نشد."
    };
  } catch (err) {
    return {
      ok: false,
      error: "ارتباط با صفحه واتساپ برقرار نشد. صفحه را تازه کنید."
    };
  }
}

async function sendTemplateNow(targetName, message) {
  var name = String(targetName || "").trim();
  var msg = String(message || "").trim();
  if (!name || !msg) {
    return { ok: false, error: "نام مخاطب و متن پیام الزامی است." };
  }
  var tab = await findWhatsAppTab();
  if (!tab) {
    return { ok: false, error: "واتساپ وب باز نیست. ابتدا web.whatsapp.com را باز کنید." };
  }
  try {
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId != null) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    var res = await chrome.tabs.sendMessage(tab.id, {
      type: "sendTemplateNow",
      targetName: name,
      message: msg
    });
    if (res && res.ok) {
      await addEvent("manual_sent", "ارسال قالب به «" + name + "»", {
        contactName: name,
        text: msg.slice(0, 120)
      });
      return { ok: true };
    }
    return {
      ok: false,
      error: (res && res.error) || "ارسال انجام نشد."
    };
  } catch (err) {
    return {
      ok: false,
      error: "ارتباط با صفحه واتساپ برقرار نشد. صفحه را تازه کنید."
    };
  }
}

async function getRunnerHealth() {
  var tab = await findWhatsAppTab();
  var tasks = await getTasks();
  var queued = tasks.filter(function (t) {
    return t.status === "queued" || t.status === "running";
  }).length;
  return {
    ok: true,
    waOpen: !!tab,
    tabId: tab ? tab.id : null,
    queued: queued
  };
}

async function ensureSweepAlarm() {
  await chrome.alarms.create(SWEEP_ALARM, { periodInMinutes: 1 });
}

async function scheduleAlarmForTask(task) {
  if (!task || !task.id) return;
  var when = Math.max(Date.now() + 1000, Number(task.runAt) || Date.now());
  await chrome.alarms.create(alarmNameForTask(task.id), { when: when });
}

async function clearAlarmForTask(taskId) {
  await chrome.alarms.clear(alarmNameForTask(taskId));
}

async function scheduleTaskFromMessage(input) {
  var targetName = String((input && input.targetName) || "").trim();
  var message = String((input && input.message) || "").trim();
  var runAt = Number(input && input.runAt) || 0;
  var targetType = (input && input.targetType) || "pv";
  var channel = taskChannel(input);

  if (!targetName || !message) {
    return { ok: false, error: "هدف و متن پیام الزامی است." };
  }
  if (!runAt || runAt < Date.now() - 60000) {
    return { ok: false, error: "زمان ارسال معتبر نیست." };
  }

  var list = await getTasks();
  var task = {
    id:
      "task_" +
      Date.now().toString(36) +
      "_" +
      Math.random().toString(36).slice(2, 8),
    targetName: targetName,
    targetType: targetType,
    channel: channel,
    message: message,
    runAt: runAt,
    status: "queued",
    attempts: 0,
    lastError: "",
    createdAt: Date.now()
  };
  list.unshift(task);
  await saveTasks(list);
  await scheduleAlarmForTask(task);
  await ensureSweepAlarm();
  await addEvent(
    "schedule",
    "زمان‌بندی برای «" + targetName + "» در " + new Date(runAt).toLocaleString("fa-IR"),
    { taskId: task.id }
  );
  return { ok: true, task: task };
}

async function cancelTaskFromMessage(taskId) {
  var task = await updateTask(taskId, {
    status: "cancelled",
    lastError: ""
  });
  await clearAlarmForTask(taskId);
  if (task) {
    await addEvent("schedule_cancel", "لغو زمان‌بندی: " + task.targetName, {
      taskId: taskId
    });
  }
  return { ok: true };
}

async function sendTaskToContent(task) {
  var channel = taskChannel(task);
  var tab = channel === "divar" ? await findDivarTab() : await findWhatsAppTab();
  if (!tab) {
    var closedMsg =
      channel === "divar"
        ? "چت دیوار باز نیست. تب divar.ir/chat را باز بگذارید."
        : "واتساپ وب باز نیست. تب web.whatsapp.com را باز بگذارید.";
    await updateTask(task.id, {
      status: "failed",
      lastError: closedMsg
    });
    await addEvent(
      "scheduled_fail",
      "ارسال ناموفق (تب بسته): " + task.targetName,
      { taskId: task.id, channel: channel }
    );
    return { ok: false, error: channel === "divar" ? "divar_closed" : "wa_closed" };
  }

  await updateTask(task.id, {
    status: "running",
    attempts: (task.attempts || 0) + 1
  });

  try {
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId != null) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    var res = await chrome.tabs.sendMessage(
      tab.id,
      channel === "divar"
        ? {
            type: "runScheduledTask",
            task: task,
            chatId: task.targetName,
            targetName: task.targetName,
            message: task.message
          }
        : {
            type: "runScheduledTask",
            task: task
          }
    );
    if (res && res.ok) {
      await updateTask(task.id, {
        status: "sent",
        lastError: ""
      });
      await addEvent(
        "scheduled_sent",
        "ارسال زمان‌بندی‌شده به «" + task.targetName + "»",
        { taskId: task.id, channel: channel }
      );
      await clearAlarmForTask(task.id);
      return { ok: true };
    }

    var err =
      (res && res.error) || "ارسال انجام نشد. چت پیدا نشد یا آماده نبود.";
    var attempts = (task.attempts || 0) + 1;
    var retry = attempts < 3;
    await updateTask(task.id, {
      status: retry ? "queued" : "failed",
      attempts: attempts,
      lastError: err,
      runAt: retry ? Date.now() + 2 * 60 * 1000 : task.runAt
    });
    if (retry) {
      var list = await getTasks();
      var t = list.find(function (x) {
        return x.id === task.id;
      });
      if (t) await scheduleAlarmForTask(t);
      await addEvent("scheduled_retry", "تلاش مجدد: " + task.targetName + " — " + err, {
        taskId: task.id
      });
    } else {
      await addEvent("scheduled_fail", "ناموفق: " + task.targetName + " — " + err, {
        taskId: task.id
      });
      await clearAlarmForTask(task.id);
    }
    return { ok: false, error: err };
  } catch (err) {
    var msg = String((err && err.message) || err);
    await updateTask(task.id, {
      status: "failed",
      lastError:
        channel === "divar"
          ? "ارتباط با صفحه دیوار برقرار نشد. صفحه چت را تازه کنید."
          : "ارتباط با صفحه واتساپ برقرار نشد. صفحه را تازه کنید."
    });
    await addEvent("scheduled_fail", "خطا: " + task.targetName + " — " + msg, {
      taskId: task.id
    });
    await clearAlarmForTask(task.id);
    return { ok: false, error: msg };
  }
}

async function runDueTasks() {
  var now = Date.now();
  var list = await getTasks();
  var due = list.filter(function (t) {
    return t.status === "queued" && Number(t.runAt) <= now + 1500;
  });
  due.sort(function (a, b) {
    return a.runAt - b.runAt;
  });

  for (var i = 0; i < due.length; i++) {
    await sendTaskToContent(due[i]);
  }
  return { ok: true, ran: due.length };
}

async function fetchTrustedTime() {
  var endpoints = [
    "https://worldtimeapi.org/api/timezone/Etc/UTC",
    "https://timeapi.io/api/Time/current/zone?timeZone=UTC"
  ];

  for (var i = 0; i < endpoints.length; i++) {
    try {
      var res = await fetch(endpoints[i], { cache: "no-store" });
      if (!res.ok) continue;
      var data = await res.json();

      if (data.unixtime) {
        return {
          ok: true,
          nowMs: Number(data.unixtime) * 1000,
          source: "worldtimeapi"
        };
      }

      if (data.dateTime) {
        var ms = Date.parse(data.dateTime);
        if (!Number.isNaN(ms)) {
          return { ok: true, nowMs: ms, source: "timeapi.io" };
        }
      }
    } catch (_err) {
      // next
    }
  }

  try {
    var res2 = await fetch("https://www.cloudflare.com/cdn-cgi/trace", {
      cache: "no-store"
    });
    var text = await res2.text();
    var match = text.match(/ts=(\d+)/);
    if (match) {
      return {
        ok: true,
        nowMs: Number(match[1]) * 1000,
        source: "cloudflare-trace"
      };
    }
  } catch (_err2) {
    // ignore
  }

  return { ok: false, error: "network_time_unavailable" };
}

chrome.runtime.onInstalled.addListener(function () {
  ensureSweepAlarm();
  chrome.alarms.create(CLOUD_ALARM, { periodInMinutes: 1 });
  pollCloudBridge();
});

chrome.runtime.onStartup.addListener(function () {
  ensureSweepAlarm();
  chrome.alarms.create(CLOUD_ALARM, { periodInMinutes: 1 });
  pollCloudBridge();
});

ensureSweepAlarm();
chrome.alarms.create(CLOUD_ALARM, { periodInMinutes: 1 });
// Kick sync soon after SW wakes (don't wait a full minute).
setTimeout(function () {
  pollCloudBridge();
}, 3000);

chrome.alarms.onAlarm.addListener(function (alarm) {
  if (!alarm || !alarm.name) return;
  if (alarm.name === CLOUD_ALARM) {
    pollCloudBridge();
    return;
  }
  if (alarm.name === SWEEP_ALARM) {
    runDueTasks();
    return;
  }
  if (alarm.name.indexOf("crm_task_") === 0) {
    runDueTasks();
  }
});

// ---------------------------------------------------------------------------
// Divar Event Sourcing bridge (MAIN world inject.js → content-bridge → here)
// ---------------------------------------------------------------------------
var DIVAR_CHAT_EVENT = "DIVAR_AUTO_CHAT_EVENT";
var DIVAR_HOOK_FAILED = "DIVAR_AUTO_HOOK_FAILED";
/** In-memory dedupe of inbound Divar message ids (SW lifetime). */
var divarSeenMessageIds = new Set();
var DIVAR_SEEN_MAX = 2000;

/**
 * Placeholder for future Divar auto-reply / cloud ingest automation.
 * @param {string} chatId
 * @param {object} messageData  engine payload.message
 * @returns {Promise<{ok:boolean, error?:string, ingested?:boolean}>}
 */
async function handleNewIncomingMessage(chatId, messageData) {
  try {
    var body = String((messageData && messageData.data) || "").trim();
    if (!chatId || !body) {
      return { ok: false, error: "empty_chat_or_body" };
    }
    // Skip Divar bot / system noise if flagged
    if (messageData && messageData.isBot === true) {
      return { ok: true, ingested: false, skipped: "bot" };
    }

    if (!(await requireCloudAuth(false))) {
      console.log("[DivarAuto:bg] skip ingest — auth required");
      return { ok: false, error: "auth_required" };
    }

    try {
      await IranexpediaCloudBridge.ensureChannelAccount("divar");
    } catch (_e) {}

    var externalId =
      messageData && messageData.id != null
        ? String(messageData.id)
        : String(chatId) +
          ":" +
          String((messageData && messageData.time) || "") +
          ":" +
          body.slice(0, 40);

    var ing = await IranexpediaCloudBridge.ingestMessage({
      chat_name: String(chatId),
      body: body,
      direction: "inbound",
      external_chat_id: String(chatId),
      // Same id CRM panel stores as phone — merges into existing inbox lead
      phone: String(chatId),
      post_token: "",
      ad_title: "",
      chat_type: "pv",
      sender_type: "customer",
      external_message_id: externalId
    });

    if (ing && ing.ok) {
      console.log(
        "[DivarAuto:bg] ingest OK → messages + AI pipeline",
        "chatId=",
        chatId,
        "id=",
        externalId,
        "data=",
        body.slice(0, 80)
      );
      return { ok: true, ingested: true, external_message_id: externalId };
    }

    console.warn(
      "[DivarAuto:bg] ingest FAIL",
      (ing && ing.error) || "unknown",
      chatId
    );
    return { ok: false, error: (ing && ing.error) || "ingest_failed" };
  } catch (err) {
    console.warn("[DivarAuto:bg] handleNewIncomingMessage error:", err);
    return { ok: false, error: String((err && err.message) || err) };
  }
}

function rememberDivarMessageId(id) {
  if (!id) return false;
  if (divarSeenMessageIds.has(id)) return false;
  divarSeenMessageIds.add(id);
  if (divarSeenMessageIds.size > DIVAR_SEEN_MAX) {
    // Drop oldest-ish entries (Set iteration order = insertion order).
    var drop = divarSeenMessageIds.size - DIVAR_SEEN_MAX;
    var it = divarSeenMessageIds.values();
    for (var i = 0; i < drop; i++) {
      var next = it.next();
      if (next.done) break;
      divarSeenMessageIds.delete(next.value);
    }
  }
  return true;
}

/**
 * @returns {Promise<{ok:boolean, ingested?:boolean, error?:string, duplicate?:boolean}>}
 */
async function onDivarChatEvent(message) {
  try {
    var ev = message && message.event;
    var payload = ev && ev.payload;
    if (!payload || typeof payload !== "object") {
      return { ok: true, ingested: false, skipped: "no_payload" };
    }

    // Only peer-authored chat messages count as "new incoming".
    // Other payload.type values (FULL_SYNC, typing, …) are intentionally ignored here.
    if (payload.type !== "message") {
      return { ok: true, ingested: false, skipped: "not_message" };
    }
    var msg = payload.message;
    if (!msg) {
      return { ok: true, ingested: false, skipped: "not_peer" };
    }
    // Divar uses peer:true for counterpart. Some envelopes omit it; treat
    // explicit peer:false / sendPhase pending-own as not inbound.
    if (msg.peer === false || msg.peer === "false") {
      return { ok: true, ingested: false, skipped: "not_peer" };
    }
    if (msg.peer !== true && msg.peer !== "true") {
      // Without peer flag, only accept if clearly not our own outgoing draft
      if (msg.sendPhase === "pending" || msg.sendPhase === "sending") {
        return { ok: true, ingested: false, skipped: "not_peer" };
      }
      // Require peer===true for reliability — closed-chat events should still set it
      return { ok: true, ingested: false, skipped: "not_peer" };
    }

    var mid = msg.id != null ? String(msg.id) : "";
    if (!mid) return { ok: false, error: "missing_message_id" };
    if (!rememberDivarMessageId(mid)) {
      return { ok: true, ingested: false, duplicate: true };
    }

    var chatId = msg.chatId != null ? String(msg.chatId) : "";
    return await handleNewIncomingMessage(chatId, msg);
  } catch (err) {
    console.warn("[DivarAuto:bg] onDivarChatEvent error (non-fatal):", err);
    return { ok: false, error: String((err && err.message) || err) };
  }
}

chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
  if (!message || !message.type) return;

  if (message.type === DIVAR_CHAT_EVENT) {
    onDivarChatEvent(message).then(sendResponse);
    return true;
  }

  if (message.type === DIVAR_HOOK_FAILED) {
    console.warn(
      "[DivarAuto:bg] MAIN-world webpack hook failed — Divar reliable stream inactive.",
      "reason=",
      message.reason,
      "detail=",
      message.detail || "",
      "moduleId=",
      message.moduleId,
      "| Update WAchromeExtension/inject.js after checking Divar's bundle."
    );
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "getTrustedTime") {
    fetchTrustedTime().then(sendResponse);
    return true;
  }

  if (message.type === "openDashboard") {
    // Business CRM panel (not super-admin /super)
    chrome.tabs.create({ url: "http://localhost:3000/home" });
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "openDivarChat") {
    chrome.tabs.create({ url: "https://divar.ir/chat" });
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "focusOrOpenDivarChat") {
    chrome.tabs.query({ url: ["https://divar.ir/chat*", "https://chat.divar.ir/*"] }, function (tabs) {
      if (tabs && tabs[0]) {
        chrome.tabs.update(tabs[0].id, { active: true, url: tabs[0].url || "https://divar.ir/chat" });
        if (tabs[0].windowId != null) chrome.windows.update(tabs[0].windowId, { focused: true });
      } else {
        chrome.tabs.create({ url: "https://divar.ir/chat" });
      }
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message.type === "scheduleTask") {
    scheduleTaskFromMessage(message.task || {}).then(sendResponse);
    return true;
  }

  if (message.type === "cancelTask") {
    cancelTaskFromMessage(message.taskId).then(sendResponse);
    return true;
  }

  if (message.type === "runDueTasks") {
    runDueTasks().then(sendResponse);
    return true;
  }

  if (message.type === "getRunnerHealth") {
    getRunnerHealth().then(sendResponse);
    return true;
  }

  if (message.type === "openContactChat") {
    openContactChat(message.targetName).then(sendResponse);
    return true;
  }

  if (message.type === "sendTemplateNow") {
    sendTemplateNow(message.targetName, message.message).then(sendResponse);
    return true;
  }

  if (message.type === "cloudSetConfig") {
    IranexpediaCloudBridge.setConfig(message.config || {}).then(function (cfg) {
      sendResponse({ ok: true, config: cfg });
    });
    return true;
  }

  if (message.type === "cloudGetConfig") {
    IranexpediaCloudBridge.getConfig().then(function (cfg) {
      sendResponse({ ok: true, config: cfg });
    });
    return true;
  }

  if (message.type === "cloudIngestMessage") {
    IranexpediaCloudBridge.ingestMessage(message.payload || {}).then(sendResponse);
    return true;
  }

  // Content scripts proxy all cloud HTTP via background (CORS-safe).
  if (message.type === "cloudBridgeInvoke") {
    var method = message.method;
    var args = message.args || [];
    var impl =
      (IranexpediaCloudBridge.__impl && IranexpediaCloudBridge.__impl[method]) ||
      IranexpediaCloudBridge[method];
    if (typeof impl !== "function") {
      sendResponse({ ok: false, error: "unknown_method:" + method });
      return true;
    }
    Promise.resolve()
      .then(function () {
        return impl.apply(null, args);
      })
      .then(sendResponse)
      .catch(function (err) {
        sendResponse({ ok: false, error: String((err && err.message) || err) });
      });
    return true;
  }

  if (message.type === "cloudSyncContacts") {
    syncLocalContactsToCloud().then(sendResponse);
    return true;
  }

  if (message.type === "pollCloudBridgeNow") {
    pollCloudBridge().then(function () {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message.type === "cloudScanWhatsAppChats") {
    findWhatsAppTab().then(function (tab) {
      if (!tab) {
        sendResponse({ ok: false, error: "whatsapp_tab_not_found" });
        return;
      }
      chrome.tabs.sendMessage(
        tab.id,
        { type: "cloudScanSidebarChats" },
        function (res) {
          if (chrome.runtime.lastError) {
            sendResponse({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          sendResponse(res || { ok: false, error: "no_response" });
        }
      );
    });
    return true;
  }
});

async function syncLocalContactsToCloud() {
  if (!(await requireCloudAuth(false))) {
    return { ok: false, error: "auth_required", synced: 0 };
  }
  var cfg = await IranexpediaCloudBridge.getConfig();
  if (!cfg.enabled || !cfg.accessToken || !cfg.orgId) {
    return { ok: false, error: "cloud_disabled", synced: 0 };
  }
  var data = await storageGet({ crmContacts: [] });
  var contacts = Array.isArray(data.crmContacts) ? data.crmContacts : [];
  var synced = 0;
  var errors = 0;
  for (var i = 0; i < contacts.length; i++) {
    var c = contacts[i];
    if (!c || !c.name) continue;
    var res = await IranexpediaCloudBridge.upsertLead({
      name: c.name,
      phone: c.phone || "",
      groupId: c.groupId || "",
      chatType: c.chatType || "pv",
      stage: c.stage || "جدید",
      tags: c.tags || [],
      notes: c.notes || "",
      // Do NOT push botPaused on bulk sync — stale local pause was re-pausing
      // chats after «شروع» / CRM «فعال‌سازی ربات».
      externalChatId:
        c.externalChatId ||
        c.chatId ||
        (c.channel === "divar" || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(String(c.phone || ""))
          ? c.phone || ""
          : "")
    });
    if (res && res.ok) synced += 1;
    else errors += 1;
  }
  lastCloudContactSyncAt = Date.now();
  return { ok: true, synced: synced, total: contacts.length, errors: errors };
}

async function relayTrace(stage, extra) {
  if (globalThis.IranexpediaReplyTrace) {
    IranexpediaReplyTrace.debug("[bg] " + stage, extra || {});
  }
  try {
    var tab = await findWhatsAppTab();
    if (!tab) return;
    chrome.tabs.sendMessage(tab.id, {
      type: "replyTraceRelay",
      stage: stage,
      extra: extra || {}
    });
  } catch (_e) {}
}

async function runJobsForChannel(channel) {
  var tab = await findChannelTab(channel);
  if (!tab) {
    await relayTrace("poll_skip", { channel: channel, reason: "tab_not_found" });
    return;
  }
  var bound = await IranexpediaCloudBridge.ensureChannelAccount(channel);
  if (!bound || !bound.ok) {
    await relayTrace("poll_skip", {
      channel: channel,
      reason: (bound && bound.error) || "channel_bind_failed"
    });
    return;
  }
  if (!bound.heartbeatOk) {
    await relayTrace("poll_warn", { channel: channel, reason: "heartbeat_failed" });
  }
  await IranexpediaCloudBridge.heartbeat();
  var jobs = await IranexpediaCloudBridge.claimJobs(3);
  if (!jobs || !jobs.length) {
    await relayTrace("poll_no_jobs", { channel: channel });
    return;
  }
  await relayTrace("poll_claimed", { channel: channel, count: jobs.length });
  console.log("[cloud-bridge] claimed", jobs.length, "job(s) for", channel);
  for (var i = 0; i < jobs.length; i++) {
    var job = jobs[i];
    try {
      var target = job.target_name || "";
      var traceId = job.trace_id || "";
      if (traceId && globalThis.IranexpediaReplyTrace) {
        IranexpediaReplyTrace.event(traceId, "job_claimed", {
          job_id: job.id,
          target: target
        });
      }
      var msg =
        channel === "divar"
          ? {
              type: "sendDivarMessage",
              chatId: target,
              targetName: target,
              message: job.body,
              traceId: traceId
            }
          : {
              type: "sendTemplateNow",
              targetName: target,
              message: job.body,
              traceId: traceId
            };
      var res = await chrome.tabs.sendMessage(tab.id, msg);
      if (traceId && globalThis.IranexpediaReplyTrace) {
        IranexpediaReplyTrace.event(traceId, "job_send_result", {
          job_id: job.id,
          ok: !!(res && res.ok),
          error: (res && res.error) || ""
        });
      }
      console.log(
        "[cloud-bridge] send",
        channel,
        target,
        res && res.ok ? "ok" : (res && res.error) || "fail"
      );
      await IranexpediaCloudBridge.completeJob(job.id, !!(res && res.ok), (res && res.error) || "");
    } catch (err) {
      console.log("[cloud-bridge] send error", err);
      await IranexpediaCloudBridge.completeJob(job.id, false, String(err && err.message || err));
    }
  }
}

async function pollCloudBridge() {
  try {
    await relayTrace("poll_start", {});
    var cfg = await IranexpediaCloudBridge.getConfig();
    if (!cfg.enabled) {
      await relayTrace("poll_skip", { reason: "cloud_disabled" });
      return;
    }
    if (!(await requireCloudAuth(false))) {
      await relayTrace("poll_skip", { reason: "auth_required" });
      return;
    }

    // Push local CRM contacts → server
    if (Date.now() - lastCloudContactSyncAt > 45 * 1000) {
      await syncLocalContactsToCloud();
    }

    // Activate + claim per open tab — no manual channel choice
    if (await findWhatsAppTab()) await runJobsForChannel("whatsapp");
    if (await findDivarTab()) await runJobsForChannel("divar");
    await relayTrace("poll_done", {});
  } catch (err) {
    await relayTrace("poll_error", { error: String((err && err.message) || err) });
  }
}

chrome.alarms.create(CLOUD_ALARM, { periodInMinutes: 1 });
// Claim AI outbound jobs every ~5s (chrome.alarms alone is too slow at 1 min)
if (!globalThis.__iranexpediaCloudPollTimer) {
  globalThis.__iranexpediaCloudPollTimer = setInterval(function () {
    pollCloudBridge();
  }, 5 * 1000);
}
