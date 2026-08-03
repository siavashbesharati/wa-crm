# CRM واتساپ ابری B2B — راهنمای فروش و راه‌اندازی

پلتفرم چنداپراتوره برای SMB: لید مشترک، اینباکس تجمیعی چند شماره واتساپ، وظایف تیمی، AI پیشنهاد پاسخ، KPI/OKR. کانال v1 = WhatsApp Web + افزونه Chrome.

## اجزا

| جزء | مسیر | نقش |
|-----|------|-----|
| API | `platform/api` | منبع حقیقت سرور |
| Admin | `platform/web` | پنل فارسی مدیران/اپراتورها |
| Workers | `python -m app.workers.runner` | auto-reply / KPI |
| Extension | `WAchromeExtension` / dist | پل واتساپ + کانکتور |

## اجرای سریع (دمو فروش)

```bash
# 1) API (SQLite محلی)
cd platform/api
pip install -r requirements.txt
# If stuck on Preparing metadata: Ctrl+C (Python 3.14 already has deps)
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
# پاپ‌آپ → بخش «ابر تیمی» → OTP → نقش connector → ذخیره اتصال
```

## تولید (Production)

```bash
cd platform
docker compose up -d db redis
# DATABASE_URL=postgresql+psycopg://crm:crm@localhost:5432/wa_crm
# APP_ENV=production  JWT_SECRET=<strong>  MOCK_OTP فقط برای staging
```

پلن‌ها:
- **starter**: ۱ شماره، ۳ کاربر، AI suggest
- **growth**: ۳ شماره، ۱۰ کاربر، AI auto-send
- **scale**: ۱۰ شماره، ۵۰ کاربر

## سناریوی فروش به مشتری

1. Owner با OTP وارد پنل می‌شود و پلن را انتخاب می‌کند  
2. شماره(های) واتساپ را ثبت می‌کند  
3. یک PC/VPS همیشه روشن = **کانکتور** (افزونه + واتساپ وب)  
4. اپراتورها فقط پنل ابری + در صورت نیاز افزونه با نقش agent  
5. دانش FAQ آپلود → پیشنهاد/ارسال AI  
6. KPI هفتگی برای مدیر

## نکات ریسک (صریح به مشتری بگویید)

- مبتنی بر WhatsApp Web است (نه Cloud API رسمی Meta)  
- ارسال انبوه خطر محدودیت دارد  
- یک نشست زنده مرورگر برای هر شماره لازم است (hybrid: کانکتور اول، بعد اپراتور آنلاین)
