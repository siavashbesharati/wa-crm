You are working on the existing Bidar CRM project.

Your task is to integrate Instagram Direct as a NEW messaging channel into the existing Bidar architecture.

IMPORTANT:
Do NOT redesign the existing application.
Do NOT rewrite WhatsApp, Bale, or Divar integrations.
Do NOT create a separate Instagram application.
Instagram must become a first-class Channel inside the existing Bidar system, using the same channel architecture, conversation model, contact model, message model, operator assignment, AI reply pipeline, history, tags, and automation system that already exists.

============================================================
CURRENT CHANNELS
============================================================

Bidar currently supports:

1. WhatsApp
2. Bale
3. Divar

We now want:

4. Instagram Direct

Instagram should behave like the other channels from the CRM's perspective.

The CRM should not care whether a message came from WhatsApp, Bale, Divar, or Instagram.

It should receive a normalized message/event from the Instagram channel and pass it through the existing Bidar pipeline.

============================================================
INSTAGRAM AUTHENTICATION
============================================================

Instagram integration will use an Instagram session ID.

There is NO username/password login inside Bidar.

The user will already be logged into Instagram.

The Instagram channel configuration UI should contain a field where the user can enter:

Instagram Session ID

The backend stores this session ID securely.

The Instagram connector uses:

aiograpi.Client

and:

await client.login_by_sessionid(sessionid)

Do NOT implement Instagram username/password authentication.

Do NOT ask the user for their Instagram password.

============================================================
IMPORTANT: WORKING INSTAGRAM REALTIME IMPLEMENTATION
============================================================

We already have a VERIFIED working Python implementation.

It successfully:

- restores an Instagram session using session ID
- connects to Instagram Realtime
- subscribes to Instagram Direct realtime
- receives incoming DMs in realtime
- extracts:
  - user_id
  - thread_id
  - item_id
  - message_id
  - text
- ignores messages sent by the Instagram account itself
- prevents duplicate processing
- sends replies using:

await client.direct_send(
    text,
    thread_ids=[int(thread_id)]
)

The important realtime flow is:

1. Client()
2. load / restore session
3. login_by_sessionid(sessionid)
4. realtime_connect()
5. register handlers with realtime_on()
6. direct_subscribe()
7. realtime_read_once() loop

The verified implementation uses:

client.realtime_on("message", handler)

and:

client.realtime_on("direct_realtime_event", handler)

and:

await client.realtime.direct_subscribe(amount=1)

and:

await client.realtime_read_once()

Do NOT replace this with Instagram Graph API webhooks.

Do NOT try to implement comment realtime.

ONLY Instagram Direct Messages are required.

============================================================
VERIFIED INSTAGRAM MESSAGE STRUCTURE
============================================================

A received message contains data similar to:

{
    "item_id": "...",
    "message_id": "...",
    "user_id": 15463995851,
    "timestamp": ...,
    "item_type": "text",
    "text": "Hello",
    "thread_id": "340282366841710301244259509836085083814"
}

The realtime event path looks like:

/direct_v2/threads/<THREAD_ID>/items/<ITEM_ID>

The thread ID must be extracted and mapped to Bidar's conversation/thread model.

============================================================
REFERENCE IMPLEMENTATION
============================================================

Use the following VERIFIED implementation as the technical reference for the Instagram connector:





import asyncio
import json
import os

from aiograpi import Client


# ============================================================
# CONFIG
# ============================================================

SESSION_FILE = "instagram_session.json"

REPLY_PREFIX = "🤖 دریافت شد: "


# ============================================================
# HELPERS
# ============================================================

def pretty(value):
    """Safe JSON printer."""

    if isinstance(value, bytes):
        return {
            "__type__": "bytes",
            "length": len(value),
            "hex": value.hex(),
        }

    try:
        return json.dumps(
            value,
            ensure_ascii=False,
            indent=2,
            default=str,
        )
    except Exception:
        return str(value)


def extract_thread_id(path):
    """Extract thread id from /direct_v2/threads/<id>/items/<id>."""

    if not isinstance(path, str):
        return None

    parts = path.split("/")

    try:
        index = parts.index("threads")
        return parts[index + 1]
    except (ValueError, IndexError):
        return None


# ============================================================
# INSTAGRAM REALTIME
# ============================================================

class InstagramRealtime:

    def __init__(self, session_file):

        self.session_file = session_file
        self.client = Client()

        self.running = True
        self.processed_items = set()

    # ========================================================
    # LOGIN
    # ========================================================

    async def login(self):

        if not os.path.exists(self.session_file):

            raise FileNotFoundError(
                f"Session file not found: {self.session_file}"
            )

        print("📂 Loading saved session...")
        print("🔄 Restoring session...")

        settings = self.client.load_settings(
            self.session_file
        )

        self.client.set_settings(settings)

        # ----------------------------------------------------
        # Restore session
        # ----------------------------------------------------

        sessionid = (
            self.client.settings
            .get("authorization_data", {})
            .get("sessionid")
        )

        if sessionid:

            await self.client.login_by_sessionid(
                sessionid
            )

        else:

            await self.client.login()

        print("✅ Session restored")

        print()
        print("👤 Instagram account:")
        print("User ID:", self.client.user_id)

    # ========================================================
    # CONNECT
    # ========================================================

    async def connect(self):

        print("📡 Connecting to Instagram Realtime...")

        await self.client.realtime_connect()

        print("✅ Realtime connected")

    # ========================================================
    # EVENT HANDLERS
    # ========================================================

    def register_handlers(self):

        # ----------------------------------------------------
        # IMPORTANT:
        #
        # We use realtime_on() because in this version:
        #
        # client.realtime is None before/around initialization
        # and RealtimeClient does not expose .on() that way.
        # ----------------------------------------------------

        self.client.realtime_on(
            "receive",
            self.on_receive,
        )

        self.client.realtime_on(
            "message",
            self.on_message,
        )

        self.client.realtime_on(
            "direct_realtime_event",
            self.on_direct_event,
        )

        self.client.realtime_on(
            "iris",
            self.on_iris,
        )

        print("✅ Realtime handlers registered")

    # ========================================================
    # RAW RECEIVE
    # ========================================================

    def on_receive(self, event):

        if not isinstance(event, dict):
            return

        topic = event.get("topic")
        payload = event.get("payload")

        # ----------------------------------------------------
        # Only show useful Direct realtime topics
        # ----------------------------------------------------

        if topic not in (
            "135",
            "146",
            "150",
        ):
            return

        print()
        print("=" * 70)
        print("📡 REALTIME RECEIVE")
        print("=" * 70)

        print(
            pretty(
                {
                    "topic": topic,
                    "payload": payload,
                }
            )
        )

    # ========================================================
    # MESSAGE EVENT
    # ========================================================

    def on_message(self, event):

        if not isinstance(event, dict):
            return

        message = event.get("message")

        if not isinstance(message, dict):
            return

        # Create async task because event callback
        # itself is synchronous.

        asyncio.create_task(
            self.handle_message(message)
        )

    # ========================================================
    # DIRECT REALTIME EVENT
    # ========================================================

    def on_direct_event(self, event):

        if not isinstance(event, dict):
            return

        value = event.get("value")

        if not isinstance(value, dict):
            return

        if value.get("item_type") != "text":
            return

        message = dict(value)

        if event.get("thread_id"):
            message["thread_id"] = event["thread_id"]

        if event.get("path"):
            message["path"] = event["path"]

        asyncio.create_task(
            self.handle_message(message)
        )

    # ========================================================
    # IRIS
    # ========================================================

    def on_iris(self, event):

        # IRIS contains synchronization/amend events.
        #
        # We intentionally don't answer these.

        return

    # ========================================================
    # HANDLE DIRECT MESSAGE
    # ========================================================

    async def handle_message(self, message):

        if not isinstance(message, dict):
            return

        # ----------------------------------------------------
        # Extract data
        # ----------------------------------------------------

        item_id = message.get("item_id")

        user_id = message.get("user_id")

        text = message.get("text")

        item_type = message.get("item_type")

        thread_id = message.get("thread_id")

        # ----------------------------------------------------
        # Thread ID fallback
        # ----------------------------------------------------

        if not thread_id:

            path = message.get("path")

            thread_id = extract_thread_id(path)

        # ----------------------------------------------------
        # Only text messages
        # ----------------------------------------------------

        if item_type != "text":
            return

        if not text:
            return

        if not thread_id:
            return

        # ----------------------------------------------------
        # Ignore own messages
        # ----------------------------------------------------

        try:

            if int(user_id) == int(self.client.user_id):
                return

        except (TypeError, ValueError):

            pass

        # ----------------------------------------------------
        # Prevent duplicate processing
        # ----------------------------------------------------

        if item_id:

            if item_id in self.processed_items:
                return

            self.processed_items.add(item_id)

        # ----------------------------------------------------
        # Message received
        # ----------------------------------------------------

        print()
        print("=" * 70)
        print("📩 NEW INSTAGRAM DM")
        print("=" * 70)

        print("USER ID :", user_id)
        print("THREAD  :", thread_id)
        print("ITEM ID :", item_id)
        print("MESSAGE :", text)

        # ----------------------------------------------------
        # Reply
        # ----------------------------------------------------

        reply = f"{REPLY_PREFIX}{text}"

        print()
        print("📤 Sending reply...")
        print("TEXT:", reply)

        try:

            result = await self.client.direct_send(
                reply,
                thread_ids=[
                    int(thread_id)
                ],
            )

            print()
            print("✅ REPLY SENT")

            if result is not None:

                result_id = getattr(
                    result,
                    "id",
                    None,
                )

                print(
                    "REPLY MESSAGE ID:",
                    result_id,
                )

        except Exception as e:

            print()
            print("❌ SEND FAILED")
            print("TYPE:", type(e).__name__)
            print("ERROR:", e)

    # ========================================================
    # DIRECT REALTIME SUBSCRIBE
    # ========================================================

    async def subscribe_direct(self):

        print()
        print(
            "📨 Subscribing to Instagram Direct realtime..."
        )

        state = await self.client.realtime.direct_subscribe(
            amount=1
        )

        print()
        print(
            "✅ Direct realtime subscription active"
        )

        print()
        print("=" * 70)
        print("DIRECT REALTIME STATE")
        print("=" * 70)

        print(
            pretty(state)
        )

        return state

    # ========================================================
    # LISTENER
    # ========================================================

    async def listen(self):

        print()
        print("=" * 70)
        print(
            "👂 LISTENING FOR INSTAGRAM DIRECT EVENTS"
        )
        print("=" * 70)

        print()
        print(
            "حالا از یک اکانت دیگر به این اکانت DM بده."
        )

        print()
        print("مثلاً:")
        print()
        print("REALTIME_DM_TEST_123")
        print()
        print("CTRL+C برای توقف")
        print()

        while self.running:

            try:

                result = (
                    await self.client.realtime_read_once()
                )

                # ------------------------------------------------
                # Raw packet result
                # ------------------------------------------------

                if result is not None:

                    print()
                    print(
                        ">>> PACKET RESULT <<<"
                    )

                    print(
                        "TYPE:",
                        type(result).__name__,
                    )

                    print(
                        "RESULT:",
                        pretty(result),
                    )

            except TimeoutError:

                # Normal socket timeout.
                continue

            except asyncio.CancelledError:

                break

            except KeyboardInterrupt:

                break

            except Exception as e:

                print()
                print("=" * 70)
                print("❌ REALTIME ERROR")
                print("=" * 70)

                print(
                    "TYPE:",
                    type(e).__name__,
                )

                print(
                    "ERROR:",
                    e,
                )

                # Don't kill realtime immediately.
                await asyncio.sleep(2)


# ============================================================
# MAIN
# ============================================================

async def main():

    instagram = InstagramRealtime(
        SESSION_FILE
    )

    # --------------------------------------------------------
    # 1. LOGIN
    # --------------------------------------------------------

    await instagram.login()

    # --------------------------------------------------------
    # 2. CONNECT REALTIME
    # --------------------------------------------------------

    await instagram.connect()

    # --------------------------------------------------------
    # 3. REGISTER HANDLERS
    #
    # IMPORTANT:
    # This happens AFTER realtime_connect().
    # --------------------------------------------------------

    instagram.register_handlers()

    # --------------------------------------------------------
    # 4. DIRECT REALTIME SUBSCRIPTION
    # --------------------------------------------------------

    await instagram.subscribe_direct()

    # --------------------------------------------------------
    # 5. LISTEN
    # --------------------------------------------------------

    await instagram.listen()


# ============================================================
# ENTRY POINT
# ============================================================

if __name__ == "__main__":

    try:

        asyncio.run(main())

    except KeyboardInterrupt:

        print()
        print("🛑 Stopped")





Do not blindly copy the CLI/debugging parts.

Extract the actual Instagram integration logic from it and convert it into a reusable Bidar Channel implementation.

============================================================
CHANNEL ARCHITECTURE
============================================================

First inspect the existing Bidar codebase.

Find how WhatsApp, Bale and Divar are implemented.

Identify:

- Channel interface / abstraction
- Channel registration
- Channel configuration
- Channel database entities
- Channel credentials/settings
- Conversation model
- Contact model
- Message model
- Incoming message pipeline
- Outgoing message pipeline
- Operator assignment
- AI reply handling
- Message status handling
- Background workers
- Connection lifecycle
- Channel health/status
- Admin UI for channels

Do NOT assume the architecture.

Read the existing implementation and follow its patterns.

Instagram should use the same abstraction.

For example, conceptually:

IChannel
    ├── WhatsAppChannel
    ├── BaleChannel
    ├── DivarChannel
    └── InstagramChannel

Use the project's actual interfaces/naming conventions instead of inventing new architecture.

============================================================
INSTAGRAM CHANNEL CONFIGURATION UI
============================================================

Add Instagram to the existing Channels section.

The user should see something conceptually like:

Channels

[ WhatsApp ]
[ Bale ]
[ Divar ]
[ Instagram ]

When adding Instagram:

--------------------------------
Add Instagram Channel

Instagram Session ID
[ __________________________ ]

[ Connect Instagram ]

--------------------------------

After connecting successfully:

Instagram
Status: Connected
Account: @username
User ID: xxxxxxxxx

[ Disconnect ]
[ Reconnect ]
[ Delete ]

If the existing UI has a standard channel configuration modal/page, reuse it.

Do NOT create a completely different UI just for Instagram.

============================================================
SESSION ID STORAGE
============================================================

The session ID is effectively an authentication credential.

Treat it as a secret.

Do not expose it in API responses after saving.

Do not log the raw session ID.

Do not display it in frontend logs.

Prefer encrypted/protected storage if the existing project already has a mechanism for channel credentials.

If the existing architecture has a generic credential/secret mechanism, Instagram must use it.

============================================================
CONNECTION FLOW
============================================================

When the user enters a Session ID:

Frontend
    ↓
Backend
    ↓
Validate session
    ↓
Create Instagram Client
    ↓
login_by_sessionid(sessionid)
    ↓
Get Instagram account information
    ↓
Save channel configuration
    ↓
Start realtime listener
    ↓
Status = Connected

If authentication fails:

Return a clean error such as:

"Instagram session is invalid or expired."

Do not expose internal Python stack traces to the user.

============================================================
REALTIME WORKER
============================================================

Instagram realtime must NOT run inside an HTTP request.

It needs a long-running background service/worker.

The worker should:

1. Load active Instagram channels.
2. Create an aiograpi Client for each channel.
3. Authenticate using the stored session ID.
4. Connect realtime.
5. Register handlers.
6. Subscribe to Direct realtime.
7. Continuously call realtime_read_once().
8. Process incoming messages.
9. Reconnect automatically if the realtime connection drops.

Conceptually:

InstagramRealtimeWorker
    ↓
InstagramChannelConnection
    ↓
aiograpi.Client
    ↓
Instagram Realtime
    ↓
Incoming DM
    ↓
Bidar normalized message pipeline

If Bidar already has a background worker architecture, use it.

Do NOT create a second unrelated worker architecture.

============================================================
MULTIPLE INSTAGRAM ACCOUNTS
============================================================

The system must support multiple Instagram channels.

Example:

Instagram Account A
Instagram Account B
Instagram Account C

Each channel has its own:

- session ID
- Instagram user ID
- username
- realtime connection
- conversation mapping

Never use global Instagram state.

Each Instagram channel must have an independent Client instance.

============================================================
INCOMING MESSAGE NORMALIZATION
============================================================

When Instagram receives:

"user_id": 15463995851
"thread_id": "340282366841710301244259509836085083814"
"text": "Hello"

convert it into Bidar's existing normalized incoming message structure.

Use the existing message DTO/model if one already exists.

Conceptually:

Channel:
    Instagram

ExternalUserId:
    15463995851

ExternalConversationId:
    340282366841710301244259509836085083814

ExternalMessageId:
    Instagram item_id/message_id

Text:
    Hello

Direction:
    Incoming

MessageType:
    Text

Then send it through the SAME pipeline used by WhatsApp/Bale/Divar.

============================================================
CONTACT MAPPING
============================================================

Instagram users must become Bidar contacts.

Use the existing Contact model.

The Instagram user ID should be the stable external identifier.

Do not create a new contact every time a message arrives.

Use:

Channel + ExternalUserId

or the equivalent identity mechanism already used by the project.

If the existing system has a ContactIdentity / ExternalIdentity concept, reuse it.

============================================================
CONVERSATION MAPPING
============================================================

Instagram thread_id must map to Bidar Conversation.

The mapping should be stable.

Example:

Channel = Instagram
ExternalConversationId = Instagram thread_id

If the conversation doesn't exist:

Create it.

If it exists:

Append the message to it.

Do NOT create a new conversation for every message.

============================================================
OUTGOING MESSAGES
============================================================

When Bidar sends a reply to an Instagram conversation:

Use:

await client.direct_send(
    text,
    thread_ids=[int(thread_id)]
)

The Instagram channel implementation should expose this through the same outgoing message abstraction used by other channels.

For example conceptually:

SendMessage(conversation, text)

↓

InstagramChannel.SendMessage()

↓

client.direct_send(...)

Do not let the rest of the CRM know about aiograpi.

============================================================
AI AUTO REPLY
============================================================

Instagram must automatically work with Bidar's existing AI reply system.

The flow should become:

Instagram DM
    ↓
Instagram Channel
    ↓
Normalized Bidar Message
    ↓
Conversation
    ↓
Existing AI / automation pipeline
    ↓
Generated response
    ↓
Channel abstraction
    ↓
InstagramChannel.SendMessage()
    ↓
Instagram Direct

Do NOT implement a separate AI system for Instagram.

Do NOT duplicate the AI logic.

============================================================
DUPLICATE MESSAGE PROTECTION
============================================================

Instagram realtime can potentially deliver duplicate events.

Use the existing Bidar idempotency/message deduplication system if available.

The external Instagram item_id/message_id should be used as the external message identifier.

Do not rely only on an in-memory Python set because that disappears after restart.

If the existing database message model supports unique external IDs, use that.

============================================================
OWN MESSAGE FILTERING
============================================================

Messages sent by the Instagram account itself must not be treated as incoming messages.

The verified implementation checks:

if int(user_id) == int(client.user_id):
    return

Implement the equivalent behavior in the production channel.

============================================================
SUPPORTED MESSAGE TYPES
============================================================

For the first version, support:

TEXT messages

Ignore unsupported Instagram message types safely.

Do not break the realtime listener when receiving:

- images
- videos
- stickers
- reactions
- system events
- amendments
- synchronization events

They should either be ignored or mapped later.

============================================================
REALTIME EVENTS
============================================================

Only Direct realtime is required.

Do NOT implement Instagram comment realtime.

Do NOT implement GraphQL comment subscriptions.

Use:

await client.realtime.direct_subscribe(amount=1)

The working implementation demonstrated that topic 146 / MESSAGE_SYNC contains realtime Direct messages.

Use the aiograpi dispatch layer rather than manually reverse engineering MQTT packets.

============================================================
ERROR HANDLING
============================================================

The Instagram worker must survive:

- expired session
- invalid session
- network failure
- MQTT disconnect
- timeout
- malformed message
- unsupported event
- Instagram API errors
- aiograpi exceptions

The worker should reconnect where appropriate.

An authentication failure should mark the channel:

Disconnected / AuthenticationRequired

rather than crashing the whole Bidar application.

One broken Instagram account must NOT stop other channels.

============================================================
CHANNEL STATUS
============================================================

Instagram should expose a health/status similar to existing channels:

Connected
Disconnected
Authentication Required
Connecting
Error

The existing channel status system should be reused.

============================================================
LOGGING
============================================================

Add useful structured logs:

[Instagram] Connecting...
[Instagram] Authenticated @username
[Instagram] Realtime connected
[Instagram] Direct subscription active
[Instagram] Message received
[Instagram] Message sent
[Instagram] Reconnecting...

Never log:

- session ID
- cookies
- authentication credentials

============================================================
SECURITY
============================================================

Session IDs are credentials.

Apply the same security standards as passwords/API tokens.

Do not expose them through:

- frontend API responses
- browser console
- logs
- exception messages
- telemetry

============================================================
DATABASE
============================================================

Inspect the existing database/migrations before creating anything.

Add only the minimum required schema changes.

If the existing Channel table already supports:

Type
Name
Credentials
Settings
Status

reuse it.

Do NOT create a separate Instagram database architecture.

If channel-specific settings are stored as JSON, use the existing pattern.

============================================================
FRONTEND
============================================================

Add Instagram to the existing channel management UI.

Follow the exact visual/design conventions already used by:

WhatsApp
Bale
Divar

The user should not need technical knowledge.

The only required credential input is:

Instagram Session ID

After connection, show the connected Instagram account.

============================================================
API
============================================================

Expose Instagram through the existing Channel APIs.

Do not create unrelated endpoints if an existing generic channel API exists.

If a channel-specific endpoint is necessary, follow the existing API naming conventions.

============================================================
IMPORTANT IMPLEMENTATION RULE
============================================================

Before writing code:

1. Inspect the entire existing channel architecture.
2. Find the WhatsApp implementation.
3. Find the Bale implementation.
4. Find the Divar implementation.
5. Find the common message/conversation pipeline.
6. Find the channel configuration UI.
7. Find background workers/services.
8. Find database models and migrations.
9. Find how outgoing messages are dispatched.
10. Find how channel credentials are stored.

Then implement Instagram using the SAME architecture.

============================================================
DELIVERABLE
============================================================

Implement the complete Instagram channel integration.

The final implementation should include whatever files are actually required, such as:

Backend:
- Instagram channel/service
- authentication/session handling
- realtime worker
- incoming message adapter
- outgoing message adapter
- configuration
- status/health
- database migration if required

Frontend:
- Instagram channel card
- Add/Edit Instagram configuration
- Session ID input
- Connection status
- Connected Instagram account
- Disconnect/reconnect actions

Tests:
- session authentication
- incoming DM normalization
- conversation mapping
- duplicate message protection
- outgoing reply
- reconnect behavior

============================================================
ACCEPTANCE TEST
============================================================

After implementation:

1. Start Bidar.
2. Open Channels.
3. Click Add Instagram.
4. Enter a valid Instagram Session ID.
5. Click Connect.
6. Bidar authenticates successfully.
7. Instagram account information appears.
8. Realtime status becomes Connected.
9. From another Instagram account send:

Hello Bidar

10. The message must appear inside the existing Bidar conversation UI.
11. The contact must be created/matched correctly.
12. Existing AI automation must be able to process it.
13. Send a reply from Bidar.
14. The reply must arrive in Instagram Direct.
15. Restart Bidar.
16. The Instagram channel should automatically reconnect.
17. No duplicate message should be created.

============================================================
VERY IMPORTANT
============================================================

Do not stop after creating the UI.

Do not stop after creating the database model.

Do not create a fake/mock Instagram connector.

The feature is only complete when:

Instagram Session ID
→ authentication
→ realtime Direct listener
→ normalized Bidar message
→ conversation/contact
→ existing AI/automation pipeline
→ outgoing Instagram DM

works end-to-end.

Do not break WhatsApp, Bale, or Divar.

At the end, provide:

1. List of files changed.
2. List of files created.
3. Database/migration changes.
4. API changes.
5. Frontend changes.
6. Background worker changes.
7. Required NuGet/npm/Python dependencies.
8. Exact commands required to run the system.
9. End-to-end test procedure.
10. Any limitations of the current Instagram integration.


و معماری نهایی‌ای که      عملاً این است:

                 BIDAR
                   │
          ┌────────┴────────┐
          │     Channels    │
          └────────┬────────┘
                   │
   ┌───────┬───────┼───────┬───────────┐
   │       │       │       │           │
WhatsApp  Bale   Divar Instagram     ...
                           │
                     Session ID
                           │
                       aiograpi
                           │
                  Instagram Realtime
                           │
                         DM
                           │
                 ┌─────────▼─────────┐
                 │ Bidar Message     │
                 │ Normalization     │
                 └─────────┬─────────┘
                           │
                 Contact / Conversation
                           │
                    AI / Automation
                           │
                 ┌─────────▼─────────┐
                 │ Channel.Send()    │
                 └─────────┬─────────┘
                           │
                      Instagram DM