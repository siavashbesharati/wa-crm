"""Curated Persian WhatsApp-style conversations for the Paramis demo showcase.

Rules for a realistic agency demo:
- AI handles ~99% of the chat (info, pricing, files, docs, reassurance).
- A human agent appears only to lock an appointment / visit time.
- AI always addresses the lead politely: «سلام خانم حسینی» / «سلام آقای کریمی».
- When files are promised, follow with media log turns (image/document) — no real files,
  just chat markers that files were sent.
"""

from __future__ import annotations

from typing import Any

# Turn: (role, body) or (role, body, media_type)
# media_type: text | image | document | video | audio
ScriptTurn = tuple[str, str] | tuple[str, str, str]
Script = list[ScriptTurn]

_FEMALE_FIRST = {
    "لیلا", "مریم", "فاطمه", "زهرا", "نرگس", "سارا", "الناز", "شیوا", "پریسا",
    "رویا", "ندا", "مونا", "ترانه", "سپیده", "یاسمین", "الهام", "نگار", "شیدا",
    "گلنار", "آیدا", "مهسا", "نسترن", "حدیث", "سمیرا", "فریبا", "ناهید",
    "بهاره", "مینا", "کیمیا", "نیلوفر", "هانیه", "سحر",
}


def polite_address(name: str | None) -> str:
    """Build a natural Persian polite form of address from the CRM display name."""
    raw = (name or "").strip()
    if not raw:
        return "شما"
    parts = raw.split()
    low = raw

    if low.startswith("خانم"):
        if len(parts) >= 2:
            return f"خانم {parts[-1]}"
        return raw
    if low.startswith("آقای") or low.startswith("آقا "):
        if len(parts) >= 2:
            return f"آقای {parts[-1]}"
        return raw.replace("آقا ", "آقای ", 1)
    if low.startswith("مهندس"):
        return f"مهندس {parts[-1]}" if len(parts) >= 2 else raw
    if low.startswith("دکتر"):
        return f"دکتر {parts[-1]}" if len(parts) >= 2 else raw

    if len(parts) >= 2:
        first, last = parts[0], parts[-1]
        if first in _FEMALE_FIRST:
            return f"خانم {last}"
        return f"آقای {last}"

    if raw in _FEMALE_FIRST:
        return f"خانم {raw}"
    return f"آقای {raw}"


def _fmt(text: str, row: dict[str, Any]) -> str:
    name = row.get("name") or "مشتری"
    address = polite_address(name)
    return text.format(
        name=name,
        address=address,
        area=row.get("area") or "تهران",
        type=row.get("type") or "آپارتمان",
        intent=row.get("intent") or "خرید",
        size=row.get("size") or 100,
        rooms=row.get("rooms") or "۲ خواب",
        budget=row.get("budget") or "",
        floor=row.get("floor") if row.get("floor") is not None else "—",
        year=row.get("year") or "—",
    )


def _files_photos(label: str = "عکس‌های ملک") -> list[ScriptTurn]:
    return [
        ("ai", label, "image"),
        ("ai", "پلان واحد", "image"),
    ]


def _files_pack() -> list[ScriptTurn]:
    return [
        ("ai", "عکس‌های ملک", "image"),
        ("ai", "فایل مشخصات PDF", "document"),
    ]


# ---------------------------------------------------------------------------
# Scripts — AI-heavy; agent only for appointment lock
# ---------------------------------------------------------------------------

def script_new_buy(row: dict[str, Any]) -> Script:
    return [
        ("customer", "سلام وقت بخیر"),
        ("customer", "آگهی {type} {area} رو دیدم، هنوز موجوده؟"),
        (
            "ai",
            "سلام {address}، وقت شما هم بخیر 🙏 بله هنوز موجوده. "
            "{rooms}، حدود {size} متر. بودجه‌تون حدوداً چقدره تا فایل مناسب بفرستم؟",
        ),
        ("customer", "حدود {budget}"),
        (
            "ai",
            "{address} عزیز، با این بودجه ۲-۳ مورد خوب تو {area} داریم. "
            "الان عکس و مشخصات رو براتون می‌فرستم.",
        ),
        *_files_pack(),
        ("customer", "پارکینگ و انباری داره؟"),
        ("ai", "بله، پارکینگ و انباری داره. آسانسور هم هست."),
        ("customer", "خوبه ممنون"),
        ("ai", "خواهش می‌کنم {address} ✅ اگه پسندید بگید تا برای بازدید حضوری هماهنگ کنیم."),
        ("customer", "امشب چک می‌کنم ممنون"),
        ("ai", "چشم {address}، هر سوالی بود همین‌جا بپرسید 🌿"),
    ]


def script_new_rent(row: dict[str, Any]) -> Script:
    return [
        ("customer", "سلام"),
        ("customer", "برای اجاره تو {area} چیزی دارید؟"),
        (
            "ai",
            "سلام {address}، وقت بخیر 🌿 بله. رهن و اجاره مد نظرتون حدوداً چقدره؟",
        ),
        ("customer", "اجاره حدود {budget}، رهن هم قابل مذاکره"),
        (
            "ai",
            "اوکی {address}. {rooms} حدود {size} متری تو {area} داریم. "
            "الان عکس‌ها رو براتون می‌فرستم.",
        ),
        *_files_photos("عکس‌های واحد اجاره‌ای"),
        ("customer", "ضامن لازم داره؟"),
        (
            "ai",
            "معمولاً بله، یک ضامن یا چک معتبر. جزئیات دقیق رو موقع بازدید می‌گیم.",
        ),
        ("customer", "اوکی ممنون"),
        ("ai", "چشم {address}. اگه خواستید بازدید بذارید بگید تا همکارم زمان قطعی رو هماهنگ کنه."),
    ]


def script_followup_buy(row: dict[str, Any]) -> Script:
    return [
        ("customer", "سلام دوباره"),
        ("customer", "اون فایل {size} متری {area} رو دیدم، سندش چطوریه؟"),
        (
            "ai",
            "سلام {address} 🙏 سند تک‌برگ و آزاد از رهنه. سال ساخت حدود {year}.",
        ),
        ("customer", "قیمت متری چقدره تقریبا؟"),
        (
            "ai",
            "با توجه به موقعیت و امکانات، حدوداً با بودجه {budget} جور درمیاد. "
            "مالک کمی هم جای چانه داره. یه فایل خلاصه مشخصات هم می‌فرستم.",
        ),
        ("ai", "خلاصه مشخصات و قیمت", "document"),
        ("customer", "وام هم میشه روش گذاشت؟"),
        (
            "ai",
            "بله {address}، با بانک‌هایی که کار می‌کنیم وام قابل انجامه. "
            "اول بازدید بذارید از نزدیک ببینید، بعد مدارک رو کامل می‌کنیم.",
        ),
        ("customer", "اوکی، پنجشنبه عصر آزادم برای بازدید"),
        (
            "ai",
            "عالی. دارم به همکارم وصل می‌کنم تا با مالک قطعی هماهنگ کنه ⏳",
        ),
        (
            "agent",
            "سلام {address}، علی هستم از پارامیس. پنجشنبه ساعت ۱۷ برای بازدید {area} قطعی شد. لوکیشن رو همین‌جا می‌فرستم.",
        ),
        ("customer", "باشه عالی ممنون"),
        ("ai", "چشم {address}، یادآوری بازدید رو هم براتون می‌فرستم 🤝"),
    ]


def script_followup_rent(row: dict[str, Any]) -> Script:
    return [
        ("customer", "سلام وقتتون بخیر"),
        ("customer", "اون واحد {area} هنوز خالیه؟"),
        ("ai", "سلام {address}، بله هنوز خالیه. برای کی می‌خواید تحویل بگیرید؟"),
        ("customer", "تا آخر ماه"),
        (
            "ai",
            "مالک تا پایان ماه آزاد می‌کنه. رهن و اجاره حدود {budget} هست، کمی هم قابل مذاکره. "
            "عکس‌های به‌روز رو هم می‌فرستم.",
        ),
        *_files_photos("عکس‌های به‌روز واحد"),
        ("customer", "مبله هست یا خالی؟"),
        ("ai", "خالی تحویل می‌دن؛ اگه مبله بخواید چند مورد دیگه هم داریم بفرستم."),
        ("customer", "همین خوبه. فردا میتونم بیام ببینم؟"),
        ("ai", "حتماً. یه لحظه همکارم زمان قطعی رو با مالک قفل می‌کنه."),
        (
            "agent",
            "سلام {address}، مریم از پارامیس. فردا ساعت ۱۱ بازدید قطعی شد. آدرس رو براتون می‌فرستم.",
        ),
        ("customer", "اوکی مرسی"),
    ]


def script_proposal_viewing(row: dict[str, Any]) -> Script:
    return [
        ("customer", "سلام، فایل‌هایی که فرستادید رو دیدم"),
        ("customer", "اون {type} {area} بیشتر به دلم نشست"),
        (
            "ai",
            "عالیه {address} 👍 مشخصاتش: حدود {size} متر، {rooms}. "
            "چند عکس نزدیک‌تر هم براتون می‌فرستم.",
        ),
        *_files_photos("عکس‌های نزدیک‌تر"),
        ("ai", "برای بازدید حضوری کی براتون راحت‌تره؟ صبح یا عصر؟"),
        ("customer", "عصرها بهتره، بعد از ساعت ۴"),
        (
            "ai",
            "اوکی. پارکینگ مهمان برای بازدید اوکیه. دارم هماهنگی قطعی رو به همکارم می‌سپرم.",
        ),
        (
            "agent",
            "سلام {address}، با مالک هماهنگ شد — فردا ساعت ۱۷:۳۰ تو {area}. لوکیشن دقیق رو می‌فرستم.",
        ),
        ("customer", "مرسی، پس فردا می‌بینمتون"),
        ("ai", "چشم {address}، فردا یادآوری هم براتون می‌فرستم. موفق باشید 🌿"),
    ]


def script_proposal_luxury(row: dict[str, Any]) -> Script:
    return [
        ("customer", "سلام وقت بخیر"),
        ("customer", "واحد لوکس {area} رو میشه ببینم؟"),
        (
            "ai",
            "سلام {address}، بله. این مورد امکانات کامل داره؛ بازدیدش با هماهنگی قبلیه. "
            "آلبوم عکس و کاتالوگ رو براتون می‌فرستم.",
        ),
        ("ai", "آلبوم عکس واحد", "image"),
        ("ai", "عکس ویو و مشاعات", "image"),
        ("ai", "کاتالوگ امکانات PDF", "document"),
        ("customer", "قیمتش در حد {budget} هست دیگه؟"),
        (
            "ai",
            "بله {address}، در همین رنجه. ویو و مشاعات خیلی خوبه؛ "
            "عکس کامل حق مطلب رو نمی‌رسونه، بهتره حضوری ببینید.",
        ),
        ("customer", "پارکینگ چندتاست؟"),
        ("ai", "دو واحد پارکینگ داره، به اضافه انباری."),
        ("customer", "شنبه صبح آزادم برای بازدید"),
        ("ai", "عالی. همکارم زمان قطعی رو با نگهبانی/مالک قفل می‌کنه."),
        (
            "agent",
            "سلام {address}، مریم از پارامیس. شنبه ساعت ۱۰:۳۰ رزرو شد. کد ورود و آدرس رو براتون می‌فرستم.",
        ),
        ("customer", "عالیه ممنون"),
    ]


def script_buy_negotiation(row: dict[str, Any]) -> Script:
    return [
        ("customer", "سلام"),
        ("customer", "بازدید خوب بود، ولی قیمت کمی بالاست"),
        (
            "ai",
            "سلام {address}، ممنون که اومدید 🙏 متوجه هستم. "
            "با مالک در مورد انعطاف قیمت صحبت می‌کنم و نتیجه رو می‌گم.",
        ),
        ("customer", "من تا {budget} نقد می‌تونم بیارم"),
        (
            "ai",
            "اوکی {address}، این عدد رو بهشون منتقل کردم. "
            "احتمال توافق هست. کمیسیون هم طبق عرف ۱٪ از طرف خریداره. "
            "پیش‌نویس شرایط رو هم براتون می‌فرستم.",
        ),
        ("ai", "پیش‌نویس شرایط معامله", "document"),
        ("customer", "مدارک چی لازم دارم؟"),
        (
            "ai",
            "کارت ملی، چک یا رسید بانکی برای بیعانه، و مدارک شناسایی. "
            "اگه بخواید فردا بیایم دفتر برای پیش‌نویس قولنامه؟",
        ),
        ("customer", "آره فردا بیایم دفتر"),
        ("ai", "چشم، زمان قطعی رو همکارم براتون اعلام می‌کنه."),
        (
            "agent",
            "سلام {address}، علی از پارامیس. فردا ساعت ۱۲ دفتر پارامیس قطعی شد. آدرس رو همین‌جا می‌فرستم.",
        ),
        ("customer", "باشه پس فردا"),
        ("ai", "موفق باشید {address} 🌷 هر سوالی قبلش بود بپرسید."),
    ]


def script_rent_negotiation(row: dict[str, Any]) -> Script:
    return [
        ("customer", "سلام وقت بخیر"),
        ("customer", "واحد رو پسندیدم، میشه رهن کامل کرد؟"),
        (
            "ai",
            "سلام {address}، با مالک چک می‌کنم. "
            "معمولاً رهن کامل با تخفیف ممکنه، یا همون ترکیب رهن و اجاره حدود {budget}.",
        ),
        ("customer", "ترجیح می‌دم رهن بیشتر باشه اجاره کمتر"),
        (
            "ai",
            "اوکی {address}، پیشنهادمون رو نوشتم و تا امشب جواب قطعی می‌دم. "
            "یه نمونه قرارداد هم براتون می‌فرستم تا ببینید.",
        ),
        ("ai", "نمونه قرارداد اجاره", "document"),
        ("customer", "مدارک چی لازم دارم؟"),
        (
            "ai",
            "کارت ملی، چک یا سفته، و معمولاً یک معرف/ضامن. "
            "جزئیات قرارداد رو حضوری کامل می‌گیم.",
        ),
        ("customer", "پس کی بیام برای قرارداد؟"),
        ("ai", "یه لحظه همکارم زمان دفتر رو قفل می‌کنه."),
        (
            "agent",
            "سلام {address}، مریم هستم. فردا ساعت ۱۱ برای قرارداد قطعی شد.",
        ),
        ("customer", "باشه ممنون"),
    ]


def script_closed_buy(row: dict[str, Any]) -> Script:
    return [
        ("customer", "سلام، قولنامه امضا شد دیگه؟"),
        (
            "ai",
            "سلام {address} 🌷 بله، همه چیز اوکیه. "
            "تبریک می‌گم، {type} {area} به نام شما تموم شد. رسید و خلاصه پرونده رو هم می‌فرستم.",
        ),
        ("ai", "رسید معامله", "document"),
        ("customer", "خیلی ممنون از پیگیریتون"),
        (
            "ai",
            "خواهش می‌کنم {address}. کلید و مدارک فردا ساعت ۱۱ تحویل می‌شه. "
            "اگه سوالی بود همین‌جا پیام بدید.",
        ),
        ("customer", "اوکی، پس فردا می‌بینمتون"),
        ("ai", "یادآوری: فردا ساعت ۱۱ تحویل کلید در دفتر پارامیس. موفق باشید 🙏"),
    ]


def script_closed_rent(row: dict[str, Any]) -> Script:
    return [
        ("customer", "سلام، قرارداد اجاره نهایی شد؟"),
        (
            "ai",
            "سلام {address}، بله قرارداد ثبت شد و کلید آماده‌ست. "
            "تحویل فردا صبح تو {area}. نسخه قرارداد رو هم براتون می‌فرستم.",
        ),
        ("ai", "نسخه قرارداد اجاره", "document"),
        ("customer", "عالیه، کنتورها رو هم چک کردید؟"),
        ("ai", "بله، قرائت کنتور ثبت شده و تو صورت‌جلسه اومده."),
        ("customer", "مرسی واقعا پیگیر بودید"),
        ("ai", "خواهش می‌کنم {address}، ساکن مبارک 🌿 هر سوالی بود درخدمتم."),
    ]


def script_divar_inquiry(row: dict[str, Any]) -> Script:
    return [
        ("customer", "سلام، از دیوار پیام می‌دم"),
        ("customer", "آگهی {type} {area} هنوز هست؟"),
        (
            "ai",
            "سلام {address}، وقت بخیر 🙏 بله موجوده. "
            "حدود {size} متر، {rooms}. بودجه شما حدود {budget} هست؟",
        ),
        ("customer", "تقریباً بله"),
        (
            "ai",
            "عالی {address}. الان فایل کامل و عکس‌های بیشتر رو براتون می‌فرستم.",
        ),
        *_files_pack(),
        ("customer", "پارکینگ داره؟"),
        ("ai", "بله، پارکینگ و انباری داره."),
        ("customer", "باشه امشب می‌بینم، اگه اوکی بود برای بازدید پیام می‌دم"),
        ("ai", "چشم {address}، هر وقت آماده بودید بگید تا همکارم زمان بازدید رو قطعی کنه."),
    ]


def script_bale_inquiry(row: dict[str, Any]) -> Script:
    return [
        ("customer", "سلام، از بله پیام می‌دم"),
        ("customer", "برای {intent} تو {area} راهنمایی می‌کنید؟"),
        (
            "ai",
            "سلام {address}، وقت بخیر 🙏 بله، دپارتمان پارامیس درخدمته. "
            "چه متراژ و بودجه‌ای مد نظرتونه؟",
        ),
        ("customer", "{rooms} حدود {size} متر، بودجه {budget}"),
        (
            "ai",
            "چند مورد مناسب داریم {address}. مشخصات رو الان براتون می‌فرستم.",
        ),
        *_files_pack(),
        ("customer", "اوکی ممنون"),
        ("ai", "خواهش می‌کنم ✅ کدوم بیشتر به کارتون میاد؟"),
        ("customer", "اولی بهتره، میشه بازدید بذاریم؟"),
        ("ai", "حتماً. فردا یا پس‌فردا کدوم براتون راحت‌تره؟"),
        ("customer", "فردا عصر"),
        ("ai", "عالی. همکارم زمان قطعی رو با مالک فیکس می‌کنه."),
        (
            "agent",
            "سلام {address}، حسین از پارامیس. فردا ساعت ۱۸ بازدید {area} قطعی شد.",
        ),
        ("customer", "باشه مرسی"),
    ]


def script_divar_followup(row: dict[str, Any]) -> Script:
    return [
        ("customer", "سلام دوباره از دیوار"),
        ("customer", "آگهی {type} {area} رو هنوز نگه داشتید؟"),
        (
            "ai",
            "سلام {address} 🙏 بله هنوز موجوده. "
            "سند و قیمت حدود {budget} هست؛ خلاصه مشخصات رو می‌فرستم.",
        ),
        ("ai", "خلاصه آگهی دیوار", "document"),
        *_files_photos("عکس‌های آگهی"),
        ("customer", "می‌تونم بازدید بذارم؟"),
        ("ai", "حتماً. یه لحظه همکارم زمان قطعی رو هماهنگ می‌کنه."),
        (
            "agent",
            "سلام {address}، مریم از پارامیس. فردا ساعت ۱۶ بازدید {area} قطعی شد.",
        ),
        ("customer", "اوکی ممنون"),
    ]


def script_bale_followup(row: dict[str, Any]) -> Script:
    return [
        ("customer", "سلام از بله"),
        ("customer", "اون فایل {size} متری {area} رو دوباره چک کردم"),
        (
            "ai",
            "سلام {address} 🙏 خوشحالم که پیگیری کردید. "
            "سند تک‌برگه و با بودجه {budget} جور درمیاد.",
        ),
        ("customer", "وام هم میشه؟"),
        (
            "ai",
            "بله {address}، قابل انجامه. یه فایل راهنمای مدارک هم براتون می‌فرستم.",
        ),
        ("ai", "راهنمای مدارک وام", "document"),
        ("customer", "پنجشنبه عصر آزادم"),
        ("ai", "عالی. همکارم زمان بازدید رو قفل می‌کنه."),
        (
            "agent",
            "سلام {address}، حسین از پارامیس. پنجشنبه ۱۷ بازدید {area} قطعی شد.",
        ),
        ("customer", "باشه ممنون"),
    ]


def script_divar_closed(row: dict[str, Any]) -> Script:
    return [
        ("customer", "سلام از دیوار، قولنامه اوکی شد؟"),
        (
            "ai",
            "سلام {address} 🌷 بله، از مسیر دیوار همه‌چیز نهایی شد. "
            "رسید معامله رو براتون می‌فرستم.",
        ),
        ("ai", "رسید معامله", "document"),
        ("customer", "مرسی از پیگیری"),
        ("ai", "خواهش می‌کنم {address}. موفق باشید 🌿"),
    ]


def script_bale_closed(row: dict[str, Any]) -> Script:
    return [
        ("customer", "سلام از بله، قرارداد نهایی شد؟"),
        (
            "ai",
            "سلام {address} 🌷 بله از بله هم همه‌چیز ثبت شد. "
            "نسخه قرارداد رو براتون می‌فرستم.",
        ),
        ("ai", "نسخه قرارداد", "document"),
        ("customer", "عالیه ممنون"),
        ("ai", "خواهش می‌کنم {address}. هر سوالی بود همین‌جا درخدمتم."),
    ]


def _stage_script(row: dict[str, Any]) -> Script:
    stage = (row.get("stage") or "جدید").strip()
    intent = (row.get("intent") or "خرید").strip()
    is_rent = intent == "اجاره"

    if stage == "جدید":
        return script_new_rent(row) if is_rent else script_new_buy(row)
    if stage == "پیگیری":
        return script_followup_rent(row) if is_rent else script_followup_buy(row)
    if stage == "پیشنهاد":
        tags = set(row.get("tags") or [])
        if "لوکس" in tags or "برند" in tags or row.get("type") in ("پنت‌هاوس", "ویلا", "باغ ویلا"):
            return script_proposal_luxury(row)
        return script_proposal_viewing(row)
    if stage == "خرید":
        return script_rent_negotiation(row) if is_rent else script_buy_negotiation(row)
    if stage == "بسته":
        return script_closed_rent(row) if is_rent else script_closed_buy(row)
    return script_new_buy(row)


def _channel_opener(source: str) -> ScriptTurn | None:
    if source == "divar":
        return ("customer", "سلام، از دیوار پیام می‌دم")
    if source == "bale":
        return ("customer", "سلام، از بله پیام می‌دم")
    return None


def _ensure_channel_voice(raw: Script, source: str) -> Script:
    """Guarantee Divar/Bale threads open with a clear channel identity + real text."""
    opener = _channel_opener(source)
    if not opener:
        return raw
    marker = "دیوار" if source == "divar" else "بله"
    first_body = raw[0][1] if raw else ""
    if marker in first_body:
        return raw
    return [opener, *raw]


def build_conversation(row: dict[str, Any]) -> Script:
    """Pick a natural script matching stage / intent / channel."""
    stage = (row.get("stage") or "جدید").strip()
    source = (row.get("source") or "whatsapp").strip().lower()

    if source == "divar":
        if stage == "جدید":
            raw = script_divar_inquiry(row)
        elif stage == "پیگیری":
            raw = script_divar_followup(row)
        elif stage == "بسته":
            raw = script_divar_closed(row)
        else:
            raw = _ensure_channel_voice(_stage_script(row), "divar")
    elif source == "bale":
        if stage in ("جدید",):
            raw = script_bale_inquiry(row)
        elif stage == "پیگیری":
            raw = script_bale_followup(row)
        elif stage == "بسته":
            raw = script_bale_closed(row)
        else:
            raw = _ensure_channel_voice(_stage_script(row), "bale")
    else:
        raw = _stage_script(row)

    out: Script = []
    for turn in raw:
        role = turn[0]
        body = (_fmt(turn[1], row) or "").strip()
        media = turn[2] if len(turn) > 2 else "text"
        if not body:
            # Never seed blank bubbles — keep a readable Persian fallback.
            if media and media != "text":
                body = {
                    "image": "تصویر ملک",
                    "document": "فایل مشخصات",
                    "video": "ویدیو ملک",
                    "audio": "پیام صوتی",
                }.get(media, "پیوست")
            else:
                body = "سلام، پیام دمو"
        out.append((role, body, media))
    return out
