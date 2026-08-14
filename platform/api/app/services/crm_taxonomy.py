"""CRM tag taxonomy: machine keys + Persian UI labels."""

from __future__ import annotations

# Funnel stages used across the CRM (keep in sync with leads router / web STAGES).
FUNNEL_STAGES = ("جدید", "پیگیری", "پیشنهاد", "خرید", "بسته")
TERMINAL_STAGES = frozenset({"بسته", "از دست رفته"})

TAG_LABELS_FA: dict[str, str] = {
    "new_lead": "لید جدید",
    "high_intent": "قصد خرید بالا",
    "low_intent": "قصد خرید پایین",
    "price_sensitive": "حساس به قیمت",
    "info_seeking": "در حال تحقیق",
    "ready_to_buy": "آماده خرید",
    "promoter": "راضی / معرف",
    "detractor": "ناراضی",
    "churn_risk": "ریسک از دست رفتن",
    "needs_human": "نیاز به کارشناس",
    "complaint": "شکایت",
    "follow_up": "نیاز به پیگیری",
    "qualified": "واجد شرایط",
    "unqualified": "غیرواجد",
    "handoff": "ارجاع دستی",
}

ALLOWED_TAGS = frozenset(TAG_LABELS_FA.keys())

SENTIMENTS = frozenset({"positive", "neutral", "negative"})

SENTIMENT_LABELS_FA: dict[str, str] = {
    "positive": "مثبت",
    "neutral": "خنثی",
    "negative": "منفی",
}


def tag_label_fa(key: str) -> str:
    k = (key or "").strip()
    return TAG_LABELS_FA.get(k, k)


def filter_tags(keys: list[str] | None) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for raw in keys or []:
        k = str(raw or "").strip().lower().replace(" ", "_").replace("-", "_")
        if k not in ALLOWED_TAGS or k in seen:
            continue
        seen.add(k)
        out.append(k)
    return out


def normalize_sentiment(value: str | None) -> str:
    v = (value or "").strip().lower()
    return v if v in SENTIMENTS else "neutral"


def normalize_stage(value: str | None) -> str | None:
    s = (value or "").strip()
    if not s:
        return None
    if s in FUNNEL_STAGES or s in TERMINAL_STAGES:
        return s
    # soft match common variants
    aliases = {
        "new": "جدید",
        "follow": "پیگیری",
        "follow_up": "پیگیری",
        "offer": "پیشنهاد",
        "proposal": "پیشنهاد",
        "won": "خرید",
        "buy": "خرید",
        "closed": "بسته",
        "lost": "از دست رفته",
    }
    return aliases.get(s.lower())


def is_terminal_stage(stage: str | None) -> bool:
    return (stage or "").strip() in TERMINAL_STAGES
