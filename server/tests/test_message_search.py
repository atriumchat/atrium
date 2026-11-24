"""Search uses live membership, indexes old history, and opens a bounded neighborhood."""
import sqlite3
from time import perf_counter

from atrium import db
from test_roles import bearer, give_roles, make_channel, make_role, server, uid


def search(client, session, **params):
    response = client.get("/api/messages/search", params=params, headers=bearer(session))
    assert response.status_code == 200, response.text
    return response.json()


def insert(table, conversation, author, message, content, attachments="[]"):
    column = "dm_id" if table == "dm_messages" else "channel_id"
    db.execute(f"""INSERT INTO {table}(id,{column},user_id,content,created_at,attachments)
                   VALUES(?,?,?,?,?,?)""", (message, conversation, author, content, 100, attachments))


def test_search_visibility_and_membership(server):
    client, people, _ = server
    admin, alice, bob = (people[key] for key in ("admin", "alice", "bob"))
    private = make_channel(client, admin, "private", private=True)["id"]
    dm = client.post("/api/dms", headers=bearer(admin), json={"userId": uid(people, "alice")}).json()["id"]
    group = client.post("/api/groups", headers=bearer(admin), json={"userIds": [uid(people, x) for x in ("alice", "carol")]}).json()["id"]
    access = f"/api/channels/{private}/access"
    assert client.put(access, headers=bearer(admin), json={"private": True, "userIds": [uid(people, "alice")]}).is_success
    for table, conv, mid in (("messages", private, "private-msg"), ("dm_messages", dm, "dm-msg"), ("dm_messages", group, "group-msg")):
        insert(table, conv, uid(people, "admin"), mid, "История проекта")
    assert {r["id"] for r in search(client, alice, q="ПРОЕК ист")} == {"private-msg", "dm-msg", "group-msg"}
    assert search(client, bob, q="проект") == []
    assert client.delete(f"/api/groups/{group}/members/me", headers=bearer(alice)).is_success
    assert client.put(access, headers=bearer(admin), json={"private": True, "userIds": []}).is_success
    assert [r["id"] for r in search(client, alice, q="проект")] == ["dm-msg"]
    for mid in ("private-msg", "group-msg"):
        assert client.get(f"/api/messages/{mid}/context", headers=bearer(alice)).status_code == 404
    assert client.get("/api/messages/dm-msg/context", headers=bearer(alice)).is_success
    assert client.get("/api/messages/dm-msg/context", headers=bearer(bob)).status_code == 404
    assert {r["id"] for r in search(client, admin, q="проект")} == {"private-msg", "dm-msg", "group-msg"}
    role = make_role(client, admin, "readers")
    assert client.put(access, headers=bearer(admin), json={"private": True, "roleIds": [role["id"]]}).is_success
    assert give_roles(client, admin, uid(people, "bob"), [role["id"]]).is_success
    assert [r["id"] for r in search(client, bob, q="проект")] == ["private-msg"]
    assert give_roles(client, admin, uid(people, "bob"), []).is_success
    assert search(client, bob, q="проект") == []
    # One-to-one DMs have no leave action. Removing an account revokes its sessions, including DM search.
    assert client.post(f"/api/users/{uid(people, 'alice')}/remove", headers=bearer(admin)).is_success
    assert client.get("/api/messages/search", params={"conversation": dm}, headers=bearer(alice)).status_code in (401, 403)
    assert client.delete(f"/api/channels/{private}", headers=bearer(admin)).is_success
    assert search(client, admin, conversation=private) == []
    assert client.get("/api/messages/private-msg/context", headers=bearer(admin)).status_code == 404


def test_filters_and_index_updates(server):
    client, people, _ = server
    admin, alice = people["admin"], people["alice"]
    public = make_channel(client, admin, "public")["id"]
    dm = client.post("/api/dms", headers=bearer(admin), json={"userId": uid(people, "alice")}).json()["id"]
    insert("messages", public, uid(people, "alice"), "link", "Ревизия https://example.org/a")
    insert("dm_messages", dm, uid(people, "admin"), "file", "Ревизия", '[{"name":"file.txt"}]')
    assert [r["id"] for r in search(client, admin, file=True)] == ["file"]
    assert [r["id"] for r in search(client, admin, q="рев", link=True, author=uid(people, "alice"), conversation=public)] == ["link"]
    assert search(client, admin, q="рев", file=True, link=True) == []
    for table, mid in (("messages", "link"), ("dm_messages", "file")):
        db.execute(f"UPDATE {table} SET content = 'Обновлено' WHERE id = ?", (mid,))
        assert mid not in [r["id"] for r in search(client, admin, q="ревизия")]
        assert mid in [r["id"] for r in search(client, admin, q="ОБНОВ")]
        db.execute(f"DELETE FROM {table} WHERE id = ?", (mid,))
        assert search(client, admin, q="обнов") == []
        assert client.get(f"/api/messages/{mid}/context", headers=bearer(admin)).status_code == 404


def test_deep_context_and_keyset_pagination(server):
    client, people, _ = server
    admin = people["admin"]
    channel = make_channel(client, admin, "archive")["id"]
    author = uid(people, "admin")
    with db.connect_db() as conn:
        conn.executemany("""INSERT INTO messages(id,channel_id,user_id,content,created_at) VALUES(?,?,?,?,?)""",
                         ((f"m{i:06}", channel, author, "Архив" if i < 81 else "later", 100)
                          for i in range(100_101)))
    hits = search(client, admin, q="арх")
    assert [r["id"] for r in hits] == [f"m{i:06}" for i in range(80, 40, -1)]
    page = search(client, admin, q="арх", before=hits[-1]["createdAt"], beforeId=hits[-1]["id"])
    assert page[0]["id"] == "m000040" and page[-1]["id"] == "m000001"
    start = perf_counter()
    response = client.get("/api/messages/m000030/context", headers=bearer(admin))
    elapsed = perf_counter() - start
    assert response.status_code == 200, response.text
    assert [m["id"] for m in response.json()] == [f"m{i:06}" for i in range(10, 51)]
    print(f"100,101 messages, single HTTP context request: {elapsed * 1000:.1f} ms")


def test_backfills_existing_rows_once():
    with sqlite3.connect(":memory:") as conn:
        for table, column in (("messages", "channel_id"), ("dm_messages", "dm_id")):
            conn.execute(f"CREATE TABLE {table}(id TEXT PRIMARY KEY, {column} TEXT, created_at INTEGER, content TEXT)")
            conn.execute(f"INSERT INTO {table} VALUES ('old', 'room', 0, 'История')")
        db.init_message_search(conn)
        db.init_message_search(conn)
        for table in ("messages", "dm_messages"):
            assert conn.execute(f"SELECT content FROM {table}_fts WHERE {table}_fts MATCH 'история'").fetchall() == [("История",)]
