"""Message pins and explicit unread markers share conversation ACLs."""
from atrium import db
from test_roles import bearer, make_channel, server, uid
from test_message_search import insert


def test_pin_and_manual_unread(server):
    client, people, _ = server
    admin, reader = bearer(people["admin"]), bearer(people["alice"])
    room = make_channel(client, people["admin"], "tools")["id"]
    for mid in ("a", "b", "c"):
        insert("messages", room, uid(people, "admin"), mid, mid)
    pins = f"/api/channels/{room}/pins"
    assert client.put(pins + "/b", headers=reader, json={"pinned": True}).status_code == 403
    assert client.put(pins + "/b", headers=admin, json={"pinned": True}).is_success
    assert [m["id"] for m in client.get(pins, headers=reader).json()] == ["b"]
    marker = client.post("/api/messages/b/unread", headers=reader).json()
    assert (marker["first"], marker["count"]) == ("b", 2)
    def read(token=None):
        assert client.post("/api/read", headers=reader, json={"conversationId": room, "at": db.now_ms(), "marker": token}).is_success
    read()
    assert client.get("/api/bootstrap", headers=reader).json()["firstUnread"][room] == "b"
    newer = client.post("/api/messages/c/unread", headers=reader).json()
    read(marker["token"])
    assert client.get("/api/bootstrap", headers=reader).json()["firstUnread"][room] == "c"
    read(newer["token"])
    assert room not in client.get("/api/bootstrap", headers=reader).json()["unread"]
    assert client.put(f"/api/channels/{room}/access", headers=admin, json={"private": True, "userIds": []}).is_success
    assert client.get(pins, headers=reader).status_code == 404
    assert client.post("/api/messages/c/unread", headers=reader).status_code == 404
    db.execute("DELETE FROM messages WHERE id='b'")
    assert client.get(pins, headers=admin).json() == []
