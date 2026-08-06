(function () {
  if (window.__iranexpediaCrmPanelBooted) return;
  window.__iranexpediaCrmPanelBooted = true;

  var root = null;
  var collapsed = false;
  var currentName = "";
  var currentContact = null;
  var licenseOk = false;
  var templates = [];
  var queuedCount = 0;
  var lastRenderKey = "";
  var autoReplyOn = false;
  var lastPathname = "";
  var tickTimer = null;
  var deadContext = false;
  var ticking = false;

  function isExtAlive() {
    try {
      return !!(chrome && chrome.runtime && chrome.runtime.id);
    } catch (_e) {
      return false;
    }
  }

  function markDeadContext() {
    if (deadContext) return;
    deadContext = true;
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
    try {
      if (root) {
        var panel = $("#iranexpedia-crm-panel", root);
        if (panel) {
          panel.innerHTML =
            '<div class="crm-head"><div class="crm-brand">پنل CRM</div>' +
            '<div class="crm-sub">iranexpedia.ir</div></div>' +
            '<div class="crm-lock"><p>افزونه به‌روزرسانی شد. صفحه را یک‌بار رفرش کنید.</p>' +
            '<div class="crm-actions" style="justify-content:center;margin-top:12px">' +
            '<button type="button" class="crm-btn" id="crm-reload-page">رفرش صفحه</button></div></div>';
          var btn = $("#crm-reload-page", panel);
          if (btn) btn.onclick = function () { location.reload(); };
        }
      }
    } catch (_e) {}
  }

  function safeRuntimeSend(message) {
    if (!isExtAlive()) {
      markDeadContext();
      return;
    }
    try {
      chrome.runtime.sendMessage(message, function () {
        if (chrome.runtime && chrome.runtime.lastError) {
          var msg = String(chrome.runtime.lastError.message || "");
          if (msg.indexOf("Extension context invalidated") !== -1) markDeadContext();
        }
      });
    } catch (_e) {
      markDeadContext();
    }
  }

  function detectHostChannel() {
    try {
      var host = String(location.hostname || "");
      if (host.indexOf("divar.ir") !== -1) return "divar";
    } catch (_e) {}
    return "whatsapp";
  }

  var hostChannel = detectHostChannel();

  function isTypingInPanel() {
    if (!root) return false;
    var active = document.activeElement;
    return !!(active && root.contains(active) && /INPUT|TEXTAREA|SELECT/.test(active.tagName));
  }

  function pathKey() {
    try {
      return String(location.pathname || "");
    } catch (_e) {
      return "";
    }
  }

  function renderKey() {
    return [
      licenseOk ? "1" : "0",
      collapsed ? "1" : "0",
      currentName || "",
      queuedCount,
      templates.length,
      autoReplyOn ? "1" : "0",
      currentContact
        ? [
            currentContact.stage,
            currentContact.botPaused ? "1" : "0",
            (currentContact.tags || []).join(","),
            currentContact.notes || ""
          ].join("|")
        : ""
    ].join("::");
  }

  function fullRenderKey() {
    // Path must stay in the same key used for skip + after render (was mismatched before).
    return renderKey() + "##" + pathKey();
  }

  function resolveActiveChatName() {
    if (hostChannel === "divar") {
      // Prefer stable chatId so the panel does not flip name ↔ chatId every tick.
      var chatId = getDivarChatIdFromUrl();
      if (chatId) return chatId;
    }
    return getChatNameSafe();
  }

  function $(sel, el) {
    return (el || document).querySelector(sel);
  }

  function ensureFont() {
    // WhatsApp CSP blocks external fonts — use system fonts from CSS
    var oldFont = document.getElementById("iranexpedia-font");
    if (oldFont) oldFont.remove();
  }

  function injectCss() {
    if (!document.getElementById("iranexpedia-crm-css")) {
      var link = document.createElement("link");
      link.id = "iranexpedia-crm-css";
      link.rel = "stylesheet";
      link.href = chrome.runtime.getURL("crm-panel.css");
      (document.head || document.documentElement).appendChild(link);
    }
    // Fallback if host CSP delays/blocks the stylesheet (common on Divar)
    if (!document.getElementById("iranexpedia-crm-inline")) {
      var style = document.createElement("style");
      style.id = "iranexpedia-crm-inline";
      style.textContent =
        "#iranexpedia-crm-root{position:fixed!important;top:0;right:0;bottom:0;width:340px;z-index:2147483646!important;pointer-events:none;direction:rtl;font-family:Tahoma,sans-serif}" +
        "#iranexpedia-crm-toggle{pointer-events:auto;position:absolute;top:72px;right:340px;width:34px;height:88px;border:0;border-radius:14px 0 0 14px;background:#2563eb;color:#fff;font-size:11px;font-weight:800;writing-mode:vertical-rl;cursor:pointer}" +
        "#iranexpedia-crm-root.is-collapsed #iranexpedia-crm-toggle{right:0}" +
        "#iranexpedia-crm-panel{pointer-events:auto;height:100%;width:340px;background:#f4f6f9;border-left:1px solid #e2e8f0;overflow:auto;color:#0f172a}" +
        "#iranexpedia-crm-root.is-collapsed #iranexpedia-crm-panel{display:none}";
      (document.head || document.documentElement).appendChild(style);
    }
  }

  function openDashboard() {
    safeRuntimeSend({ type: "openDashboard" });
  }

  function openDivarChatPage() {
    safeRuntimeSend({ type: "focusOrOpenDivarChat" });
  }

  function isDivarChatPath() {
    try {
      return /^\/chat(\/|$)/.test(String(location.pathname || ""));
    } catch (_e) {
      return false;
    }
  }

  function getDivarChatIdFromUrl() {
    try {
      var m = String(location.pathname || "").match(/\/chat\/([^/?#]+)/);
      if (!m) return "";
      var id = decodeURIComponent(m[1]);
      return !id || id === "postchi" ? "" : id;
    } catch (_e) {
      return "";
    }
  }

  function getChatNameSafe() {
    if (typeof window.__iranexpediaGetChatName === "function") {
      var n = window.__iranexpediaGetChatName() || "";
      if (n && n !== "چت و تماس") return n;
    }
    if (typeof window.__iranexpediaGetChatIdentity === "function") {
      try {
        var idn = window.__iranexpediaGetChatIdentity();
        if (idn && (idn.name || idn.externalChatId || idn.chatId)) {
          var nm = String(idn.name || idn.externalChatId || idn.chatId || "");
          if (nm && nm !== "چت و تماس") return nm;
        }
      } catch (_e) {}
    }
    var h2 = document.querySelector("h2.kt-chat-nav-bar__title");
    if (h2) {
      var h2t = String(h2.textContent || "").trim();
      if (h2t && h2t !== "چت و تماس") return h2t;
    }
    var divarTitles = document.querySelectorAll(".kt-chat-nav-bar__title");
    for (var di = 0; di < divarTitles.length; di++) {
      var dt = String(divarTitles[di].textContent || "").trim();
      if (dt && dt !== "چت و تماس") return dt;
    }
    var spans = document.querySelectorAll(
      '#main header span[dir="auto"], #main header span[title]'
    );
    for (var i = 0; i < spans.length; i++) {
      var t = (
        spans[i].getAttribute("title") ||
        spans[i].innerText ||
        ""
      ).trim();
      if (t && t.length < 80) return t;
    }
    return "";
  }

  function renderDivarGate(panel) {
    var onChat = isDivarChatPath();
    var chatId = getDivarChatIdFromUrl();
    var name = currentName || getChatNameSafe();
    if (name === chatId) name = getChatNameSafe() || name;
    var identity =
      typeof window.__iranexpediaGetChatIdentity === "function"
        ? window.__iranexpediaGetChatIdentity()
        : null;
    var ad = (identity && identity.adTitle) || "";
    var body =
      '<div class="crm-head"><div class="crm-brand">پنل CRM دیوار</div>' +
      '<div class="crm-sub">iranexpedia.ir · ' +
      (licenseOk ? "متصل" : "ورود لازم") +
      "</div></div>";

    if (!onChat) {
      body +=
        '<div class="crm-lock">' +
        "<p>صفحه چت دیوار باز نیست.</p>" +
        '<div class="crm-actions" style="justify-content:center;margin-top:12px;flex-direction:column;gap:8px">' +
        '<button type="button" class="crm-btn" id="crm-open-divar-chat">باز کردن چت دیوار</button>' +
        '<button type="button" class="crm-btn secondary" id="crm-open-dash">داشبورد کسب‌وکار</button>' +
        "</div></div>";
      panel.innerHTML = body;
      var btnChat0 = $("#crm-open-divar-chat", panel);
      var btnDash0 = $("#crm-open-dash", panel);
      if (btnChat0) btnChat0.onclick = openDivarChatPage;
      if (btnDash0) btnDash0.onclick = openDashboard;
      return;
    }

    body +=
      '<div class="crm-body"><div class="crm-card"><h3>گفتگوی فعلی</h3>' +
      (name || chatId
        ? "<p><strong>" +
          (name || "بدون نام") +
          "</strong></p>" +
          (ad ? '<p class="crm-empty">' + ad + "</p>" : "") +
          (chatId ? '<p class="crm-empty">chatId: ' + chatId + "</p>" : "")
        : '<p class="crm-empty">یک گفتگو را از لیست چپ انتخاب کنید.</p>') +
      "</div>";

    body +=
      '<div class="crm-card"><h3>' +
      (licenseOk ? "وضعیت" : "ورود") +
      "</h3>" +
      (licenseOk
        ? '<p class="crm-empty">وصل هستید. گفتگو را باز نگه دارید.</p>'
        : '<p class="crm-empty">از پاپ‌آپ افزونه فقط شماره و کد را بزنید تا پاسخ خودکار فعال شود.</p>') +
      '<div class="crm-actions" style="flex-wrap:wrap;gap:8px">' +
      '<button type="button" class="crm-btn" id="crm-open-divar-chat">چت دیوار</button>' +
      '<button type="button" class="crm-btn secondary" id="crm-open-dash">داشبورد کسب‌وکار</button>' +
      "</div></div></div>";

    panel.innerHTML = body;
    var b1 = $("#crm-open-divar-chat", panel);
    var b2 = $("#crm-open-dash", panel);
    if (b1) b1.onclick = openDivarChatPage;
    if (b2) b2.onclick = openDashboard;
  }

  function render() {
    if (!root) return;
    root.classList.toggle("is-collapsed", collapsed);

    var panel = $("#iranexpedia-crm-panel", root);

    // Divar: show chat CTA / current chat even before OTP; full CRM only when logged in + chat open
    if (hostChannel === "divar") {
      var divarReady = licenseOk && currentName && isDivarChatPath();
      if (!divarReady) {
        renderDivarGate(panel);
        return;
      }
    }

    if (!licenseOk) {
      panel.innerHTML =
        '<div class="crm-head"><div class="crm-brand">پنل CRM</div>' +
        '<div class="crm-sub">iranexpedia.ir</div></div>' +
        '<div class="crm-lock"><p>از پاپ‌آپ افزونه فقط شماره و کد را وارد کنید.</p>' +
        '<div class="crm-actions" style="justify-content:center;margin-top:12px">' +
        '<button type="button" class="crm-btn" id="crm-open-dash">داشبورد کسب‌وکار</button></div></div>';
      $("#crm-open-dash", panel).onclick = openDashboard;
      return;
    }

    var contactHtml;
    if (!currentName) {
      contactHtml =
        hostChannel === "divar"
          ? '<p class="crm-empty">یک گفتگو را در دیوار باز کنید تا کارت مخاطب نمایش داده شود.</p>' +
            '<div class="crm-actions" style="margin-top:10px">' +
            '<button type="button" class="crm-btn" id="crm-open-divar-chat-inline">باز کردن چت دیوار</button></div>'
          : '<p class="crm-empty">یک چت را در واتساپ باز کنید تا کارت مخاطب نمایش داده شود.</p>';
    } else {
      var c = currentContact || {
        name: currentName,
        stage: "جدید",
        tags: [],
        notes: "",
        botPaused: false,
        chatType: "pv"
      };
      var stageOpts = (window.IranexpediaCrm.STAGES || [])
        .map(function (s) {
          return (
            '<option value="' +
            s +
            '"' +
            (c.stage === s ? " selected" : "") +
            ">" +
            s +
            "</option>"
          );
        })
        .join("");
      var idMeta =
        (c.chatType || "pv") === "group"
          ? c.groupId
            ? " · " + c.groupId
            : ""
          : c.phone
            ? " · " + c.phone
            : "";
      contactHtml =
        '<div class="crm-field"><label>نام</label>' +
        '<input id="crm-contact-name" type="text" /></div>' +
        '<div class="crm-field" id="crm-phone-wrap"><label>' +
        (hostChannel === "divar" ? "شناسه چت دیوار" : "شماره") +
        "</label>" +
        '<input id="crm-contact-phone" type="text" placeholder="' +
        (hostChannel === "divar" ? "chatId" : "98912...") +
        '" /></div>' +
        '<div class="crm-field" id="crm-group-wrap" style="display:none"><label>شناسه گروه</label>' +
        '<input id="crm-contact-group" type="text" /></div>' +
        '<div class="crm-meta">نوع: ' +
        (c.chatType || "pv") +
        idMeta +
        "</div>" +
        '<div class="crm-field"><label>مرحله</label><select id="crm-stage">' +
        stageOpts +
        "</select></div>" +
        '<div class="crm-field"><label>برچسب‌ها (با ویرگول)</label>' +
        '<input id="crm-tags" type="text" /></div>' +
        '<div class="crm-field"><label>یادداشت</label>' +
        '<textarea id="crm-notes"></textarea></div>' +
        '<div class="crm-actions">' +
        '<button type="button" class="crm-btn" id="crm-save">ذخیره</button>' +
        '<button type="button" class="crm-btn secondary" id="crm-toggle-bot">' +
        (c.botPaused ? "فعال‌سازی ربات" : "توقف ربات این چت") +
        "</button>" +
        '<button type="button" class="crm-btn secondary" id="crm-open-contact-dash">جزئیات در داشبورد</button></div>';
    }

    var tplHtml =
      templates.length === 0
        ? '<p class="crm-empty">قالبی ثبت نشده. از داشبورد اضافه کنید.</p>'
        : '<div class="crm-template-list">' +
          templates
            .slice(0, 12)
            .map(function (t, i) {
              return (
                '<div class="crm-template-item" data-i="' +
                i +
                '"><div><strong></strong><span></span></div>' +
                '<button type="button" class="crm-btn secondary crm-send-tpl">ارسال</button></div>'
              );
            })
            .join("") +
          "</div>";

    root.classList.toggle("is-extension-on", !!autoReplyOn);
    root.classList.toggle("is-extension-off", !autoReplyOn);

    panel.innerHTML =
      '<div class="crm-head">' +
      '<div class="crm-brand">پنل CRM چندکاناله</div>' +
      '<div class="crm-sub">iranexpedia.ir · v' +
      (chrome.runtime.getManifest().version || "") +
      "</div>" +
      '<div class="crm-health">' +
      '<span class="crm-chip ok" id="crm-chip-wa">' +
      (hostChannel === "divar" ? "دیوار متصل" : "واتساپ متصل") +
      "</span>" +
      '<span class="crm-chip' +
      (queuedCount ? " warn" : "") +
      '" id="crm-chip-q">' +
      queuedCount +
      " در صف</span>" +
      "</div></div>" +
      '<div class="crm-power-card ' +
      (autoReplyOn ? "is-on" : "is-off") +
      '">' +
      '<div class="crm-power-top">' +
      '<div><div class="crm-power-title">' +
      (autoReplyOn ? "افزونه روشن است" : "افزونه خاموش است") +
      "</div>" +
      '<div class="crm-power-sub">' +
      (autoReplyOn
        ? hostChannel === "divar"
          ? "پاسخ خودکار روی چت دیوار فعال است"
          : "پاسخ خودکار روی چت‌ها و گروه‌ها فعال است"
        : "هیچ پیام خودکاری ارسال نمی‌شود") +
      "</div></div>" +
      '<button type="button" class="crm-power-switch" id="crm-global-toggle" aria-pressed="' +
      (autoReplyOn ? "true" : "false") +
      '">' +
      '<span class="crm-power-knob"></span>' +
      '<span class="crm-power-label">' +
      (autoReplyOn ? "ON" : "OFF") +
      "</span></button></div>" +
      (hostChannel === "divar"
        ? ""
        : '<button type="button" class="crm-btn crm-members-btn" id="crm-download-members">دانلود اعضای گروه</button>') +
      '<button type="button" class="crm-btn secondary" id="crm-open-dash">باز کردن داشبورد کامل</button>' +
      "</div>" +
      '<div class="crm-banner">' +
      (hostChannel === "divar"
        ? "برای اتوماسیون، تب چت دیوار باید باز بماند."
        : "برای زمان‌بندی، واتساپ وب باید باز بماند.") +
      "</div>" +
      '<div class="crm-body' +
      (autoReplyOn ? "" : " is-dimmed") +
      '">' +
      '<div class="crm-card"><h3>مخاطب فعلی</h3>' +
      contactHtml +
      "</div>" +
      '<div class="crm-card"><h3>قالب‌ها</h3>' +
      tplHtml +
      "</div>" +
      '<div class="crm-card"><h3>ارسال زمان‌بندی‌شده</h3>' +
      '<div class="crm-field"><label>پیام</label><textarea id="crm-later-msg" placeholder="متن پیام"></textarea></div>' +
      '<div class="crm-field"><label>زمان ارسال</label><input id="crm-later-at" type="datetime-local" /></div>' +
      '<div class="crm-field"><label>نوع هدف</label>' +
      '<select id="crm-later-type"><option value="pv">چت خصوصی</option>' +
      '<option value="group">گروه</option><option value="channel">کانال</option></select></div>' +
      '<label class="crm-field" style="display:flex;gap:8px;align-items:center">' +
      '<input id="crm-later-risk" type="checkbox" style="width:auto" />' +
      '<span style="font-size:11px;color:#9bb5a7">خطر محدودیت واتساپ را می‌پذیرم (گروه/کانال)</span></label>' +
      '<div class="crm-actions">' +
      '<button type="button" class="crm-btn" id="crm-schedule">ثبت در صف</button>' +
      "</div></div></div>";

    if (currentName) {
      var identity =
        typeof window.__iranexpediaGetChatIdentity === "function"
          ? window.__iranexpediaGetChatIdentity()
          : null;
      var chatType =
        (currentContact && currentContact.chatType) ||
        (identity && identity.chatType) ||
        "pv";
      var nameInput = $("#crm-contact-name", panel);
      var phoneInput = $("#crm-contact-phone", panel);
      var groupInput = $("#crm-contact-group", panel);
      var phoneWrap = $("#crm-phone-wrap", panel);
      var groupWrap = $("#crm-group-wrap", panel);
      if (nameInput) {
        nameInput.value =
          (currentContact && currentContact.name) || currentName || "";
      }
      if (phoneInput) {
        phoneInput.value =
          hostChannel === "divar"
            ? (identity && (identity.externalChatId || identity.chatId)) ||
              (currentContact && currentContact.phone) ||
              ""
            : (currentContact && currentContact.phone) ||
              (identity && identity.phone) ||
              "";
      }
      if (groupInput) {
        groupInput.value =
          (currentContact && currentContact.groupId) ||
          (identity && identity.groupId) ||
          "";
      }
      if (phoneWrap) phoneWrap.style.display = chatType === "group" ? "none" : "";
      if (groupWrap) groupWrap.style.display = chatType === "group" ? "" : "none";
      $("#crm-tags", panel).value = ((currentContact && currentContact.tags) || []).join(", ");
      $("#crm-notes", panel).value = (currentContact && currentContact.notes) || "";
      $("#crm-save", panel).onclick = saveCurrent;
      $("#crm-toggle-bot", panel).onclick = toggleBot;
      var stageSel = $("#crm-stage", panel);
      if (stageSel) {
        stageSel.onchange = async function () {
          await ensureContact();
          if (currentContact && currentContact.id) {
            await IranexpediaCrm.setContactStage(currentContact.id, stageSel.value);
            currentContact = await IranexpediaCrm.getContactById(currentContact.id);
          }
        };
      }
      var openDashContact = $("#crm-open-contact-dash", panel);
      if (openDashContact) openDashContact.onclick = openDashboard;
    }

    var items = panel.querySelectorAll(".crm-template-item");
    items.forEach(function (item) {
      var i = Number(item.getAttribute("data-i"));
      var t = templates[i];
      if (!t) return;
      item.querySelector("strong").textContent = t.title;
      item.querySelector("span").textContent = t.body;
      item.querySelector(".crm-send-tpl").onclick = function () {
        sendTemplate(t);
      };
    });

    var openDashBtn = $("#crm-open-dash", panel);
    if (openDashBtn) openDashBtn.onclick = openDashboard;
    var openDivarInline = $("#crm-open-divar-chat-inline", panel);
    if (openDivarInline) openDivarInline.onclick = openDivarChatPage;
    var scheduleBtn = $("#crm-schedule", panel);
    if (scheduleBtn) scheduleBtn.onclick = scheduleLater;

    var membersBtn = $("#crm-download-members", panel);
    if (membersBtn) {
      membersBtn.onclick = async function () {
        if (typeof window.__iranexpediaDownloadGroupMembers === "function") {
          await window.__iranexpediaDownloadGroupMembers(membersBtn);
        } else {
          alert("صفحه واتساپ را تازه کنید و دوباره تلاش کنید.");
        }
      };
    }

    var globalBtn = $("#crm-global-toggle", panel);
    if (globalBtn) {
      globalBtn.onclick = async function () {
        var next = !autoReplyOn;
        if (typeof window.__iranexpediaSetAutoReplyEnabled === "function") {
          autoReplyOn = !!(await window.__iranexpediaSetAutoReplyEnabled(next));
        } else {
          await new Promise(function (resolve) {
            chrome.storage.local.set({ autoReplyEnabled: next }, resolve);
          });
          autoReplyOn = next;
        }
        lastRenderKey = "";
        render();
      };
    }

    var later = $("#crm-later-at", panel);
    if (later && !later.value) {
      var d = new Date(Date.now() + 15 * 60 * 1000);
      d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
      later.value = d.toISOString().slice(0, 16);
    }

    lastRenderKey = fullRenderKey();
  }

  async function refreshLicense() {
    if (!isExtAlive()) {
      markDeadContext();
      return;
    }
    if (!globalThis.IranexpediaAuthGate) return;
    try {
      var res = await IranexpediaAuthGate.verify();
      // Keep previous licenseOk until we have a definitive result (avoids gate flicker).
      licenseOk = !!(res && res.ok && IranexpediaAuthGate.assertUnlocked());
    } catch (e) {
      var m = String((e && e.message) || e || "");
      if (m.indexOf("Extension context invalidated") !== -1) markDeadContext();
      licenseOk = false;
    }
  }

  async function refreshData() {
    if (!isExtAlive()) {
      markDeadContext();
      return;
    }
    try {
      if (typeof window.__iranexpediaGetAutoReplyEnabled === "function") {
        autoReplyOn = !!window.__iranexpediaGetAutoReplyEnabled();
      } else {
        autoReplyOn = await new Promise(function (resolve) {
          try {
            chrome.storage.local.get({ autoReplyEnabled: false }, function (data) {
              resolve(!!(data && data.autoReplyEnabled));
            });
          } catch (_e) {
            resolve(false);
          }
        });
      }
      if (!globalThis.IranexpediaCrm) return;
      templates = await IranexpediaCrm.getTemplates();
      queuedCount = await IranexpediaCrm.getQueuedCount();
      if (currentName) {
        currentContact = await IranexpediaCrm.getContactByName(currentName);
        if (!currentContact && typeof window.__iranexpediaGetChatIdentity === "function") {
          var idn = window.__iranexpediaGetChatIdentity();
          if (idn && idn.phone && IranexpediaCrm.getContactByPhone) {
            currentContact = await IranexpediaCrm.getContactByPhone(idn.phone);
          }
        }
      } else {
        currentContact = null;
      }
    } catch (e) {
      var msg = String((e && e.message) || e || "");
      if (msg.indexOf("Extension context invalidated") !== -1) markDeadContext();
    }
  }

  async function ensureContact() {
    if (!globalThis.IranexpediaCrm) return;
    var identity =
      typeof window.__iranexpediaGetChatIdentity === "function"
        ? window.__iranexpediaGetChatIdentity()
        : { name: currentName, chatType: "pv", phone: "", groupId: "" };
    var chatType =
      (identity && identity.chatType) ||
      (currentContact && currentContact.chatType) ||
      "pv";
    var divarChatId =
      hostChannel === "divar"
        ? (identity && (identity.externalChatId || identity.chatId)) ||
          getDivarChatIdFromUrl() ||
          ""
        : "";
    var phone =
      chatType === "group"
        ? ""
        : hostChannel === "divar"
          ? divarChatId ||
            (identity && identity.phone) ||
            (currentContact && currentContact.phone) ||
            ""
          : (identity && identity.phone) ||
            (currentContact && currentContact.phone) ||
            "";
    var prettyName =
      (identity && identity.name) ||
      getChatNameSafe() ||
      "";
    // Keep a previously saved human name; do not overwrite with raw chatId.
    var displayName =
      (currentContact &&
        currentContact.name &&
        currentContact.name !== phone &&
        currentContact.name) ||
      (prettyName && prettyName !== "چت و تماس" ? prettyName : "") ||
      currentName ||
      phone ||
      "";
    if (!displayName && !phone) return;

    if (!currentContact && phone && IranexpediaCrm.getContactByPhone) {
      currentContact = await IranexpediaCrm.getContactByPhone(phone);
    }
    if (!currentContact && displayName) {
      currentContact = await IranexpediaCrm.getContactByName(displayName);
    }

    currentContact = await IranexpediaCrm.upsertContact({
      id: currentContact && currentContact.id,
      name: displayName || phone,
      chatType: chatType,
      phone: phone,
      channel: hostChannel,
      groupId:
        chatType === "group"
          ? (identity && identity.groupId) ||
            (currentContact && currentContact.groupId) ||
            ""
          : (currentContact && currentContact.groupId) || ""
    });
    // Divar: keep stable key = chatId so tick() does not thrash on title changes.
    if (hostChannel === "divar" && (divarChatId || phone)) {
      currentName = divarChatId || phone;
    } else if (currentContact && currentContact.name) {
      currentName = currentContact.name;
    }
  }

  async function saveCurrent() {
    if (!globalThis.IranexpediaCrm) return;
    var nameEl = $("#crm-contact-name", root);
    var phoneEl = $("#crm-contact-phone", root);
    var groupEl = $("#crm-contact-group", root);
    var editedName = nameEl ? String(nameEl.value || "").trim() : "";
    var editedPhone = phoneEl ? String(phoneEl.value || "").trim() : "";
    var editedGroup = groupEl ? String(groupEl.value || "").trim() : "";
    if (!editedName && !currentName) {
      alert("نام مخاطب را وارد کنید.");
      return;
    }
    if (editedName) currentName = editedName;
    await ensureContact();
    var tags = ($("#crm-tags", root).value || "")
      .split(/[,،]/)
      .map(function (t) {
        return t.trim();
      })
      .filter(Boolean);
    var chatType = (currentContact && currentContact.chatType) || "pv";
    if (currentContact && currentContact.id && IranexpediaCrm.saveContactDetails) {
      currentContact = await IranexpediaCrm.saveContactDetails(currentContact.id, {
        name: editedName || currentContact.name,
        stage: $("#crm-stage", root).value,
        tags: tags,
        notes: $("#crm-notes", root).value || "",
        phone: chatType === "group" ? "" : editedPhone,
        groupId: chatType === "group" ? editedGroup : "",
        botPaused: !!(currentContact && currentContact.botPaused)
      });
    } else {
      currentContact = await IranexpediaCrm.upsertContact({
        name: editedName || currentName,
        phone: chatType === "group" ? "" : editedPhone,
        groupId: chatType === "group" ? editedGroup : "",
        stage: $("#crm-stage", root).value,
        tags: tags,
        notes: $("#crm-notes", root).value || "",
        botPaused: !!(currentContact && currentContact.botPaused),
        chatType: chatType
      });
    }
    if (currentContact && currentContact.name) currentName = currentContact.name;
    lastRenderKey = "";
    render();
  }

  async function toggleBot() {
    if (!currentName) return;
    await ensureContact();
    currentContact = await IranexpediaCrm.updateContact(currentContact.id, {
      botPaused: !currentContact.botPaused
    });
    await IranexpediaCrm.addEvent(
      "bot_pause",
      (currentContact.botPaused ? "ربات متوقف شد برای " : "ربات فعال شد برای ") +
        currentName
    );
    render();
  }

  function sendTemplate(t) {
    if (!currentName) {
      alert("ابتدا یک چت را باز کنید.");
      return;
    }
    var body = IranexpediaCrm.applyTemplateVars(t.body, { name: currentName });
    if (typeof window.__iranexpediaSendNow === "function") {
      window.__iranexpediaSendNow(body);
    } else {
      alert("ارسال آماده نیست. صفحه واتساپ را تازه کنید.");
    }
  }

  async function scheduleLater() {
    if (!currentName) {
      alert("ابتدا یک چت را باز کنید.");
      return;
    }
    var message = ($("#crm-later-msg", root).value || "").trim();
    var runAtVal = $("#crm-later-at", root).value;
    var targetType = $("#crm-later-type", root).value || "pv";
    var risk = $("#crm-later-risk", root).checked;
    if (!message) {
      alert("متن پیام را وارد کنید.");
      return;
    }
    if (!runAtVal) {
      alert("زمان ارسال را مشخص کنید.");
      return;
    }
    var runAt = new Date(runAtVal).getTime();
    if (!Number.isFinite(runAt) || runAt < Date.now() - 5000) {
      alert("زمان ارسال معتبر نیست.");
      return;
    }
    if ((targetType === "group" || targetType === "channel") && !risk) {
      alert("برای گروه/کانال باید پذیرش خطر را علامت بزنید.");
      return;
    }
    if (targetType === "group" || targetType === "channel") {
      await IranexpediaCrm.acceptRisk();
    }
    chrome.runtime.sendMessage(
      {
        type: "scheduleTask",
        task: {
          targetName: currentName,
          targetType: targetType,
          channel: hostChannel,
          message: message,
          runAt: runAt
        }
      },
      async function (res) {
        if (chrome.runtime.lastError || !res || !res.ok) {
          alert((res && res.error) || "ثبت زمان‌بندی ناموفق بود.");
          return;
        }
        $("#crm-later-msg", root).value = "";
        await refreshData();
        render();
        alert("در صف زمان‌بندی ثبت شد.");
      }
    );
  }

  function build() {
    ensureFont();
    injectCss();
    if (document.getElementById("iranexpedia-crm-root")) {
      root = document.getElementById("iranexpedia-crm-root");
      return;
    }
    root = document.createElement("div");
    root.id = "iranexpedia-crm-root";
    root.innerHTML =
      '<button type="button" id="iranexpedia-crm-toggle">CRM</button>' +
      '<aside id="iranexpedia-crm-panel"></aside>';
    document.documentElement.appendChild(root);
    $("#iranexpedia-crm-toggle", root).onclick = function () {
      collapsed = !collapsed;
      root.classList.toggle("is-collapsed", collapsed);
    };
    render();
  }

  async function tick() {
    if (deadContext || ticking) return;
    if (!isExtAlive()) {
      markDeadContext();
      return;
    }
    ticking = true;
    try {
      build();
      await refreshLicense();
      var pathNow = pathKey();
      var pathChanged = pathNow !== lastPathname;
      lastPathname = pathNow;

      var name = resolveActiveChatName();
      var nameChanged = name !== currentName;
      if (nameChanged) {
        currentName = name;
        if (currentName && licenseOk) await ensureContact();
      }
      await refreshData();

      var key = fullRenderKey();
      if (key === lastRenderKey && !nameChanged && !pathChanged) {
        var chip = $("#crm-chip-q", root);
        if (chip) {
          chip.textContent = queuedCount + " در صف";
          chip.className = "crm-chip" + (queuedCount ? " warn" : "");
        }
        return;
      }

      // Never wipe inputs while the user is editing (unless chat/path really changed).
      if (isTypingInPanel() && !nameChanged && !pathChanged) {
        return;
      }

      lastRenderKey = key;
      render();
    } catch (err) {
      var msg = String((err && err.message) || err || "");
      if (msg.indexOf("Extension context invalidated") !== -1) {
        markDeadContext();
      }
    } finally {
      ticking = false;
    }
  }

  try {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (deadContext || !isExtAlive()) return;
      if (area !== "local") return;
      // Avoid wiping the form mid-edit when our own upsert writes storage.
      if (isTypingInPanel()) return;
      if (
        changes.crmContacts ||
        changes.crmTemplates ||
        changes.crmTasks ||
        changes.crmSettings ||
        changes.cloudBridgeConfig ||
        changes.autoReplyEnabled
      ) {
        tick();
      }
    });
  } catch (_e) {
    markDeadContext();
  }

  tick();
  tickTimer = setInterval(tick, 2500);
})();
