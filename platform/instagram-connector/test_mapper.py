from __future__ import annotations

from mapper import (
    extract_thread_id,
    is_auth_failure,
    map_realtime_dm,
    parse_thread_target,
    thread_key,
)


def test_extract_thread_id_from_realtime_path() -> None:
    path = "/direct_v2/threads/340282366841710301244259509836085083814/items/12345"
    assert extract_thread_id(path) == "340282366841710301244259509836085083814"
    assert extract_thread_id(None) == ""
    assert extract_thread_id("/iris/foo") == ""


def test_parse_thread_target_accepts_prefixed_and_bare_ids() -> None:
    assert parse_thread_target("instagram:thread:42") == 42
    assert parse_thread_target("340282366841710301244259509836085083814") == 340282366841710301244259509836085083814
    assert parse_thread_target("bale:user:1") is None
    assert parse_thread_target("") is None
    assert thread_key(42) == "instagram:thread:42"


def test_map_realtime_dm_normalizes_incoming_text() -> None:
    payload = map_realtime_dm(
        account_id="acc-1",
        message={
            "item_id": "item-9",
            "user_id": 15463995851,
            "timestamp": 1724100000,
            "item_type": "text",
            "text": "Hello",
            "thread_id": "340282366841710301244259509836085083814",
        },
        me_id=999,
    )
    assert payload is not None
    assert payload["direction"] == "inbound"
    assert payload["sender_type"] == "customer"
    assert payload["body"] == "Hello"
    assert payload["external_chat_id"] == "340282366841710301244259509836085083814"
    assert payload["external_message_id"] == "ig:item-9"
    assert payload["chat_type"] == "pv"
    assert payload["phone"] == ""


def test_map_realtime_dm_ignores_own_and_non_text() -> None:
    base = {
        "item_id": "x",
        "thread_id": "777",
        "item_type": "text",
        "text": "hi",
    }
    own = dict(base, user_id=999)
    assert map_realtime_dm(account_id="a", message=own, me_id=999) is None

    media = dict(base, user_id=1, item_type="media")
    assert map_realtime_dm(account_id="a", message=media, me_id=2) is None

    no_text = dict(base, user_id=1, text="")
    assert map_realtime_dm(account_id="a", message=no_text, me_id=2) is None

    no_thread = {"item_id": "y", "user_id": 1, "item_type": "text", "text": "s"}
    assert map_realtime_dm(account_id="a", message=no_thread, me_id=2) is None


def test_map_realtime_dm_resolves_thread_from_path() -> None:
    payload = map_realtime_dm(
        account_id="a",
        message={
            "item_id": "z",
            "user_id": 5,
            "item_type": "text",
            "text": "salam",
            "path": "/direct_v2/threads/888/items/z",
        },
        me_id=1,
    )
    assert payload is not None
    assert payload["external_chat_id"] == "888"


def test_is_auth_failure_detection() -> None:
    class ClientLoginRequired(Exception):
        pass

    assert is_auth_failure(ClientLoginRequired("login_required"))
    assert not is_auth_failure(ConnectionError("network unreachable"))
