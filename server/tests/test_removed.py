"""Taking someone off the server: out at once and not back in until the admin lets them. Run: .venv/bin/pytest"""

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


def invite(client, headers) -> str:
    return client.get("/api/invite", headers=headers).json()["code"]


def member(client, admin) -> tuple[str, str, dict]:
    name = f"Гость{secrets.randbelow(10**6)}"
    r = client.post("/api/register", json={"invite": invite(client, admin), "name": name, "password": PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()["user"]["id"], name, bearer(r.json()["token"])


def login(client, name):
    return client.post("/api/login", json={"name": name, "password": PASSWORD})


def test_removed_is_out_until_let_back(client, admin):
    user_id, name, token = member(client, admin)
    their_invite = invite(client, token)

    gone = client.post(f"/api/users/{user_id}/remove", headers=admin)
    assert gone.status_code == 200 and gone.json()["removed"] is True
    assert client.get("/api/bootstrap", headers=token).status_code == 401
    assert login(client, name).json()["code"] == "removed"
    # Their link went with them, and a new invite doesn't bring them back.
    assert client.get(f"/api/invite/check/{their_invite}").status_code == 404
    again = client.post("/api/register", json={"invite": invite(client, admin), "name": name, "password": PASSWORD})
    assert again.status_code == 409
    users = {u["id"]: u for u in client.get("/api/bootstrap", headers=admin).json()["users"]}
    assert users[user_id]["removed"] is True

    assert "removed" not in client.delete(f"/api/users/{user_id}/removed", headers=admin).json()
    assert login(client, name).status_code == 200


def test_only_the_admin_and_never_an_admin(client, admin):
    user_id, _, token = member(client, admin)
    other_id, _, _ = member(client, admin)
    assert client.post(f"/api/users/{other_id}/remove", headers=token).status_code == 403
    admin_id = client.get("/api/bootstrap", headers=admin).json()["me"]["id"]
    assert client.post(f"/api/users/{admin_id}/remove", headers=admin).status_code == 403
    assert client.post(f"/api/users/{user_id}/remove", headers=admin).status_code == 200
    assert client.post(f"/api/users/{user_id}/reset-link", headers=admin).status_code == 409
