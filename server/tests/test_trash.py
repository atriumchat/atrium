"""A deleted channel waits a week in the trash: hidden for everyone, back with its messages, then gone. Run: .venv/bin/pytest"""

import pytest

from atrium.channels import TRASH_TTL_MS, purge_deleted_channels
from atrium.db import execute, now_ms, query

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


def names(client, admin):
    return [c["name"] for c in client.get("/api/bootstrap", headers=admin).json()["channels"]]


def test_delete_hide_restore_purge(client, admin):
    channels = client.post("/api/channels", json={"name": "Заметки", "kind": "text"}, headers=admin).json()
    channel = next(c for c in channels if c["name"] == "заметки")
    execute(
        "INSERT INTO messages (id, channel_id, user_id, content, attachments, created_at) VALUES ('m1', ?, (SELECT id FROM users LIMIT 1), 'hi', '[]', ?)",
        (channel["id"], now_ms()),
    )

    assert client.delete(f"/api/channels/{channel['id']}", headers=admin).status_code == 200
    assert "заметки" not in names(client, admin)
    assert client.get(f"/api/channels/{channel['id']}/messages", headers=admin).status_code == 404
    trash = client.get("/api/channels/deleted", headers=admin).json()
    assert [(c["name"], c["messages"]) for c in trash] == [("заметки", 1)]

    restored = client.post(f"/api/channels/{channel['id']}/restore", headers=admin).json()
    assert "заметки" in [c["name"] for c in restored]
    assert client.get(f"/api/channels/{channel['id']}/messages", headers=admin).json()[0]["content"] == "hi"
    assert client.get("/api/channels/deleted", headers=admin).json() == []

    client.delete(f"/api/channels/{channel['id']}", headers=admin)
    assert purge_deleted_channels() == 0
    execute("UPDATE channels SET deleted_at = ? WHERE id = ?", (now_ms() - TRASH_TTL_MS - 1000, channel["id"]))
    assert purge_deleted_channels() == 1
    assert query("SELECT 1 FROM channels WHERE id = ?", (channel["id"],)) == []
    assert query("SELECT 1 FROM messages WHERE channel_id = ?", (channel["id"],)) == []
    assert client.post(f"/api/channels/{channel['id']}/restore", headers=admin).status_code == 404


def test_last_text_channel_stays(client, admin):
    texts = [c for c in client.get("/api/bootstrap", headers=admin).json()["channels"] if c["kind"] == "text"]
    for c in texts[:-1]:
        assert client.delete(f"/api/channels/{c['id']}", headers=admin).status_code == 200
    assert client.delete(f"/api/channels/{texts[-1]['id']}", headers=admin).status_code == 400
