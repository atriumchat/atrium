"""Recovery key at sign-up, recovery with it, and the admin's one-time reset link. Run: .venv/bin/pytest"""

import re

import pytest

from atrium.db import execute, now_ms

KEY_FORMAT = re.compile(r"^([A-Z2-9]{4}-){3}[A-Z2-9]{4}$")
PASSWORD = "correct horse battery"


def bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def server(client):
    """A set-up server: the admin, plus a member who signed up with the admin's invite."""
    r = client.post("/api/setup", json={"code": "friends", "serverName": "Тест", "name": "Админ", "password": PASSWORD})
    if r.status_code == 409:  # another test file set the server up first, with the same admin
        r = client.post("/api/login", json={"name": "Админ", "password": PASSWORD})
    assert r.status_code == 200, r.text
    admin = r.json()
    code = client.get("/api/invite", headers=bearer(admin["token"])).json()["code"]
    r = client.post("/api/register", json={"invite": code, "name": "Лена", "password": PASSWORD})
    assert r.status_code == 200, r.text
    return {"admin": admin, "member": r.json(), "invite": code}


def test_sign_up_returns_a_key_that_recovers(client, server):
    member = server["member"]
    assert KEY_FORMAT.match(member["recoveryKey"])
    assert member["serverName"] == "Тест"
    me = client.get("/api/bootstrap", headers=bearer(member["token"])).json()
    assert me["hasRecoveryKey"] is True and me["isAdmin"] is False

    # Lower case and no dashes are what people type.
    typed = member["recoveryKey"].lower().replace("-", "")
    r = client.post("/api/recover", json={"name": "Лена", "key": typed, "password": "second password"})
    assert r.status_code == 200, r.text
    # The key is spent and replaced by the next one; the old session is over.
    assert r.json()["recoveryKey"] != member["recoveryKey"]
    assert client.post("/api/recover", json={"name": "Лена", "key": typed, "password": PASSWORD}).status_code == 401
    assert client.get("/api/bootstrap", headers=bearer(member["token"])).status_code == 401
    assert client.post("/api/login", json={"name": "Лена", "password": "second password"}).status_code == 200


def test_old_long_keys_still_work(client, server):
    from atrium.auth import hash_password
    from atrium.users import normalize_key

    long_key = "ABCD-EFGH-JKMN-PQRS-TUVW-XYZ2-3456-789A"
    execute("UPDATE users SET recovery_hash = ? WHERE name = 'Лена'", (hash_password(normalize_key(long_key)),))
    r = client.post("/api/recover", json={"name": "Лена", "key": long_key, "password": PASSWORD})
    assert r.status_code == 200 and KEY_FORMAT.match(r.json()["recoveryKey"])


def test_reset_link_flow(client, server):
    admin, member = server["admin"], server["member"]
    r = client.post(f"/api/users/{member['user']['id']}/reset-link", headers=bearer(admin["token"]))
    assert r.status_code == 200, r.text
    token = r.json()["token"]
    assert 0 < r.json()["expiresAt"] - now_ms() <= 24 * 3600 * 1000

    # Only the hash is stored.
    assert token not in str(execute.__globals__["query"]("SELECT * FROM password_resets"))

    assert client.post("/api/reset/check", json={"token": token}).json() == {"name": "Лена"}
    before = client.post("/api/login", json={"name": "Лена", "password": PASSWORD}).json()["token"]

    assert client.post("/api/reset", json={"token": token, "password": "short"}).status_code == 422
    r = client.post("/api/reset", json={"token": token, "password": "brand new password"})
    assert r.status_code == 200, r.text
    assert KEY_FORMAT.match(r.json()["recoveryKey"])
    assert client.get("/api/bootstrap", headers=bearer(r.json()["token"])).status_code == 200
    # Other sessions are over, the new password works, the old doesn't, and the link is spent.
    assert client.get("/api/bootstrap", headers=bearer(before)).status_code == 401
    assert client.post("/api/login", json={"name": "Лена", "password": "brand new password"}).status_code == 200
    assert client.post("/api/login", json={"name": "Лена", "password": PASSWORD}).status_code == 401
    assert client.post("/api/reset", json={"token": token, "password": "another password"}).status_code == 404
    assert client.post("/api/reset/check", json={"token": token}).status_code == 404


def test_a_newer_link_replaces_the_older(client, server):
    admin, member = server["admin"], server["member"]
    url = f"/api/users/{member['user']['id']}/reset-link"
    first = client.post(url, headers=bearer(admin["token"])).json()["token"]
    second = client.post(url, headers=bearer(admin["token"])).json()["token"]
    assert client.post("/api/reset/check", json={"token": first}).status_code == 404
    assert client.post("/api/reset/check", json={"token": second}).status_code == 200


def test_expired_link_does_not_work(client, server):
    admin, member = server["admin"], server["member"]
    token = client.post(f"/api/users/{member['user']['id']}/reset-link", headers=bearer(admin["token"])).json()["token"]
    execute("UPDATE password_resets SET expires_at = ?", (now_ms() - 1,))
    assert client.post("/api/reset/check", json={"token": token}).status_code == 404
    assert client.post("/api/reset", json={"token": token, "password": "brand new password"}).status_code == 404


def test_only_the_admin_makes_links(client, server):
    admin, member = server["admin"], server["member"]
    login = client.post("/api/login", json={"name": "Лена", "password": "brand new password"}).json()
    # A member can't, not even for themselves; nobody can for an unknown id; the admin can for themselves.
    assert client.post(f"/api/users/{admin['user']['id']}/reset-link", headers=bearer(login["token"])).status_code == 403
    assert client.post(f"/api/users/{member['user']['id']}/reset-link", headers=bearer(login["token"])).status_code == 403
    assert client.post("/api/users/nope/reset-link", headers=bearer(admin["token"])).status_code == 404
    assert client.post(f"/api/users/{admin['user']['id']}/reset-link", headers=bearer(admin["token"])).status_code == 200
    assert client.get("/api/bootstrap", headers=bearer(admin["token"])).json()["isAdmin"] is True
