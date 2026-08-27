"""One-shot utility: wipe all demo campaigns + their sends + campaign-related
messages so the new seeder can run from a clean slate.

Usage:
  cd platform/api
  python wipe_demo_camps.py
"""
import sys

sys.stdout.reconfigure(encoding="utf-8")

from app.database import SessionLocal
from app.models import Organization, Campaign, CampaignSend, Message, AiEvent, Lead

db = SessionLocal()
org = db.query(Organization).filter(Organization.name == "دپارتمان ملک پارامیس").first()
if not org:
    print("Demo org not found")
    sys.exit(0)

# Collect campaign lead IDs to clean up demo-tagged messages
camps = db.query(Campaign).filter(Campaign.org_id == org.id).all()
print(f"Deleting {len(camps)} campaigns and their sends...")

# 1) Campaign sends
sends = db.query(CampaignSend).filter(CampaignSend.org_id == org.id).all()
for s in sends:
    db.delete(s)
db.flush()

# 2) Messages that we tagged with demo-camp-* ids
demo_msgs = (
    db.query(Message)
    .filter(
        Message.org_id == org.id,
        Message.wa_message_id.like("demo-camp-%"),
    )
    .all()
)
for m in demo_msgs:
    db.delete(m)
db.flush()

# 3) AiEvent rows from the demo campaign pass (scan payload in Python)
ai_evs_all = db.query(AiEvent).filter(AiEvent.org_id == org.id).all()
to_delete = [e for e in ai_evs_all if isinstance(e.payload, dict) and e.payload.get("source") == "seed-demo-campaign"]
for e in to_delete:
    db.delete(e)
db.flush()

# 4) Reset leads that were flipped to بسته‌شده by the campaign seed.
#    Heuristic: a lead that was originally in مذاکره (its phone ends in 12x-12x
#    or 13x-13x ranges) and is now in بسته‌شده gets restored to مذاکره.
flipped = (
    db.query(Lead)
    .filter(Lead.org_id == org.id, Lead.stage == "بسته‌شده")
    .all()
)
from datetime import datetime, timedelta
for l in flipped:
    # restore only leads that were updated within the last 2 days (campaign flips)
    if l.updated_at and (datetime.utcnow() - l.updated_at) < timedelta(days=2):
        l.stage = "مذاکره"
        db.add(l)

# 5) Campaigns themselves
for c in camps:
    db.delete(c)

db.commit()
print("Wipe complete.")
print(f"  Campaigns:     {len(camps)}")
print(f"  CampaignSends: {len(sends)}")
print(f"  Messages:      {len(demo_msgs)}")
print(f"  AiEvents:      {len(to_delete)}")
db.close()
