"""Seed a demo org for sales demos.

Usage:
  cd platform/api
  python scripts/seed_demo.py
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.database import Base, SessionLocal, engine
from app.models import (
    AiPolicy,
    KnowledgeChunk,
    KnowledgeDoc,
    Lead,
    MemberRole,
    Membership,
    Organization,
    OkrObjective,
    User,
    WhatsAppAccount,
)
from app.services.embeddings import chunk_text, embed_text


def main() -> None:
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    phone = "09120000000"
    user = db.query(User).filter(User.phone == phone).first()
    if not user:
        user = User(phone=phone, display_name="دمو ادمین")
        db.add(user)
        db.flush()

    membership = db.query(Membership).filter(Membership.user_id == user.id).first()
    if membership:
        org = db.get(Organization, membership.org_id)
    else:
        org = Organization(name="آژانس دمو iranexpedia", plan="growth")
        db.add(org)
        db.flush()
        db.add(Membership(org_id=org.id, user_id=user.id, role=MemberRole.owner))
        db.add(AiPolicy(org_id=org.id, auto_send_enabled=False, min_confidence=0.55))

    if not db.query(WhatsAppAccount).filter(WhatsAppAccount.org_id == org.id).first():
        db.add(WhatsAppAccount(org_id=org.id, label="واتساپ فروش", phone="989121234567", status="disconnected"))

    if db.query(Lead).filter(Lead.org_id == org.id).count() == 0:
        db.add(Lead(org_id=org.id, name="نمونه مشتری", phone="989129998877", stage="جدید", tags=["دمو"]))
        db.add(Lead(org_id=org.id, name="پیگیری تور", phone="989127776655", stage="پیگیری", tags=["تور"]))

    if not db.query(KnowledgeDoc).filter(KnowledgeDoc.org_id == org.id).first():
        doc = KnowledgeDoc(org_id=org.id, title="FAQ دمو", source="seed")
        db.add(doc)
        db.flush()
        content = "قیمت تور استانبول از ۲۰ میلیون تومان شروع می‌شود.\nپاسپورت باید حداقل ۶ ماه اعتبار داشته باشد."
        for part in chunk_text(content):
            db.add(
                KnowledgeChunk(
                    org_id=org.id,
                    doc_id=doc.id,
                    content=part,
                    embedding=embed_text(part),
                )
            )

    if not db.query(OkrObjective).filter(OkrObjective.org_id == org.id).first():
        db.add(
            OkrObjective(
                org_id=org.id,
                title="بستن ۲۰ فروش در ماه",
                description="هدف دمو فروش",
                target_value=20,
                current_value=3,
                period="month",
                owner_id=user.id,
            )
        )

    db.commit()
    print("Demo ready.")
    print("Phone:", phone)
    print("OTP mock code: 123456")
    print("Org id:", org.id, "| plan:", org.plan)
    db.close()


if __name__ == "__main__":
    main()
