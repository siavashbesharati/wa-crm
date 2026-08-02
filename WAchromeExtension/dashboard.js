(function () {
  var titles = {
    contacts: ["لیدها", "مدیریت لیدها، برچسب و مراحل فروش"],
    pipeline: ["پایپلاین", "برد مراحل فروش — کارت را بکشید تا مرحله عوض شود"],
    templates: ["قالب‌ها", "پیام‌های آماده با متغیر {name}"],
    rules: ["اتوماسیون", "پاسخ خودکار بر اساس کلمه کلیدی"],
    activity: ["فعالیت‌ها", "لاگ ارسال‌ها و رویدادها"],
    settings: ["تنظیمات", "محدودیت ایمنی و ساعات کاری"]
  };

  var contacts = [];
  var templates = [];
  var tasks = [];
  var rules = [];
  var events = [];
  var settings = null;
  var contactView = "list";
  var selectedContact = null;
  var drawerEvents = [];
  var drawerMode = "edit";

  var manifest = chrome.runtime.getManifest();
  document.getElementById("dash-version").textContent = "v" + manifest.version;

  function $(id) {
    return document.getElementById(id);
  }

  function fmt(ts) {
    if (!ts) return "-";
    return new Date(ts).toLocaleString("fa-IR");
  }

  function stages() {
    return (window.IranexpediaCrm && IranexpediaCrm.STAGES) || [
      "جدید",
      "پیگیری",
      "پیشنهاد",
      "خرید",
      "بسته"
    ];
  }

  function faKey(s) {
    if (window.IranexpediaCrm && IranexpediaCrm.normalizeContactKey) {
      return IranexpediaCrm.normalizeContactKey(s);
    }
    return String(s || "")
      .replace(/ي/g, "ی")
      .replace(/ك/g, "ک")
      .toLocaleLowerCase("fa-IR");
  }

  function showToast(msg, isError) {
    var el = $("drawer-toast");
    if (!el) {
      alert(msg);
      return;
    }
    el.textContent = msg;
    el.classList.toggle("error", !!isError);
    el.classList.remove("hidden");
    setTimeout(function () {
      el.classList.add("hidden");
    }, 3200);
  }

  function switchTab(tab) {
    var navTab = tab;
    var contentTab = tab;
    if (tab === "pipeline") {
      contentTab = "contacts";
      setContactView("pipeline");
    } else if (tab === "contacts") {
      setContactView("list");
    }

    document.querySelectorAll(".nav-btn").forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-tab") === navTab);
    });
    document.querySelectorAll(".tab").forEach(function (el) {
      el.classList.toggle("active", el.id === "tab-" + contentTab);
    });
    var title = titles[navTab] || titles.contacts;
    $("page-title").textContent = title[0];
    $("page-sub").textContent = title[1];
  }

  document.querySelectorAll(".nav-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      switchTab(btn.getAttribute("data-tab"));
    });
  });

  async function ensureLicense() {
    var status = await IranexpediaLicense.getStoredLicenseStatus();
    if (!status.valid) {
      document.querySelector("main").innerHTML =
        '<div class="card" style="max-width:520px;margin:40px auto;text-align:center">' +
        "<h2>فعال‌سازی لازم است</h2>" +
        "<p class='hint'>برای استفاده از داشبورد CRM، از آیکون افزونه کلید فعال‌سازی را وارد کنید.</p>" +
        "</div>";
      return false;
    }
    return true;
  }

  function fillStageSelect(sel, selected) {
    if (!sel) return;
    sel.innerHTML = "";
    stages().forEach(function (s) {
      var opt = document.createElement("option");
      opt.value = s;
      opt.textContent = s;
      if (s === selected) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  function populateFilters() {
    var stageSel = $("filter-stage");
    var tagSel = $("filter-tag");
    var curStage = stageSel.value;
    var curTag = tagSel.value;
    stageSel.innerHTML = '<option value="">همه مراحل</option>';
    stages().forEach(function (s) {
      var opt = document.createElement("option");
      opt.value = s;
      opt.textContent = s;
      stageSel.appendChild(opt);
    });
    stageSel.value = curStage;

    var tags = {};
    contacts.forEach(function (c) {
      (c.tags || []).forEach(function (t) {
        if (t) tags[t] = true;
      });
    });
    tagSel.innerHTML = '<option value="">همه برچسب‌ها</option>';
    Object.keys(tags)
      .sort()
      .forEach(function (t) {
        var opt = document.createElement("option");
        opt.value = t;
        opt.textContent = t;
        tagSel.appendChild(opt);
      });
    tagSel.value = curTag;
  }

  function filteredContacts() {
    var q = faKey(($("contact-search").value || "").trim());
    var stage = $("filter-stage").value;
    var tag = $("filter-tag").value;
    return contacts.filter(function (c) {
      if (stage && c.stage !== stage) return false;
      if (tag && (c.tags || []).indexOf(tag) === -1) return false;
      if (!q) return true;
      var hay = faKey(
        c.name + " " + (c.tags || []).join(" ") + " " + (c.notes || "")
      );
      return hay.indexOf(q) !== -1;
    });
  }

  function setContactView(view) {
    contactView = view === "pipeline" ? "pipeline" : "list";
    $("view-list").classList.toggle("active", contactView === "list");
    $("view-pipeline").classList.toggle("active", contactView === "pipeline");
    $("contacts-list-view").classList.toggle("hidden", contactView !== "list");
    $("contacts-pipeline-view").classList.toggle(
      "hidden",
      contactView !== "pipeline"
    );
    renderContacts();
  }

  function setDrawerMode(mode) {
    drawerMode = mode === "send" || mode === "task" ? mode : "edit";
    var isEdit = drawerMode === "edit";
    var isSend = drawerMode === "send";
    var isTask = drawerMode === "task";

    $("drawer-form").classList.toggle("hidden", !isEdit);
    $("drawer-text-box").classList.toggle("hidden", !isSend);
    $("drawer-task-box").classList.toggle("hidden", !isTask);
    $("drawer-timeline-card").classList.toggle("hidden", !isEdit);

    $("drawer-mode-edit").classList.toggle("active", isEdit);
    $("drawer-mode-edit").classList.toggle("secondary", !isEdit);
    $("drawer-mode-send").classList.toggle("active", isSend);
    $("drawer-mode-send").classList.toggle("secondary", !isSend);
    $("drawer-mode-task").classList.toggle("active", isTask);
    $("drawer-mode-task").classList.toggle("secondary", !isTask);
  }

  function syncDrawerIdentityFields(contact) {
    var isGroup = (contact.chatType || "pv") === "group";
    $("drawer-phone-label").classList.toggle("hidden", isGroup);
    $("drawer-group-label").classList.toggle("hidden", !isGroup);
    $("drawer-phone").value = contact.phone || "";
    $("drawer-group-id").value = contact.groupId || "";
  }

  async function openDrawer(contact) {
    selectedContact = contact;
    $("drawer-backdrop").classList.remove("hidden");
    $("contact-drawer").classList.remove("hidden");
    $("contact-drawer").setAttribute("aria-hidden", "false");
    $("drawer-name").textContent = contact.name;
    var idPart =
      (contact.chatType || "pv") === "group"
        ? contact.groupId
          ? " · " + contact.groupId
          : ""
        : contact.phone
          ? " · " + contact.phone
          : "";
    $("drawer-meta").textContent =
      (contact.chatType || "pv") +
      idPart +
      " · آخرین پیام: " +
      fmt(contact.lastMessageAt || contact.updatedAt);
    fillStageSelect($("drawer-stage"), contact.stage || stages()[0]);
    $("drawer-tags").value = (contact.tags || []).join("، ");
    syncDrawerIdentityFields(contact);
    $("drawer-notes").value = contact.notes || "";
    $("drawer-bot-paused").checked = !!contact.botPaused;
    $("drawer-text-body").value = "";

    var d = new Date(Date.now() + 60 * 60 * 1000);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    $("drawer-task-at").value = d.toISOString().slice(0, 16);
    $("drawer-task-msg").value = "";

    setDrawerMode("edit");
    drawerEvents = await IranexpediaCrm.getEventsForContact(contact.name);
    renderDrawerTimeline();
  }

  function closeDrawer() {
    selectedContact = null;
    drawerMode = "edit";
    $("drawer-backdrop").classList.add("hidden");
    $("contact-drawer").classList.add("hidden");
    $("contact-drawer").setAttribute("aria-hidden", "true");
  }

  function renderDrawerTimeline() {
    var list = $("drawer-timeline");
    list.innerHTML = "";
    if (!drawerEvents.length) {
      var empty = document.createElement("li");
      empty.innerHTML = '<div class="msg hint">هنوز رویدادی ثبت نشده است.</div>';
      list.appendChild(empty);
      return;
    }
    drawerEvents.slice(0, 40).forEach(function (e) {
      var li = document.createElement("li");
      var when = document.createElement("div");
      when.className = "when";
      when.textContent = fmt(e.at) + " · " + e.type;
      var msg = document.createElement("div");
      msg.className = "msg";
      msg.textContent = e.message;
      li.appendChild(when);
      li.appendChild(msg);
      list.appendChild(li);
    });
  }

  function openWhatsAppFor(contact) {
    chrome.runtime.sendMessage(
      { type: "openContactChat", targetName: contact.name },
      function (res) {
        if (chrome.runtime.lastError || !res || !res.ok) {
          showToast(
            (res && res.error) || "باز کردن چت ناموفق بود.",
            true
          );
          return;
        }
        showToast("چت باز شد.");
      }
    );
  }

  function renderContacts() {
    populateFilters();
    var list = filteredContacts();
    if (contactView === "pipeline") {
      renderPipeline(list);
      return;
    }

    var body = $("contacts-body");
    body.innerHTML = "";
    list.forEach(function (c) {
      var tr = document.createElement("tr");
      tr.innerHTML =
        "<td><strong></strong><div class='hint'></div></td>" +
        "<td></td><td></td><td></td><td></td><td class='row-actions'></td>";
      tr.cells[0].querySelector("strong").textContent = c.name;
      tr.cells[0].querySelector(".hint").textContent =
        (c.chatType || "pv") +
        ((c.chatType || "pv") === "group"
          ? c.groupId
            ? " · " + c.groupId
            : ""
          : c.phone
            ? " · " + c.phone
            : "");
      tr.cells[1].textContent = c.stage || "-";
      tr.cells[2].textContent = (c.tags || []).join("، ") || "-";
      tr.cells[3].textContent = c.botPaused ? "متوقف" : "فعال";
      tr.cells[4].textContent = c.notes || "-";

      var details = document.createElement("button");
      details.type = "button";
      details.className = "btn";
      details.textContent = "عملیات";
      details.onclick = function () {
        openDrawer(c);
      };

      var del = document.createElement("button");
      del.className = "btn danger";
      del.type = "button";
      del.textContent = "حذف";
      del.onclick = async function () {
        if (!confirm("حذف مخاطب «" + c.name + "»؟")) return;
        await IranexpediaCrm.deleteContact(c.id);
        if (selectedContact && selectedContact.id === c.id) closeDrawer();
        await loadAll();
      };

      tr.cells[5].appendChild(details);
      tr.cells[5].appendChild(del);
      body.appendChild(tr);
    });
  }

  function renderPipeline(list) {
    var board = $("contacts-pipeline-view");
    board.innerHTML = "";
    var dragMoved = false;

    stages().forEach(function (stage) {
      var col = document.createElement("div");
      col.className = "pipeline-col";
      col.dataset.stage = stage;
      var title = document.createElement("h3");
      var items = list.filter(function (c) {
        return (c.stage || stages()[0]) === stage;
      });
      title.textContent = stage + " (" + items.length + ")";
      col.appendChild(title);

      col.addEventListener("dragover", function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        col.classList.add("drag-over");
      });
      col.addEventListener("dragleave", function (e) {
        if (!col.contains(e.relatedTarget)) {
          col.classList.remove("drag-over");
        }
      });
      col.addEventListener("drop", async function (e) {
        e.preventDefault();
        col.classList.remove("drag-over");
        var contactId = e.dataTransfer.getData("text/contact-id");
        var fromStage = e.dataTransfer.getData("text/from-stage");
        if (!contactId || fromStage === stage) return;
        await IranexpediaCrm.setContactStage(contactId, stage);
        await loadAll();
      });

      items.forEach(function (c) {
        var card = document.createElement("div");
        card.className = "pipeline-card";
        card.draggable = true;
        card.dataset.contactId = c.id;

        var strong = document.createElement("strong");
        strong.textContent = c.name;
        var tags = document.createElement("div");
        tags.className = "tags";
        tags.textContent = (c.tags || []).join("، ") || "بدون برچسب";
        var hint = document.createElement("div");
        hint.className = "drag-hint";
        hint.textContent = "بکشید برای تغییر مرحله";
        var sel = document.createElement("select");
        fillStageSelect(sel, c.stage || stage);
        sel.draggable = false;
        sel.onclick = function (e) {
          e.stopPropagation();
        };
        sel.onmousedown = function (e) {
          e.stopPropagation();
        };
        sel.onchange = async function (e) {
          e.stopPropagation();
          await IranexpediaCrm.setContactStage(c.id, sel.value);
          await loadAll();
        };

        card.appendChild(strong);
        card.appendChild(tags);
        card.appendChild(hint);
        card.appendChild(sel);

        card.addEventListener("dragstart", function (e) {
          dragMoved = true;
          card.classList.add("dragging");
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/contact-id", c.id);
          e.dataTransfer.setData("text/from-stage", c.stage || stage);
          e.dataTransfer.setData("text/plain", c.name);
        });
        card.addEventListener("dragend", function () {
          card.classList.remove("dragging");
          board.querySelectorAll(".pipeline-col.drag-over").forEach(function (el) {
            el.classList.remove("drag-over");
          });
          setTimeout(function () {
            dragMoved = false;
          }, 0);
        });
        card.onclick = function () {
          if (dragMoved) return;
          openDrawer(c);
        };
        col.appendChild(card);
      });
      board.appendChild(col);
    });
  }

  async function loadAll() {
    contacts = await IranexpediaCrm.getContacts();
    templates = await IranexpediaCrm.getTemplates();
    tasks = await IranexpediaCrm.getTasks();
    rules = await IranexpediaCrm.getKeywordRules();
    events = await IranexpediaCrm.getEvents();
    settings = await IranexpediaCrm.getSettings();
    renderStats();
    renderContacts();
    renderTemplates();
    renderRules();
    renderEvents();
    renderSettings();
    refreshHealth();
    if (selectedContact) {
      var fresh = await IranexpediaCrm.getContactById(selectedContact.id);
      if (fresh) openDrawer(fresh);
      else closeDrawer();
    }
  }

  function renderStats() {
    $("stat-contacts").textContent = String(contacts.length);
    $("stat-queued").textContent = String(
      tasks.filter(function (t) {
        return t.status === "queued" || t.status === "running";
      }).length
    );
    var start = new Date();
    start.setHours(0, 0, 0, 0);
    var sentToday = events.filter(function (e) {
      return (
        e.at >= start.getTime() &&
        (e.type === "scheduled_sent" ||
          e.type === "manual_sent" ||
          e.type === "auto_reply")
      );
    }).length;
    $("stat-sent").textContent = String(sentToday);
  }

  function renderTemplates() {
    var list = $("templates-list");
    list.innerHTML = "";
    templates.forEach(function (t) {
      var card = document.createElement("div");
      card.className = "tpl-card";
      var h = document.createElement("h3");
      h.textContent = t.title;
      var p = document.createElement("p");
      p.textContent = t.body;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn danger";
      btn.textContent = "حذف";
      btn.onclick = async function () {
        await IranexpediaCrm.deleteTemplate(t.id);
        await loadAll();
      };
      card.appendChild(h);
      card.appendChild(p);
      card.appendChild(btn);
      list.appendChild(card);
    });
  }

  function renderRules() {
    var body = $("rules-body");
    body.innerHTML = "";
    rules.forEach(function (r, index) {
      var tr = document.createElement("tr");
      tr.innerHTML = "<td></td><td></td><td></td>";
      tr.cells[0].textContent = r.keyword;
      tr.cells[1].textContent = r.reply;
      var del = document.createElement("button");
      del.type = "button";
      del.className = "btn danger";
      del.textContent = "حذف";
      del.onclick = async function () {
        rules = rules.filter(function (_, i) {
          return i !== index;
        });
        await IranexpediaCrm.saveKeywordRules(rules);
        await loadAll();
      };
      tr.cells[2].appendChild(del);
      body.appendChild(tr);
    });
  }

  function renderEvents() {
    var list = $("events-list");
    list.innerHTML = "";
    events.slice(0, 100).forEach(function (e) {
      var li = document.createElement("li");
      var when = document.createElement("div");
      when.className = "when";
      when.textContent = fmt(e.at) + " · " + e.type;
      var msg = document.createElement("div");
      msg.className = "msg";
      msg.textContent = e.message;
      li.appendChild(when);
      li.appendChild(msg);
      list.appendChild(li);
    });
  }

  function renderSettings() {
    if (!settings) return;
    $("set-max-hour").value = settings.maxPerHour;
    $("set-min-delay").value = settings.minDelayMs;
    $("set-max-delay").value = settings.maxDelayMs;
    $("set-hours-enabled").checked = !!(
      settings.businessHours && settings.businessHours.enabled
    );
    $("set-hours-start").value =
      (settings.businessHours && settings.businessHours.start) || "09:00";
    $("set-hours-end").value =
      (settings.businessHours && settings.businessHours.end) || "18:00";
    $("set-away").value =
      (settings.businessHours && settings.businessHours.awayMessage) || "";
    $("risk-status").textContent = settings.riskAcceptedAt
      ? "پذیرش خطر گروه/کانال ثبت شده در " + fmt(settings.riskAcceptedAt)
      : "هنوز پذیرش خطر گروه/کانال ثبت نشده است.";
  }

  function refreshHealth() {
    chrome.runtime.sendMessage({ type: "getRunnerHealth" }, function (res) {
      var el = $("runner-health");
      if (chrome.runtime.lastError || !res) {
        el.textContent = "وضعیت اجرا: نامشخص";
        return;
      }
      if (res.waOpen) {
        el.textContent =
          "وضعیت اجرا: واتساپ باز است · صف " + (res.queued || 0);
      } else {
        el.textContent =
          "وضعیت اجرا: واتساپ وب باز نیست — زمان‌بندی اجرا نمی‌شود";
      }
    });
  }

  $("contact-search").addEventListener("input", renderContacts);
  $("filter-stage").addEventListener("change", renderContacts);
  $("filter-tag").addEventListener("change", renderContacts);
  $("view-list").addEventListener("click", function () {
    switchTab("contacts");
  });
  $("view-pipeline").addEventListener("click", function () {
    switchTab("pipeline");
  });
  $("drawer-close").addEventListener("click", closeDrawer);
  $("drawer-backdrop").addEventListener("click", closeDrawer);

  $("drawer-mode-edit").addEventListener("click", function () {
    setDrawerMode("edit");
  });
  $("drawer-mode-send").addEventListener("click", function () {
    setDrawerMode("send");
  });
  $("drawer-mode-task").addEventListener("click", function () {
    setDrawerMode("task");
  });

  $("drawer-text-confirm").addEventListener("click", function () {
    if (!selectedContact) return;
    var message = ($("drawer-text-body").value || "").trim();
    if (!message) {
      showToast("متن پیام خالی است.", true);
      return;
    }
    chrome.runtime.sendMessage(
      {
        type: "sendTemplateNow",
        targetName: selectedContact.name,
        message: message
      },
      async function (res) {
        if (chrome.runtime.lastError || !res || !res.ok) {
          showToast((res && res.error) || "ارسال ناموفق بود.", true);
          return;
        }
        showToast("متن ارسال شد.");
        $("drawer-text-body").value = "";
        setDrawerMode("edit");
        await loadAll();
      }
    );
  });

  $("drawer-task-confirm").addEventListener("click", function () {
    if (!selectedContact) return;
    var message = ($("drawer-task-msg").value || "").trim();
    var at = $("drawer-task-at").value;
    if (!message || !at) {
      showToast("زمان و متن پیام را وارد کنید.", true);
      return;
    }
    var runAt = new Date(at).getTime();
    chrome.runtime.sendMessage(
      {
        type: "scheduleTask",
        task: {
          targetName: selectedContact.name,
          targetType: selectedContact.chatType || "pv",
          message: message,
          runAt: runAt
        }
      },
      async function (res) {
        if (!res || !res.ok) {
          showToast((res && res.error) || "ثبت وظیفه ناموفق بود.", true);
          return;
        }
        showToast("زمان‌بندی ثبت شد. در زمان مقرر ارسال می‌شود.");
        setDrawerMode("edit");
        await loadAll();
      }
    );
  });

  $("drawer-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    if (!selectedContact) return;
    var tags = ($("drawer-tags").value || "")
      .split(/[,،]/)
      .map(function (t) {
        return t.trim();
      })
      .filter(Boolean);
    var isGroup = (selectedContact.chatType || "pv") === "group";
    await IranexpediaCrm.saveContactDetails(selectedContact.id, {
      stage: $("drawer-stage").value,
      tags: tags,
      notes: $("drawer-notes").value || "",
      phone: isGroup ? selectedContact.phone || "" : $("drawer-phone").value || "",
      groupId: isGroup
        ? $("drawer-group-id").value || ""
        : selectedContact.groupId || "",
      botPaused: $("drawer-bot-paused").checked
    });
    showToast("تغییرات ذخیره شد.");
    await loadAll();
  });

  $("export-contacts").addEventListener("click", function () {
    var rows = [
      [
        "name",
        "stage",
        "tags",
        "notes",
        "botPaused",
        "chatType",
        "phone",
        "groupId"
      ]
    ];
    filteredContacts().forEach(function (c) {
      rows.push([
        c.name,
        c.stage || "",
        (c.tags || []).join("|"),
        (c.notes || "").replace(/\n/g, " "),
        c.botPaused ? "1" : "0",
        c.chatType || "",
        c.phone || "",
        c.groupId || ""
      ]);
    });
    var csv = rows
      .map(function (r) {
        return r
          .map(function (cell) {
            return '"' + String(cell).replace(/"/g, '""') + '"';
          })
          .join(",");
      })
      .join("\n");
    var blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "iranexpedia-contacts.csv";
    a.click();
  });

  $("template-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    await IranexpediaCrm.addTemplate($("tpl-title").value, $("tpl-body").value);
    $("template-form").reset();
    await loadAll();
  });

  $("rule-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    var keyword = $("rule-keyword").value.trim();
    var reply = $("rule-reply").value.trim();
    var idx = rules.findIndex(function (r) {
      return String(r.keyword).toLowerCase() === keyword.toLowerCase();
    });
    if (idx >= 0) rules[idx] = { keyword: keyword, reply: reply };
    else rules.push({ keyword: keyword, reply: reply });
    await IranexpediaCrm.saveKeywordRules(rules);
    $("rule-form").reset();
    await loadAll();
  });

  $("clear-events").addEventListener("click", async function () {
    await IranexpediaCrm.clearEvents();
    await loadAll();
  });

  $("settings-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    await IranexpediaCrm.saveSettings({
      maxPerHour: Number($("set-max-hour").value),
      minDelayMs: Number($("set-min-delay").value),
      maxDelayMs: Number($("set-max-delay").value),
      riskAcceptedAt: settings.riskAcceptedAt || null,
      businessHours: {
        enabled: $("set-hours-enabled").checked,
        start: $("set-hours-start").value || "09:00",
        end: $("set-hours-end").value || "18:00",
        awayMessage: $("set-away").value || ""
      }
    });
    await loadAll();
    alert("تنظیمات ذخیره شد.");
  });

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area === "local") loadAll();
  });

  (async function init() {
    var ok = await ensureLicense();
    if (!ok) return;
    fillStageSelect($("drawer-stage"), stages()[0]);
    var d = new Date(Date.now() + 15 * 60 * 1000);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    $("task-at").value = d.toISOString().slice(0, 16);
    setContactView("list");
    await loadAll();
    setInterval(refreshHealth, 5000);
  })();
})();
