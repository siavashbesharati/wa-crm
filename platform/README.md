# CRM چندکاناله ابری B2B — راهنمای فروش و راه‌اندازی



پلتفرم چنداپراتوره برای SMB: لید مشترک، اینباکس تجمیعی چند کانال، وظایف تیمی، AI پیشنهاد پاسخ، KPI/OKR.



کانال‌های فعلی: **WhatsApp Web** و **Divar Chat** (افزونه Chrome). کانال‌های بعدی با همان مدل `ChannelAccount` اضافه می‌شوند.



## دو داشبورد جدا



| داشبورد | مسیر | مخاطب |

|---------|------|--------|

| **سوپر ادمین** | `/super` | مالک پلتفرم — همه کسب‌وکارها، پلن، AI سراسری، وضعیت سیستم |

| **کسب‌وکار** | `/login` → `/home` | مالک / اپراتور یک سازمان — لید، اینباکس، کانال، تیم، AI سازمان |



ورودها از هم جدا هستند (توکن `platform` در برابر توکن `org`).

**ورود/ثبت‌نام کسب‌وکار (فقط شماره):** `/login` → OTP.  
- شماره جدید → ساخت draft → ویزارد `/onboarding` (پروفایل → پلن → پرداخت mock → راهنما/افزونه) → داشبورد  
- شماره موجود با onboarding تمام‌شده → داشبورد  
- شماره موجود با ویزارد ناتمام → ادامه `/onboarding`  

**دانلود افزونه در ویزارد:** فایل در `platform/web/public/downloads/iranexpedia-extension.zip`  
برای بازسازی ZIP از ریشه ریپو: `npm run pack:ext`

## اجزا



| جزء | مسیر | نقش |

|-----|------|-----|

| API | `platform/api` | منبع حقیقت سرور (`/admin/*`, `/channels`, …) |

| Admin UI | `platform/web` | پنل فارسی سوپر ادمین + کسب‌وکار |

| Workers | `python -m app.workers.runner` | auto-reply / KPI |

| Extension | `WAchromeExtension` / dist | پل چندکاناله + کانکتور |



## اجرای سریع (دمو فروش)



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

# http://localhost:3000/super/login  ← سوپر ادمین

# پیش‌فرض توسعه: 09000000000 / admin123

# ساخت کسب‌وکار → شماره مالک

# http://localhost:3000/login        ← پنل همان کسب‌وکار (OTP؛ mock: 123456)



# 3) Workers (اختیاری)

cd platform/api

python -m app.workers.runner



# 4) افزونه

# Chrome → Load unpacked → WAchromeExtension (یا dist)

# پاپ‌آپ → همان شماره مالک + OTP → واتساپ / دیوار

```



### متغیرهای سوپر ادمین (API `.env`)



```

SUPER_ADMIN_PHONE=09000000000

SUPER_ADMIN_PASSWORD=admin123

APP_ENV=development

OPENAI_API_KEY=

```



## تولید (Production)



```bash

cd platform

docker compose up -d db redis

# DATABASE_URL=postgresql+psycopg://crm:crm@localhost:5432/wa_crm

# APP_ENV=production

# JWT_SECRET=<strong>

# SUPER_ADMIN_PHONE=...

# SUPER_ADMIN_PASSWORD=<strong>

# MOCK_OTP فقط برای staging

```



پلن‌ها (سقف **صندلی افزونه هم‌زمان** — کانال‌ها نامحدود):

- **starter**: ۲ صندلی، AI suggest

- **growth**: ۵ صندلی، AI auto-send

- **scale**: ۲۰ صندلی، AI auto-send

هر نصب Chrome یک **توکن صندلی** یکتا می‌گیرد (منوی «صندلی افزونه»). بعد از اتصال روی همان نصب قفل می‌شود؛ مدیر می‌تواند ریست/حذف کند.



## سناریوی فروش به مشتری



1. سوپر ادمین در `/super` کسب‌وکار + شماره مالک می‌سازد و پلن را تنظیم می‌کند  

2. مالک با OTP وارد `/login` می‌شود (یا سوپر ادمین «ورود به پنل» را می‌زند)  

3. اکانت‌های کانال (واتساپ / دیوار) را در «کانال‌ها» ثبت می‌کند  

4. یک PC/VPS همیشه روشن = **کانکتور** (افزونه + تب‌های کانال)  

5. اپراتورها فقط پنل ابری + در صورت نیاز افزونه با نقش agent  

6. دانش FAQ آپلود → پیشنهاد/ارسال AI  

7. KPI هفتگی برای مدیر  



### هویت لید دیوار

لیدهای دیوار با `external_chat_id` (chatId) و اختیاری `post_token` / عنوان آگهی شناسایی می‌شوند — شماره تلفن الزامی نیست.



## نکات ریسک (صریح به مشتری بگویید)



- مبتنی بر WhatsApp Web و DOM چت دیوار است (نه API رسمی Meta / Divar)  

- ارسال انبوه خطر محدودیت / مسدود شدن حساب دارد  

- یک نشست زنده مرورگر برای هر اکانت کانال لازم است (hybrid: کانکتور اول، بعد اپراتور آنلاین)  

- اتوماسیون ممکن است خلاف شرایط استفاده دیوار/واتساپ باشد

