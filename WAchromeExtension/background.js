/**
 * Trusted time + CRM task scheduler dispatcher + cloud bridge.
 */

importScripts("cloud-bridge.js", "auth-gate.js");

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
    url: ["https://divar.ir/chat/*", "https://chat.divar.ir/*", "https://chat.divar.ir/chat/*"]
  });
  if (!tabs || !tabs.length) return null;
  return tabs[0];
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
  var tab = await findWhatsAppTab();
  if (!tab) {
    await updateTask(task.id, {
      status: "failed",
      lastError: "واتساپ وب باز نیست. تب web.whatsapp.com را باز بگذارید."
    });
    await addEvent(
      "scheduled_fail",
      "ارسال ناموفق (تب بسته): " + task.targetName,
      { taskId: task.id }
    );
    return { ok: false, error: "wa_closed" };
  }

  await updateTask(task.id, {
    status: "running",
    attempts: (task.attempts || 0) + 1
  });

  try {
    var res = await chrome.tabs.sendMessage(tab.id, {
      type: "runScheduledTask",
      task: task
    });
    if (res && res.ok) {
      await updateTask(task.id, {
        status: "sent",
        lastError: ""
      });
      await addEvent(
        "scheduled_sent",
        "ارسال زمان‌بندی‌شده به «" + task.targetName + "»",
        { taskId: task.id }
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
      lastError: "ارتباط با صفحه واتساپ برقرار نشد. صفحه را تازه کنید."
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

chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
  if (!message || !message.type) return;

  if (message.type === "getTrustedTime") {
    fetchTrustedTime().then(sendResponse);
    return true;
  }

  if (message.type === "openDashboard") {
    chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
    sendResponse({ ok: true });
    return;
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
      botPaused: !!c.botPaused
    });
    if (res && res.ok) synced += 1;
    else errors += 1;
  }
  lastCloudContactSyncAt = Date.now();
  return { ok: true, synced: synced, total: contacts.length, errors: errors };
}

async function pollCloudBridge() {
  try {
    var cfg = await IranexpediaCloudBridge.getConfig();
    if (!cfg.enabled) return;
    if (!(await requireCloudAuth(false))) return;
    await IranexpediaCloudBridge.heartbeat();

    // Push local CRM contacts → server (real reason backend has leads).
    if (Date.now() - lastCloudContactSyncAt > 45 * 1000) {
      await syncLocalContactsToCloud();
    }

    var jobs = await IranexpediaCloudBridge.claimJobs(3);
    if (!jobs.length) return;
    var channel = cfg.channel || "whatsapp";
    var tab = await findChannelTab(channel);
    if (!tab) return;
    for (var i = 0; i < jobs.length; i++) {
      var job = jobs[i];
      try {
        var msg =
          channel === "divar"
            ? {
                type: "sendDivarMessage",
                chatId: job.target_name,
                targetName: job.target_name,
                message: job.body
              }
            : {
                type: "sendTemplateNow",
                targetName: job.target_name,
                message: job.body
              };
        var res = await chrome.tabs.sendMessage(tab.id, msg);
        await IranexpediaCloudBridge.completeJob(job.id, !!(res && res.ok), (res && res.error) || "");
      } catch (err) {
        await IranexpediaCloudBridge.completeJob(job.id, false, String(err && err.message || err));
      }
    }
  } catch (_err) {
    // ignore transient bridge errors
  }
}

chrome.alarms.create(CLOUD_ALARM, { periodInMinutes: 1 });
