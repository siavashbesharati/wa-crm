# CRM چندکاناله ابری B2B — راهنمای فروش و راه‌اندازی

پلتفرم چنداپراتوره برای SMB: لید مشترک، اینباکس تجمیعی چند کانال، وظایف تیمی، AI پیشنهاد پاسخ، KPI/OKR.

کانال‌های فعلی: **WhatsApp Web** و **Divar Chat** (افزونه Chrome). کانال‌های بعدی با همان مدل `ChannelAccount` اضافه می‌شوند.

## اجزا

| جزء | مسیر | نقش |
|-----|------|-----|
| API | `platform/api` | منبع حقیقت سرور (`/channels`, `/messages`, …) |
| Admin | `platform/web` | پنل فارسی مدیران/اپراتورها |
| Workers | `python -m app.workers.runner` | auto-reply / KPI |
| Extension | `WAchromeExtension` / dist | پل چندکاناله + کانکتور |

## اجرای سریع (دمو فروش)

```bash
# 1) API (SQLite محلی)
cd platform/api
pip install -r requirements.txt
# If stuck on Preparing metadata: Ctrl+C (Python 3.14 already has deps)
# اگر API در حال اجراست و از نسخه قبلی می‌آیید: اول سرور را متوقف کنید،
# سپس یا wa_crm.db را حذف کنید یا: python scripts/migrate_multichannel.py
python scripts/seed_demo.py
python -m uvicorn app.main:app --reload --port 8000

# 2) پنل ابری
cd platform/web
npm install
npm run dev
# http://localhost:3000
# موبایل: 09120000000  کد: 123456

# 3) Workers (اختیاری)
cd platform/api
python -m app.workers.runner

# 4) افزونه
# در ریشه ریپو: npm run build:ext
# Chrome → Load unpacked → WAchromeExtension-dist
# پاپ‌آپ → OTP → انتخاب کانال (واتساپ / دیوار) → نقش connector → ذخیره اتصال
# تب web.whatsapp.com و/یا divar.ir/chat را باز بگذارید
```

## تولید (Production)

```bash
cd platform
docker compose up -d db redis
# DATABASE_URL=postgresql+psycopg://crm:crm@localhost:5432/wa_crm
# APP_ENV=production  JWT_SECRET=<strong>  MOCK_OTP فقط برای staging
```

پلن‌ها (سقف **اکانت کانال**):
- **starter**: ۲ اکانت، ۳ کاربر، AI suggest
- **growth**: ۶ اکانت، ۱۰ کاربر، AI auto-send
- **scale**: ۲۰ اکانت، ۵۰ کاربر

## سناریوی فروش به مشتری

1. Owner با OTP وارد پنل می‌شود و پلن را انتخاب می‌کند  
2. اکانت‌های کانال (واتساپ / دیوار) را در «کانال‌ها» ثبت می‌کند  
3. یک PC/VPS همیشه روشن = **کانکتور** (افزونه + تب‌های کانال)  
4. اپراتورها فقط پنل ابری + در صورت نیاز افزونه با نقش agent  
5. دانش FAQ آپلود → پیشنهاد/ارسال AI  
6. KPI هفتگی برای مدیر  

### هویت لید دیوار
لیدهای دیوار با `external_chat_id` (chatId) و اختیاری `post_token` / عنوان آگهی شناسایی می‌شوند — شماره تلفن الزامی نیست.

## نکات ریسک (صریح به مشتری بگویید)

- مبتنی بر WhatsApp Web و DOM چت دیوار است (نه API رسمی Meta / Divar)  
- ارسال انبوه خطر محدودیت / مسدود شدن حساب دارد  
- یک نشست زنده مرورگر برای هر اکانت کانال لازم است (hybrid: کانکتور اول، بعد اپراتور آنلاین)  
- اتوماسیون ممکن است خلاف شرایط استفاده دیوار/واتساپ باشد
