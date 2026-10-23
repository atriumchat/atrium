"""Kick and ban: the admin takes someone off the server; a kicked person comes back by a new invite. Run: .venv/bin/pytest"""

import secrets

import pytest

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


def invite(client, admin) -> str:
    return client.get("/api/invite", headers=admin).json()["code"]


def member(client, admin) -> tuple[str, str, dict]:
    name = f"Гость{secrets.randbelow(10**6)}"
    r = client.post("/api/register", json={"invite": invite(client, admin), "name": name, "password": PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()["user"]["id"], name, bearer(r.json()["token"])


def login(client, name, password=PASSWORD):
    return client.post("/api/login", json={"name": name, "password": password})


def test_kicked_is_out_and_back_by_a_new_invite(client, admin):
    user_id, name, token = member(client, admin)
    their_invite = invite(client, token)

    kicked = client.post(f"/api/users/{user_id}/kick", headers=admin)
    assert kicked.status_code == 200 and kicked.json()["removed"] == "kicked"
    assert client.get("/api/bootstrap", headers=token).status_code == 401
    assert login(client, name).json()["code"] == "kicked"
    # Their link went with them.
    assert client.get(f"/api/invite/check/{their_invite}").status_code == 404
    # Someone else can't take the account over by its nick.
    taken = client.post("/api/register", json={"invite": invite(client, admin), "name": name, "password": "another password 1"})
    assert taken.status_code == 409

    back = client.post("/api/register", json={"invite": invite(client, admin), "name": name, "password": PASSWORD})
    assert back.status_code == 200, back.text
    assert back.json()["user"]["id"] == user_id and "removed" not in back.json()["user"]
    assert client.get("/api/bootstrap", headers=bearer(back.json()["token"])).status_code == 200


def test_banned_stays_out_until_let_back(client, admin):
    user_id, name, token = member(client, admin)
    assert client.post(f"/api/users/{user_id}/ban", headers=admin).json()["removed"] == "banned"
    assert client.get("/api/bootstrap", headers=token).status_code == 401
    assert login(client, name).json()["code"] == "banned"
    again = client.post("/api/register", json={"invite": invite(client, admin), "name": name, "password": PASSWORD})
    assert again.status_code == 409
    users = {u["id"]: u for u in client.get("/api/bootstrap", headers=admin).json()["users"]}
    assert users[user_id]["removed"] == "banned"

    assert "removed" not in client.delete(f"/api/users/{user_id}/removed", headers=admin).json()
    assert login(client, name).status_code == 200


def test_only_the_admin_and_never_an_admin(client, admin):
    user_id, _, token = member(client, admin)
    other_id, _, _ = member(client, admin)
    assert client.post(f"/api/users/{other_id}/kick", headers=token).status_code == 403
    admin_id = client.get("/api/bootstrap", headers=admin).json()["me"]["id"]
    assert client.post(f"/api/users/{admin_id}/ban", headers=admin).status_code == 403
    assert client.post(f"/api/users/{user_id}/kick", headers=admin).status_code == 200
    assert client.post(f"/api/users/{user_id}/reset-link", headers=admin).status_code == 409
