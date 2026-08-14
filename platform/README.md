# CRM چندکاناله ابری B2B — راهنمای فروش و راه‌اندازی



پلتفرم چنداپراتوره برای SMB: لید مشترک، اینباکس تجمیعی چند کانال، وظایف تیمی، AI پیشنهاد پاسخ، KPI/OKR.



کانال‌های فعلی: **WhatsApp (Baileys سرور — QR)** و **Divar (API سرور — OTP)**. افزونه Chrome حذف شده است.



## دو داشبورد جدا



| داشبورد | مسیر | مخاطب |

|---------|------|--------|

| **سوپر ادمین** | `/super` | مالک پلتفرم — همه کسب‌وکارها، پلن، AI سراسری، وضعیت سیستم |

| **کسب‌وکار** | `/login` → `/home` | مالک / اپراتور یک سازمان — لید، اینباکس، کانال، تیم، AI سازمان |



ورودها از هم جدا هستند (توکن `platform` در برابر توکن `org`).

**ورود/ثبت‌نام کسب‌وکار (فقط شماره):** `/login` → OTP.  
- شماره جدید → ساخت draft → ویزارد `/onboarding` (پروفایل → پلن → پرداخت → AI → راهنمای کانال) → داشبورد  
- شماره موجود با onboarding تمام‌شده → داشبورد  
- شماره موجود با ویزارد ناتمام → ادامه `/onboarding`  

**پرداخت:** پیش‌فرض `PAYMENT_PROVIDER=mock` (دمو آفلاین). برای زیبال: `zibal` + merchant تستی `zibal`. مبالغ پلن‌ها همان **ریال** است و بدون تبدیل به درگاه فرستاده می‌شود.  
Callback: `GET /api/payments/zibal/callback` → ریدایرکت به `/onboarding?paid=1` یا `/billing?paid=1`. برای تست لوکال API باید از اینترنت در دسترس باشد (tunnel).  
در پنل کسب‌وکار: صفحه **`/billing`** برای تمدید همان پلن یا ارتقا (مالک، از طریق `POST /api/payments/start`).

**اجرای لوکال:** `npm run start:all` از ریشه ریپو (API + Web + Workers + wa-connector + divar-connector).  
- بدون واتساپ: `node scripts/start-all.mjs --no-wa`  
- بدون دیوار: `node scripts/start-all.mjs --no-divar`  
- فقط کانکتورها: `npm run wa:dev` / `npm run divar:dev`

## اجزا



| جزء | مسیر | نقش |

|-----|------|-----|

| API | `platform/api` | منبع حقیقت سرور (`/admin/*`, `/channels`, `/internal/wa/*`, …) |

| Admin UI | `platform/web` | پنل فارسی سوپر ادمین + کسب‌وکار |

| WA Connector | `platform/wa-connector` | Baileys sidecar — QR، دریافت/ارسال واتساپ |

| Workers | `python -m app.workers.runner` | auto-reply / KPI |

| Extension | `WAchromeExtension` / dist | دیوار (+ واتساپ legacy) |



## اجرای سریع (دمو فروش)

پیشنهادی از ریشه ریپو:

```bash
npm run start:all
```

سپس دستی اگر لازم بود:

```bash
# 1) API (SQLite محلی)
cd platform/api

pip install -r requirements.txt

# اگر از نسخه قبلی می‌آیید:

python scripts/migrate_multichannel.py

python scripts/seed_demo.py

python -m uvicorn app.main:app --reload --port 8000



# 2) پنل ابری

cd platform/web

npm install

npm run dev

# http://localhost:3000/super/login  ← سوپر ادمین (OTP sms.ir)
# SUPER_ADMIN_PHONE و SMS را در platform/api/app/config.py تنظیم کنید
# ساخت کسب‌وکار → شماره مالک
# http://localhost:3000/login        ← پنل همان کسب‌وکار (OTP واقعی sms.ir)



# 3) Workers (اختیاری)

cd platform/api

python -m app.workers.runner



# 4) WhatsApp Baileys connector

cd platform/wa-connector

npm install

npm run dev

# http://127.0.0.1:8090/health

# پنل → کانال‌ها → اتصال واتساپ (QR) یا دیوار (OTP)

# 5) Divar connector

cd platform/divar-connector
pip install -r requirements.txt
python main.py
# http://127.0.0.1:8091/health
```



### تنظیمات API (`platform/api/app/config.py`)

تنظیمات از فایل `.env` خوانده **نمی‌شوند**؛ فقط از `config.py`:

- `super_admin_phone`
- `sms_ir_api_key` / `sms_ir_template_id` / `sms_ir_otp_param`
- `payment_provider` / `zibal_merchant_id` / …



## تولید (Production)



```bash

cd platform

docker compose up -d db redis

# DATABASE_URL=postgresql+psycopg://crm:crm@localhost:5432/wa_crm

# APP_ENV=production

# JWT_SECRET=<strong>

# SUPER_ADMIN_PHONE=...

# SMS_IR_API_KEY=...
# SMS_IR_TEMPLATE_ID=...

```



پلن‌ها (سقف **اعضای تیم** — کانال‌ها نامحدود):

- **starter**: ۲ عضو، AI suggest
- **growth**: ۵ عضو، AI auto-send
- **scale**: ۲۰ عضو، AI auto-send

کانال‌ها از داشبورد → **کانال‌ها** وصل می‌شوند (واتساپ QR / دیوار OTP). سرویس‌های `wa-connector` و `divar-connector` روی سرور باید روشن باشند.



## سناریوی فروش به مشتری



1. سوپر ادمین در `/super` کسب‌وکار + شماره مالک می‌سازد و پلن را تنظیم می‌کند  

2. مالک با OTP وارد `/login` می‌شود (یا سوپر ادمین «ورود به پنل» را می‌زند)  

3. اکانت‌های کانال (واتساپ QR / دیوار OTP) را در «کانال‌ها» وصل می‌کند  

4. یک PC/VPS همیشه روشن با `wa-connector` + `divar-connector`  

5. اپراتورها فقط پنل ابری  

6. دانش FAQ آپلود → پیشنهاد/ارسال AI  

7. KPI هفتگی برای مدیر  



### هویت لید دیوار

لیدهای دیوار با `external_chat_id` (chatId) و اختیاری `post_token` / عنوان آگهی شناسایی می‌شوند — شماره تلفن الزامی نیست.



## نکات ریسک (صریح به مشتری بگویید)



- مبتنی بر WhatsApp Web و DOM چت دیوار است (نه API رسمی Meta / Divar)  

- ارسال انبوه خطر محدودیت / مسدود شدن حساب دارد  

- یک نشست زنده مرورگر برای هر اکانت کانال لازم است (hybrid: کانکتور اول، بعد اپراتور آنلاین)  

- اتوماسیون ممکن است خلاف شرایط استفاده دیوار/واتساپ باشد

