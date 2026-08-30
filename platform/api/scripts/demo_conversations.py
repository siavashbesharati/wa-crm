"""Curated Persian WhatsApp-style conversations for the Paramis demo showcase.

Each script is a natural real-estate flow (خرید / اجاره) with short messages,
everyday Farsi, light emoji, and a mix of AI + human agent replies.
"""

from __future__ import annotations

from typing import Any


def _fmt(text: str, row: dict[str, Any]) -> str:
    return text.format(
        name=row.get("name") or "مشتری",
        area=row.get("area") or "تهران",
        type=row.get("type") or "آپارتمان",
        intent=row.get("intent") or "خرید",
        size=row.get("size") or 100,
        rooms=row.get("rooms") or "۲ خواب",
        budget=row.get("budget") or "",
        floor=row.get("floor") if row.get("floor") is not None else "—",
        year=row.get("year") or "—",
        first=(row.get("name") or "مشتری").split()[0],
    )


# role: customer | ai | agent
Script = list[tuple[str, str]]


def script_new_buy(row: dict[str, Any]) -> Script:
    return [
        ("customer", "سلام وقت بخیر"),
        ("customer", "آگهی {type} {area} رو دیدم، هنوز موجوده؟"),
        (
            "ai",
            "سلام، وقت شما هم بخیر 🙏 بله موجوده. {rooms}، حدود {size} متر. "
            "بودجه‌تون حدوداً چقدره تا فایل مناسب بفرستم؟",
        ),
        ("customer", "حدود {budget}"),
        (
            "ai",
            "اوکی. با این بودجه ۲-۳ مورد خوب تو {area} داریم. "
            "مشخصات و عکس رو براتون می‌فرستم.",
        ),
        ("customer", "عالی، لطفا بفرستید"),
        (
            "ai",
            "فرستادم ✅ اگه پسندید بگید تا بازدید حضوری هماهنگ کنیم.",
        ),
        ("customer", "باشه ممنون، امشب چک می‌کنم"),
    ]


def script_new_rent(row: dict[str, Any]) -> Script:
    return [
        ("customer", "سلام"),
        ("customer", "برای اجاره تو {area} چیزی دارید؟"),
        (
            "ai",
            "سلام وقت بخیر 🌿 بله. رهن و اجاره مد نظرتون چقدره؟",
        ),
        ("customer", "اجاره حدود {budget}، رهن هم قابل مذاکره"),
        (
            "ai",
            "باشه. {rooms} حدود {size} متری تو {area} داریم، بعضی‌ها مبله هم هست. "
            "عکس و آدرس حدودی رو براتون می‌فرستم.",
        ),
        ("customer", "خوبه، پارکینگ داره؟"),
        ("ai", "بله، پارکینگ و انباری داره. آسانسور هم هست."),
        ("customer", "اوکی لطفا فایل رو بفرستید"),
    ]


def script_followup_buy(row: dict[str, Any]) -> Script:
    return [
        ("customer", "سلام دوباره"),
        ("customer", "اون فایل {size} متری {area} رو دیدم، سندش چطوریه؟"),
        (
            "ai",
            "سلام، سند تک‌برگ و آزاد از رهن هست. سال ساخت حدود {year}. "
            "اگه بخواید جزئیات بیشتر رو همکارم براتون می‌فرسته.",
        ),
        ("customer", "قیمت متری چقدره تقریبا؟"),
        (
            "agent",
            "سلام {first} عزیز، من علی هستم از پارامیس. "
            "با توجه به موقعیت و امکانات، حدوداً با بودجه {budget} جور درمیاد. "
            "مالک کمی هم جای چانه داره.",
        ),
        ("customer", "خب بد نیست. وام هم میشه روش گذاشت؟"),
        (
            "agent",
            "بله، با بانک‌هایی که کار می‌کنیم وام قابل انجامه. "
            "اول یک بازدید بذارید تا از نزدیک ببینید، بعد مدارک رو کامل می‌کنیم.",
        ),
        ("customer", "اوکی، پنجشنبه عصر آزادم"),
        ("agent", "پنجشنبه ساعت ۱۷ اوکیه؟ لوکیشن رو همین‌جا می‌فرستم."),
        ("customer", "باشه عالی"),
    ]


def script_followup_rent(row: dict[str, Any]) -> Script:
    return [
        ("customer", "سلام وقتتون بخیر"),
        ("customer", "اون واحد {area} هنوز خالیه؟"),
        ("ai", "سلام بله هنوز خالیه. برای کی می‌خواید تحویل بگیرید؟"),
        ("customer", "تا آخر ماه"),
        (
            "agent",
            "سلام، مریم هستم. مالک تا پایان ماه آزاد می‌کنه. "
            "رهن و اجاره حدود {budget} هست، کمی هم قابل مذاکره.",
        ),
        ("customer", "ضامن لازم داره؟"),
        ("agent", "معمولاً یک ضامن یا چک معتبر می‌خوان. جزئیات رو حضوری می‌گیم."),
        ("customer", "باشه، فردا میتونم بیام ببینم؟"),
        ("agent", "فردا ساعت ۱۱ اوکیه. آدرس رو براتون می‌فرستم."),
    ]


def script_proposal_viewing(row: dict[str, Any]) -> Script:
    return [
        ("customer", "سلام، فایل‌هایی که فرستادید رو دیدم"),
        ("customer", "اون {type} {area} بیشتر به دلم نشست"),
        (
            "ai",
            "عالیه 👍 برای بازدید حضوری کی براتون راحت‌تره؟ صبح یا عصر؟",
        ),
        ("customer", "عصرها بهتره، بعد از ساعت ۴"),
        (
            "agent",
            "سلام {first} جان، من هماهنگ کردم با مالک. "
            "فردا ساعت ۱۷:۳۰ تو {area} بازدید داریم. اوکیه؟",
        ),
        ("customer", "اوکی، پارکینگ مهمون داره ساختمون؟"),
        ("agent", "بله، برای بازدید پارکینگ موقت اوکیه. لوکیشن دقیق: همین پیام بعدی."),
        ("customer", "مرسی، پس فردا می‌بینمتون"),
        ("agent", "چشم، فردا همون‌جا منتظرتون هستیم 🤝"),
    ]


def script_proposal_luxury(row: dict[str, Any]) -> Script:
    return [
        ("customer", "سلام وقت بخیر"),
        ("customer", "پنت‌هاوس / واحد لوکس {area} رو میشه ببینم؟"),
        (
            "ai",
            "سلام، بله. این مورد امکانات کامل داره و بازدیدش با هماهنگی قبلیه.",
        ),
        ("customer", "قیمتش در حد {budget} هست دیگه؟"),
        (
            "agent",
            "سلام، مریم از پارامیس. بله در همین رنجه. "
            "ویو و مشاعات خیلی خوبه؛ بهتره حضوری ببینید چون عکس کامل حق مطلب رو نمی‌رسونه.",
        ),
        ("customer", "شنبه صبح آزادم"),
        ("agent", "شنبه ساعت ۱۰:۳۰ رزرو کردم. کد ورود و آدرس رو براتون می‌فرستم."),
        ("customer", "عالیه ممنون"),
    ]


def script_buy_negotiation(row: dict[str, Any]) -> Script:
    return [
        ("customer", "سلام"),
        ("customer", "بازدید خوب بود، ولی قیمت کمی بالاست"),
        (
            "agent",
            "سلام {first} عزیز، ممنون که اومدید. "
            "با مالک صحبت کردم؛ روی قیمت نهایی کمی انعطاف دارن.",
        ),
        ("customer", "من تا {budget} نقد می‌تونم بیارم"),
        (
            "agent",
            "اوکی، این عدد رو بهشون گفتم. احتمالاً نزدیک توافق بشیم. "
            "اگه موافقید پیش‌نویس قولنامه رو آماده کنیم.",
        ),
        ("customer", "باشه ولی کمیسیونتون چقدره؟"),
        (
            "agent",
            "طبق عرف ۱٪ از طرف خریدار. برای مبالغ بالاتر کمی تخفیف هم داریم.",
        ),
        ("customer", "اوکی، فردا بیایم دفتر؟"),
        ("agent", "چشم، فردا ساعت ۱۲ دفتر پارامیس. آدرس رو همین‌جا می‌فرستم."),
        ("customer", "باشه پس فردا"),
    ]


def script_rent_negotiation(row: dict[str, Any]) -> Script:
    return [
        ("customer", "سلام وقت بخیر"),
        ("customer", "واحد رو پسندیدم، میشه رهن کامل کرد؟"),
        (
            "agent",
            "سلام، با مالک چک کردم. رهن کامل با تخفیف ممکنه، "
            "یا همون ترکیب رهن و اجاره حدود {budget}.",
        ),
        ("customer", "ترجیح می‌دم رهن بیشتر باشه اجاره کمتر"),
        ("agent", "اوکی، پیشنهادمون رو می‌نویسم و تا امشب جواب قطعی می‌دم."),
        ("customer", "مدارک چی لازم دارم؟"),
        (
            "agent",
            "کارت ملی، چک یا سفته، و معمولاً یک معرف/ضامن. "
            "جزئیات قرارداد رو حضوری کامل می‌گیم.",
        ),
        ("customer", "باشه ممنون، منتظر پیامتم"),
    ]


def script_closed_buy(row: dict[str, Any]) -> Script:
    return [
        ("customer", "سلام، قولنامه امضا شد دیگه؟"),
        (
            "agent",
            "سلام {first} عزیز 🌷 بله، همه چیز اوکیه. "
            "تبریک می‌گم، {type} {area} به نام شما تموم شد.",
        ),
        ("customer", "خیلی ممنون از پیگیریتون"),
        (
            "agent",
            "خواهش می‌کنم. کلید و مدارک فردا ساعت ۱۱ تحویل می‌شه. "
            "اگه سوالی بود همین‌جا پیام بدید.",
        ),
        ("customer", "اوکی، پس فردا می‌بینمتون"),
        ("ai", "یادآوری: فردا ساعت ۱۱ تحویل کلید در دفتر پارامیس. موفق باشید 🙏"),
    ]


def script_closed_rent(row: dict[str, Any]) -> Script:
    return [
        ("customer", "سلام، قرارداد اجاره نهایی شد؟"),
        (
            "agent",
            "سلام بله، قرارداد ثبت شد و کلید آماده‌ست. "
            "تحویل فردا صبح تو {area}.",
        ),
        ("customer", "عالیه، کنتورها رو هم چک کردید؟"),
        ("agent", "بله، قرائت کنتور ثبت شده و تو صورت‌جلسه اومده."),
        ("customer", "مرسی واقعا پیگیر بودید"),
        ("agent", "خواهش می‌کنم، ساکن مبارک 🌿 هر سوالی بود درخدمتم."),
    ]


def script_divar_inquiry(row: dict[str, Any]) -> Script:
    return [
        ("customer", "سلام از دیوار پیام می‌دم"),
        ("customer", "آگهی {type} {area} هنوز هست؟"),
        (
            "ai",
            "سلام وقت بخیر، بله موجوده. برای هماهنگی بازدید یا جزئیات بیشتر بفرمایید.",
        ),
        ("customer", "متراژ دقیقش چند متره؟"),
        ("ai", "حدود {size} متر، {rooms}. بودجه شما حدود {budget} هست؟"),
        ("customer", "تقریباً بله"),
        (
            "agent",
            "سلام، فایل کامل و عکس‌های بیشتر رو براتون فرستادم. "
            "اگه خواستید بازدید بذارید بگید.",
        ),
        ("customer", "باشه امشب می‌بینم پیام می‌دم"),
    ]


def script_bale_inquiry(row: dict[str, Any]) -> Script:
    return [
        ("customer", "سلام از بله"),
        ("customer", "برای {intent} تو {area} راهنمایی می‌کنید؟"),
        (
            "ai",
            "سلام وقت بخیر 🙏 بله، دپارتمان پارامیس درخدمته. "
            "چه متراژ و بودجه‌ای مد نظرتونه؟",
        ),
        ("customer", "{rooms} حدود {size} متر، بودجه {budget}"),
        (
            "ai",
            "چند مورد مناسب داریم. مشخصات رو براتون می‌فرستم، بعد اگه خواستید همکارتون وصل می‌شه.",
        ),
        ("customer", "اوکی ممنون"),
        (
            "agent",
            "سلام، حسین هستم. فایل‌ها رو دیدید؟ کدوم بیشتر به کارتون میاد؟",
        ),
        ("customer", "اولی بهتره، میشه بازدید بذاریم؟"),
        ("agent", "حتماً، فردا یا پس‌فردا کدوم براتون راحت‌تره؟"),
    ]


def build_conversation(row: dict[str, Any]) -> Script:
    """Pick a natural script matching stage / intent / channel."""
    stage = (row.get("stage") or "جدید").strip()
    intent = (row.get("intent") or "خرید").strip()
    source = (row.get("source") or "whatsapp").strip().lower()
    is_rent = intent == "اجاره"

    # Channel-flavored openers for a few new leads
    if source == "divar" and stage == "جدید":
        raw = script_divar_inquiry(row)
    elif source == "bale" and stage in ("جدید", "پیگیری"):
        raw = script_bale_inquiry(row)
    elif stage == "جدید":
        raw = script_new_rent(row) if is_rent else script_new_buy(row)
    elif stage == "پیگیری":
        raw = script_followup_rent(row) if is_rent else script_followup_buy(row)
    elif stage == "پیشنهاد":
        # luxury / penthouse get a richer viewing flow
        tags = set(row.get("tags") or [])
        if "لوکس" in tags or "برند" in tags or row.get("type") in ("پنت‌هاوس", "ویلا", "باغ ویلا"):
            raw = script_proposal_luxury(row)
        else:
            raw = script_proposal_viewing(row)
    elif stage == "خرید":
        raw = script_rent_negotiation(row) if is_rent else script_buy_negotiation(row)
    elif stage == "بسته":
        raw = script_closed_rent(row) if is_rent else script_closed_buy(row)
    else:
        raw = script_new_buy(row)

    return [(role, _fmt(body, row)) for role, body in raw]
