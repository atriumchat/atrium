"""Errors carry a stable `code` for the web client's own translation, next to the Russian `detail` old clients read.
Run: .venv/bin/pytest"""

import pytest

from gomex.channels import message_body
from gomex.db import execute
from gomex.errors import Rejected, socket_error, socket_rejected


def test_http_error_has_code_and_russian_detail(client):
    r = client.post("/api/login", json={"name": "Никто", "password": "неверный пароль"})
    assert r.status_code == 401
    assert r.json() == {"detail": "Неверный ник или пароль", "code": "badCredentials"}


def test_needs_sign_in_code(client):
    r = client.get("/api/friends", headers={"Authorization": "Bearer nope"})
    assert r.status_code == 401
    assert r.json()["code"] == "sessionExpired"


def test_params_travel_with_the_code(client):
    for _ in range(40):
        r = client.post("/api/login", json={"name": "Никто", "password": "x" * 12})
        if r.status_code == 429:
            break
    body = r.json()
    assert r.status_code == 429
    assert body["code"] == "tooManyTries"
    assert body["params"]["minutes"] >= 1 and body["params"]["seconds"] >= 1
    assert "Слишком много попыток" in body["detail"]


def test_plain_404_stays_plain(client):
    r = client.get("/api/definitely-not-here")
    assert "code" not in r.json()


def test_socket_helpers_keep_old_error_field():
    assert socket_error("tooFast", "Слишком часто, пауза пару секунд") == {
        "ok": False,
        "error": "Слишком часто, пауза пару секунд",
        "code": "tooFast",
    }
    assert socket_rejected(Rejected("tooManyImages", "text", n=4)) == {"ok": False, "error": "text", "code": "tooManyImages", "params": {"n": 4}}


def test_message_body_rejects_with_codes():
    execute("INSERT OR IGNORE INTO users (id, name, password_hash, created_at) VALUES ('u-codes', 'Коды', 'x', 0)") if False else None
    with pytest.raises(Rejected) as e:
        message_body("u-codes", {"content": "   "})
    assert e.value.code == "badMessage"
    assert "Пустое" in str(e.value)
    with pytest.raises(Rejected) as e:
        message_body("u-codes", {"content": "x", "attachments": ["a"] * 50})
    assert e.value.code == "tooManyImages" and e.value.params["n"] > 0
    with pytest.raises(Rejected) as e:
        message_body("u-codes", {"content": "x", "attachments": ["missing"]})
    assert e.value.code == "fileMissing"
