می‌خواهم یک مکانیزم reliable برای تشخیص پیام‌های جدید چت اضافه کنی، بدون تکیه به DOM mutation observer یا polling ظاهری.

زمینهٔ فنی (خیلی مهم، دقیق رعایت شود)

از طریق reverse engineering، فهمیدیم که Web Chat دیوار یک "Event Sourcing Engine" داخلی دارد که در یک webpack module با id عددی (فعلاً 66478) قرار دارد و در متغیر global زیر در دسترس است:

js
window.webpackChunk_divar_ghased

این متغیر یک آرایه است که webpack chunkها را نگه می‌دارد و از طریق .push([[chunkId], {}, function(require){...}) می‌توان به هر moduleای دسترسی گرفت. برای گرفتن instance زندهٔ engine:

js
window.webpackChunk_divar_ghased.push([
  ['__grab_' + Date.now()],
  {},
  function (require) {
    const mod = require(66478);
    // mod.T یک SINGLETON INSTANCE زنده است (نه کلاس)، چون export از نوع
    // webpack getter export (n.d(t,{T:function(){return V}})) است و
    // در زمان اجرای این کد، V قبلاً به یک instance واقعی resolve شده.
    const engine = mod.T;
    // engine.ingest(event) متدی است که هر رویداد ورودی چت (پیام جدید،
    // typing indicator، خوانده‌شدن پیام و ...) از آن عبور می‌کند.
  }
]);

ساختار واقعی eventای که از ingest عبور می‌کند (نمونهٔ واقعی گرفته‌شده از production):

json
{
  "seq": 129,
  "seqCount": 1,
  "payload": {
    "type": "message",
    "silent": false,
    "message": {
      "id": "6ad5c024-9376-11f1-946f-26d5e42839df",
      "chatId": "ad2be1ca-36d6-4767-a6c6-daa4ac6099e7",
      "data": "سلام",
      "type": "TEXT",
      "state": "NORMAL",
      "sendPhase": "sent",
      "peer": true,
      "isBot": false,
      "censored": false,
      "time": 1786227223301
    }
  }
}

نکته: payload.type می‌تواند مقادیر دیگری هم غیر از "message" داشته باشد (مثلاً برای FULL_SYNC یا سایر رویدادها) — این‌ها باید پاس داده شوند تا در background قابل تشخیص و فیلتر باشند، نه اینکه content script خودش فیلتر سخت‌گیرانه بزند.

معماری موردنیاز

سه فایل جدید/تغییر یافته می‌خواهم:

۱. inject.js — یک اسکریپت که در MAIN world صفحه تزریق می‌شود (نه isolated world). وظایف آن:

به‌صورت polling (مثلاً هر ۲۰۰ میلی‌ثانیه، حداکثر تا ۳۰ ثانیه) چک کند که window.webpackChunk_divar_ghased و module 66478 در دسترس هستند یا نه.
وقتی موفق شد، instance را بگیرد، متد ingest آن را monkey-patch کند تا قبل از اجرای منطق اصلی، خودِ event را از طریق window.postMessage با یک type مشخص (مثلاً "DIVAR_AUTO_CHAT_EVENT") و یک source شناسایی‌شونده به بیرون بفرستد.
اگر بعد از patch شدن، دوباره این تابع اجرا شد (مثلاً به‌خاطر re-injection)، نباید دوباره patch کند — یک flag روی خودِ engine instance بگذارد (مثلاً engine.__divarAutoHooked = true) و چک کند.
اگر بعد از timeout module پیدا نشد، یک پیام خطا با postMessage بفرستد (type: "DIVAR_AUTO_HOOK_FAILED") تا content script بداند باید به یک fallback (مثلاً DOM observer قدیمی) برگردد.
تمام خطاها در try/catch باشند و به کنسول با prefix [DivarAuto:inject] لاگ شوند تا در محیط production قابل دیباگ باشند.

۲. content-bridge.js — content script معمولی (isolated world) که:

یک <script> tag با src = chrome.runtime.getURL('inject.js') را در ابتدای document_start به صفحه اضافه می‌کند (این تنها راه امن برای اجرای کد در MAIN world در Manifest V3 است؛ اگر "world": "MAIN" در content_scripts manifest پشتیبانی می‌شود در Chrome نسخهٔ فعلی، از آن هم می‌توان به‌جای script-injection استفاده کرد — هر دو روش را در کد بگذار و کامنت بگذار کدام ترجیح داده می‌شود).
به window.addEventListener('message', ...) گوش می‌دهد، فقط پیام‌هایی که event.source === window و event.data?.type === 'DIVAR_AUTO_CHAT_EVENT' هستند را قبول می‌کند (برای امنیت، مطمئن شو از هر iframe دیگری این پیام‌ها قبول نمی‌شوند).
پیام معتبر را با chrome.runtime.sendMessage به background service worker می‌فرستد.
اگر DIVAR_AUTO_HOOK_FAILED دریافت شد، یک لاگ هشدار در کنسول بگذارد و (اختیاری) به یک استراتژی fallback سوییچ کند.

۳. background.js (service worker) — گیرندهٔ پیام‌ها:

chrome.runtime.onMessage را listen کند، eventهایی با payload.type === "message" و payload.message.peer === true (یعنی پیام از طرف مقابل آمده، نه پیام خودمان) را به‌عنوان "پیام جدید ورودی" تشخیص دهد.
برای جلوگیری از پردازش تکراری، payload.message.id را در یک Set (یا chrome.storage.session) نگه دارد و duplicateها را نادیده بگیرد.
یک تابع placeholder به اسم handleNewIncomingMessage(chatId, messageData) بسازد که بعداً منطق اتوماسیون داخلش قرار می‌گیرد.
الزامات manifest.json
Manifest V3
content_scripts باید run_at: "document_start" داشته باشد.
web_accessible_resources باید شامل inject.js با matches محدود به دامنه‌های واقعی دیوار (مثلاً https://*.divar.ir/*) باشد — نه <all_urls>.
Permission لازم: scripting (اگر از chrome.scripting.executeScript با world: "MAIN" استفاده می‌کنی به‌جای script-tag injection).
الزامات robustness
کل مکانیزم به یک internal implementation detail از bundle دیوار (module id 66478) وابسته است که می‌تواند در آینده بدون هشدار تغییر کند. کد باید:
این وابستگی را در یک کامنت بالای فایل واضح مستند کند.
اگر module id عوض شد یا shape خروجی فرق کرد (مثلاً mod.T دیگر ingest نداشت)، error واضح لاگ کند نه silent fail.
در صورت شکست کامل hook، extension نباید crash کند؛ باید gracefully به حالت غیرفعال برود و در کنسول به‌وضوح بگوید که باید به‌صورت دستی بررسی و به‌روزرسانی شود.

لطفاً کد کامل هر سه فایل + تغییرات manifest.json را بنویس، با کامنت‌های فارسی/انگلیسی که توضیح دهد هر بخش چه می‌کند، مخصوصاً بخش‌های marshaling بین MAIN world و isolated world.