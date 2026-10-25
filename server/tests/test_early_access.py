"""Early access: off by default, an admin's switch, and the seven numbers a weekly ping sends. Run: .venv/bin/pytest"""

import asyncio
import secrets

import pytest

from atrium import realtime, telemetry
from atrium.db import execute

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


def member(client, admin) -> dict:
    code = client.get("/api/invite", headers=admin).json()["code"]
    r = client.post("/api/register", json={"invite": code, "name": f"Гость{secrets.randbelow(10**6)}", "password": PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()


def test_off_by_default_and_only_an_admin_switches_it(client, admin):
    execute("DELETE FROM settings WHERE key = 'early_access'")
    assert client.get("/api/server/channel").json() == {"channel": "stable"}
    someone = bearer(member(client, admin)["token"])
    assert client.put("/api/server/early-access", json={"enabled": True}, headers=someone).status_code == 403
    assert client.get("/api/server/early-access", headers=someone).status_code == 403

    r = client.put("/api/server/early-access", json={"enabled": True}, headers=admin)
    assert r.status_code == 200 and r.json()["enabled"] is True
    assert client.get("/api/server/channel").json() == {"channel": "early"}
    client.put("/api/server/early-access", json={"enabled": False}, headers=admin)


def test_a_ping_sends_seven_numbers_and_only_when_on(client, admin, monkeypatch):
    sent = []
    monkeypatch.setattr(telemetry, "send", sent.append)
    telemetry.set_enabled(False)
    asyncio.run(telemetry.ping_if_due())
    assert sent == []

    telemetry.set_enabled(True)
    asyncio.run(telemetry.ping_if_due())
    assert len(sent) == 1
    assert set(sent[0]) == {"server", "version", "days_since_install", "members", "voice3_people", "active2d", "voice3_days"}
    assert len(sent[0]["server"]) == 32
    # Once a week, not every hour.
    asyncio.run(telemetry.ping_if_due())
    assert len(sent) == 1
    assert client.get("/api/server/early-access", headers=admin).json()["lastSent"]["numbers"] == sent[0]
    telemetry.set_enabled(False)


def test_three_in_one_room_on_two_days_is_a_returning_call(client, admin, monkeypatch):
    execute("DELETE FROM voice_days")
    channel = next(c for c in client.get("/api/bootstrap", headers=admin).json()["channels"] if c["kind"] == "voice")
    people = [member(client, admin)["user"]["id"] for _ in range(3)]
    monkeypatch.setattr(realtime, "voice", {})

    # Two people: they were in voice, but it wasn't a call of three.
    for i, user_id in enumerate(people[:2]):
        realtime.voice[f"sid{i}"] = {"channelId": channel["id"], "userId": user_id, "kind": "channel"}
    telemetry.note_room(channel["id"])
    assert telemetry.numbers()["voice3_people"] == 0

    realtime.voice["sid2"] = {"channelId": channel["id"], "userId": people[2], "kind": "channel"}
    telemetry.note_room(channel["id"])
    first = telemetry.numbers()
    assert (first["voice3_people"], first["active2d"], first["voice3_days"]) == (3, 0, 1)

    # The same three again on another day this week.
    for user_id in people:
        execute("INSERT INTO voice_days (user_id, day, crowded) VALUES (?, ?, 1)", (user_id, telemetry.days_ago(2)))
    again = telemetry.numbers()
    assert (again["voice3_people"], again["active2d"], again["voice3_days"]) == (3, 3, 2)
    execute("DELETE FROM voice_days")
