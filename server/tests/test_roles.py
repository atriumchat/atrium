"""Roles and private channels: who sees a private channel everywhere it shows up (list, history, files, socket
broadcasts, unread counts, inbox, voice rooms and their tokens), the role hierarchy, and the upgrade from before roles.
Run: python -m pytest -q server/tests"""

import asyncio
import json
import sqlite3
import threading
import time
from unittest.mock import Mock
from urllib.parse import urlencode

import jwt
import pytest
from fastapi.testclient import TestClient

from atrium import db, realtime, uploads
from atrium.config import INVITE_CODE, LIVEKIT_API_KEY, LIVEKIT_API_SECRET

PASSWORD = "original-password-123"


def bearer(session):
    return {"Authorization": f"Bearer {session['token']}"}


class Emits(list):
    """Stands in for sio.emit: keeps (event, data, to, skip_sid)."""

    async def __call__(self, event, data=None, to=None, skip_sid=None, **kwargs):
        self.append((event, data, to, skip_sid))

    def to_user(self, event, user_id):
        """What of `event` reached this person's tabs (a broadcast reaches everyone)."""
        room = realtime.user_room(user_id)
        return [d for e, d, to, _ in self if e == event and (to is None or room == to or (isinstance(to, list) and room in to))]


@pytest.fixture
def server(tmp_path, monkeypatch):
    from app import app

    monkeypatch.setattr(db, "DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr(db, "_db", threading.local())
    db.init_db()
    for name in ("online", "voice", "calls"):
        monkeypatch.setattr(realtime, name, {})
    monkeypatch.setattr(realtime, "livekit_remove", Mock())
    emits = Emits()
    monkeypatch.setattr(realtime.sio, "emit", emits)
    with TestClient(app) as client:
        r = client.post("/api/setup", json={"code": INVITE_CODE, "serverName": "Roles", "name": "Admin", "password": PASSWORD})
        assert r.status_code == 200, r.text
        people = {"admin": r.json()}
        invite = client.get("/api/invite", headers=bearer(people["admin"])).json()["code"]
        for name in ("Alice", "Bob", "Carol"):
            r = client.post("/api/register", json={"invite": invite, "name": name, "password": PASSWORD})
            assert r.status_code == 200, r.text
            people[name.lower()] = r.json()
        sessions = {}
        for key, session in people.items():
            uid = session["user"]["id"]
            # Everyone is online, one tab each: per-person broadcasts go to their user room.
            realtime.online[f"sid-{key}"] = uid
            sessions[f"sid-{key}"] = {"user": client.get("/api/bootstrap", headers=bearer(session)).json()["me"]}

        async def get_session(sid):
            return sessions[sid]

        monkeypatch.setattr(realtime.sio, "get_session", get_session)
        emits.clear()
        yield client, people, emits


def uid(people, key):
    return people[key]["user"]["id"]


def boot(client, session):
    return client.get("/api/bootstrap", headers=bearer(session)).json()


def make_channel(client, admin, name, kind="text", private=False):
    r = client.post("/api/channels", json={"name": name, "kind": kind, "private": private}, headers=bearer(admin))
    assert r.status_code == 200, r.text
    return next(c for c in r.json() if c["name"] == name)


def make_role(client, session, name, permissions=(), color=None):
    r = client.post("/api/roles", json={"name": name, "permissions": list(permissions), "color": color}, headers=bearer(session))
    assert r.status_code == 200, r.text
    return next(x for x in r.json() if x["name"] == name)


def give_roles(client, session, user_id, role_ids):
    return client.put(f"/api/users/{user_id}/roles", json={"roleIds": role_ids}, headers=bearer(session))


def send(sid, channel_id, content, **extra):
    return asyncio.run(realtime.message_send(sid, {"channelId": channel_id, "content": content, **extra}))


def rtc_check(client, token):
    return client.get("/api/rtc/authorize", headers={"X-Forwarded-Uri": "/rtc?" + urlencode({"access_token": token})})


def forged_token(user_id, room):
    """A token as if the server had issued it, for a room it never would."""
    version = db.query("SELECT token_version FROM users WHERE id = ?", (user_id,))[0]["token_version"]
    now = int(time.time())
    claims = {
        "iss": LIVEKIT_API_KEY,
        "sub": user_id,
        "nbf": now - 10,
        "exp": now + 600,
        "metadata": json.dumps({"color": "#fff", "authVersion": version}),
        "video": {"room": room, "roomJoin": True},
    }
    return jwt.encode(claims, LIVEKIT_API_SECRET, algorithm="HS256")


def test_private_text_channel_is_hidden_everywhere_from_a_member_without_access(server):
    client, people, emits = server
    admin, alice, bob = people["admin"], people["alice"], people["bob"]
    secret = make_channel(client, admin, "секрет", private=True)
    assert secret["private"]
    r = client.put(f"/api/channels/{secret['id']}/access", json={"private": True, "userIds": [uid(people, "alice")]}, headers=bearer(admin))
    assert r.status_code == 200, r.text
    assert r.json()["userIds"] == [uid(people, "alice")]

    # The list, in the bootstrap and in the broadcast after the change.
    assert secret["id"] in [c["id"] for c in boot(client, alice)["channels"]]
    assert secret["id"] not in [c["id"] for c in boot(client, bob)["channels"]]
    assert all(secret["id"] not in [c["id"] for c in channels] for channels in emits.to_user("channels", uid(people, "bob")))
    assert any(secret["id"] in [c["id"] for c in channels] for channels in emits.to_user("channels", uid(people, "alice")))

    # Sending, with a file: only the people who see the channel get it, and only they may load the file.
    upload = client.post("/api/uploads?name=plan.txt", content=b"the plan", headers={**bearer(alice), "Content-Type": "text/plain"}).json()
    emits.clear()
    sent = send("sid-alice", secret["id"], "<@all> план", attachments=[upload["id"]])
    assert sent["ok"], sent
    assert emits.to_user("message:new", uid(people, "alice")) and emits.to_user("message:new", uid(people, "admin"))
    assert emits.to_user("message:new", uid(people, "bob")) == []
    row = db.query("SELECT * FROM uploads WHERE id = ?", (upload["id"],))[0]
    assert row["scope"] == f"channel:{secret['id']}"
    assert uploads.can_see_upload(uid(people, "alice"), row)
    assert not uploads.can_see_upload(uid(people, "bob"), row)

    # History, read marks, unread counts, the inbox.
    assert client.get(f"/api/channels/{secret['id']}/messages", headers=bearer(bob)).status_code == 404
    assert client.get(f"/api/channels/{secret['id']}/messages", headers=bearer(admin)).status_code == 200
    assert client.post("/api/read", json={"conversationId": secret["id"], "at": 1}, headers=bearer(bob)).status_code == 404
    assert secret["id"] not in boot(client, bob)["unread"]
    assert boot(client, admin)["unread"].get(secret["id"]) == 1
    assert boot(client, admin)["mentions"].get(secret["id"]) == 1
    assert all(m["channelId"] != secret["id"] for m in client.get("/api/inbox", headers=bearer(bob)).json())
    assert any(m["channelId"] == secret["id"] for m in client.get("/api/inbox", headers=bearer(admin)).json())

    # Bob can't write there, react, edit, delete, type into it or mute it.
    assert not send("sid-bob", secret["id"], "можно?")["ok"]
    message_id = sent["message"]["id"]
    assert not asyncio.run(realtime.reaction_toggle("sid-bob", {"messageId": message_id, "emoji": "👍"}))["ok"]
    assert not asyncio.run(realtime.message_delete("sid-bob", {"id": message_id}))["ok"]
    assert client.put(f"/api/channels/{secret['id']}/mute", json={"muted": True}, headers=bearer(bob)).status_code == 404
    emits.clear()
    asyncio.run(realtime.typing("sid-bob", {"channelId": secret["id"]}))
    assert emits == []
    asyncio.run(realtime.typing("sid-alice", {"channelId": secret["id"]}))
    assert emits.to_user("typing", uid(people, "admin")) and emits.to_user("typing", uid(people, "bob")) == []

    # A reaction from someone who sees it goes only to the channel's people too.
    emits.clear()
    assert asyncio.run(realtime.reaction_toggle("sid-admin", {"messageId": message_id, "emoji": "👍"}))["ok"]
    assert emits.to_user("message:reactions", uid(people, "alice")) and emits.to_user("message:reactions", uid(people, "bob")) == []


def test_access_through_a_role_and_through_seeing_every_channel(server):
    client, people, _ = server
    admin, bob, carol = people["admin"], people["bob"], people["carol"]
    secret = make_channel(client, admin, "штаб", private=True)
    squad = make_role(client, admin, "Отряд")
    watcher = make_role(client, admin, "Смотритель", ["seeAllChannels"])
    client.put(f"/api/channels/{secret['id']}/access", json={"private": True, "roleIds": [squad["id"]]}, headers=bearer(admin))
    assert client.get(f"/api/channels/{secret['id']}/messages", headers=bearer(bob)).status_code == 404

    assert give_roles(client, admin, uid(people, "bob"), [squad["id"]]).status_code == 200
    assert client.get(f"/api/channels/{secret['id']}/messages", headers=bearer(bob)).status_code == 200
    assert give_roles(client, admin, uid(people, "carol"), [watcher["id"]]).status_code == 200
    assert secret["id"] in [c["id"] for c in boot(client, carol)["channels"]]

    # Taking the role away takes the channel with it; so does making the channel public again give it to everyone.
    assert give_roles(client, admin, uid(people, "bob"), []).status_code == 200
    assert client.get(f"/api/channels/{secret['id']}/messages", headers=bearer(bob)).status_code == 404
    client.put(f"/api/channels/{secret['id']}/access", json={"private": False}, headers=bearer(admin))
    assert client.get(f"/api/channels/{secret['id']}/messages", headers=bearer(bob)).status_code == 200


def test_private_voice_room_refuses_tokens_hides_who_is_inside_and_ends_lost_access(server):
    client, people, emits = server
    admin, alice, bob = people["admin"], people["alice"], people["bob"]
    room = make_channel(client, admin, "Тихая", kind="voice", private=True)
    squad = make_role(client, admin, "Тиммейты")
    client.put(f"/api/channels/{room['id']}/access", json={"private": True, "roleIds": [squad["id"]]}, headers=bearer(admin))
    give_roles(client, admin, uid(people, "alice"), [squad["id"]])

    assert client.post("/api/voice-token", json={"channelId": room["id"]}, headers=bearer(bob)).status_code == 404
    assert rtc_check(client, forged_token(uid(people, "bob"), f"voice-{room['id']}")).status_code == 401
    token = client.post("/api/voice-token", json={"channelId": room["id"]}, headers=bearer(alice)).json()["token"]
    assert rtc_check(client, token).status_code == 200

    # Bob can't join; Alice can, and only the room's people hear that she's there.
    asyncio.run(realtime.voice_join("sid-bob", {"channelId": room["id"]}))
    assert "sid-bob" not in realtime.voice
    emits.clear()
    asyncio.run(realtime.voice_join("sid-alice", {"channelId": room["id"]}))
    assert realtime.voice["sid-alice"]["channelId"] == room["id"]
    seen_by = lambda key: [e for state in emits.to_user("voice:state", uid(people, key)) for e in state]  # noqa: E731
    assert any(e["channelId"] == room["id"] for e in seen_by("admin"))
    assert seen_by("bob") == [] or all(e["channelId"] != room["id"] for e in seen_by("bob"))
    assert emits.to_user("voice:state", uid(people, "bob")), "Bob still gets the rooms he sees"

    # Losing the role ends the call there and the old token stops working.
    assert give_roles(client, admin, uid(people, "alice"), []).status_code == 200
    assert "sid-alice" not in realtime.voice
    realtime.livekit_remove.assert_any_call(f"voice-{room['id']}", uid(people, "alice"))
    assert rtc_check(client, token).status_code == 401


def test_role_hierarchy_and_permissions_one_does_not_hold(server):
    client, people, _ = server
    admin, alice, bob = people["admin"], people["alice"], people["bob"]
    mods = make_role(client, admin, "Модеры", ["manageRoles", "removeMembers"], color="#3ba55c")
    rookies = make_role(client, admin, "Новички", color="#faa61a")
    admins_role = next(r for r in client.get("/api/roles", headers=bearer(alice)).json() if r["name"] == "Админ")
    assert give_roles(client, admin, uid(people, "alice"), [mods["id"]]).status_code == 200
    assert boot(client, alice)["permissions"] == ["manageRoles", "removeMembers"]
    assert not boot(client, alice)["canManageChannels"]

    # Roles below her own: yes. Hers or higher, or a permission she doesn't have: no.
    r = give_roles(client, alice, uid(people, "bob"), [rookies["id"]])
    assert r.status_code == 200 and r.json()["roles"] == [rookies["id"]]
    assert give_roles(client, alice, uid(people, "bob"), [rookies["id"], mods["id"]]).status_code == 403
    assert give_roles(client, alice, uid(people, "alice"), [mods["id"], admins_role["id"]]).status_code == 403
    assert client.post("/api/roles", json={"name": "Строители", "permissions": ["manageChannels"]}, headers=bearer(alice)).status_code == 403
    assert client.put(f"/api/roles/{mods['id']}", json={"name": "Боссы", "permissions": ["manageRoles"]}, headers=bearer(alice)).status_code == 403
    assert client.delete(f"/api/roles/{admins_role['id']}", headers=bearer(alice)).status_code == 403
    assert give_roles(client, alice, uid(people, "admin"), [rookies["id"]]).status_code == 403
    assert client.put("/api/roles/order", json={"ids": [rookies["id"], mods["id"]]}, headers=bearer(alice)).status_code == 409
    assert client.put("/api/roles/order", json={"ids": [rookies["id"]]}, headers=bearer(alice)).status_code == 200

    # Bob, a rookie, manages nothing; Alice takes him off the server, but not the admin.
    assert client.post("/api/roles", json={"name": "Мои"}, headers=bearer(bob)).status_code == 403
    assert client.post(f"/api/users/{uid(people, 'admin')}/remove", headers=bearer(alice)).status_code == 403
    assert client.post(f"/api/users/{uid(people, 'bob')}/remove", headers=bearer(alice)).status_code == 200


def test_member_above_cannot_be_removed_or_reassigned_by_a_lower_one(server):
    client, people, _ = server
    admin, alice = people["admin"], people["alice"]
    high = make_role(client, admin, "Старшие", ["removeMembers", "manageRoles"])
    low = make_role(client, admin, "Младшие", ["removeMembers", "manageRoles"])
    give_roles(client, admin, uid(people, "bob"), [high["id"]])
    give_roles(client, admin, uid(people, "alice"), [low["id"]])
    assert client.post(f"/api/users/{uid(people, 'bob')}/remove", headers=bearer(alice)).status_code == 403
    assert give_roles(client, alice, uid(people, "bob"), []).status_code == 403


def test_managing_messages_and_channels_comes_from_roles(server):
    client, people, _ = server
    admin, bob, carol = people["admin"], people["bob"], people["carol"]
    general = next(c for c in boot(client, admin)["channels"] if c["kind"] == "text")
    sent = send("sid-alice", general["id"], "привет")
    assert not asyncio.run(realtime.message_delete("sid-carol", {"id": sent["message"]["id"]}))["ok"]
    assert client.post("/api/channels", json={"name": "новый", "kind": "text"}, headers=bearer(bob)).status_code == 403

    moderators = make_role(client, admin, "Модерация", ["manageMessages", "manageChannels"])
    give_roles(client, admin, uid(people, "carol"), [moderators["id"]])
    give_roles(client, admin, uid(people, "bob"), [moderators["id"]])
    assert asyncio.run(realtime.message_delete("sid-carol", {"id": sent["message"]["id"]}))["ok"]
    assert boot(client, bob)["canManageChannels"]
    assert client.post("/api/channels", json={"name": "новый", "kind": "text"}, headers=bearer(bob)).status_code == 200

    # A private channel Bob makes stays his; a manager who doesn't see a channel can't touch it.
    mine = make_channel(client, bob, "бобов", private=True)
    assert client.get(f"/api/channels/{mine['id']}/access", headers=bearer(bob)).json()["userIds"] == [uid(people, "bob")]
    assert client.patch(f"/api/channels/{mine['id']}", json={"name": "чужой"}, headers=bearer(carol)).status_code == 404
    assert client.put(f"/api/channels/{mine['id']}/access", json={"private": False}, headers=bearer(carol)).status_code == 404


def test_upgrade_from_before_roles_keeps_channels_public_and_admins_on_top(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "old.db")
    monkeypatch.setattr(db, "_db", threading.local())
    db.init_db()
    # Back to the schema before roles, with an admin, a member and a picture sent in a channel.
    conn = sqlite3.connect(db.DB_PATH)
    conn.executescript(
        """DROP TABLE channel_users; DROP TABLE channel_roles; DROP TABLE user_roles; DROP TABLE roles;
           ALTER TABLE channels DROP COLUMN private;"""
    )
    channel_id = conn.execute("SELECT id FROM channels WHERE kind = 'text' LIMIT 1").fetchone()[0]
    for user_id, name, admin in (("a" * 32, "Admin", 1), ("b" * 32, "Member", 0)):
        conn.execute(
            "INSERT INTO users (id, name, name_key, password_hash, color, created_at, is_admin) VALUES (?, ?, ?, 'x', '#fff', 0, ?)",
            (user_id, name, name.casefold(), admin),
        )
    conn.execute("INSERT INTO uploads (id, user_id, width, height, created_at, scope) VALUES ('p.webp', ?, 1, 1, 0, 'channel')", ("b" * 32,))
    conn.execute(
        "INSERT INTO messages (id, channel_id, user_id, content, created_at, attachments) VALUES ('m', ?, ?, '', 0, ?)",
        (channel_id, "b" * 32, json.dumps([{"url": "/api/uploads/p.webp", "width": 1, "height": 1}])),
    )
    conn.commit()
    conn.close()

    monkeypatch.setattr(db, "_db", threading.local())
    db.init_db()
    roles = db.query("SELECT * FROM roles")
    assert len(roles) == 1 and set(json.loads(roles[0]["permissions"])) == set(db.ALL_PERMISSIONS)
    assert [r["user_id"] for r in db.query("SELECT user_id FROM user_roles")] == ["a" * 32]
    assert db.query("SELECT COUNT(*) AS n FROM channels WHERE private != 0")[0]["n"] == 0
    assert db.query("SELECT scope FROM uploads WHERE id = 'p.webp'")[0]["scope"] == f"channel:{channel_id}"
    # A second start changes nothing.
    monkeypatch.setattr(db, "_db", threading.local())
    db.init_db()
    assert len(db.query("SELECT * FROM roles")) == 1
