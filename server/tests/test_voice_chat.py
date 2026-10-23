"""A voice room's own chat: messages beside the call, read marks and unread counts as in a text channel.
Run: .venv/bin/pytest"""

import asyncio

import pytest

from atrium import realtime

PASSWORD = "correct horse battery"


def bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def admin(client):
    r = client.post("/api/setup", json={"code": "friends", "serverName": "Тест", "name": "Админ", "password": PASSWORD})
    if r.status_code == 409:  # another test file set the server up first, with the same admin
        r = client.post("/api/login", json={"name": "Админ", "password": PASSWORD})
    assert r.status_code == 200, r.text
    return bearer(r.json()["token"])


def test_voice_room_has_a_chat(client, admin, monkeypatch):
    boot = client.get("/api/bootstrap", headers=admin).json()
    room = client.post("/api/channels", json={"name": "Болталка", "kind": "voice"}, headers=admin).json()
    room = next(c for c in room if c["name"] == "Болталка")

    async def session(sid):
        return {"user": boot["me"]}

    async def emit(*args, **kwargs):
        return None

    monkeypatch.setattr(realtime.sio, "get_session", session)
    monkeypatch.setattr(realtime.sio, "emit", emit)
    sent = asyncio.run(realtime.message_send("sid", {"channelId": room["id"], "content": "слышно?"}))
    assert sent["ok"], sent

    history = client.get(f"/api/channels/{room['id']}/messages", headers=admin).json()
    assert [m["content"] for m in history] == ["слышно?"]
    read = client.post("/api/read", json={"conversationId": room["id"], "at": sent["message"]["createdAt"]}, headers=admin)
    assert read.status_code == 200
