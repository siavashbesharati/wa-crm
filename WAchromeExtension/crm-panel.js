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

  function isTypingInPanel() {
    if (!root) return false;
    var active = document.activeElement;
    return !!(active && root.contains(active) && /INPUT|TEXTAREA|SELECT/.test(active.tagName));
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

  function $(sel, el) {
    return (el || document).querySelector(sel);
  }

  function ensureFont() {
    // WhatsApp CSP blocks external fonts — use system fonts from CSS
    var oldFont = document.getElementById("iranexpedia-font");
    if (oldFont) oldFont.remove();
  }

  function injectCss() {
    if (document.getElementById("iranexpedia-crm-css")) return;
    var link = document.createElement("link");
    link.id = "iranexpedia-crm-css";
    link.rel = "stylesheet";
    link.href = chrome.runtime.getURL("crm-panel.css");
    document.documentElement.appendChild(link);
  }

  function openDashboard() {
    chrome.runtime.sendMessage({ type: "openDashboard" });
  }

  function getChatNameSafe() {
    if (typeof window.__iranexpediaGetChatName === "function") {
      return window.__iranexpediaGetChatName() || "";
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

  function render() {
    if (!root) return;
    root.classList.toggle("is-collapsed", collapsed);

    var panel = $("#iranexpedia-crm-panel", root);
    if (!licenseOk) {
      panel.innerHTML =
        '<div class="crm-head"><div class="crm-brand">پنل CRM</div>' +
        '<div class="crm-sub">iranexpedia.ir</div></div>' +
        '<div class="crm-lock"><p>برای استفاده از CRM و زمان‌بندی، ابتدا افزونه را فعال کنید.</p>' +
        '<div class="crm-actions" style="justify-content:center;margin-top:12px">' +
        '<button type="button" class="crm-btn" id="crm-open-dash">باز کردن داشبورد</button></div></div>';
      $("#crm-open-dash", panel).onclick = openDashboard;
      return;
    }

    var contactHtml;
    if (!currentName) {
      contactHtml =
        '<p class="crm-empty">یک چت را در واتساپ باز کنید تا کارت مخاطب نمایش داده شود.</p>';
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
      contactHtml =
        '<div class="crm-name"></div>' +
        '<div class="crm-meta">نوع: ' +
        (c.chatType || "pv") +
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
        "</button></div>";
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

    panel.innerHTML =
      '<div class="crm-head">' +
      '<div class="crm-brand">پنل CRM واتساپ</div>' +
      '<div class="crm-sub">iranexpedia.ir</div>' +
      '<div class="crm-health">' +
      '<span class="crm-chip ok" id="crm-chip-wa">واتساپ متصل</span>' +
      '<span class="crm-chip' +
      (autoReplyOn ? " ok" : " bad") +
      '" id="crm-chip-bot">' +
      (autoReplyOn ? "پاسخ خودکار روشن" : "پاسخ خودکار خاموش") +
      "</span>" +
      '<span class="crm-chip' +
      (queuedCount ? " warn" : "") +
      '" id="crm-chip-q">' +
      queuedCount +
      " در صف</span>" +
      "</div></div>" +
      '<div class="crm-banner">برای پاسخ خودکار، دکمه زیر را روشن کنید. برای زمان‌بندی، واتساپ وب باید باز بماند.</div>' +
      '<div class="crm-body">' +
      '<div class="crm-card"><h3>پاسخ خودکار</h3>' +
      '<button type="button" class="crm-btn crm-global-toggle' +
      (autoReplyOn ? "" : " secondary") +
      '" id="crm-global-toggle">' +
      (autoReplyOn ? "خاموش کردن پاسخ خودکار" : "روشن کردن پاسخ خودکار") +
      "</button>" +
      '<p class="crm-empty">بدون این دکمه، فقط مخاطب ذخیره می‌شود و پاسخی ارسال نمی‌شود.</p></div>' +
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
      '<button type="button" class="crm-btn secondary" id="crm-open-dash">داشبورد کامل</button>' +
      "</div></div></div>";

    if (currentName) {
      $(".crm-name", panel).textContent = currentName;
      $("#crm-tags", panel).value = ((currentContact && currentContact.tags) || []).join(", ");
      $("#crm-notes", panel).value = (currentContact && currentContact.notes) || "";
      $("#crm-save", panel).onclick = saveCurrent;
      $("#crm-toggle-bot", panel).onclick = toggleBot;
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

    $("#crm-open-dash", panel).onclick = openDashboard;
    $("#crm-schedule", panel).onclick = scheduleLater;
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

    lastRenderKey = renderKey();
  }

  async function refreshLicense() {
    if (!globalThis.IranexpediaLicense) {
      licenseOk = false;
      return;
    }
    var status = await IranexpediaLicense.getStoredLicenseStatus();
    licenseOk = !!status.valid;
  }

  async function refreshData() {
    if (typeof window.__iranexpediaGetAutoReplyEnabled === "function") {
      autoReplyOn = !!window.__iranexpediaGetAutoReplyEnabled();
    } else {
      autoReplyOn = await new Promise(function (resolve) {
        chrome.storage.local.get({ autoReplyEnabled: false }, function (data) {
          resolve(!!data.autoReplyEnabled);
        });
      });
    }
    if (!globalThis.IranexpediaCrm) return;
    templates = await IranexpediaCrm.getTemplates();
    queuedCount = await IranexpediaCrm.getQueuedCount();
    if (currentName) {
      currentContact = await IranexpediaCrm.getContactByName(currentName);
    } else {
      currentContact = null;
    }
  }

  async function ensureContact() {
    if (!currentName || !globalThis.IranexpediaCrm) return;
    currentContact = await IranexpediaCrm.upsertContact({
      name: currentName,
      chatType: (currentContact && currentContact.chatType) || "pv"
    });
  }

  async function saveCurrent() {
    if (!currentName) return;
    var tags = ($("#crm-tags", root).value || "")
      .split(/[,،]/)
      .map(function (t) {
        return t.trim();
      })
      .filter(Boolean);
    currentContact = await IranexpediaCrm.upsertContact({
      name: currentName,
      stage: $("#crm-stage", root).value,
      tags: tags,
      notes: $("#crm-notes", root).value || "",
      botPaused: !!(currentContact && currentContact.botPaused),
      chatType: (currentContact && currentContact.chatType) || "pv"
    });
    await IranexpediaCrm.addEvent("contact_update", "مخاطب به‌روزرسانی شد: " + currentName);
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
    build();
    await refreshLicense();
    var name = getChatNameSafe();
    var nameChanged = name !== currentName;
    if (nameChanged) {
      currentName = name;
      if (currentName && licenseOk) await ensureContact();
    }
    await refreshData();

    var key = renderKey();
    if (key === lastRenderKey && !nameChanged) {
      var chip = $("#crm-chip-q", root);
      if (chip) {
        chip.textContent = queuedCount + " در صف";
        chip.className = "crm-chip" + (queuedCount ? " warn" : "");
      }
      return;
    }

    if (isTypingInPanel() && !nameChanged && key.split("::")[0] === lastRenderKey.split("::")[0]) {
      return;
    }

    lastRenderKey = key;
    render();
  }

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== "local") return;
    if (
      changes.crmContacts ||
      changes.crmTemplates ||
      changes.crmTasks ||
      changes.crmSettings ||
      changes.licenseActivated ||
      changes.licenseHash ||
      changes.autoReplyEnabled
    ) {
      tick();
    }
  });

  tick();
  setInterval(tick, 2500);
})();
