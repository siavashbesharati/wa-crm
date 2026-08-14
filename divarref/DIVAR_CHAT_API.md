# Divar Chat Client — Reverse-Engineered API Flow

## Purpose

This document describes the currently verified Divar Web Chat API flow used by the Python client.

The goal is to provide an implementation reference for an AI/software engineer working on the Divar client.

The following operations have been successfully verified against a real authenticated account:

1. Client initialization
2. Session persistence
3. Authorization
4. Account information retrieval
5. Conversation listing
6. Conversation message retrieval
7. Sending a text message

All API requests below are currently performed through the authenticated HTTP session exposed by:

```python
client._req_session
```

---



# 1. High-Level Flow

The complete currently verified flow is:

```text
Client
  │
  ├── Client("my_session")
  │
  │      └── FileSession
  │
  ├── authorize()
  │
  ├── is_authorized
  │
  ├── get_me()
  │
  │      └── Account
  │
  ├── POST /chat/api/conversations
  │
  │      └── conversations[]
  │
  │             ├── conversation.id
  │             ├── metadata
  │             ├── peer
  │             ├── preview
  │             └── ...
  │
  ├── POST /chat/api/get-conversation-messages
  │
  │      └── conversation_id
  │
  │             └── messages[]
  │
  │                    ├── id
  │                    ├── sent_at
  │                    ├── from_me
  │                    ├── text_content
  │                    └── ...
  │
  └── POST /chat/api/send-message
         │
         ├── conversation_id
         ├── is_suggested
         ├── client_reference
         └── text
                  │
                  ▼
             sent_message
```

---



# 2. Authentication / Session



## Client initialization

```python
from divar import Client

client = Client("my_session")
```

The session is stored using the client's `FileSession`.

Example:

```python
print(client.storage)
print(client.storage.exists())
```

Expected output:

```text
Storage: <divar.session.session.FileSession object at ...>
Storage exists: True
```

---



# 3. Authorization

Authorization is performed through:

```python
client.authorize()
```

Then verify:

```python
if not client.is_authorized:
    raise RuntimeError("Client is not authorized")
```

Account information:

```python
account = client.get_me()

print(account)
```

Example:

```json
{
  "@type": "Account",
  "user_id": "4cfeddda-b690-4b0f-b737-981755e02f28",
  "phone_number": "+989195410188"
}
```

The `user_id` identifies the authenticated account.

---



# 4. Conversation Listing



## Endpoint

```text
POST https://api.divar.ir/chat/api/conversations
```



## Payload

The currently verified payload is:

```json
{
  "filter": {
    "filter": {
      "main_filter": {}
    }
  },
  "page_size": 100
}
```

Python:

```python
CONVERSATIONS_URL = (
    "https://api.divar.ir/chat/api/conversations"
)

response = client._req_session.post(
    CONVERSATIONS_URL,
    json={
        "filter": {
            "filter": {
                "main_filter": {}
            }
        },
        "page_size": 100
    }
)

response.raise_for_status()

data = response.json()

conversations = data.get("conversations", [])
```

---



# 5. Conversation Response

The response contains:

```json
{
  "conversations": [
    {
      "owner_id": "...",
      "id": "gaxtOczs",
      "peer": {
        "id": "...",
        "name": "~ کاربر: m gh.",
        "avatar": "..."
      },
      "metadata": {
        "ad_token": "gaxtOczs",
        "title": "کمک آموزشی",
        "thumbnail": "...",
        "category": "volunteers"
      },
      "peer_conversation": {
        "id": "...",
        "seen_to": "..."
      },
      "seen_to": "...",
      "from_me": true,
      "spam_status": {},
      "preview": {
        "id": "...",
        "text": "سلام، خوش آمدید...",
        "from_me": true,
        "sent_at": "...",
        "type": "TEXT"
      },
      "chat_context": "DEFAULT",
      "header": {
        "title": "کمک آموزشی",
        "thumbnail": "...",
        "action": {
          "type": "VIEW_POST",
          "payload": {
            "token": "gaxtOczs"
          }
        }
      }
    }
  ]
}
```

Important fields:

```text
conversation.id
    Unique conversation identifier.

conversation.metadata.title
    Advertisement/chat title.

conversation.metadata.ad_token
    Advertisement token.

conversation.peer
    Other participant.

conversation.preview
    Latest message preview.

conversation.preview.from_me
    Whether latest preview message was sent by the authenticated account.

conversation.preview.text
    Latest message text.

conversation.header
    Conversation/ad header information.
```

---



# 6. Example: Listing Conversations

```python
for index, conversation in enumerate(conversations):

    print()
    print(f"[{index}]")

    print("ID:", conversation.get("id"))

    print(
        "Title:",
        conversation.get("metadata", {}).get("title")
    )

    print(
        "Peer:",
        conversation.get("peer", {}).get("name")
    )

    print(
        "Last message:",
        conversation.get("preview", {}).get("text")
    )

    print(
        "From me:",
        conversation.get("preview", {}).get("from_me")
    )
```

Example:

```text
[0]
ID: gaxtOczs
Title: کمک آموزشی
Peer: ~ کاربر: m gh.
Last message: سلام، خوش آمدید...
From me: True
```

---



# 7. Selecting a Conversation

A conversation can be selected using its array index:

```python
selected_index = 0

conversation = conversations[selected_index]

conversation_id = conversation.get("id")
```

Example:

```text
conversation_id = gaxtOczs
```

The conversation ID is then used to retrieve its messages and send messages.

---



# 8. Get Conversation Messages



## Endpoint

```text
POST https://api.divar.ir/chat/api/get-conversation-messages
```



## Payload

Verified payload:

```json
{
  "limit": 100,
  "conversation_id": "gaxtOczs",
  "order": "DESC"
}
```

Python:

```python
MESSAGES_URL = (
    "https://api.divar.ir/chat/api/get-conversation-messages"
)

response = client._req_session.post(
    MESSAGES_URL,
    json={
        "limit": 100,
        "conversation_id": conversation_id,
        "order": "DESC"
    }
)

response.raise_for_status()

messages_data = response.json()

messages = messages_data.get("messages", [])
```

---



# 9. Message Response

Example:

```json
{
  "messages": [
    {
      "id": "658afab3-95b8-11f1-9f55-222e9f409359",
      "owner_id": "e3a7e8b2-c1cf-431e-8be2-93a836f1f235",
      "conversation_id": "gaxtOczs",
      "sent_at": "2026-08-11T19:11:03.532Z",
      "from_me": true,
      "text_content": {
        "text": "سلام، خوش آمدید. می توانید در مورد چه خدماتی اطلاعات بخواهید؟"
      }
    }
  ]
}
```

Important fields:

```text
message.id
    Unique message ID.

message.conversation_id
    Conversation containing the message.

message.sent_at
    ISO timestamp.

message.from_me
    true  = sent by authenticated account
    false = sent by peer

message.text_content.text
    Text message content.
```

---



# 10. Message Ordering

The request currently uses:

```json
{
  "order": "DESC"
}
```

Observed behavior:

```text
Newest message
      ↓
older message
      ↓
older message
      ↓
...
```

Therefore:

```python
messages[0]
```

is expected to contain the newest returned message.

Do not assume this behavior for other order values unless verified.

---



# 11. Printing Messages

```python
for index, message in enumerate(messages):

    message_id = message.get("id")

    sent_at = message.get("sent_at")

    from_me = message.get("from_me", False)

    text_content = message.get("text_content") or {}

    text = text_content.get("text")

    print()
    print(f"[Message {index + 1}]")
    print("-" * 50)

    print("ID:", message_id)
    print("Sent at:", sent_at)
    print("From me:", from_me)
    print("Text:", text)
```

---



# 12. Sending a Message



## Endpoint

```text
POST https://api.divar.ir/chat/api/send-message
```

This endpoint has been successfully tested from Python.

---



# 13. Send Message Payload

Verified payload:

```json
{
  "conversation_id": "gaxtOczs",
  "is_suggested": false,
  "client_reference": "a33e0ce2-44d7-45cb-84b1-b132b00789c1",
  "text": {
    "text": "999999999"
  }
}
```

Important:

`client_reference` should be generated as a new UUID for every outgoing message.

Python:

```python
import uuid

conversation_id = "gaxtOczs"

message = "555"

client_reference = str(uuid.uuid4())

response = client._req_session.post(
    "https://api.divar.ir/chat/api/send-message",
    json={
        "conversation_id": conversation_id,
        "is_suggested": False,
        "client_reference": client_reference,
        "text": {
            "text": message
        }
    }
)

response.raise_for_status()
```

---



# 14. Send Message Response

Successfully verified response:

```json
{
  "sent_message": {
    "id": "6410ea80-97eb-11f1-9b86-bac2c3b9d417",
    "owner_id": "e3a7e8b2-c1cf-431e-8be2-93a836f1f235",
    "conversation_id": "gaxtOczs",
    "sent_at": "2026-08-14T14:21:07.713499770Z",
    "from_me": true,
    "client_reference": "dd7284e2-b4ac-4ba8-a2a6-b97849beadeb",
    "text_content": {
      "text": "555"
    }
  }
}
```

The returned `sent_message.id` can be used as the server-generated message identifier.

---



# 15. Complete Working Example

The following script demonstrates the complete currently verified flow.

```python
import uuid

from divar import Client


# ==================================================
# 1. Client
# ==================================================

client = Client("my_session")

print("Client created")

print("Storage:", client.storage)

print(
    "Storage exists:",
    client.storage.exists()
)


# ==================================================
# 2. Authorize
# ==================================================

client.authorize()

print(
    "Authorized:",
    client.is_authorized
)

if not client.is_authorized:
    raise RuntimeError(
        "Client is not authorized"
    )


# ==================================================
# 3. Account
# ==================================================

print()
print("=" * 70)
print("ACCOUNT")
print("=" * 70)

print(client.get_me())


# ==================================================
# 4. Get Conversations
# ==================================================

CONVERSATIONS_URL = (
    "https://api.divar.ir/chat/api/conversations"
)

response = client._req_session.post(
    CONVERSATIONS_URL,
    json={
        "filter": {
            "filter": {
                "main_filter": {}
            }
        },
        "page_size": 100
    }
)

response.raise_for_status()

data = response.json()

conversations = data.get(
    "conversations",
    []
)


# ==================================================
# 5. Print Conversations
# ==================================================

print()
print("=" * 70)
print("CONVERSATIONS")
print("=" * 70)

print(
    "Count:",
    len(conversations)
)

if not conversations:

    print(
        "No conversations found."
    )

    raise SystemExit


for index, conversation in enumerate(
    conversations
):

    print()
    print(f"[{index}]")

    print(
        "ID:",
        conversation.get("id")
    )

    print(
        "Title:",
        conversation
        .get("metadata", {})
        .get("title")
    )

    print(
        "Peer:",
        conversation
        .get("peer", {})
        .get("name")
    )

    print(
        "Last message:",
        conversation
        .get("preview", {})
        .get("text")
    )

    print(
        "From me:",
        conversation
        .get("preview", {})
        .get("from_me")
    )


# ==================================================
# 6. Select Conversation
# ==================================================

selected_index = 0

conversation = conversations[
    selected_index
]

conversation_id = conversation.get(
    "id"
)


print()
print("=" * 70)
print("SELECTED CONVERSATION")
print("=" * 70)

print(
    "ID:",
    conversation_id
)

print(
    "Title:",
    conversation
    .get("metadata", {})
    .get("title")
)

print(
    "Peer:",
    conversation
    .get("peer", {})
    .get("name")
)


# ==================================================
# 7. Get Conversation Messages
# ==================================================

MESSAGES_URL = (
    "https://api.divar.ir/chat/api/"
    "get-conversation-messages"
)

response = client._req_session.post(
    MESSAGES_URL,
    json={
        "limit": 100,
        "conversation_id": conversation_id,
        "order": "DESC"
    }
)

response.raise_for_status()

messages_data = response.json()

messages = messages_data.get(
    "messages",
    []
)


# ==================================================
# 8. Print Messages
# ==================================================

print()
print("=" * 70)
print("MESSAGES")
print("=" * 70)

print(
    "Message count:",
    len(messages)
)


for index, message in enumerate(
    messages
):

    message_id = message.get(
        "id"
    )

    sent_at = message.get(
        "sent_at"
    )

    from_me = message.get(
        "from_me",
        False
    )

    text_content = (
        message.get("text_content")
        or {}
    )

    text = text_content.get(
        "text"
    )

    print()
    print(
        f"[Message {index + 1}]"
    )

    print(
        "-" * 50
    )

    print(
        "ID:",
        message_id
    )

    print(
        "Sent at:",
        sent_at
    )

    print(
        "From me:",
        from_me
    )

    print(
        "Text:",
        text
    )


# ==================================================
# 9. Send Test Message
# ==================================================

SEND_MESSAGE_URL = (
    "https://api.divar.ir/chat/api/send-message"
)

message_text = "555"

client_reference = str(
    uuid.uuid4()
)

response = client._req_session.post(
    SEND_MESSAGE_URL,
    json={
        "conversation_id": conversation_id,

        "is_suggested": False,

        "client_reference":
            client_reference,

        "text": {
            "text": message_text
        }
    }
)

response.raise_for_status()

send_data = response.json()


# ==================================================
# 10. Print Send Result
# ==================================================

print()
print("=" * 70)
print("SEND MESSAGE")
print("=" * 70)

print(
    "Status:",
    response.status_code
)

print(
    "Response:"
)

print(
    send_data
)


sent_message = send_data.get(
    "sent_message"
)

if sent_message:

    print()
    print(
        "Message sent successfully."
    )

    print(
        "Message ID:",
        sent_message.get("id")
    )

    print(
        "Conversation ID:",
        sent_message.get(
            "conversation_id"
        )
    )

    print(
        "Text:",
        sent_message
        .get("text_content", {})
        .get("text")
    )
```

---



# 16. Verified API Endpoints


| Operation     | Method | Endpoint                              | Status   |
| ------------- | ------ | ------------------------------------- | -------- |
| Conversations | POST   | `/chat/api/conversations`             | VERIFIED |
| Messages      | POST   | `/chat/api/get-conversation-messages` | VERIFIED |
| Send message  | POST   | `/chat/api/send-message`              | VERIFIED |


Base URL:

```text
https://api.divar.ir
```

---



# 17. Current Client Capability

At this stage the client can:

```text
┌──────────────────────────────┐
│ Authentication               │
├──────────────────────────────┤
│ Session persistence          │
│ Authorization                │
│ Get current account          │
└──────────────────────────────┘

              ↓

┌──────────────────────────────┐
│ Conversations                │
├──────────────────────────────┤
│ List conversations            │
│ Get conversation metadata     │
│ Get peer information          │
│ Get latest message preview    │
└──────────────────────────────┘

              ↓

┌──────────────────────────────┐
│ Messages                     │
├──────────────────────────────┤
│ Get conversation messages     │
│ Read message text             │
│ Detect from_me                │
│ Read sent_at                  │
│ Read message ID               │
└──────────────────────────────┘

              ↓

┌──────────────────────────────┐
│ Outgoing Messages             │
├──────────────────────────────┤
│ Send text message             │
│ Generate client_reference     │
│ Receive sent_message          │
└──────────────────────────────┘
```

---



# 18. Important Implementation Notes



## 18.1 Authentication

Do not manually construct authentication tokens if the existing `Client` session already handles authentication.

Always prefer:

```python
client._req_session
```

after:

```python
client.authorize()
```

---



## 18.2 Session

The session name:

```python
Client("my_session")
```

is persistent.

Do not create a new session unnecessarily for every request.

---



## 18.3 Conversation ID

The `conversation_id` must come from the conversation object:

```python
conversation["id"]
```

Example:

```text
gaxtOczs
```

Do not confuse:

```text
conversation.id
```

with:

```text
peer.id
owner_id
metadata.ad_token
```

For chat message APIs, use:

```text
conversation.id
```

---



## 18.4 client_reference

For every outgoing message:

```python
client_reference = str(uuid.uuid4())
```

Generate a new value.

Do not reuse an old `client_reference`.

---



## 18.5 Message Direction

Use:

```python
message["from_me"]
```

to determine direction.

```text
true
    ↓
message was sent by authenticated account

false
    ↓
message was sent by peer
```

This field is important for future automation.

---



# 19. Future Automation Flow

The current verified APIs allow the following future architecture:

```text
                   Client
                     │
                     ▼
              Authentication
                     │
                     ▼
             Conversations
                     │
          ┌──────────┴──────────┐
          │                     │
          ▼                     ▼
   Conversation A        Conversation B
          │                     │
          ▼                     ▼
       Messages              Messages
          │                     │
          ▼                     ▼
    from_me == false?    from_me == false?
          │                     │
          └──────────┬──────────┘
                     │
                     ▼
              Incoming Message
                     │
                     ▼
              Business Logic
                     │
                     ▼
                  AI/LLM
                     │
                     ▼
             Generated Response
                     │
                     ▼
              send-message
                     │
                     ▼
                Divar Chat
```

---



# 20. Next APIs To Investigate

The following functionality has NOT yet been fully documented in this file and must be reverse-engineered from the browser Network panel before implementation:

```text
1. Unread conversations
2. New message detection
3. Real-time chat events
4. WebSocket/event-stream communication
5. Message pagination
6. Sending media
7. Suggested messages
8. Message attachments
9. Read/seen state
10. Conversation state changes
```

An already observed endpoint is:

```text
POST /chat/api/unread-conversation-ids
```

This endpoint should be investigated next because it may provide a more efficient mechanism for detecting conversations requiring processing than repeatedly downloading every message.

---



# 21. Recommended Development Order

Do not implement the AI automation immediately.

Recommended sequence:

```text
Phase 1
Authentication
    ↓
DONE

Phase 2
Conversation listing
    ↓
DONE

Phase 3
Conversation message retrieval
    ↓
DONE

Phase 4
Send text message
    ↓
DONE

Phase 5
Unread message detection
    ↓
NEXT

Phase 6
Incremental message synchronization
    ↓
NEXT

Phase 7
Real-time events / WebSocket investigation
    ↓
NEXT

Phase 8
AI response generation
    ↓
FUTURE

Phase 9
Automatic reply
    ↓
FUTURE
```

---



# 22. Current Verified Test Account

Testing has been performed using:

```text
Conversation:
gaxtOczs

Title:
کمک آموزشی
```

The conversation contains historical test messages.

Therefore, historical messages in this conversation should NOT be interpreted as production user behavior.

The conversation is intentionally used as a development/test conversation.

---



# 23. Minimal API Reference



## List conversations

```python
response = client._req_session.post(
    "https://api.divar.ir/chat/api/conversations",
    json={
        "filter": {
            "filter": {
                "main_filter": {}
            }
        },
        "page_size": 100
    }
)
```



## Get messages

```python
response = client._req_session.post(
    "https://api.divar.ir/chat/api/"
    "get-conversation-messages",
    json={
        "limit": 100,
        "conversation_id": conversation_id,
        "order": "DESC"
    }
)
```



## Send message

```python
response = client._req_session.post(
    "https://api.divar.ir/chat/api/send-message",
    json={
        "conversation_id": conversation_id,
        "is_suggested": False,
        "client_reference": str(uuid.uuid4()),
        "text": {
            "text": message
        }
    }
)
```

These three endpoints currently form the core verified Divar chat API used by this client.

```

### خلاصه‌ی flow جدید

نسخه قبلی را به این تبدیل کن:

```text
Client
 │
 ├── Client("my_session")
 │      │
 │      └── persistent FileSession
 │
 ├── authorize()
 │
 ├── get_me()
 │      │
 │      └── Account
 │
 ├── POST /chat/api/conversations
 │      │
 │      └── conversations[]
 │              │
 │              ├── id
 │              ├── metadata
 │              ├── peer
 │              └── preview
 │
 ├── SELECT conversation.id
 │      │
 │      └── conversation_id
 │
 ├── POST /chat/api/get-conversation-messages
 │      │
 │      └── messages[]
 │              │
 │              ├── id
 │              ├── sent_at
 │              ├── from_me
 │              └── text_content
 │
 └── POST /chat/api/send-message
        │
        ├── conversation_id
        ├── is_suggested
        ├── client_reference = UUID
        └── text.text
                │
                ▼
          sent_message
```

