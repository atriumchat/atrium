"""The call quality report: one log line, clamped numbers, rate limit. Run: .venv/bin/pytest"""

import pytest

from atrium import realtime

PASSWORD = "correct horse battery"


def bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
def fresh_limit():
    # The shared fixture only resets the limits in atrium.auth; this one lives in atrium.realtime.
    realtime.CALL_QUALITY_BY_USER.hits.clear()


@pytest.fixture(scope="module")
def admin(client):
    # The server is set up once per run: this file sorts after test_recovery, which may have done it.
    r = client.post("/api/setup", json={"code": "friends", "serverName": "Тест", "name": "Админ", "password": PASSWORD})
    if r.status_code != 200:
        r = client.post("/api/login", json={"name": "Админ", "password": PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def voice_room(client, admin):
    channels = client.get("/api/bootstrap", headers=bearer(admin["token"])).json()["channels"]
    return next(c["id"] for c in channels if c["kind"] == "voice")


def test_report_becomes_one_log_line(client, admin, voice_room, capsys):
    body = {
        "channelId": voice_room, "when": "leave", "transport": "relay/turn-tls", "lossIn": 2.14, "lossInWorst": 5,
        "jitter": 31.2, "jitterWorst": 80, "rtt": 84, "lossOut": 0.4, "screenAudio": True,
    }
    r = client.post("/api/call-quality", json=body, headers=bearer(admin["token"]))
    assert r.status_code == 200, r.text
    lines = [l for l in capsys.readouterr().out.splitlines() if l.startswith("call quality:")]
    assert len(lines) == 1
    assert f"user={admin['user']['id']} room={voice_room} at=leave transport=relay/turn-tls" in lines[0]
    assert "loss_in=2.1% " in lines[0] and "jitter_in=31.2ms" in lines[0] and "rtt=84ms" in lines[0]
    assert "loss_out=0.4% screen_audio=yes" in lines[0]


def test_numbers_are_clamped_and_text_is_not_trusted(client, admin, voice_room, capsys):
    body = {"channelId": voice_room, "transport": "x\ny=1", "lossIn": 900, "jitter": -5, "rtt": 1e12}
    assert client.post("/api/call-quality", json=body, headers=bearer(admin["token"])).status_code == 200
    out = capsys.readouterr().out
    line = next(l for l in out.splitlines() if l.startswith("call quality:"))
    assert "transport=? loss_in=100% " in line and "jitter_in=0ms" in line and "rtt=60000ms" in line
    assert "loss_out=-" in line and "y=1" not in out


def test_needs_a_login_and_a_real_room(client, admin):
    assert client.post("/api/call-quality", json={"channelId": "x"}).status_code == 401
    r = client.post("/api/call-quality", json={"channelId": "nope"}, headers=bearer(admin["token"]))
    assert r.status_code == 404


def test_rate_limited(client, admin, voice_room):
    codes = [client.post("/api/call-quality", json={"channelId": voice_room}, headers=bearer(admin["token"])).status_code for _ in range(12)]
    assert codes[:10] == [200] * 10 and codes[10] == 429
