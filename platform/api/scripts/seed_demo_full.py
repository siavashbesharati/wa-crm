"""Comprehensive demo seed — sales showcase for "دپارتمان ملک پارامیس".

Creates a fully-populated business org for product demos:
- 4 connected channels (WhatsApp x2 + Divar + Bale)
- Owner + 3 operators (team)
- 30 realistic real-estate leads across every pipeline stage
- 150+ realistic Persian conversations (inbound / outbound / AI replies)
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
]

CHANNELS = [
    {"channel": ChannelType.whatsapp, "label": "واتساپ فروش پارامیس",  "external_id": "989121234567", "status": "connected", "pairing_state": "connected", "wa_jid": "989121234567@s.whatsapp.net", "connector_type": "baileys"},
    {"channel": ChannelType.whatsapp, "label": "واتساپ اجاره پارامیس",  "external_id": "989121234568", "status": "connected", "pairing_state": "connected", "wa_jid": "989121234568@s.whatsapp.net", "connector_type": "baileys"},
    {"channel": ChannelType.divar,    "label": "دیوار — شعبه مرکزی",    "external_id": "divar-paramis", "status": "connected", "pairing_state": "connected", "wa_jid": "", "connector_type": "divar_api"},
    {"channel": ChannelType.bale,     "label": "بله — پشتیبانی پارامیس", "external_id": "bale-paramis",  "status": "connected", "pairing_state": "connected", "wa_jid": "", "connector_type": "bale_api"},
]

# 30 leads: spread across all 5 pipeline stages
LEADS = [
    {"name": "آقای کریمی", "phone": "989121111101", "stage": "جدید", "area": "نیاوران", "intent": "خرید", "type": "آپارتمان", "budget": "۲۵ میلیارد", "size": 180, "rooms": "۳ خواب", "floor": 4, "year": 1400, "source": "whatsapp", "tags": ["vip", "خریدار جدی"], "score": 82, "assignee": "علی محمدی"},
    {"name": "خانم حسینی", "phone": "989121111102", "stage": "جدید", "area": "فرمانیه", "intent": "اجاره", "type": "آپارتمان", "budget": "۶۵ میلیون", "size": 120, "rooms": "۲ خواب", "floor": 2, "year": 1395, "source": "divar", "tags": ["پرچم‌دار"], "score": 64, "assignee": "مریم احمدی"},
    {"name": "آقای نوری", "phone": "989121111103", "stage": "جدید", "area": "ولنجک", "intent": "خرید", "type": "ویلا", "budget": "۶۰ میلیارد", "size": 450, "rooms": "۵ خواب", "floor": 0, "year": 1402, "source": "whatsapp", "tags": ["سرمایه‌گذاری"], "score": 88, "assignee": "علی محمدی"},
    {"name": "مهندس صادقی", "phone": "989121111104", "stage": "جدید", "area": "سعادت‌آباد", "intent": "خرید", "type": "آپارتمان", "budget": "۱۸ میلیارد", "size": 140, "rooms": "۳ خواب", "floor": 3, "year": 1398, "source": "bale", "tags": ["نقد"], "score": 71, "assignee": "حسین رضایی"},
    {"name": "خانم مرادی", "phone": "989121111105", "stage": "جدید", "area": "شهرک غرب", "intent": "اجاره", "type": "آپارتمان", "budget": "۸۰ میلیون", "size": 160, "rooms": "۳ خواب", "floor": 5, "year": 1397, "source": "whatsapp", "tags": ["مبله"], "score": 59, "assignee": "مریم احمدی"},
    {"name": "آقای زارع", "phone": "989121111106", "stage": "جدید", "area": "تجریش", "intent": "خرید", "type": "مغازه", "budget": "۱۲ میلیارد", "size": 80, "rooms": "—", "floor": 0, "year": 1385, "source": "divar", "tags": ["تجاری"], "score": 67, "assignee": "علی محمدی"},
    {"name": "خانم فلاحی", "phone": "989121111107", "stage": "جدید", "area": "ونک", "intent": "خرید", "type": "آپارتمان", "budget": "۳۰ میلیارد", "size": 200, "rooms": "۳ خواب", "floor": 8, "year": 1399, "source": "whatsapp", "tags": ["ویو"], "score": 76, "assignee": "حسین رضایی"},
    {"name": "آقای غلامی", "phone": "989121111108", "stage": "پیگیری", "area": "زعفرانیه", "intent": "خرید", "type": "آپارتمان", "budget": "۴۵ میلیارد", "size": 250, "rooms": "۴ خواب", "floor": 6, "year": 1401, "source": "whatsapp", "tags": ["ویو باز"], "score": 91, "assignee": "علی محمدی"},
    {"name": "دکتر اکبری", "phone": "989121111109", "stage": "پیگیری", "area": "قیطریه", "intent": "خرید", "type": "آپارتمان", "budget": "۲۸ میلیارد", "size": 170, "rooms": "۳ خواب", "floor": 3, "year": 1396, "source": "whatsapp", "tags": ["وام‌دار"], "score": 78, "assignee": "مریم احمدی"},
    {"name": "خانم رنجبر", "phone": "989121111110", "stage": "پیگیری", "area": "پاسداران", "intent": "اجاره", "type": "آپارتمان", "budget": "۴۵ میلیون", "size": 110, "rooms": "۲ خواب", "floor": 2, "year": 1390, "source": "divar", "tags": ["مستاجر"], "score": 55, "assignee": "حسین رضایی"},
    {"name": "آقای توکلی", "phone": "989121111111", "stage": "پیگیری", "area": "جردن", "intent": "خرید", "type": "آپارتمان", "budget": "۳۵ میلیارد", "size": 190, "rooms": "۳ خواب", "floor": 7, "year": 1398, "source": "bale", "tags": ["پارکینگ"], "score": 83, "assignee": "علی محمدی"},
    {"name": "خانم سلطانی", "phone": "989121111112", "stage": "پیگیری", "area": "کامرانیه", "intent": "خرید", "type": "ویلا", "budget": "۹۰ میلیارد", "size": 600, "rooms": "۶ خواب", "floor": 0, "year": 1395, "source": "whatsapp", "tags": ["استخر"], "score": 87, "assignee": "مریم احمدی"},
    {"name": "آقای موسوی", "phone": "989121111113", "stage": "پیگیری", "area": "اقدسیه", "intent": "خرید", "type": "زمین", "budget": "۲۰ میلیارد", "size": 500, "rooms": "—", "floor": 0, "year": 0, "source": "divar", "tags": ["زمین"], "score": 70, "assignee": "حسین رضایی"},
    {"name": "خانم نجفی", "phone": "989121111114", "stage": "پیگیری", "area": "یوسف‌آباد", "intent": "اجاره", "type": "آپارتمان", "budget": "۳۵ میلیون", "size": 95, "rooms": "۲ خواب", "floor": 1, "year": 1385, "source": "whatsapp", "tags": ["قدیمی"], "score": 48, "assignee": "علی محمدی"},
    {"name": "آقای صالحی", "phone": "989121111115", "stage": "بازدید", "area": "فرشته", "intent": "خرید", "type": "آپارتمان", "budget": "۵۵ میلیارد", "size": 280, "rooms": "۴ خواب", "floor": 9, "year": 1402, "source": "whatsapp", "tags": ["برند"], "score": 94, "assignee": "علی محمدی"},
    {"name": "خانم عابدی", "phone": "989121111116", "stage": "بازدید", "area": "الهیه", "intent": "خرید", "type": "پنت‌هاوس", "budget": "۸۰ میلیارد", "size": 350, "rooms": "۴ خواب", "floor": 15, "year": 1403, "source": "whatsapp", "tags": ["لوکس"], "score": 96, "assignee": "مریم احمدی"},
    {"name": "آقای مومنی", "phone": "989121111117", "stage": "بازدید", "area": "دروس", "intent": "خرید", "type": "آپارتمان", "budget": "۳۸ میلیارد", "size": 210, "rooms": "۳ خواب", "floor": 4, "year": 1399, "source": "bale", "tags": ["نوساز"], "score": 89, "assignee": "حسین رضایی"},
    {"name": "خانم آقاجانی", "phone": "989121111118", "stage": "بازدید", "area": "اختیاریه", "intent": "خرید", "type": "آپارتمان", "budget": "۲۲ میلیارد", "size": 130, "rooms": "۲ خواب", "floor": 3, "year": 1394, "source": "divar", "tags": ["بازسازی"], "score": 73, "assignee": "علی محمدی"},
    {"name": "آقای حیدری", "phone": "989121111119", "stage": "بازدید", "area": "محمودیه", "intent": "اجاره", "type": "آپارتمان", "budget": "۵۰ میلیون", "size": 130, "rooms": "۲ خواب", "floor": 4, "year": 1393, "source": "whatsapp", "tags": ["بالکن"], "score": 62, "assignee": "مریم احمدی"},
    {"name": "دکتر کاشانی", "phone": "989121111120", "stage": "بازدید", "area": "امام‌زاده قاسم", "intent": "خرید", "type": "باغ ویلا", "budget": "۳۵ میلیارد", "size": 800, "rooms": "۴ خواب", "floor": 0, "year": 1390, "source": "whatsapp", "tags": ["ویلای شمالی"], "score": 81, "assignee": "حسین رضایی"},
    {"name": "آقای باقری", "phone": "989121111121", "stage": "مذاکره", "area": "شهرک قدس", "intent": "خرید", "type": "آپارتمان", "budget": "۲۶ میلیارد", "size": 155, "rooms": "۳ خواب", "floor": 5, "year": 1398, "source": "whatsapp", "tags": ["قیمت نهایی"], "score": 92, "assignee": "علی محمدی"},
    {"name": "خانم شفیعی", "phone": "989121111122", "stage": "مذاکره", "area": "آریاشهر", "intent": "اجاره", "type": "آپارتمان", "budget": "۷۰ میلیون", "size": 145, "rooms": "۳ خواب", "floor": 3, "year": 1396, "source": "bale", "tags": ["رهن کامل"], "score": 79, "assignee": "مریم احمدی"},
    {"name": "آقای ناصری", "phone": "989121111123", "stage": "مذاکره", "area": "صادقیه", "intent": "خرید", "type": "آپارتمان", "budget": "۱۵ میلیارد", "size": 105, "rooms": "۲ خواب", "floor": 2, "year": 1392, "source": "divar", "tags": ["پای معامله"], "score": 85, "assignee": "حسین رضایی"},
    {"name": "خانم حسامی", "phone": "989121111124", "stage": "مذاکره", "area": "پونک", "intent": "خرید", "type": "آپارتمان", "budget": "۲۱ میلیارد", "size": 135, "rooms": "۲ خواب", "floor": 4, "year": 1397, "source": "whatsapp", "tags": ["نقلی"], "score": 88, "assignee": "علی محمدی"},
    {"name": "آقای عبادی", "phone": "989121111125", "stage": "مذاکره", "area": "جردن", "intent": "خرید", "type": "دفتر کار", "budget": "۴۰ میلیارد", "size": 220, "rooms": "۵ اتاق", "floor": 6, "year": 1395, "source": "whatsapp", "tags": ["اداری"], "score": 84, "assignee": "مریم احمدی"},
    {"name": "آقای رستمی", "phone": "989121111126", "stage": "بسته‌شده", "area": "نیاوران", "intent": "خرید", "type": "آپارتمان", "budget": "۳۲ میلیارد", "size": 175, "rooms": "۳ خواب", "floor": 3, "year": 1399, "source": "whatsapp", "tags": ["فروش"], "score": 100, "assignee": "علی محمدی"},
    {"name": "خانم افضلی", "phone": "989121111127", "stage": "بسته‌شده", "area": "سعادت‌آباد", "intent": "خرید", "type": "آپارتمان", "budget": "۱۹ میلیارد", "size": 125, "rooms": "۲ خواب", "floor": 2, "year": 1396, "source": "divar", "tags": ["فروش"], "score": 100, "assignee": "مریم احمدی"},
    {"name": "آقای کاظمی", "phone": "989121111128", "stage": "بسته‌شده", "area": "تجریش", "intent": "اجاره", "type": "آپارتمان", "budget": "۵۵ میلیون", "size": 140, "rooms": "۲ خواب", "floor": 4, "year": 1393, "source": "whatsapp", "tags": ["اجاره"], "score": 100, "assignee": "حسین رضایی"},
    {"name": "دکتر شایان", "phone": "989121111129", "stage": "بسته‌شده", "area": "قیطریه", "intent": "خرید", "type": "ویلا", "budget": "۷۰ میلیارد", "size": 500, "rooms": "۵ خواب", "floor": 0, "year": 1398, "source": "bale", "tags": ["فروش"], "score": 100, "assignee": "علی محمدی"},
    {"name": "آقای متین", "phone": "989121111130", "stage": "بسته‌شده", "area": "پاسداران", "intent": "اجاره", "type": "آپارتمان", "budget": "۴۰ میلیون", "size": 100, "rooms": "۲ خواب", "floor": 1, "year": 1385, "source": "whatsapp", "tags": ["اجاره"], "score": 100, "assignee": "مریم احمدی"},
]

# Realistic Persian conversation templates
CONVERSATIONS = {
    "جدید": [
        ("سلام وقت بخیر. یک آپارتمان {size} متری در {area} می\u200cخواستم.", "customer"),
        ("سلام، خوش اومدید. بله {area} موجود داریم. چند خواب؟ چه بودجه\u200cای مدنظرتون هست؟", "agent"),
        ("{rooms}. بودجه\u200cم تا {budget} تومان هست. نوساز باشه ترجیح می\u200cدم.", "customer"),
        ("عالیه. چند مورد عالی دارم براتون. فردا ساعت ۱۱ بازدید آپارتمان نیاوران رو داریم، می\u200cتونید بیاید؟", "agent"),
        ("بله حتماً. آدرس رو بفرستید لطفاً.", "customer"),
        ("\U0001F4CD نیاوران، خیابان یاسر، پلاک ۴۲. فردا ساعت ۱۱ جلوی ساختمان منتظرتون هستم.", "agent"),
        ("ممنون. حتماً میام.", "customer"),
    ],
    "پیگیری": [
        ("سلام. فایل {area} که گفتید هنوز آماده نیست؟", "customer"),
        ("سلام، بله الان آماده\u200cست. {size} متر، {rooms}، طبقه {floor}، سال ساخت {year}. قیمت {budget}.", "agent"),
        ("قیمتش یه کم بالاست. میشه چانه بزنیم؟", "customer"),
        ("ببینید مالک تا یه حدی انعطاف داره ولی خیلی پایین نمیاد. نظرتون چنده؟", "agent"),
        ("{budget} می\u200cتونم بدم. اگه موافق باشه پیش\u200cپرداخت هم نقد می\u200cدم.", "customer"),
        ("اجازه بدید با مالک صحبت کنم، فردا جواب می\u200cدم.", "agent"),
        ("ممنون. منتظر جوابتون هستم \U0001F64F", "customer"),
    ],
    "بازدید": [
        ("سلام. برای بازدید امروز ساعت ۴ تأیید هست؟", "customer"),
        ("بله حتماً. من و مالک ساعت ۴ دم در ساختمان هستیم.", "agent"),
        ("دمتون گرم. یه سوال: آسانسور داره؟ پارکینگ چندتا؟", "customer"),
        ("آسانسور برند Otis ۶ نفره. پارکینگ ۲ تا سند + ۱ مهمان. انباری هم داره.", "agent"),
        ("عالی. حتماً میام. کد ورود چیه؟", "customer"),
        ("کد ۲۳۴۵# — طبقه ۴ واحد ۸.", "agent"),
        ("ممنون. در راه م.", "customer"),
    ],
    "مذاکره": [
        ("سلام. فکر کردم دیدم. آپارتمان {area} رو پسندیدم ولی قیمت بالاست.", "customer"),
        ("سلام، ممنون از بازدیدتون. قیمت {budget} قابل مذاکره\u200cست، مالک گفت تا {budget} می\u200cتونه بیاد پایین.", "agent"),
        ("اگه {budget} باشه و یه\u200cماه اجاره رایگان بده، همین هفته قرارداد می\u200cبندیم.", "customer"),
        ("اجاره رایگان سخته ولی یک ماه فرصت تخلیه می\u200cدم. نظرتون؟", "agent"),
        ("قبول. فردا بیع\u200cنامه رو آماده کنید.", "customer"),
        ("عالی. فردا ساعت ۱۰ دفتر منتظرتون هستم. مدارک شناسایی + چک ضمانت بیارید.", "agent"),
        ("حتماً. ممنون \U0001F64F", "customer"),
    ],
    "بسته\u200cشده": [
        ("سلام. فقط تشکر کنم بابت همکاری خوبتون. کلید رو تحویل گرفتم.", "customer"),
        ("سلام، خواهش می\u200cکنم. مبارکتون باشه \U0001F337 اگه سوالی بود در خدمتم.", "agent"),
        ("حتماً. اگه کسی دنبال ملک بود معرفی\u200cتون می\u200cکنم.", "customer"),
        ("لطف می\u200cکنید. در خدمتتون هستم \U0001F64F", "agent"),
    ],
}

# (title, lead_index, status, offset_days, source, assignee)
TASKS = [
    ("تماس با مالک آپارتمان نیاوران", 0,  "in_progress", 0,  "manual", "علی محمدی"),
    ("ارسال فایل پنت\u200cهاوس الهیه به خانم عابدی", 15, "open",        1,  "ai",     "مریم احمدی"),
    ("هماهنگی بازدید ویلای کامرانیه",          11, "open",        2,  "manual", "مریم احمدی"),
    ("تنظیم قولنامه مغازه تجریش",              5,  "in_progress", 3,  "manual", "علی محمدی"),
    ("پیگیری بازپرداخت وام آقای اکبری",         8,  "open",        5,  "manual", "مریم احمدی"),
    ("ارسال قرارداد اجاره برای آقای کاظمی",     27, "done",       -2,  "manual", "حسین رضایی"),
    ("تشکر از مشتری پس از تحویل کلید",         25, "done",       -7,  "ai",     "علی محمدی"),
    ("آپلود عکس\u200cهای جدید باغ ویلای امام\u200cزاده قاسم", 19, "open", 1, "manual", "حسین رضایی"),
    ("پیگیری نظرسنجی از خانم متین",             29, "done",       -1,  "ai",     "مریم احمدی"),
    ("بررسی مدارک شناسایی خانم عابدی",          15, "in_progress", 0,  "manual", "مریم احمدی"),
]

KNOWLEDGE_DOCS = [
    {
        "title": "راهنمای محله\u200cهای شمال تهران",
        "content": (
            "نیاوران: یکی از گران\u200cترین محله\u200cهای شمال تهران. دسترسی عالی به مترو و بزرگراه صدر. "
            "میانگین قیمت آپارتمان نوساز ۱۸۰ متری در نیاوران ۳۰ تا ۴۰ میلیارد تومان است.\n"
            "فرمانیه: محله\u200cای خانوادگی با مدارس خوب و بازار مدرن. قیمت\u200cها ۲۰ تا ۳۰ درصد پایین\u200cتر از نیاوران است.\n"
            "ولنجک: منطقه\u200cای لوکس با ویلاهای بزرگ. مناسب سرمایه\u200cگذاری بلندمدت. قیمت هر متر مربع بالای ۲۰۰ میلیون تومان.\n"
            "زعفرانیه: ترکیب آپارتمان\u200cهای لوکس و ویلا. ویژه طبقه مرفه. دسترسی خوب به تجریش و شمال."
        ),
    },
    {
        "title": "راهنمای قیمت ملک در سعادت\u200cآباد و شهرک غرب",
        "content": (
            "سعادت\u200cآباد: از پرطرفدارترین مناطق غرب تهران. قیمت هر متر مربع آپارتمان نوساز ۱۲۰ تا ۱۸۰ میلیون تومان. "
            "برج\u200cهای مدرن با امکانات ورزشی و امنیتی.\n"
            "شهرک غرب: مدرن\u200cترین محله غرب تهران با معماری روز. مناسب خانواده\u200cهای جوان. "
            "قیمت\u200cها بین ۱۰۰ تا ۱۵۰ میلیون تومان هر متر مربع."
        ),
    },
    {
        "title": "مراحل خرید ملک در تهران",
        "content": (
            "۱. انتخاب ملک و بازدید حضوری\n"
            "۲. بررسی مدارک مالکیت و استعلام از شهرداری\n"
            "۳. مذاکره نهایی و توافق بر سر قیمت\n"
            "۴. تنظیم بیع\u200cنامه در دفتر اسناد رسمی\n"
            "۵. پرداخت پیش\u200cپرداخت و دریافت رسید\n"
            "۶. تنظیم قرارداد در دفترخانه و انتقال سند\n"
            "مدت زمان معمول از بیع\u200cنامه تا سند نهایی: ۲ تا ۴ هفته."
        ),
    },
    {
        "title": "سوالات متداول مشتریان",
        "content": (
            "سوال: آیا امکان رهن کامل وجود دارد؟\n"
            "پاسخ: بستگی به مالک دارد. معمولاً برای آپارتمان\u200cهای بالای ۲۰۰ متر، رهن کامل با ۵۰٪ تخفیف ممکن است.\n\n"
            "سوال: کمیسیون دپارتمان پارامیس چقدر است؟\n"
            "پاسخ: برای خرید ۱٪ و برای اجاره یک ماه اجاره. در خریدهای بالای ۲۰ میلیارد، ۰.۵٪ تخفیف.\n\n"
            "سوال: آیا وام بانکی برای خرید ملک پیشنهاد می\u200cکنید؟\n"
            "پاسخ: بله، با همکاری ۳ بانک معتبر، وام با سود ۱۸٪ و بازپرداخت ۱۲ ساله."
        ),
    },
]

CAMPAIGNS = [
    {
        "name": "کمپین نوروزی — آپارتمان\u200cهای نیاوران",
        "status": "completed",
        "template": (
            "سلام {name} عزیز،\n"
            "دپارتمان ملک پارامیس پیشاپیش فرا رسیدن سال نو را تبریک می\u200cگوید. "
            "پیشنهاد ویژه نوروزی: ۱۰٪ تخفیف کمیسیون برای معاملات تا پایان فروردین. \U0001F337"
        ),
        "segment": {"tags": ["vip", "خریدار جدی"], "stages": ["جدید", "پیگیری"], "min_score": 60, "include_groups": False},
        "days_back": 30,
    },
    {
        "name": "کمپین فعال — پنت\u200cهاوس و ویلاهای لوکس",
        "status": "running",
        "template": (
            "سلام {name} عزیز،\n"
            "مجموعه\u200cای از ویلاهای لوکس شمال تهران وارد فایل ما شده. "
            "در صورت تمایل برای بازدید رایگان هماهنگ می\u200cکنیم. \U0001F3E1"
        ),
        "segment": {"tags": ["vip"], "stages": ["بازدید", "مذاکره"], "min_score": 75, "include_groups": False},
        "days_back": 4,
    },
]

OKRS = [
    {"title": "بستن ۱۵ فروش در فصل بهار",        "target": 15,  "current": 8,  "period": "quarter", "assignee": "علی محمدی"},
    {"title": "رسیدن به ۹۰٪ رضایت مشتریان",      "target": 90,  "current": 87, "period": "quarter", "assignee": "مریم احمدی"},
    {"title": "افزایش فایل\u200cهای فعال به ۱۲۰ ملک", "target": 120, "current": 96, "period": "month",  "assignee": "حسین رضایی"},
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
                allowed_stages=["جدید", "پیگیری", "بازدید", "مذاکره"],
                business_hours_only=False,
                hours_start="09:00",
                hours_end="21:00",
                agent_role=(
                    "یک مشاور املاک حرفه\u200cای در دپارتمان ملک پارامیس هستی. "
                    "لحن رسمی-دوستانه، کوتاه و مؤدبانه. به فارسی پاسخ بده. "
                    "اگر در مورد قیمت یا بازدید سؤال شد، زمان بازدید هماهنگ کن."
                ),
                system_prompt=(
                    "تو دستیار فروش دپارتمان ملک پارامیس هستی. "
                    "اطلاعات تو دربارهٔ محله\u200cها، قیمت\u200cها و آماده\u200cسازی قرارداد کامل است."
                ),
                fallback_message=(
                    "سلام، پیامتون رو دریافت کردم. یکی از همکارانم بزودی پاسخ می\u200cدن. \U0001F64F"
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
                audience="خریداران و مستأجران نهایی در تهران، به\u200cویژه مناطق شمال و غرب",
                tone="formal-friendly",
                goals=["افزایش فروش فصلی", "رضایت مشتری", "برندینگ محلی"],
                offers="تخفیف کمیسیون برای معاملات بالای ۲۰ میلیارد، بازدید رایگان، مشاوره حقوقی رایگان",
                banned_phrases="ارزان، تضمین سود، بی\u200cواسطه، قولنامه دستی",
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

        if not db.query(ConnectorSession).filter(ConnectorSession.account_id == acc.id).first():
            role = (
                "baileys" if ch["channel"] == ChannelType.whatsapp
                else "divar" if ch["channel"] == ChannelType.divar
                else "bale"
            )
            db.add(
                ConnectorSession(
                    org_id=org.id,
                    account_id=acc.id,
                    device_id=f"demo-device-{acc.id[:6]}",
                    role=role,
                    status="online",
                )
            )
        accounts.append(acc)
    return accounts

def _ensure_leads(db, org, accounts, users):
    existing_count = db.query(Lead).filter(Lead.org_id == org.id).count()
    if existing_count >= len(LEADS):
        return db.query(Lead).filter(Lead.org_id == org.id).all()

    wa_accounts = [a for a in accounts if a.channel == ChannelType.whatsapp]
    divar_accounts = [a for a in accounts if a.channel == ChannelType.divar]
    bale_accounts = [a for a in accounts if a.channel == ChannelType.bale]

    leads = []
    for idx, row in enumerate(LEADS):
        lead = (
            db.query(Lead)
            .filter(Lead.org_id == org.id, Lead.phone == row["phone"])
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
        lead = Lead(
            org_id=org.id, name=row["name"], phone=row["phone"],
            external_chat_id=(row["phone"] if row["source"] != "whatsapp" else None),
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
        ext = row["phone"] if row["source"] != "whatsapp" else None
        if account:
            db.add(LeadAccountLink(
                org_id=org.id, lead_id=lead.id, account_id=account.id,
                chat_name=row["name"], external_chat_id=ext,
            ))
        leads.append(lead)
    return leads

def _ensure_conversations(db, org, accounts, users, leads):
    """Insert realistic Persian conversations for each lead that has none."""
    wa_accounts = [a for a in accounts if a.channel == ChannelType.whatsapp]
    divar_accounts = [a for a in accounts if a.channel == ChannelType.divar]
    bale_accounts = [a for a in accounts if a.channel == ChannelType.bale]

    for idx, row in enumerate(LEADS):
        if idx >= len(leads):
            break
        lead = leads[idx]
        # Skip if lead already has messages
        if db.query(Message).filter(Message.lead_id == lead.id).count() > 0:
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
        is_closed = stage == "بسته\u200cشده"
        ai_meta = {
            "sentiment": "positive" if score >= 80 else ("neutral" if score >= 55 else "cautious"),
            "confidence": round(0.6 + (score / 100) * 0.4, 2),
        }
        last_msg_at = lead.last_message_at or datetime.utcnow()
        assignee = users.get(row["assignee"])
        template = CONVERSATIONS.get(stage, CONVERSATIONS["جدید"])
        for j, (txt, sender) in enumerate(template):
            offset = len(template) - j
            ts = last_msg_at - timedelta(hours=offset * 6 + random.randint(0, 4))
            direction = MessageDirection.inbound if sender == "customer" else MessageDirection.outbound
            sender_type = (
                SenderType.customer if sender == "customer"
                else (SenderType.ai if (j % 4 == 1 and score >= 60) else SenderType.agent)
            )
            try:
                body = txt.format(
                    area=row["area"], size=row["size"], rooms=row["rooms"],
                    floor=row["floor"], year=row["year"], budget=row["budget"],
                    type=row["type"], intent=row["intent"], name=row["name"],
                )
            except KeyError:
                body = txt
            db.add(Message(
                org_id=org.id, account_id=account.id, lead_id=lead.id,
                direction=direction, sender_type=sender_type, body=body,
                agent_id=(assignee.id if sender_type == SenderType.agent and assignee else None),
                wa_message_id=f"demo-msg-{lead.id[:6]}-{j:03d}",
                media_type="text",
                delivery_status=("read" if direction == MessageDirection.outbound else ""),
                created_at=ts,
            ))
            if sender_type == SenderType.ai:
                db.add(AiEvent(
                    org_id=org.id, lead_id=lead.id, event_type="auto_reply",
                    payload={"body_preview": body[:80], "confidence": ai_meta["confidence"]},
                    created_at=ts,
                ))

        if is_closed and account:
            db.add(OutboundJob(
                org_id=org.id, account_id=account.id, lead_id=lead.id,
                target_name=row["name"],
                target_jid=f"{row['phone']}@s.whatsapp.net",
                body=f"سلام {row['name']} عزیز، از خرید شما در {row['area']} سپاسگزاریم. \U0001F337",
                sender_type=SenderType.agent,
                created_by_id=assignee.id if assignee else None,
                status=OutboundStatus.sent,
                created_at=last_msg_at, updated_at=last_msg_at,
            ))

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
        camp = Campaign(
            org_id=org.id, name=c["name"], status=c["status"],
            segment_json=c["segment"], message_template=c["template"],
            channel_account_id=(wa_accounts[0].id if wa_accounts else None),
            created_by_id=owner.id,
            started_at=datetime.utcnow() - timedelta(days=c["days_back"]),
            finished_at=(datetime.utcnow() - timedelta(days=c["days_back"] - 5) if c["status"] == "completed" else None),
        )
        db.add(camp); db.flush()
        for lead in leads:
            tags = list(lead.tags or [])
            stages_ok = (not c["segment"]["stages"]) or (lead.stage in c["segment"]["stages"])
            tags_ok = (not c["segment"]["tags"]) or any(t in tags for t in c["segment"]["tags"])
            score_ok = (lead.lead_score or 0) >= c["segment"]["min_score"]
            if not (stages_ok and tags_ok and score_ok):
                continue
            if db.query(CampaignSend).filter(CampaignSend.campaign_id == camp.id, CampaignSend.lead_id == lead.id).first():
                continue
            db.add(CampaignSend(
                org_id=org.id, campaign_id=camp.id, lead_id=lead.id,
                status=("sent" if c["status"] == "completed" else random.choice(["sent", "queued", "pending"])),
                created_at=datetime.utcnow() - timedelta(days=c["days_back"] - 1),
            ))


def _ensure_okrs(db, org, users):
    if db.query(OkrObjective).filter(OkrObjective.org_id == org.id).count() >= len(OKRS):
        return
    for o in OKRS:
        if db.query(OkrObjective).filter(OkrObjective.org_id == org.id, OkrObjective.title == o["title"]).first():
            continue
        u = users.get(o["assignee"])
        db.add(OkrObjective(
            org_id=org.id, title=o["title"],
            description=f"هدف تعیین\u200cشده توسط {o['assignee']} — دوره {o['period']}",
            target_value=o["target"], current_value=o["current"],
            period=o["period"], owner_id=u.id if u else None,
        ))

def _ensure_kpis(db, org):
    if db.query(KpiSnapshot).filter(KpiSnapshot.org_id == org.id).count() > 0:
        return
    kpi_defs = [
        {"key": "leads_total",        "label": "سرنخ\u200cهای جدید",     "target": 25,  "unit": "count"},
        {"key": "leads_converted",    "label": "تبدیل به مشتری",       "target": 5,   "unit": "count"},
        {"key": "messages_inbound",   "label": "پیام\u200cهای ورودی",  "target": 200, "unit": "count"},
        {"key": "messages_outbound",  "label": "پیام\u200cهای خروجی",  "target": 250, "unit": "count"},
        {"key": "ai_suggestions",     "label": "پیشنهاد AI",          "target": 100, "unit": "count"},
        {"key": "viewings_scheduled", "label": "بازدیدهای هماهنگ\u200cشده", "target": 15, "unit": "count"},
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
        subject="درخواست فعال\u200cسازی اتصال Bale برای شعبه شمال",
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
        body="سلام، درخواست شما دریافت شد. تیم فنی تا فردا اتصال را بررسی می\u200cکند.",
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
        ("member.invite",    "دعوت از مریم احمدی به\u200cعنوان agent"),
        ("member.invite",    "دعوت از حسین رضایی به\u200cعنوان agent"),
        ("ai.policy.update", "تغییر سیاست AI — فعال\u200cسازی auto-send"),
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
        _ensure_conversations(db, org, accounts, users, leads)
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


def main():
    # We need name/id before the session closes, so do a quick print inside seed.
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
    # Now actually do the heavy seeding (idempotent — already-created entities are skipped)
    _ = seed()
    print("=" * 60)
    print("✅ دمو فروش آماده شد")
    print("=" * 60)
    print(f"  کسب\u200cوکار:   {name}")
    print(f"  پلن:        {plan}")
    print(f"  org_id:     {org_id}")
    print(f"  owner:      {DEMO_OWNER_NAME} ({DEMO_OWNER_PHONE})")
    print(f"  endpoint:   POST /api/auth/demo/login")
    print("=" * 60)


if __name__ == "__main__":
    main()
