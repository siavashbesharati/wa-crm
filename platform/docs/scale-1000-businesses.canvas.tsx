/**
 * Snapshot of the Cursor canvas "Scale plan — 1,000 businesses, 3,000 channels".
 * Readable copy: scale-1000-businesses.md
 * Live canvas (Cursor IDE): canvases/scale-1000-businesses.canvas.tsx
 */
import {
  BarChart,
  Callout,
  Card,
  CardBody,
  CardHeader,
  Divider,
  Grid,
  H1,
  H2,
  H3,
  Pill,
  Row,
  Stack,
  Stat,
  Table,
  Text,
  UsageBar,
} from "cursor/canvas";

const ASSUMPTIONS =
  "Model: 1,000 businesses × 3 channels (WhatsApp + Divar + Bale). Traffic: ~20 CRM messages per business per day (SMB chat). Retention: 30-day hot store (starter default), optional 12-month archive.";

export default function Scale1000Businesses() {
  return (
    <Stack gap={24}>
      <Stack gap={8}>
        <H1>Scale plan — 1,000 businesses, 3,000 channels</H1>
        <Text tone="secondary">
          Isolation today, storage at 1,000 tenants, and what actually breaks first.
          PostgreSQL can hold the messages. Live WhatsApp sessions cannot sit in one process.
        </Text>
        <Text tone="tertiary" size="small">
          {ASSUMPTIONS}
        </Text>
      </Stack>

      <Grid columns={4} gap={16}>
        <Stat value="1,000" label="Businesses (orgs)" />
        <Stat value="3,000" label="Live channel sessions" />
        <Stat value="~20k" label="Messages / day (platform)" />
        <Stat value="WhatsApp RAM" label="Real bottleneck" tone="warning" />
      </Grid>

      <Callout tone="info" title="Packages for Bale">
        Yes — install Python deps, no new Node packages. From repo root: pip install
        -r platform/api/requirements.txt and pip install -r
        platform/bale-connector/requirements.txt. That pulls bale-sdk (protobuf +
        websockets). npm run start:all already tries the connector install. This
        machine already has bale-sdk 0.1.1.
      </Callout>

      <H2>Tenant isolation — how it works now</H2>
      <Text tone="secondary">
        Bidar is one shared database. Isolation is by organization id on every row,
        not separate databases. Public APIs always filter org_id from the login
        token. Encrypted channel credentials are stored per ChannelAccount, which
        belongs to one org.
      </Text>
      <Table
        headers={["Asset", "Stored where", "Isolation key", "Visible to other businesses?"]}
        columnAlign={["left", "left", "left", "left"]}
        rowTone={["success", "success", "success", "success", "warning", "warning"]}
        rows={[
          [
            "Channel session (WA / Divar / Bale)",
            "Encrypted row: wa_auth_states / divar_auth_states / bale_auth_states",
            "account_id → org_id",
            "No — token never sent to the browser",
          ],
          [
            "Contacts / leads",
            "leads + lead_account_links",
            "org_id",
            "No, if every query keeps org_id",
          ],
          [
            "Conversations + messages",
            "messages (account_id + lead_id)",
            "org_id + account_id",
            "No",
          ],
          [
            "Outbound / AI jobs",
            "outbound_jobs + workers",
            "org_id + account_id",
            "No",
          ],
          [
            "Connector process",
            "One sidecar holds all orgs’ live sockets",
            "Platform service key",
            "Process can see every session — must stay server-side",
          ],
          [
            "Database file (local)",
            "Single SQLite wa_crm.db",
            "App filter only",
            "Ops/backup access is global — move to Postgres + RLS later",
          ],
        ]}
      />
      <Callout tone="success" title="Business A cannot use Business B’s Bale token">
        Pairing APIs require the org JWT. Internal connector APIs use a server key
        and never expose tokens to the UI. A broken Bale channel cannot take down
        WhatsApp or Divar for other orgs at the application layer — but one overloaded
        connector process still can, which is the scale risk below.
      </Callout>

      <H2>Capacity at 1,000 businesses</H2>
      <Text tone="secondary">
        Message volume is modest for a relational database. Persistent messenger
        sockets are not.
      </Text>
      <Table
        headers={["Store", "Approx volume", "Disk / RAM", "Fits current local stack?"]}
        columnAlign={["left", "left", "left", "left"]}
        rowTone={["success", "success", "success", "warning", "danger", "info"]}
        rows={[
          ["Organizations + users", "1,000 orgs, ~3–5k users", "< 50 MB", "Yes"],
          [
            "Channel accounts + encrypted auth",
            "3,000 accounts",
            "50–200 MB",
            "Yes — already encrypted at rest",
          ],
          [
            "Contacts / leads",
            "~250k (250 per business)",
            "1–3 GB",
            "Postgres yes · SQLite no",
          ],
          [
            "Messages, 30-day hot",
            "~600k rows (~20 msg/biz/day)",
            "2–4 GB with indexes",
            "Postgres yes · SQLite no",
          ],
          [
            "Messages, 12-month archive",
            "~7.3M rows",
            "15–25 GB",
            "Postgres + optional monthly partitions",
          ],
          [
            "Live sockets (the hard part)",
            "1,000 WA + 1,000 Bale + 1,000 Divar poll",
            "WA 40–80 GB RAM · Bale ~8 GB · Divar < 1 GB",
            "Not in one VM / one process",
          ],
        ]}
      />

      <H3>Where RAM goes at 3,000 channels</H3>
      <Text tone="tertiary" size="small">
        Source: conservative per-session footprints for Baileys (Node), Bale WebSocket
        (Python asyncio), Divar HTTP poll. Not measured on this repo — planning envelope.
      </Text>
      <UsageBar
        total={90}
        topLeftLabel="Live connector RAM at 1,000 of each channel"
        topRightLabel="~49–89 GB — WhatsApp dominates"
        segments={[
          { id: "wa", value: 60, color: "green" },
          { id: "bale", value: 8, color: "blue" },
          { id: "divar", value: 1, color: "orange" },
          { id: "api", value: 4, color: "purple" },
        ]}
      />
      <Row gap={16} wrap>
        <Text tone="secondary" size="small">
          Green WhatsApp 40–80 GB · Blue Bale ~8 GB · Orange Divar ~1 GB · Purple API/Postgres ~4 GB
        </Text>
      </Row>

      <H3>Daily message ingest — database is easy</H3>
      <BarChart
        categories={["Low (8/biz)", "Model (20/biz)", "Busy (80/biz)"]}
        series={[{ name: "Messages / day", data: [8000, 20000, 80000], tone: "info" }]}
        height={220}
        valueSuffix=""
        showValues
      />
      <Text tone="tertiary" size="small">
        Source: planning model · 1,000 businesses. Even the busy case (~1 msg/s average,
        ~10–20 msg/s peak) is well inside PostgreSQL + Redis. The database is not the cliff.
      </Text>

      <H2>What can handle messages and events</H2>
      <Grid columns={2} gap={16}>
        <Card>
          <CardHeader trailing={<Pill size="sm">Keep</Pill>}>Hot path</CardHeader>
          <CardBody>
            <Stack gap={8}>
              <Text>
                PostgreSQL for contacts, conversations, messages, jobs. Already in the
                production README via DATABASE_URL.
              </Text>
              <Text>
                Redis for outbound/AI queues (queue.py already prefers Redis, falls back
                to files). Add Redis Streams or keep the jobs table for claim/complete.
              </Text>
              <Text>
                SSE hub for the panel inbox — shard by org_id when subscriber count grows.
              </Text>
            </Stack>
          </CardBody>
        </Card>
        <Card>
          <CardHeader trailing={<Pill size="sm">Avoid at this size</Pill>}>Overkill</CardHeader>
          <CardBody>
            <Stack gap={8}>
              <Text>
                Kafka is not required at 20k–80k messages/day. Postgres + Redis covers
                ingest, AI workers, and operator sends.
              </Text>
              <Text>
                Per-tenant databases for 1,000 SMBs add ops cost without fixing the
                WhatsApp RAM problem.
              </Text>
              <Text>
                SQLite (current local default) is for demos only — one writer, one file,
                no tenant crash isolation.
              </Text>
            </Stack>
          </CardBody>
        </Card>
      </Grid>

      <H2>Current stack vs 1,000-tenant stack</H2>
      <Table
        headers={["Layer", "Today (local)", "At 1,000 businesses", "Why"]}
        rows={[
          [
            "Database",
            "SQLite wa_crm.db",
            "Managed Postgres (16+ GB RAM, 4 vCPU, 200 GB SSD)",
            "Concurrent tenants, backups, indexes on org_id",
          ],
          [
            "Jobs / events",
            "Redis if up, else JSONL files + in-memory SSE",
            "Redis (queues, rate limits, pub/sub) + Postgres jobs table",
            "API and workers must not share a file",
          ],
          [
            "WhatsApp connector",
            "One Node process, all sessions in RAM",
            "Sharded: ~10–20 workers, 50–100 sessions each",
            "Baileys is the RAM cliff (40–80 GB if unsharded)",
          ],
          [
            "Bale connector",
            "One asyncio process, dict of sessions",
            "Sharded: 3–5 workers, ~200–300 WS each",
            "Lighter than WA; still cap sockets per process",
          ],
          [
            "Divar connector",
            "One poller, all accounts every few seconds",
            "Sharded pollers + backoff; respect Divar rate limits",
            "1,000 accounts × 6s poll ≈ 167 HTTP req/s",
          ],
          [
            "API / web",
            "One uvicorn + Next.js",
            "2–3 API replicas behind a load balancer",
            "JWT + org_id stays; sticky sessions not required",
          ],
        ]}
      />

      <Callout tone="warning" title="Do not run 3,000 live channels in start-all on one PC">
        Local start-all is a sales/dev topology. Production needs Postgres, Redis, and
        horizontally sharded connectors. Isolation of data is already org-scoped; isolation
        of failure requires splitting connector workers so one dead Bale socket does not
        recycle a thousand WhatsApp sessions.
      </Callout>

      <H2>Recommended machine envelope</H2>
      <Table
        headers={["Role", "Count", "Size", "Notes"]}
        rows={[
          ["Postgres", "1 primary (+ replica later)", "4 vCPU / 16 GB / 200 GB SSD", "Holds 12 months of chat easily"],
          ["Redis", "1", "2 vCPU / 4 GB", "Queues + short-lived events"],
          ["API + workers", "2–3", "2 vCPU / 4 GB each", "Stateless besides DB"],
          ["Web", "1–2", "2 vCPU / 2 GB", "Next.js"],
          [
            "WA connectors",
            "10–20 shards",
            "4 vCPU / 8–16 GB each",
            "Dominant cost — plan ~8 GB RAM per 100 WA sessions",
          ],
          [
            "Bale connectors",
            "3–5 shards",
            "2 vCPU / 4–8 GB each",
            "~200–300 WebSockets per process",
          ],
          ["Divar connectors", "2–3 shards", "2 vCPU / 2 GB each", "HTTP poll, cheap"],
        ]}
      />
      <Text tone="tertiary" size="small">
        Rough monthly cloud cost band if self-hosted on typical VPS: WhatsApp fleet
        dominates. Database is a small fraction. Exact EUR/IRT depends on provider.
      </Text>

      <Divider />
      <H2>What to change before 1,000, not before 20</H2>
      <Stack gap={8}>
        <Text>
          1. Switch DATABASE_URL to Postgres as soon as you leave single-demo SQLite.
        </Text>
        <Text>
          2. Keep Redis always on for queues — stop using the JSONL file fallback in
          production.
        </Text>
        <Text>
          3. Shard connectors by account_id hash (each worker lists only its slice of
          /internal/*/sessions). That is the real 3,000-channel design.
        </Text>
        <Text>
          4. Add unique (org_id, account_id, wa_message_id) and retain org_id on every
          query — isolation stays an application rule plus indexes, then optional Postgres
          RLS.
        </Text>
        <Text>
          5. Enforce message retention (already on plans) so the hot table stays hundreds
          of thousands of rows, not unbounded.
        </Text>
      </Stack>
    </Stack>
  );
}
