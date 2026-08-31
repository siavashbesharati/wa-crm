"""Comprehensive demo seed — sales showcase for "دپارتمان ملک پارامیس".

Creates a fully-populated business org for product demos:
- 4 connected channels (WhatsApp x2 + Divar + Bale)
- Owner + 3 operators (team)
- 30 realistic real-estate leads across every pipeline stage
- Natural Persian WhatsApp-style conversations (خرید / اجاره / بازدید / معامله)
- Tasks in every status (open / in_progress / done)
- 4 knowledge-base documents (neighborhoods + pricing + rules)
- 2 campaigns (1 completed, 1 running)
- 3 OKR objectives with progress
- KPI snapshots (12 weeks history)
- AI policy tuned for real-estate tone
- Support ticket + audit events + payments

Idempotent: re-running only fills gaps (it never duplicates the org / user).

Usage:
  cd platform/api
  python scripts/seed_demo_full.py
  python scripts/seed_demo_full.py --conversations --replace
"""

from __future__ import annotations

import importlib.util
import random
import sys
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import text  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.database import Base, SessionLocal, engine  # noqa: E402
from app.models import (  # noqa: E402
    AiEvent, AiPolicy, AuditEvent, BaleAuthState, Campaign, CampaignSend,
    ChannelAccount, ChannelType, ConnectorSession, DivarAuthState,
    KpiDefinition, KpiSnapshot, KnowledgeChunk, KnowledgeDoc, Lead,
    LeadAccountLink, MemberRole, Membership, Message, MessageDirection,
    OkrObjective, Organization, OrgCoachProfile, OutboundJob, OutboundStatus,
    Payment, SenderType, SupportMessage, SupportTicket, Task, TaskStatus,
    User, WaAuthState,
)
from app.services.embeddings import chunk_text, embed_text  # noqa: E402
from app.services.phone import normalize_phone_for_storage  # noqa: E402

# Local curated inbox scripts (natural Farsi real-estate flows)
_SCRIPTS = Path(__file__).resolve().parent / "demo_conversations.py"
_spec = importlib.util.spec_from_file_location("demo_conversations", _SCRIPTS)
_demo_conv = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(_demo_conv)
build_conversation = _demo_conv.build_conversation

settings = get_settings()
DEMO_ORG_NAME = settings.demo_org_name
DEMO_OWNER_PHONE = settings.demo_owner_phone
DEMO_OWNER_NAME = settings.demo_owner_name

# ---------------------------------------------------------------------------
# Static demo data
# ---------------------------------------------------------------------------

OPERATORS = [
    {"phone": "09121110001", "name": "علی محمدی", "role": MemberRole.admin},
    {"phone": "09121110002", "name": "مریم احمدی", "role": MemberRole.agent},
    {"phone": "09121110003", "name": "حسین رضایی", "role": MemberRole.agent},
    {"phone": "09121110004", "name": "مهندس لطفی", "role": MemberRole.agent},
]

CHANNELS = [
    {"channel": ChannelType.whatsapp, "label": "واتساپ فروش پارامیس",  "external_id": "989121234567", "status": "offline", "pairing_state": "disconnected", "wa_jid": "", "connector_type": "baileys"},
    {"channel": ChannelType.whatsapp, "label": "واتساپ اجاره پارامیس",  "external_id": "989121234568", "status": "offline", "pairing_state": "disconnected", "wa_jid": "", "connector_type": "baileys"},
    {"channel": ChannelType.divar,    "label": "دیوار — شعبه مرکزی",    "external_id": "divar-paramis", "status": "offline", "pairing_state": "disconnected", "wa_jid": "", "connector_type": "divar_api"},
    {"channel": ChannelType.bale,     "label": "بله — پشتیبانی پارامیس", "external_id": "bale-paramis",  "status": "offline", "pairing_state": "disconnected", "wa_jid": "", "connector_type": "bale_api"},
]

# Stages match CRM board: جدید → پیگیری → پیشنهاد → خرید → بسته
LEADS = [
    {"name": "جواد کریمی", "phone": "09121111101", "stage": "جدید", "area": "نیاوران", "intent": "خرید", "type": "آپارتمان", "budget": "۲۵ میلیارد", "size": 180, "rooms": "۳ خواب", "floor": 4, "year": 1400, "source": "whatsapp", "tags": ["vip", "خریدار جدی"], "score": 82, "assignee": "علی محمدی"},
    {"name": "لیلا حسینی", "phone": "09121111102", "stage": "جدید", "area": "فرمانیه", "intent": "اجاره", "type": "آپارتمان", "budget": "۶۵ میلیون", "size": 120, "rooms": "۲ خواب", "floor": 2, "year": 1395, "source": "divar", "tags": ["پرچم‌دار"], "score": 64, "assignee": "مریم احمدی"},
    {"name": "امیر نوری", "phone": "09121111103", "stage": "جدید", "area": "ولنجک", "intent": "خرید", "type": "ویلا", "budget": "۶۰ میلیارد", "size": 450, "rooms": "۵ خواب", "floor": 0, "year": 1402, "source": "whatsapp", "tags": ["سرمایه‌گذاری"], "score": 88, "assignee": "علی محمدی"},
    {"name": "مهندس صادقی", "phone": "09121111104", "stage": "جدید", "area": "سعادت‌آباد", "intent": "خرید", "type": "آپارتمان", "budget": "۱۸ میلیارد", "size": 140, "rooms": "۳ خواب", "floor": 3, "year": 1398, "source": "bale", "tags": ["نقد"], "score": 71, "assignee": "حسین رضایی", "bale_uid": 381966101},
    {"name": "سارا مرادی", "phone": "09121111105", "stage": "جدید", "area": "شهرک غرب", "intent": "اجاره", "type": "آپارتمان", "budget": "۸۰ میلیون", "size": 160, "rooms": "۳ خواب", "floor": 5, "year": 1397, "source": "whatsapp", "tags": ["مبله"], "score": 59, "assignee": "مریم احمدی"},
    {"name": "رضا زارع", "phone": "09121111106", "stage": "جدید", "area": "تجریش", "intent": "خرید", "type": "مغازه", "budget": "۱۲ میلیارد", "size": 80, "rooms": "—", "floor": 0, "year": 1385, "source": "divar", "tags": ["تجاری"], "score": 67, "assignee": "علی محمدی"},
    {"name": "نرگس فلاحی", "phone": "09121111107", "stage": "جدید", "area": "ونک", "intent": "خرید", "type": "آپارتمان", "budget": "۳۰ میلیارد", "size": 200, "rooms": "۳ خواب", "floor": 8, "year": 1399, "source": "whatsapp", "tags": ["ویو"], "score": 76, "assignee": "حسین رضایی"},
    {"name": "حسین غلامی", "phone": "09121111108", "stage": "پیگیری", "area": "زعفرانیه", "intent": "خرید", "type": "آپارتمان", "budget": "۴۵ میلیارد", "size": 250, "rooms": "۴ خواب", "floor": 6, "year": 1401, "source": "whatsapp", "tags": ["ویو باز"], "score": 91, "assignee": "علی محمدی"},
    {"name": "دکتر اکبری", "phone": "09121111109", "stage": "پیگیری", "area": "قیطریه", "intent": "خرید", "type": "آپارتمان", "budget": "۲۸ میلیارد", "size": 170, "rooms": "۳ خواب", "floor": 3, "year": 1396, "source": "whatsapp", "tags": ["وام‌دار"], "score": 78, "assignee": "مریم احمدی"},
    {"name": "مریم رنجبر", "phone": "09121111110", "stage": "پیگیری", "area": "پاسداران", "intent": "اجاره", "type": "آپارتمان", "budget": "۴۵ میلیون", "size": 110, "rooms": "۲ خواب", "floor": 2, "year": 1390, "source": "divar", "tags": ["مستاجر"], "score": 55, "assignee": "حسین رضایی"},
    {"name": "کاوه توکلی", "phone": "09121111111", "stage": "پیگیری", "area": "جردن", "intent": "خرید", "type": "آپارتمان", "budget": "۳۵ میلیارد", "size": 190, "rooms": "۳ خواب", "floor": 7, "year": 1398, "source": "bale", "tags": ["پارکینگ"], "score": 83, "assignee": "علی محمدی", "bale_uid": 381966111},
    {"name": "الناز سلطانی", "phone": "09121111112", "stage": "پیگیری", "area": "کامرانیه", "intent": "خرید", "type": "ویلا", "budget": "۹۰ میلیارد", "size": 600, "rooms": "۶ خواب", "floor": 0, "year": 1395, "source": "whatsapp", "tags": ["استخر"], "score": 87, "assignee": "مریم احمدی"},
    {"name": "مهدی موسوی", "phone": "09121111113", "stage": "پیگیری", "area": "اقدسیه", "intent": "خرید", "type": "زمین", "budget": "۲۰ میلیارد", "size": 500, "rooms": "—", "floor": 0, "year": 0, "source": "divar", "tags": ["زمین"], "score": 70, "assignee": "حسین رضایی"},
    {"name": "زهرا نجفی", "phone": "09121111114", "stage": "پیگیری", "area": "یوسف‌آباد", "intent": "اجاره", "type": "آپارتمان", "budget": "۳۵ میلیون", "size": 95, "rooms": "۲ خواب", "floor": 1, "year": 1385, "source": "whatsapp", "tags": ["قدیمی"], "score": 48, "assignee": "علی محمدی"},
    {"name": "سعید صالحی", "phone": "09121111115", "stage": "پیشنهاد", "area": "فرشته", "intent": "خرید", "type": "آپارتمان", "budget": "۵۵ میلیارد", "size": 280, "rooms": "۴ خواب", "floor": 9, "year": 1402, "source": "whatsapp", "tags": ["برند"], "score": 94, "assignee": "علی محمدی"},
    {"name": "شیوا عابدی", "phone": "09121111116", "stage": "پیشنهاد", "area": "الهیه", "intent": "خرید", "type": "پنت‌هاوس", "budget": "۸۰ میلیارد", "size": 350, "rooms": "۴ خواب", "floor": 15, "year": 1403, "source": "whatsapp", "tags": ["لوکس"], "score": 96, "assignee": "مریم احمدی"},
    {"name": "نیما مومنی", "phone": "09121111117", "stage": "پیشنهاد", "area": "دروس", "intent": "خرید", "type": "آپارتمان", "budget": "۳۸ میلیارد", "size": 210, "rooms": "۳ خواب", "floor": 4, "year": 1399, "source": "bale", "tags": ["نوساز"], "score": 89, "assignee": "حسین رضایی", "bale_uid": 381966117},
    {"name": "پریسا آقاجانی", "phone": "09121111118", "stage": "پیشنهاد", "area": "اختیاریه", "intent": "خرید", "type": "آپارتمان", "budget": "۲۲ میلیارد", "size": 130, "rooms": "۲ خواب", "floor": 3, "year": 1394, "source": "divar", "tags": ["بازسازی"], "score": 73, "assignee": "علی محمدی"},
    {"name": "آرش حیدری", "phone": "09121111119", "stage": "پیشنهاد", "area": "محمودیه", "intent": "اجاره", "type": "آپارتمان", "budget": "۵۰ میلیون", "size": 130, "rooms": "۲ خواب", "floor": 4, "year": 1393, "source": "whatsapp", "tags": ["بالکن"], "score": 62, "assignee": "مریم احمدی"},
    {"name": "دکتر کاشانی", "phone": "09121111120", "stage": "پیشنهاد", "area": "امام‌زاده قاسم", "intent": "خرید", "type": "باغ ویلا", "budget": "۳۵ میلیارد", "size": 800, "rooms": "۴ خواب", "floor": 0, "year": 1390, "source": "whatsapp", "tags": ["ویلای شمالی"], "score": 81, "assignee": "حسین رضایی"},
    {"name": "بهرام باقری", "phone": "09121111121", "stage": "خرید", "area": "شهرک قدس", "intent": "خرید", "type": "آپارتمان", "budget": "۲۶ میلیارد", "size": 155, "rooms": "۳ خواب", "floor": 5, "year": 1398, "source": "whatsapp", "tags": ["قیمت نهایی"], "score": 92, "assignee": "علی محمدی"},
    {"name": "رویا شفیعی", "phone": "09121111122", "stage": "خرید", "area": "آریاشهر", "intent": "اجاره", "type": "آپارتمان", "budget": "۷۰ میلیون", "size": 145, "rooms": "۳ خواب", "floor": 3, "year": 1396, "source": "bale", "tags": ["رهن کامل"], "score": 79, "assignee": "مریم احمدی", "bale_uid": 381966122},
    {"name": "فرهاد ناصری", "phone": "09121111123", "stage": "خرید", "area": "صادقیه", "intent": "خرید", "type": "آپارتمان", "budget": "۱۵ میلیارد", "size": 105, "rooms": "۲ خواب", "floor": 2, "year": 1392, "source": "divar", "tags": ["پای معامله"], "score": 85, "assignee": "حسین رضایی"},
    {"name": "ندا حسامی", "phone": "09121111124", "stage": "خرید", "area": "پونک", "intent": "خرید", "type": "آپارتمان", "budget": "۲۱ میلیارد", "size": 135, "rooms": "۲ خواب", "floor": 4, "year": 1397, "source": "whatsapp", "tags": ["نقلی"], "score": 88, "assignee": "علی محمدی"},
    {"name": "پارسا عبادی", "phone": "09121111125", "stage": "خرید", "area": "جردن", "intent": "خرید", "type": "دفتر کار", "budget": "۴۰ میلیارد", "size": 220, "rooms": "۵ اتاق", "floor": 6, "year": 1395, "source": "whatsapp", "tags": ["اداری"], "score": 84, "assignee": "مریم احمدی"},
    {"name": "مجید رستمی", "phone": "09121111126", "stage": "بسته", "area": "نیاوران", "intent": "خرید", "type": "آپارتمان", "budget": "۳۲ میلیارد", "size": 175, "rooms": "۳ خواب", "floor": 3, "year": 1399, "source": "whatsapp", "tags": ["فروش"], "score": 100, "assignee": "علی محمدی"},
    {"name": "مهسا افضلی", "phone": "09121111127", "stage": "بسته", "area": "سعادت‌آباد", "intent": "خرید", "type": "آپارتمان", "budget": "۱۹ میلیارد", "size": 125, "rooms": "۲ خواب", "floor": 2, "year": 1396, "source": "divar", "tags": ["فروش"], "score": 100, "assignee": "مریم احمدی"},
    {"name": "علی کاظمی", "phone": "09121111128", "stage": "بسته", "area": "تجریش", "intent": "اجاره", "type": "آپارتمان", "budget": "۵۵ میلیون", "size": 140, "rooms": "۲ خواب", "floor": 4, "year": 1393, "source": "whatsapp", "tags": ["اجاره"], "score": 100, "assignee": "حسین رضایی"},
    {"name": "دکتر شایان", "phone": "09121111129", "stage": "بسته", "area": "قیطریه", "intent": "خرید", "type": "ویلا", "budget": "۷۰ میلیارد", "size": 500, "rooms": "۵ خواب", "floor": 0, "year": 1398, "source": "bale", "tags": ["فروش"], "score": 100, "assignee": "علی محمدی", "bale_uid": 381966129},
    {"name": "هانیه متین", "phone": "09121111130", "stage": "بسته", "area": "پاسداران", "intent": "اجاره", "type": "آپارتمان", "budget": "۴۰ میلیون", "size": 100, "rooms": "۲ خواب", "floor": 1, "year": 1385, "source": "whatsapp", "tags": ["اجاره"], "score": 100, "assignee": "مریم احمدی"},
]

TASKS = [
    ("تماس با مالک آپارتمان نیاوران", 0,  "in_progress", 0,  "manual", "علی محمدی"),
    ("ارسال فایل پنت‌هاوس الهیه به خانم عابدی", 15, "open",        1,  "ai",     "مریم احمدی"),
    ("هماهنگی بازدید ویلای کامرانیه",          11, "open",        2,  "manual", "مریم احمدی"),
    ("تنظیم قولنامه مغازه تجریش",              5,  "in_progress", 3,  "manual", "علی محمدی"),
    ("پیگیری بازپرداخت وام آقای اکبری",         8,  "open",        5,  "manual", "مریم احمدی"),
    ("ارسال قرارداد اجاره برای آقای کاظمی",     27, "done",       -2,  "manual", "حسین رضایی"),
    ("تشکر از مشتری پس از تحویل کلید",         25, "done",       -7,  "ai",     "علی محمدی"),
    ("آپلود عکس‌های جدید باغ ویلای امام‌زاده قاسم", 19, "open", 1, "manual", "حسین رضایی"),
    ("پیگیری نظرسنجی از خانم متین",             29, "done",       -1,  "ai",     "مریم احمدی"),
    ("بررسی مدارک شناسایی خانم عابدی",          15, "in_progress", 0,  "manual", "مریم احمدی"),
]

KNOWLEDGE_DOCS = [
    {
        "title": "راهنمای محله‌های شمال تهران",
        "content": (
            "نیاوران: یکی از گران‌ترین محله‌های شمال تهران. دسترسی عالی به مترو و بزرگراه صدر. "
            "میانگین قیمت آپارتمان نوساز ۱۸۰ متری در نیاوران ۳۰ تا ۴۰ میلیارد تومان است.\n"
            "فرمانیه: محله‌ای خانوادگی با مدارس خوب و بازار مدرن. قیمت‌ها ۲۰ تا ۳۰ درصد پایین‌تر از نیاوران است.\n"
            "ولنجک: منطقه‌ای لوکس با ویلاهای بزرگ. مناسب سرمایه‌گذاری بلندمدت. قیمت هر متر مربع بالای ۲۰۰ میلیون تومان.\n"
            "زعفرانیه: ترکیب آپارتمان‌های لوکس و ویلا. ویژه طبقه مرفه. دسترسی خوب به تجریش و شمال."
        ),
    },
    {
        "title": "راهنمای قیمت ملک در سعادت‌آباد و شهرک غرب",
        "content": (
            "سعادت‌آباد: از پرطرفدارترین مناطق غرب تهران. قیمت هر متر مربع آپارتمان نوساز ۱۲۰ تا ۱۸۰ میلیون تومان. "
            "برج‌های مدرن با امکانات ورزشی و امنیتی.\n"
            "شهرک غرب: مدرن‌ترین محله غرب تهران با معماری روز. مناسب خانواده‌های جوان. "
            "قیمت‌ها بین ۱۰۰ تا ۱۵۰ میلیون تومان هر متر مربع."
        ),
    },
    {
        "title": "مراحل خرید ملک در تهران",
        "content": (
            "۱. انتخاب ملک و بازدید حضوری\n"
            "۲. بررسی مدارک مالکیت و استعلام از شهرداری\n"
            "۳. مذاکره نهایی و توافق بر سر قیمت\n"
            "۴. تنظیم بیع‌نامه در دفتر اسناد رسمی\n"
            "۵. پرداخت پیش‌پرداخت و دریافت رسید\n"
            "۶. تنظیم قرارداد در دفترخانه و انتقال سند\n"
            "مدت زمان معمول از بیع‌نامه تا سند نهایی: ۲ تا ۴ هفته."
        ),
    },
    {
        "title": "سوالات متداول مشتریان",
        "content": (
            "سوال: آیا امکان رهن کامل وجود دارد؟\n"
            "پاسخ: بستگی به مالک دارد. معمولاً برای آپارتمان‌های بالای ۲۰۰ متر، رهن کامل با ۵۰٪ تخفیف ممکن است.\n\n"
            "سوال: کمیسیون دپارتمان پارامیس چقدر است؟\n"
            "پاسخ: برای خرید ۱٪ و برای اجاره یک ماه اجاره. در خریدهای بالای ۲۰ میلیارد، ۰.۵٪ تخفیف.\n\n"
            "سوال: آیا وام بانکی برای خرید ملک پیشنهاد می‌کنید؟\n"
            "پاسخ: بله، با همکاری ۳ بانک معتبر، وام با سود ۱۸٪ و بازپرداخت ۱۲ ساله."
        ),
    },
]

CAMPAIGNS = [
    {
        "name": "کمپین نوروزی — آپارتمان‌های نیاوران",
        "status": "completed",
        "template": (
            "سلام {name} عزیز،\n"
            "دپارتمان ملک پارامیس پیشاپیش فرا رسیدن سال نو را تبریک می‌گوید. "
            "پیشنهاد ویژه نوروزی: ۱۰٪ تخفیف کمیسیون برای معاملات تا پایان فروردین. 🌷"
        ),
        "segment": {"tags": ["vip", "خریدار جدی"], "stages": ["جدید", "پیگیری"], "min_score": 60, "include_groups": False},
        "days_back": 30,
    },
    {
        "name": "کمپین فعال — پنت‌هاوس و ویلاهای لوکس",
        "status": "running",
        "template": (
            "سلام {name} عزیز،\n"
            "مجموعه‌ای از ویلاهای لوکس شمال تهران وارد فایل ما شده. "
            "در صورت تمایل برای بازدید رایگان هماهنگ می‌کنیم. 🏡"
        ),
        "segment": {"tags": ["vip", "لوکس", "برند"], "stages": ["پیشنهاد", "خرید"], "min_score": 75, "include_groups": False},
        "days_back": 4,
    },
]

BULK_TARGETS = {
    "کمپین نوروزی — آپارتمان‌های نیاوران": 200,
    "کمپین فعال — پنت‌هاوس و ویلاهای لوکس": 150,
}

BULK_FIRST = [
    "محمد", "علی", "حسین", "مهدی", "رضا", "امیر", "متین", "آرمان", "پویا", "سهیل",
    "سعید", "نیما", "امید", "بهرام", "فرهاد", "کاوه", "شایان", "آرش", "پارسا", "بابک",
    "نگار", "شیدا", "الناز", "سارا", "مریم", "فاطمه", "زهرا", "نرگس", "گلنار", "لیلا",
    "آیدا", "شیوا", "پریسا", "رویا", "ندا", "مونا", "ترانه", "سپیده", "یاسمین", "الهام",
]
BULK_LAST = [
    "رضایی", "کریمی", "احمدی", "محمدی", "حسینی", "قاسمی", "موسوی", "تقوی", "صبوری",
    "کاظمی", "نوری", "عباسی", "همتی", "آزاد", "شریفی", "مظفری", "باقری", "صادقی",
    "نجفی", "رستمی", "فلاحی", "ایمانی", "توکلی", "بهرامی", "مرادی",
]

OKRS = [
    {"title": "بستن ۱۵ فروش در فصل بهار",        "target": 15,  "current": 8,  "period": "quarter", "assignee": "علی محمدی"},
    {"title": "رسیدن به ۹۰٪ رضایت مشتریان",      "target": 90,  "current": 87, "period": "quarter", "assignee": "مریم احمدی"},
    {"title": "افزایش فایل‌های فعال به ۱۲۰ ملک", "target": 120, "current": 96, "period": "month",  "assignee": "حسین رضایی"},
]

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _ensure_owner(db):
    user = db.query(User).filter(User.phone == DEMO_OWNER_PHONE).first()
    if not user:
        user = User(phone=DEMO_OWNER_PHONE, display_name=DEMO_OWNER_NAME)
        db.add(user)
        db.flush()
    elif not user.display_name:
        user.display_name = DEMO_OWNER_NAME
        db.add(user)
    return user


def _ensure_org(db, owner):
    membership = (
        db.query(Membership)
        .filter(Membership.user_id == owner.id)
        .order_by(Membership.created_at.asc())
        .first()
    )
    if membership:
        org = db.get(Organization, membership.org_id)
    else:
        org = (
            db.query(Organization)
            .filter(Organization.name == DEMO_ORG_NAME)
            .first()
        )
        if not org:
            org = Organization(
                name=DEMO_ORG_NAME,
                plan="growth",
                status="active",
                onboarding_step="done",
                industry="املاک و مستغلات",
                city="تهران",
                plan_expires_at=datetime.utcnow() + timedelta(days=365),
            )
            db.add(org)
            db.flush()
        membership = Membership(org_id=org.id, user_id=owner.id, role=MemberRole.owner)
        db.add(membership)

    if not db.query(AiPolicy).filter(AiPolicy.org_id == org.id).first():
        db.add(
            AiPolicy(
                org_id=org.id,
                auto_send_enabled=True,
                min_confidence=0.6,
                group_reply_mode="keywords",
                group_keywords=["قیمت", "بازدید", "خرید", "اجاره"],
                allowed_stages=["جدید", "پیگیری", "پیشنهاد", "خرید"],
                business_hours_only=False,
                hours_start="09:00",
                hours_end="21:00",
                agent_role=(
                    "یک مشاور املاک حرفه‌ای در دپارتمان ملک پارامیس هستی. "
                    "لحن رسمی-دوستانه، کوتاه و مؤدبانه. به فارسی پاسخ بده. "
                    "اگر در مورد قیمت یا بازدید سؤال شد، زمان بازدید هماهنگ کن."
                ),
                system_prompt=(
                    "تو دستیار فروش دپارتمان ملک پارامیس هستی. "
                    "اطلاعات تو دربارهٔ محله‌ها، قیمت‌ها و آماده‌سازی قرارداد کامل است."
                ),
                fallback_message=(
                    "سلام، پیامتون رو دریافت کردم. یکی از همکارانم بزودی پاسخ می‌دن. 🙏"
                ),
                auto_apply_stage=False,
                pause_bot_on_escalate=True,
            )
        )

    if not db.query(OrgCoachProfile).filter(OrgCoachProfile.org_id == org.id).first():
        db.add(
            OrgCoachProfile(
                org_id=org.id,
                niche="املاک و مستغلات",
                audience="خریداران و مستأجران نهایی در تهران، به‌ویژه مناطق شمال و غرب",
                tone="formal-friendly",
                goals=["افزایش فروش فصلی", "رضایت مشتری", "برندینگ محلی"],
                offers="تخفیف کمیسیون برای معاملات بالای ۲۰ میلیارد، بازدید رایگان، مشاوره حقوقی رایگان",
                banned_phrases="ارزان، تضمین سود، بی‌واسطه، قولنامه دستی",
                wizard_completed=True,
            )
        )

    return org

def _ensure_operators(db, org):
    out = {}
    for op in OPERATORS:
        u = db.query(User).filter(User.phone == op["phone"]).first()
        if not u:
            u = User(phone=op["phone"], display_name=op["name"])
            db.add(u)
            db.flush()
        m = (
            db.query(Membership)
            .filter(Membership.user_id == u.id, Membership.org_id == org.id)
            .first()
        )
        if not m:
            db.add(Membership(org_id=org.id, user_id=u.id, role=op["role"]))
        out[op["name"]] = u
    return out


def _ensure_channels(db, org):
    accounts = []
    for ch in CHANNELS:
        acc = (
            db.query(ChannelAccount)
            .filter(
                ChannelAccount.org_id == org.id,
                ChannelAccount.channel == ch["channel"],
                ChannelAccount.label == ch["label"],
            )
            .first()
        )
        if not acc:
            acc = ChannelAccount(
                org_id=org.id,
                channel=ch["channel"],
                label=ch["label"],
                external_id=ch["external_id"],
                status=ch["status"],
                connector_type=ch["connector_type"],
                pairing_state=ch["pairing_state"],
                wa_jid=ch.get("wa_jid", ""),
            )
            db.add(acc)
            db.flush()
        else:
            acc.status = ch["status"]
            acc.pairing_state = ch["pairing_state"]
            acc.connector_type = ch["connector_type"]
            if ch.get("wa_jid"):
                acc.wa_jid = ch["wa_jid"]
            db.add(acc)

        if ch["channel"] == ChannelType.whatsapp and ch["status"] == "connected":
            if not db.query(WaAuthState).filter(WaAuthState.account_id == acc.id).first():
                db.add(WaAuthState(account_id=acc.id, creds_enc="DEMO", keys_enc="DEMO"))
        elif ch["channel"] == ChannelType.divar:
            if not db.query(DivarAuthState).filter(DivarAuthState.account_id == acc.id).first():
                db.add(
                    DivarAuthState(
                        account_id=acc.id,
                        cookies_enc="DEMO",
                        pending_enc="",
                        cursors_json='{"last_sync": "2026-08-26T00:00:00Z"}',
                    )
                )
        elif ch["channel"] == ChannelType.bale:
            if not db.query(BaleAuthState).filter(BaleAuthState.account_id == acc.id).first():
                db.add(
                    BaleAuthState(
                        account_id=acc.id,
                        token_enc="DEMO",
                        pending_enc="",
                        cursors_json='{"last_sync": "2026-08-26T00:00:00Z"}',
                    )
                )

        for Model, attr in (
            (WaAuthState, "account_id"),
            (DivarAuthState, "account_id"),
            (BaleAuthState, "account_id"),
            (ConnectorSession, "account_id"),
        ):
            stale = db.query(Model).filter(getattr(Model, attr) == acc.id).first()
            if stale:
                db.delete(stale)
        accounts.append(acc)
    return accounts

def _lead_phone(row: dict) -> str:
    return normalize_phone_for_storage(row["phone"]) or row["phone"]


def _lead_external_id(row: dict) -> str | None:
    source = row.get("source") or "whatsapp"
    if source == "bale":
        uid = row.get("bale_uid") or abs(hash(row["phone"])) % 900_000_000 + 100_000_000
        return f"bale:user:{uid}"
    if source == "divar":
        return row.get("phone")
    return None


def _ensure_leads(db, org, accounts, users):
    existing_count = db.query(Lead).filter(Lead.org_id == org.id).count()
    if existing_count >= len(LEADS):
        return db.query(Lead).filter(Lead.org_id == org.id).all()

    wa_accounts = [a for a in accounts if a.channel == ChannelType.whatsapp]
    divar_accounts = [a for a in accounts if a.channel == ChannelType.divar]
    bale_accounts = [a for a in accounts if a.channel == ChannelType.bale]

    leads = []
    for idx, row in enumerate(LEADS):
        phone = _lead_phone(row)
        lead = (
            db.query(Lead)
            .filter(Lead.org_id == org.id, Lead.phone == phone)
            .first()
        )
        if lead:
            leads.append(lead)
            continue

        if row["source"] == "whatsapp" and wa_accounts:
            account = wa_accounts[0]
        elif row["source"] == "divar" and divar_accounts:
            account = divar_accounts[0]
        elif row["source"] == "bale" and bale_accounts:
            account = bale_accounts[0]
        else:
            account = wa_accounts[0] if wa_accounts else accounts[0]

        stage = row["stage"]
        score = row["score"]
        ai_meta = {
            "sentiment": "positive" if score >= 80 else ("neutral" if score >= 55 else "cautious"),
            "suggested_stage": stage,
            "last_enriched_at": (datetime.utcnow() - timedelta(days=random.randint(0, 14))).isoformat(),
            "confidence": round(0.6 + (score / 100) * 0.4, 2),
            "escalation": False,
        }
        last_msg_at = datetime.utcnow() - timedelta(days=random.randint(0, 30))
        created_at = last_msg_at - timedelta(days=random.randint(15, 90))
        assignee = users.get(row["assignee"])
        ext = _lead_external_id(row)
        lead = Lead(
            org_id=org.id, name=row["name"], phone=phone,
            external_chat_id=ext,
            post_token=(f"PARAMIS-{idx:04d}" if row["source"] == "divar" else ""),
            source_channel=row["source"], chat_type="pv", stage=stage,
            board_order=idx, tags=row["tags"],
            notes=(
                f"درخواست: {row['intent']} {row['type']} در {row['area']} — "
                f"بودجه {row['budget']} — {row['rooms']} — طبقه {row['floor']} — "
                f"سال ساخت {row['year']} — متراژ {row['size']} متر. "
                f"امتیاز سرنخ: {score}."
            ),
            lead_score=float(score), ai_meta=ai_meta,
            assignee_id=assignee.id if assignee else None,
            bot_paused=(random.random() < 0.15),
            last_message_at=last_msg_at, created_at=created_at, updated_at=last_msg_at,
        )
        db.add(lead); db.flush()
        if account:
            db.add(LeadAccountLink(
                org_id=org.id, lead_id=lead.id, account_id=account.id,
                chat_name=row["name"], external_chat_id=ext,
            ))
        leads.append(lead)
    return leads

_FA_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹", "0123456789")


def _fa2en(s: str) -> str:
    return (s or "").translate(_FA_DIGITS)


def _budget_billions(budget: str) -> float:
    t = _fa2en(budget).replace(",", "").replace("٬", "")
    num = "".join(ch for ch in t if ch.isdigit())
    if not num:
        return 0.0
    billions = float(num)
    if "میلیارد" in t:
        return billions
    return billions / 1000.0

# ---------------------------------------------------------------------------
# Natural Persian inbox conversations (curated showcase scripts)
# ---------------------------------------------------------------------------

def _row_for_lead(lead: Lead, idx: int) -> dict:
    if idx < len(LEADS) and _lead_phone(LEADS[idx]) == (lead.phone or ""):
        return dict(LEADS[idx])
    # Match by phone across all showcase rows (order can drift after reseed)
    for row in LEADS:
        if _lead_phone(row) == (lead.phone or ""):
            return dict(row)
    notes = lead.notes or ""
    row = {
        "name": lead.name or "مشتری",
        "phone": lead.phone or "",
        "stage": lead.stage or "جدید",
        "area": "نیاوران",
        "intent": "اجاره" if "اجاره" in notes else "خرید",
        "type": "آپارتمان",
        "budget": "۳۰ میلیارد",
        "size": 180,
        "rooms": "۳ خواب",
        "floor": 4,
        "year": 1400,
        "source": lead.source_channel or "whatsapp",
        "tags": list(lead.tags or []),
        "score": int(lead.lead_score or 70),
        "assignee": None,
    }
    for area in [
        "نیاوران", "فرمانیه", "ولنجک", "سعادت‌آباد", "شهرک غرب", "تجریش",
        "زعفرانیه", "قیطریه", "پاسداران", "جردن", "کامرانیه", "اقدسیه",
        "یوسف‌آباد", "فرشته", "الهیه", "دروس", "اختیاریه", "محمودیه",
        "پونک", "صادقیه", "ونک", "آریاشهر", "امام‌زاده قاسم", "شهرک قدس",
    ]:
        if area in notes:
            row["area"] = area
            break
    return row


def _ensure_conversations(db, org, accounts, users, leads):
    """Seed natural Farsi real-estate threads for the showcase inbox."""
    wa_accounts = [a for a in accounts if a.channel == ChannelType.whatsapp]
    divar_accounts = [a for a in accounts if a.channel == ChannelType.divar]
    bale_accounts = [a for a in accounts if a.channel == ChannelType.bale]

    operator_names = ["علی محمدی", "مریم احمدی", "حسین رضایی", "مهندس لطفی"]
    operator_users = [users.get(name) for name in operator_names if users.get(name)]

    if not leads:
        return

    for idx, lead in enumerate(leads):
        if db.query(Message).filter(Message.lead_id == lead.id).count() > 0:
            continue

        row = _row_for_lead(lead, idx)
        source = row.get("source") or lead.source_channel or "whatsapp"

        if source == "whatsapp" and wa_accounts:
            account = wa_accounts[idx % len(wa_accounts)]
        elif source == "divar" and divar_accounts:
            account = divar_accounts[0]
        elif source == "bale" and bale_accounts:
            account = bale_accounts[0]
        else:
            account = wa_accounts[0] if wa_accounts else (accounts[0] if accounts else None)
        if account is None:
            continue

        script = build_conversation(row)
        rng = random.Random(f"paramis-chat-{lead.phone}-{idx}")
        days_ago = rng.randint(0, 12)
        last_message_at = lead.last_message_at or (datetime.utcnow() - timedelta(days=days_ago))
        base_time = last_message_at - timedelta(hours=max(3, len(script) * 4))
        operator = operator_users[idx % len(operator_users)] if operator_users else None
        previous_ts = base_time

        for j, turn in enumerate(script):
            kind = turn[0]
            body = turn[1]
            media_type = (turn[2] if len(turn) > 2 else "text") or "text"
            if j == 0:
                ts = base_time
            else:
                # File logs arrive seconds after the “می‌فرستم” text
                if media_type in ("image", "document", "video", "audio"):
                    gap = rng.choice([1, 1, 2, 3])
                else:
                    gap = rng.choice([2, 4, 7, 11, 18, 25, 40, 55, 90, 140])
                ts = previous_ts + timedelta(minutes=gap)
            previous_ts = ts

            if kind == "customer":
                direction = MessageDirection.inbound
                sender_type = SenderType.customer
                agent_id = None
            elif kind == "ai":
                direction = MessageDirection.outbound
                sender_type = SenderType.ai
                agent_id = None
            else:
                direction = MessageDirection.outbound
                sender_type = SenderType.agent
                agent_id = operator.id if operator else None

            message_id = f"demo-chat-{lead.id[:8]}-{j:03d}"
            if db.query(Message).filter(Message.wa_message_id == message_id).first():
                continue
            db.add(Message(
                org_id=org.id, account_id=account.id, lead_id=lead.id,
                direction=direction, sender_type=sender_type, body=body,
                agent_id=agent_id, wa_message_id=message_id,
                media_type=media_type,
                delivery_status=("read" if direction == MessageDirection.outbound else ""),
                created_at=ts,
            ))

            if sender_type == SenderType.ai and media_type in ("", "text"):
                intent = "info"
                if any(w in body for w in ("منتقل", "وصل", "همکار", "فروش")):
                    intent = "handoff"
                elif any(w in body for w in ("بازدید", "لوکیشن")):
                    intent = "viewing"
                elif any(w in body for w in ("قیمت", "میلیارد", "رهن")):
                    intent = "pricing"
                db.add(AiEvent(
                    org_id=org.id, lead_id=lead.id, event_type="auto_reply",
                    payload={
                        "body_preview": body[:120],
                        "confidence": round(0.78 + (lead.lead_score or 70) / 1000, 2),
                        "intent": intent,
                        "source": "seed-demo-natural",
                    },
                    created_at=ts,
                ))

        if row["stage"] == "بسته":
            if not db.query(OutboundJob).filter(
                OutboundJob.org_id == org.id, OutboundJob.lead_id == lead.id
            ).first():
                assignee = users.get(row["assignee"]) if row.get("assignee") else None
                target = (lead.external_chat_id or "").strip()
                if not target and source == "whatsapp":
                    digits = normalize_phone_for_storage(row["phone"]) or row["phone"]
                    # Baileys edge still uses country-code digits
                    from app.services.phone import to_cc_digits
                    target = f"{to_cc_digits(digits)}@s.whatsapp.net"
                db.add(OutboundJob(
                    org_id=org.id, account_id=account.id, lead_id=lead.id,
                    target_name=row["name"],
                    target_jid=target,
                    body=f"سلام {row['name']} عزیز، مبارکتون باشه 🌷 ممنون که پارامیس رو انتخاب کردید.",
                    sender_type=SenderType.agent,
                    created_by_id=assignee.id if assignee else (operator.id if operator else None),
                    status=OutboundStatus.sent,
                    created_at=last_message_at, updated_at=last_message_at,
                ))

    for lead in leads:
        latest = db.query(Message).filter(Message.lead_id == lead.id).order_by(
            Message.created_at.desc()
        ).first()
        if latest:
            lead.last_message_at = latest.created_at
            lead.updated_at = latest.created_at
            db.add(lead)


def _ensure_tasks(db, org, leads, users):
    if db.query(Task).filter(Task.org_id == org.id).count() >= len(TASKS):
        return
    for t in TASKS:
        if t[1] >= len(leads):
            continue
        lead = leads[t[1]]
        assignee = users.get(t[5])
        due = datetime.utcnow() + timedelta(days=t[3])
        db.add(Task(
            org_id=org.id, lead_id=lead.id, title=t[0], message=t[0],
            assignee_id=assignee.id if assignee else None,
            created_by_id=assignee.id if assignee else None,
            due_at=due, status=t[2], board_order=random.randint(0, 100),
            source=t[4], source_message_id="",
            created_at=datetime.utcnow() - timedelta(days=abs(t[3]) + 1),
            updated_at=datetime.utcnow() - timedelta(days=max(0, t[3])),
        ))


def _ensure_knowledge(db, org):
    if db.query(KnowledgeDoc).filter(KnowledgeDoc.org_id == org.id).count() >= len(KNOWLEDGE_DOCS):
        return
    for doc_def in KNOWLEDGE_DOCS:
        if db.query(KnowledgeDoc).filter(KnowledgeDoc.org_id == org.id, KnowledgeDoc.title == doc_def["title"]).first():
            continue
        doc = KnowledgeDoc(org_id=org.id, title=doc_def["title"], source="seed-demo")
        db.add(doc); db.flush()
        for part in chunk_text(doc_def["content"]):
            try:
                emb = embed_text(part)
            except Exception:
                emb = []
            db.add(KnowledgeChunk(
                org_id=org.id, doc_id=doc.id, content=part, embedding=emb,
            ))


def _ensure_campaigns(db, org, accounts, owner):
    if db.query(Campaign).filter(Campaign.org_id == org.id).count() >= len(CAMPAIGNS):
        return
    wa_accounts = [a for a in accounts if a.channel == ChannelType.whatsapp]
    leads = db.query(Lead).filter(Lead.org_id == org.id).all()
    for c in CAMPAIGNS:
        if db.query(Campaign).filter(Campaign.org_id == org.id, Campaign.name == c["name"]).first():
            continue
        started_at = datetime.utcnow() - timedelta(days=c["days_back"])
        camp = Campaign(
            org_id=org.id, name=c["name"], status=c["status"],
            segment_json=c["segment"], message_template=c["template"],
            channel_account_id=(wa_accounts[0].id if wa_accounts else None),
            created_by_id=owner.id,
            started_at=started_at,
            finished_at=(started_at + timedelta(days=5) if c["status"] == "completed" else None),
        )
        db.add(camp); db.flush()

        matched = []
        for lead in leads:
            tags = list(lead.tags or [])
            stages_ok = (not c["segment"]["stages"]) or (lead.stage in c["segment"]["stages"])
            tags_ok = (not c["segment"]["tags"]) or any(t in tags for t in c["segment"]["tags"])
            score_ok = (lead.lead_score or 0) >= c["segment"]["min_score"]
            if stages_ok and tags_ok and score_ok:
                matched.append(lead)
        if not matched:
            continue

        for lead in matched:
            if db.query(CampaignSend).filter(
                CampaignSend.campaign_id == camp.id, CampaignSend.lead_id == lead.id
            ).first():
                continue
            roll = random.random()
            send_status = "sent" if roll < 0.92 else ("failed" if roll < 0.97 else "queued")
            send_ts = started_at + timedelta(minutes=random.randint(5, 240))
            db.add(CampaignSend(
                org_id=org.id, campaign_id=camp.id, lead_id=lead.id,
                status=send_status,
                job_id=f"demo-job-{camp.id[:6]}-{lead.id[:6]}",
                error=("شماره مقصد موقتاً در دسترس نیست" if send_status == "failed" else ""),
                created_at=send_ts,
                updated_at=send_ts,
            ))

        if c["status"] == "completed":
            convert_pool = [l for l in matched if l.stage not in ("بسته",)]
            random.shuffle(convert_pool)
            for cl in convert_pool[:2]:
                cl.stage = "بسته"
                cl.updated_at = started_at + timedelta(days=random.randint(2, 5))
                db.add(cl)

        sent_leads = [
            l for l in matched
            if not db.query(CampaignSend).filter(
                CampaignSend.campaign_id == camp.id,
                CampaignSend.lead_id == l.id,
                CampaignSend.status != "sent",
            ).first()
        ]
        channel = wa_accounts[0] if wa_accounts else (accounts[0] if accounts else None)
        if channel is None:
            continue
        for lead in sent_leads:
            r = random.random()
            if r > 0.65:
                continue
            reply_ts = started_at + timedelta(minutes=random.randint(15, 120 * 24))
            db.add(Message(
                org_id=org.id, account_id=channel.id, lead_id=lead.id,
                direction=MessageDirection.inbound, sender_type=SenderType.customer,
                body=random.choice([
                    "سلام، پیامتون رو دیدم. جزئیات بیشتری دارید؟",
                    "ممنون. قیمت نهایی چقدره؟",
                    "بازدید میشه هماهنگ کرد؟",
                    "بله هنوز دنبال ملک هستم. کی میتونم ببینم؟",
                    "خوبه، فایل کامل رو لطفا بفرستید.",
                ]),
                wa_message_id=f"demo-camp-reply-{lead.id[:6]}",
                media_type="text",
                created_at=reply_ts,
            ))
            if random.random() < 0.4:
                ai_ts = reply_ts + timedelta(minutes=random.randint(1, 30))
                db.add(Message(
                    org_id=org.id, account_id=channel.id, lead_id=lead.id,
                    direction=MessageDirection.outbound, sender_type=SenderType.ai,
                    body="سلام، ممنون از پیامتون. یکی از همکارانم تا دقیقه دیگه فایل رو براتون می‌فرسته 🙏",
                    wa_message_id=f"demo-camp-ai-{lead.id[:6]}",
                    media_type="text",
                    delivery_status="read",
                    created_at=ai_ts,
                ))
                db.add(AiEvent(
                    org_id=org.id, lead_id=lead.id, event_type="auto_reply",
                    payload={"body_preview": "AI auto reply", "source": "seed-demo-campaign"},
                    created_at=ai_ts,
                ))


def _match_campaign_segment(lead: Lead, seg: dict) -> bool:
    stages = [s for s in (seg.get("stages") or []) if str(s).strip()]
    if stages and (lead.stage or "").strip() not in stages:
        return False
    if float(lead.lead_score or 0) < float(seg.get("min_score") or 0):
        return False
    tags = set(seg.get("tags") or [])
    if tags and not tags.intersection(set(lead.tags or [])):
        return False
    return True


def _ensure_bulk_campaign_leads(db, org, accounts):
    wa = [a for a in accounts if a.channel == ChannelType.whatsapp]
    account = wa[0] if wa else (accounts[0] if accounts else None)
    existing = db.query(Lead).filter(Lead.org_id == org.id).all()
    phones = {l.phone for l in existing}
    used_names = {l.name for l in existing if l.name}
    board = (max((l.board_order or 0) for l in existing) + 1) if existing else 0
    claimed: set[str] = set()

    def _next_phone():
        nonlocal board
        phone = f"98931{5000000 + board:07d}"
        while phone in phones:
            board += 1
            phone = f"98931{5000000 + board:07d}"
        phones.add(phone)
        board += 1
        return phone

    for cmp_def in CAMPAIGNS:
        target = BULK_TARGETS.get(cmp_def["name"])
        if target is None:
            continue
        seg = cmp_def["segment"]
        stages = [s for s in (seg.get("stages") or []) if str(s).strip()]
        seg_tags = list(seg.get("tags") or [])
        min_score = int(float(seg.get("min_score") or 0))
        current = sum(
            1 for l in existing
            if _match_campaign_segment(l, seg) and l.id not in claimed
        )
        need = target - current
        for _ in range(max(0, need)):
            phone = _next_phone()
            stage = random.choice(stages) if stages else "جدید"
            lead_tags = [random.choice(seg_tags)] if seg_tags else []
            score = random.randint(min_score, 96)
            name = f"{random.choice(BULK_FIRST)} {random.choice(BULK_LAST)}"
            while name in used_names:
                name = f"{random.choice(BULK_FIRST)} {random.choice(BULK_LAST)}"
            used_names.add(name)
            ai_meta = {
                "sentiment": "positive" if score >= 80 else "neutral",
                "suggested_stage": stage,
                "confidence": round(0.6 + (score / 100) * 0.4, 2),
                "escalation": False,
            }
            last_msg_at = datetime.utcnow() - timedelta(days=random.randint(0, 20))
            lead = Lead(
                org_id=org.id, name=name, phone=phone,
                external_chat_id=None, post_token="",
                source_channel="whatsapp", chat_type="pv", stage=stage,
                board_order=board, tags=lead_tags,
                notes=f"سرنخ دمو برای کمپین «{cmp_def['name']}». امتیاز سرنخ: {score}.",
                lead_score=float(score), ai_meta=ai_meta,
                assignee_id=None, bot_paused=(random.random() < 0.15),
                last_message_at=last_msg_at,
                created_at=last_msg_at - timedelta(days=random.randint(15, 60)),
                updated_at=last_msg_at,
            )
            db.add(lead)
            db.flush()
            if account:
                db.add(LeadAccountLink(
                    org_id=org.id, lead_id=lead.id, account_id=account.id,
                    chat_name=name, external_chat_id=None,
                ))
            existing.append(lead)
        claimed.update(
            l.id for l in existing if _match_campaign_segment(l, seg)
        )


def _ensure_okrs(db, org, users):
    if db.query(OkrObjective).filter(OkrObjective.org_id == org.id).count() >= len(OKRS):
        return
    for o in OKRS:
        if db.query(OkrObjective).filter(OkrObjective.org_id == org.id, OkrObjective.title == o["title"]).first():
            continue
        u = users.get(o["assignee"])
        db.add(OkrObjective(
            org_id=org.id, title=o["title"],
            description=f"هدف تعیین‌شده توسط {o['assignee']} — دوره {o['period']}",
            target_value=o["target"], current_value=o["current"],
            period=o["period"], owner_id=u.id if u else None,
        ))

def _ensure_kpis(db, org):
    if db.query(KpiSnapshot).filter(KpiSnapshot.org_id == org.id).count() > 0:
        return
    kpi_defs = [
        {"key": "leads_total",        "label": "سرنخ‌های جدید",     "target": 25,  "unit": "count"},
        {"key": "leads_converted",    "label": "تبدیل به مشتری",       "target": 5,   "unit": "count"},
        {"key": "messages_inbound",   "label": "پیام‌های ورودی",  "target": 200, "unit": "count"},
        {"key": "messages_outbound",  "label": "پیام‌های خروجی",  "target": 250, "unit": "count"},
        {"key": "ai_suggestions",     "label": "پیشنهاد AI",          "target": 100, "unit": "count"},
        {"key": "viewings_scheduled", "label": "بازدیدهای هماهنگ‌شده", "target": 15, "unit": "count"},
        {"key": "response_time_min",  "label": "زمان پاسخ (دقیقه)",   "target": 5,   "unit": "minutes"},
    ]
    for k in kpi_defs:
        if not db.query(KpiDefinition).filter(KpiDefinition.org_id == org.id, KpiDefinition.key == k["key"]).first():
            db.add(KpiDefinition(org_id=org.id, key=k["key"], label=k["label"],
                                 target_value=k["target"], unit=k["unit"]))
    rng = random.Random(42)
    for w in range(12, 0, -1):
        ts = datetime.utcnow() - timedelta(weeks=w)
        for k in kpi_defs:
            base = k["target"]; trend = (12 - w) / 12.0
            noise = rng.uniform(0.7, 1.3)
            value = max(0, base * (0.4 + 0.6 * trend) * noise)
            if k["key"] == "response_time_min":
                value = max(1, base * (1.4 - 0.4 * trend) * noise)
            db.add(KpiSnapshot(org_id=org.id, key=k["key"], value=round(value, 2),
                               period="weekly", captured_at=ts))


def _ensure_support(db, org, owner):
    if db.query(SupportTicket).filter(SupportTicket.org_id == org.id).first():
        return
    t = SupportTicket(
        org_id=org.id, user_id=owner.id,
        subject="درخواست فعال‌سازی اتصال Bale برای شعبه شمال",
        category="technical", status="in_progress", priority="normal",
    )
    db.add(t); db.flush()
    db.add(SupportMessage(
        ticket_id=t.id, user_id=owner.id, sender_side="business",
        body="سلام، لطفاً کانکتور بله را برای شعبه شمال فعال کنید. تیم پشتیبانی فروش نیاز دارد.",
        created_at=datetime.utcnow() - timedelta(days=2),
    ))
    db.add(SupportMessage(
        ticket_id=t.id, user_id=None, sender_side="platform",
        body="سلام، درخواست شما دریافت شد. تیم فنی تا فردا اتصال را بررسی می‌کند.",
        created_at=datetime.utcnow() - timedelta(days=1, hours=12),
    ))


def _ensure_audit(db, org, owner):
    if db.query(AuditEvent).filter(AuditEvent.org_id == org.id).count() > 0:
        return
    events = [
        ("plan.upgrade",     "ارتقای پلن از starter به growth"),
        ("channel.connect",  "اتصال کانال WhatsApp شعبه مرکزی"),
        ("channel.connect",  "اتصال کانال Divar شعبه مرکزی"),
        ("channel.connect",  "اتصال کانال Bale پشتیبانی"),
        ("member.invite",    "دعوت از مریم احمدی به‌عنوان agent"),
        ("member.invite",    "دعوت از حسین رضایی به‌عنوان agent"),
        ("ai.policy.update", "تغییر سیاست AI — فعال‌سازی auto-send"),
        ("campaign.send",    "ارسال کمپین نوروزی به ۱۲ سرنخ VIP"),
        ("payment.charge",   "پرداخت ماهانه — پلن growth (۴٬۹۰۰٬۰۰۰ تومان)"),
    ]
    for i, (etype, msg) in enumerate(events):
        db.add(AuditEvent(
            org_id=org.id, user_id=owner.id, event_type=etype, message=msg,
            meta={"source": "seed-demo"},
            created_at=datetime.utcnow() - timedelta(days=len(events) - i),
        ))


def _ensure_payments(db, org, owner):
    if db.query(Payment).filter(Payment.org_id == org.id).count() > 0:
        return
    for i in range(3):
        db.add(Payment(
            org_id=org.id, user_id=owner.id, purpose="renew", plan="growth",
            amount_irr=4_900_000, provider="zibal",
            track_id=f"TRK-DEMO-{i:04d}", ref_number=f"REF-DEMO-{i:08d}",
            status="paid", paid_at=datetime.utcnow() - timedelta(days=30 * i + 5),
        ))

def _migrate_then_create_all():
    try:
        mig_path = Path(__file__).resolve().parent / "migrate_multichannel.py"
        spec = importlib.util.spec_from_file_location("migrate_multichannel", mig_path)
        if spec and spec.loader:
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            mod.main()
        else:
            Base.metadata.create_all(bind=engine)
    except Exception as exc:  # noqa: BLE001
        print("migrate skipped:", exc)
        Base.metadata.create_all(bind=engine)


def seed():
    _migrate_then_create_all()
    db = SessionLocal()
    try:
        owner = _ensure_owner(db)
        org = _ensure_org(db, owner)
        users = _ensure_operators(db, org)
        accounts = _ensure_channels(db, org)
        leads = _ensure_leads(db, org, accounts, users)
        _ensure_bulk_campaign_leads(db, org, accounts)
        from app.services.phone import phone_aliases

        showcase_phones: set[str] = set()
        for row in LEADS:
            showcase_phones.update(phone_aliases(row["phone"]))
        all_leads = db.query(Lead).filter(
            Lead.org_id == org.id,
            Lead.phone.in_(list(showcase_phones)),
        ).all()
        _ensure_conversations(db, org, accounts, users, all_leads)
        _ensure_tasks(db, org, leads, users)
        _ensure_knowledge(db, org)
        _ensure_campaigns(db, org, accounts, owner)
        _ensure_okrs(db, org, users)
        _ensure_kpis(db, org)
        _ensure_support(db, org, owner)
        _ensure_audit(db, org, owner)
        _ensure_payments(db, org, owner)
        try:
            db.execute(text("PRAGMA foreign_keys=ON"))
        except Exception:
            pass
        db.commit()
        return org
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def gen_conversations_cli(*, replace: bool = False):
    """Regenerate showcase inbox threads from curated natural Farsi scripts."""
    from app.services.phone import phone_aliases

    _migrate_then_create_all()
    db = SessionLocal()
    try:
        owner = _ensure_owner(db)
        org = _ensure_org(db, owner)
        users = _ensure_operators(db, org)
        accounts = _ensure_channels(db, org)
        # Prefer new 09… phones; also match legacy 98… rows
        alias_to_row: dict[str, dict] = {}
        for row in LEADS:
            for alias in phone_aliases(row["phone"]):
                alias_to_row[alias] = row
        all_leads = (
            db.query(Lead)
            .filter(Lead.org_id == org.id, Lead.phone.in_(list(alias_to_row.keys())))
            .all()
        )
        if not all_leads:
            # Create missing showcase leads then reload
            _ensure_leads(db, org, accounts, users)
            all_leads = (
                db.query(Lead)
                .filter(Lead.org_id == org.id, Lead.phone.in_(list(alias_to_row.keys())))
                .all()
            )
        if replace:
            for lead in all_leads:
                row = alias_to_row.get(lead.phone or "")
                if not row:
                    continue
                lead.phone = _lead_phone(row)
                lead.stage = row["stage"]
                lead.name = row["name"]
                lead.source_channel = row["source"]
                lead.external_chat_id = _lead_external_id(row)
                lead.tags = row["tags"]
                db.add(lead)
            lead_ids = [lead.id for lead in all_leads]
            demo_messages = db.query(Message).filter(
                Message.org_id == org.id,
                Message.lead_id.in_(lead_ids),
                Message.wa_message_id.like("demo-%"),
            ).all()
            for message in demo_messages:
                db.delete(message)
            demo_events = db.query(AiEvent).filter(AiEvent.org_id == org.id).all()
            for event in demo_events:
                if isinstance(event.payload, dict) and str(event.payload.get("source", "")).startswith("seed-demo-"):
                    db.delete(event)
            db.flush()
            print(f"Removed {len(demo_messages)} demo messages before generation.")
        _ensure_conversations(db, org, accounts, users, all_leads)
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    print("=" * 60)
    print("✅ مکالمات طبیعی فارسی در صندوق پیام ذخیره شد")
    print("  (سناریوهای خرید/اجاره بر اساس مرحله CRM)")
    print("=" * 60)


def main():
    if "--conversations" in sys.argv:
        gen_conversations_cli(replace="--replace" in sys.argv)
        return
    _migrate_then_create_all()
    db = SessionLocal()
    try:
        owner = _ensure_owner(db)
        org = _ensure_org(db, owner)
        name = org.name
        plan = org.plan
        org_id = org.id
    finally:
        db.close()
    _ = seed()
    print("=" * 60)
    print("✅ دمو فروش آماده شد")
    print("=" * 60)
    print(f"  کسب‌وکار:   {name}")
    print(f"  پلن:        {plan}")
    print(f"  org_id:     {org_id}")
    print(f"  owner:      {DEMO_OWNER_NAME} ({DEMO_OWNER_PHONE})")
    print(f"  endpoint:   POST /api/auth/demo/login")
    print("=" * 60)


if __name__ == "__main__":
    main()
