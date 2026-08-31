"""One-shot utility: wipe demo campaigns + showcase inbox messages so the
seeder can rebuild natural Farsi conversations from a clean slate.

Usage:
  cd platform/api
  python wipe_demo_camps.py
"""
import sys

sys.stdout.reconfigure(encoding="utf-8")

from datetime import datetime, timedelta

from app.database import SessionLocal
from app.models import AiEvent, Campaign, CampaignSend, Lead, Message, Organization

db = SessionLocal()
org = db.query(Organization).filter(Organization.name == "دپارتمان ملک پارامیس").first()
if not org:
    print("Demo org not found")
    sys.exit(0)

camps = db.query(Campaign).filter(Campaign.org_id == org.id).all()
print(f"Deleting {len(camps)} campaigns and their sends...")

sends = db.query(CampaignSend).filter(CampaignSend.org_id == org.id).all()
for s in sends:
    db.delete(s)
db.flush()

demo_msgs = (
    db.query(Message)
    .filter(
        Message.org_id == org.id,
        Message.wa_message_id.like("demo-%"),
    )
    .all()
)
for m in demo_msgs:
    db.delete(m)
db.flush()

ai_evs_all = db.query(AiEvent).filter(AiEvent.org_id == org.id).all()
to_delete = [
    e
    for e in ai_evs_all
    if isinstance(e.payload, dict)
    and str(e.payload.get("source", "")).startswith("seed-demo-")
]
for e in to_delete:
    db.delete(e)
db.flush()

# Restore campaign-flipped closed leads back into negotiation (خرید)
flipped = (
    db.query(Lead)
    .filter(Lead.org_id == org.id, Lead.stage.in_(["بسته", "بسته‌شده"]))
    .all()
)
for lead in flipped:
    if lead.updated_at and (datetime.utcnow() - lead.updated_at) < timedelta(days=2):
        lead.stage = "خرید"
        db.add(lead)

for c in camps:
    db.delete(c)

db.commit()
print("Wipe complete.")
print(f"  Campaigns:     {len(camps)}")
print(f"  CampaignSends: {len(sends)}")
print(f"  Messages:      {len(demo_msgs)}")
print(f"  AiEvents:      {len(to_delete)}")
db.close()
