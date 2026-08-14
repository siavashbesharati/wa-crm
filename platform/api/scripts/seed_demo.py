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
    ChannelAccount,
    ChannelType,
    KnowledgeChunk,
    KnowledgeDoc,
    Lead,
    MemberRole,
    Membership,
    Organization,
    OkrObjective,
    User,
)
from app.services.embeddings import chunk_text, embed_text


def main() -> None:
    # Bring older local SQLite schemas forward when possible
    try:
        import importlib.util

        mig_path = Path(__file__).resolve().parent / "migrate_multichannel.py"
        spec = importlib.util.spec_from_file_location("migrate_multichannel", mig_path)
        if spec and spec.loader:
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            mod.main()
        else:
            Base.metadata.create_all(bind=engine)
    except Exception as exc:
        print("migrate skipped:", exc)
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
        org = Organization(
            name="آژانس دمو iranexpedia",
            plan="growth",
            onboarding_step="done",
        )
        db.add(org)
        db.flush()
        db.add(Membership(org_id=org.id, user_id=user.id, role=MemberRole.owner))
        db.add(AiPolicy(org_id=org.id, auto_send_enabled=False, min_confidence=0.55))

    if not db.query(ChannelAccount).filter(
        ChannelAccount.org_id == org.id, ChannelAccount.channel == ChannelType.whatsapp
    ).first():
        db.add(
            ChannelAccount(
                org_id=org.id,
                channel=ChannelType.whatsapp,
                label="واتساپ فروش",
                external_id="989121234567",
                status="disconnected",
            )
        )

    if not db.query(ChannelAccount).filter(
        ChannelAccount.org_id == org.id, ChannelAccount.channel == ChannelType.divar
    ).first():
        db.add(
            ChannelAccount(
                org_id=org.id,
                channel=ChannelType.divar,
                label="دیوار فروش",
                external_id="divar-demo",
                status="disconnected",
            )
        )

    if db.query(Lead).filter(Lead.org_id == org.id).count() == 0:
        db.add(Lead(org_id=org.id, name="نمونه مشتری", phone="989129998877", stage="جدید", tags=["دمو"], source_channel="whatsapp"))
        db.add(Lead(org_id=org.id, name="پیگیری تور", phone="989127776655", stage="پیگیری", tags=["تور"], source_channel="whatsapp"))
        db.add(
            Lead(
                org_id=org.id,
                name="آگهی خوابگاه نمونه",
                external_chat_id="Qa2noKqg",
                post_token="Qa2noKqg",
                source_channel="divar",
                stage="جدید",
                tags=["دیوار", "دمو"],
            )
        )

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
        db.flush()
        try:
            from app.services import pinecone_kb

            if pinecone_kb.is_configured(db):
                pinecone_kb.upsert_doc_from_db(db, org_id=org.id, doc_id=doc.id)
        except Exception:  # noqa: BLE001
            pass

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
    print("Login: /login (business OTP) and /super/login (platform OTP via sms.ir)")
    print("Org id:", org.id, "| plan:", org.plan)
    db.close()


if __name__ == "__main__":
    main()
