"""Guest mode, for a public demo: in without a form, as "Guest NNNN". Run: .venv/bin/pytest"""

import pytest

from atrium import auth, users

PASSWORD = "correct horse battery"


def bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def admin(client):
    r = client.post("/api/setup", json={"code": "friends", "serverName": "Тест", "name": "Админ", "password": PASSWORD})
    if r.status_code == 409:  # another test file set the server up first, with the same admin
        r = client.post("/api/login", json={"name": "Админ", "password": PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()


def test_off_by_default(client, admin):
    assert client.get("/api/setup").json()["guest"] is False
    assert client.post("/api/guest", json={}).status_code == 404


def test_a_guest_gets_in_renames_and_is_the_admins_friend(client, admin, monkeypatch):
    monkeypatch.setattr(users, "GUEST_MODE", True)
    assert client.get("/api/setup").json()["guest"] is True

    r = client.post("/api/guest", json={})
    assert r.status_code == 200, r.text
    session = r.json()
    assert session["user"]["name"].startswith("Guest ")
    # No recovery key: there's no password anyone knows to recover.
    assert "recoveryKey" not in session

    me = bearer(session["token"])
    friends = client.get("/api/friends", headers=me).json()
    assert [f["userId"] for f in friends if f["status"] == "friend"] == [admin["user"]["id"]]
    assert client.get("/api/bootstrap", headers=me).json()["isGuest"] is True
    assert client.patch("/api/me/name", json={"name": "Visitor"}, headers=me).status_code == 200
    assert client.get("/api/bootstrap", headers=me).json()["me"]["name"] == "Visitor"


def test_guests_count_against_the_sign_up_limit(client, admin, monkeypatch):
    monkeypatch.setattr(users, "GUEST_MODE", True)
    try:
        codes = [client.post("/api/guest", json={}).status_code for _ in range(7)]
        assert codes[:6] == [200] * 6
        assert codes[6] == 429
    finally:
        # The next file's module fixture signs up before the per-test reset runs.
        auth.REGISTER_BY_IP.hits.clear()
