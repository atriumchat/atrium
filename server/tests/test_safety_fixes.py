"""Fixes from the 23 October server audit. Run: .venv/bin/pytest"""

import asyncio
import secrets

import pytest
from fastapi.testclient import TestClient

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


def member(client, admin) -> tuple[dict, str]:
    code = client.get("/api/invite", headers=admin).json()["code"]
    name = f"Гость{secrets.randbelow(10**6)}"
    r = client.post("/api/register", json={"invite": code, "name": name, "password": PASSWORD})
    assert r.status_code == 200, r.text
    return r.json(), name


def test_a_stranger_cant_lock_someone_out(client, admin):
    from app import app

    _, name = member(client, admin)
    stranger = TestClient(app, client=("203.0.113.7", 50000))
    for _ in range(8):
        stranger.post("/api/login", json={"name": name, "password": "wrong password!"})
    assert stranger.post("/api/login", json={"name": name, "password": "wrong password!"}).status_code == 429
    # The owner, from their own address, still gets in.
    assert client.post("/api/login", json={"name": name, "password": PASSWORD}).status_code == 200


def test_numbers_too_big_are_turned_down_not_crashing(client, admin):
    channel = client.get("/api/bootstrap", headers=admin).json()["channels"][0]
    huge = 10**30
    assert client.post("/api/read", json={"conversationId": channel["id"], "at": huge}, headers=admin).status_code == 422
    assert client.get(f"/api/channels/{channel['id']}/messages?before={huge}", headers=admin).status_code == 422
    assert client.get(f"/api/inbox?before={huge}", headers=admin).status_code == 422


def test_odd_avatar_names_are_not_found(client, admin):
    assert client.get("/api/avatars/a%00b.webp").status_code == 404
    assert client.get("/api/avatars/..%2Fsecret.webp").status_code == 404


def test_socket_handlers_take_any_data(client, admin, monkeypatch):
    boot = client.get("/api/bootstrap", headers=admin).json()
    channel = next(c for c in boot["channels"] if c["kind"] == "text")

    async def session(sid):
        return {"user": boot["me"]}

    async def emit(*args, **kwargs):
        return None

    monkeypatch.setattr(realtime.sio, "get_session", session)
    monkeypatch.setattr(realtime.sio, "emit", emit)
    for bad in ([], "text", 5, None):
        for handler in (realtime.message_send, realtime.reaction_toggle, realtime.read_socket):
            result = asyncio.run(handler("sid", bad))
            assert not (result or {}).get("ok")

    sent = asyncio.run(realtime.message_send("sid", {"channelId": channel["id"], "content": "раз два"}))
    assert sent["ok"]
    # Keycap emoji start with a digit or #, and are emoji all the same.
    for keycap in ("1️⃣", "#️⃣"):
        reacted = asyncio.run(realtime.reaction_toggle("sid", {"messageId": sent["message"]["id"], "emoji": keycap}))
        assert (reacted or {}).get("ok", True) and (reacted or {}).get("code") != "notEmoji", reacted
    assert asyncio.run(realtime.reaction_toggle("sid", {"messageId": sent["message"]["id"], "emoji": "12"}))["code"] == "notEmoji"
