One caveat: dedup is only in-memory (_seen_items), so after a restart duplicates could re-ingest unless the backend API enforces uniqueness on the external message ID. Want me to verify whether the API side has that unique constraint?


Good news: the backend already has application-level dedup — process_message_ingest checks Message.wa_message_id == ext_msg_id scoped to org_id + account_id and returns the existing message (ingest_deduped). So a connector restart won't create duplicates as long as the connector sends external_message_id.

However, there are gaps worth fixing across all channels (WhatsApp/Bale/Divar/Instagram):

Plan
1. Verify all connectors send external_message_id ✅/❌
Check wa-connector (inbound-mapper.ts), bale-connector/mapper.py, divar-connector, instagram-connector/mapper.py.
Fix any that omit it or send empty strings on some message types.
2. Add a DB unique constraint (race-condition safety)
Two realtime events arriving in parallel can both pass the existing check before either commits.
Migration: add a partial unique index on (org_id, account_id, wa_message_id) where wa_message_id != '' (Alembic revision in versions).
Wrap message insert in try/except IntegrityError → re-query existing row and return it (idempotent upsert).
3. Normalize empty-ID handling
Messages without an external ID (some Divar/system events) must not collide — confirm the partial index excludes empty strings.
4. Keep in-memory _seen_items as a cheap first filter
No change needed; it just reduces API calls. Optionally document it as non-authoritative.
5. Tests
Unit test: same external_message_id ingested twice → single Message row, second returns ingest_deduped.
Concurrency test: two simultaneous ingests of same ID → one row.
Per-channel mapper tests asserting external_message_id is populated.