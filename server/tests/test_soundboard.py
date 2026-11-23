"""A personal soundboard: uploads transcoded to Opus, sounds kept on the server, played in a voice call, and who may
load their files. Run: python -m pytest -q server/tests"""

import asyncio
import os
import shutil
import subprocess
import threading
import time

import pytest
from fastapi.testclient import TestClient

from atrium import auth, db, realtime, sounds, uploads
from atrium.config import INVITE_CODE, MEDIA_COOKIE

PASSWORD = "original-password-123"
FFMPEG = shutil.which("ffmpeg")
FFPROBE = shutil.which("ffprobe")
# Every upload goes through ffmpeg now, so without it there is nothing to test.
pytestmark = pytest.mark.skipif(FFMPEG is None, reason="ffmpeg is not installed: the soundboard transcodes uploads with it")


def bearer(session):
    return {"Authorization": f"Bearer {session['token']}"}


def media_headers(people, key):
    """The file endpoint loads through the media cookie, not the Bearer header."""
    return {"Cookie": f"{MEDIA_COOKIE}={auth.issue_token(people[key]['user']['id'], scope='media')}"}


def in_call(people, key, channel_id):
    realtime.voice[f"sid-{key}"] = {"channelId": channel_id, "userId": people[key]["user"]["id"], "kind": "channel"}


def make_audio(source, fmt, *extra):
    """Real audio from ffmpeg's own test sources, straight to a pipe: the transcoder needs something it can read."""
    command = [FFMPEG, "-nostdin", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", source, *extra, "-f", fmt, "pipe:1"]
    return subprocess.run(command, capture_output=True, check=True).stdout


def probe_channels(path):
    """How many channels the stored file has, read back with ffprobe."""
    command = [
        FFPROBE, "-hide_banner", "-loglevel", "error", "-i", str(path),
        "-select_streams", "a:0", "-show_entries", "stream=channels", "-of", "csv=p=0",
    ]
    return int(subprocess.run(command, capture_output=True, check=True).stdout.decode().strip())


@pytest.fixture(scope="session")
def audio():
    """A second of mono mp3 and wav, and seventy seconds of stereo mp3 to be cut down."""
    return {
        "mp3": make_audio("sine=frequency=440:duration=1", "mp3"),
        "wav": make_audio("sine=frequency=330:duration=1", "wav"),
        "long": make_audio("sine=frequency=220:duration=250", "mp3", "-ac", "2"),
    }


class Emits(list):
    """Stands in for sio.emit: keeps (event, data, to, skip_sid)."""

    async def __call__(self, event, data=None, to=None, skip_sid=None, **kwargs):
        self.append((event, data, to, skip_sid))

    def played_to(self):
        """The `to` list of the last sound:played broadcast."""
        return [to for event, _, to, _ in self if event == "sound:played"][-1]


@pytest.fixture
def server(tmp_path, monkeypatch):
    from app import app

    monkeypatch.setattr(db, "DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr(db, "_db", threading.local())
    # Sound files go to a temp dir: nothing is left in the real data folder.
    monkeypatch.setattr(sounds, "SOUND_DIR", tmp_path / "sounds")
    monkeypatch.setattr(uploads, "SOUND_DIR", tmp_path / "sounds")
    (tmp_path / "sounds").mkdir()
    db.init_db()
    for name in ("online", "voice", "calls"):
        monkeypatch.setattr(realtime, name, {})
    emits = Emits()
    monkeypatch.setattr(realtime.sio, "emit", emits)
    with TestClient(app) as client:
        r = client.post("/api/setup", json={"code": INVITE_CODE, "serverName": "Sounds", "name": "Admin", "password": PASSWORD})
        assert r.status_code == 200, r.text
        people = {"admin": r.json()}
        invite = client.get("/api/invite", headers=bearer(people["admin"])).json()["code"]
        for name in ("Alice", "Bob", "Carol"):
            r = client.post("/api/register", json={"invite": invite, "name": name, "password": PASSWORD})
            assert r.status_code == 200, r.text
            people[name.lower()] = r.json()
        sessions = {}
        for key, session in people.items():
            realtime.online[f"sid-{key}"] = session["user"]["id"]
            sessions[f"sid-{key}"] = {"user": client.get("/api/bootstrap", headers=bearer(session)).json()["me"]}

        async def get_session(sid):
            return sessions[sid]

        monkeypatch.setattr(realtime.sio, "get_session", get_session)
        # Register left the last person's media cookie in the jar; the tests set it per request instead.
        client.cookies.clear()
        emits.clear()
        yield client, people, emits


def upload(client, session, data, name="Sound", emoji="", volume=None):
    params = {"name": name}
    if emoji:
        params["emoji"] = emoji
    if volume is not None:
        params["volume"] = volume
    return client.post("/api/sounds", params=params, content=data, headers=bearer(session))


def test_upload_shows_in_the_list_and_bad_files_are_refused(server, audio):
    client, people, _ = server
    admin = people["admin"]
    r = upload(client, admin, audio["mp3"], name="Hello", emoji="🔥", volume=0.5)
    assert r.status_code == 200, r.text
    sound = r.json()
    assert set(sound) == {"id", "userId", "name", "emoji", "volume", "url", "durationMs", "trimmed", "createdAt"}
    assert sound["userId"] == admin["user"]["id"]
    assert sound["name"] == "Hello" and sound["emoji"] == "🔥" and sound["volume"] == 0.5
    assert sound["url"] == f"/api/sounds/{sound['id']}/file"
    assert abs(sound["durationMs"] - 1000) < 200 and sound["trimmed"] is False

    listed = client.get("/api/sounds", headers=bearer(admin)).json()
    assert [s["id"] for s in listed] == [sound["id"]]
    assert listed[0]["durationMs"] == sound["durationMs"] and listed[0]["trimmed"] is False

    # The kind comes from the first bytes only: the name and the claimed type are ignored.
    png = client.post("/api/sounds", params={"name": "x"}, content=b"\x89PNG\r\n\x1a\n" + b"\0" * 50, headers={**bearer(admin), "Content-Type": "audio/mpeg"})
    assert png.status_code == 415 and png.json()["code"] == "badSound"
    assert client.post("/api/sounds", params={"name": "x"}, content=b"just some text", headers=bearer(admin)).status_code == 415
    # An mp3 header on top of rubbish: it passes the sniff, and ffmpeg refuses to read it.
    garbage = client.post("/api/sounds", params={"name": "x"}, content=b"ID3" + b"\0" * 100, headers=bearer(admin))
    assert garbage.status_code == 415 and garbage.json()["code"] == "badSound"

    big = upload(client, admin, b"ID3" + b"\0" * (50 * 1024 * 1024), name="big")
    assert big.status_code == 413 and big.json()["code"] == "soundTooBig"

    assert client.post("/api/sounds", content=audio["mp3"], headers=bearer(admin)).json()["code"] == "emptyName"
    bad = upload(client, admin, audio["mp3"], name="ok", emoji="hello")
    assert bad.status_code == 400 and bad.json()["code"] == "notEmoji"
    assert upload(client, admin, audio["mp3"], name="x" * 100).json()["name"] == "x" * 32


def test_an_mp3_is_stored_as_mono_opus_ogg(server, audio):
    client, people, _ = server
    sound = upload(client, people["admin"], audio["mp3"], name="Mp3").json()
    assert abs(sound["durationMs"] - 1000) < 200
    stored = sounds.SOUND_DIR / f"{sound['id']}.ogg"
    assert stored.is_file()
    assert probe_channels(stored) == 1, "a mono source stays mono at 64 kbit/s"
    # The upload was written as a temp file beside the output; it must not survive.
    assert not list(sounds.SOUND_DIR.glob(f".{sound['id']}.*"))


def test_a_wav_is_stored_as_opus_ogg(server, audio):
    client, people, _ = server
    sound = upload(client, people["admin"], audio["wav"], name="Wav").json()
    assert abs(sound["durationMs"] - 1000) < 200 and sound["trimmed"] is False
    assert (sounds.SOUND_DIR / f"{sound['id']}.ogg").is_file()
    assert not (sounds.SOUND_DIR / f"{sound['id']}.wav").exists()
    r = client.get(sound["url"], headers=media_headers(people, "admin"))
    assert r.status_code == 200
    assert r.content[:4] == b"OggS" and r.headers["content-type"] == "audio/ogg"


def test_a_source_longer_than_four_minutes_is_trimmed(server, audio):
    client, people, _ = server
    sound = upload(client, people["admin"], audio["long"], name="Song").json()
    assert sound["trimmed"] is True
    assert 239_000 <= sound["durationMs"] <= 241_000
    stored = sounds.SOUND_DIR / f"{sound['id']}.ogg"
    assert probe_channels(stored) == 2, "a stereo source is kept stereo at 128 kbit/s"


def test_a_volume_that_is_not_a_number_becomes_full(server, audio):
    client, people, _ = server
    # "nan" parses as a float; it must not reach the database.
    r = upload(client, people["admin"], audio["mp3"], name="Odd", volume="nan")
    assert r.status_code == 200, r.text
    assert r.json()["volume"] == 1.0


def test_a_twenty_first_sound_is_refused(server, audio):
    client, people, _ = server
    admin = people["admin"]
    for i in range(20):
        assert upload(client, admin, audio["mp3"], name=f"sound {i}").status_code == 200
    over = upload(client, admin, audio["mp3"], name="one too many")
    assert over.status_code == 409
    assert over.json()["code"] == "tooManySounds" and over.json()["params"]["n"] == 20


def test_editing_and_deleting_are_the_owners_only(server, audio):
    client, people, _ = server
    admin, alice = people["admin"], people["alice"]
    sound = upload(client, admin, audio["mp3"]).json()
    path = sounds.SOUND_DIR / f"{sound['id']}.ogg"
    assert path.is_file()

    assert client.patch(f"/api/sounds/{sound['id']}", json={"name": "чужое"}, headers=bearer(alice)).status_code == 404
    assert client.delete(f"/api/sounds/{sound['id']}", headers=bearer(alice)).status_code == 404

    r = client.patch(f"/api/sounds/{sound['id']}", json={"name": "  My  Sound  ", "emoji": "👏", "volume": 5}, headers=bearer(admin))
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "My Sound" and r.json()["emoji"] == "👏" and r.json()["volume"] == 1.0
    assert path.is_file(), "editing keeps the file"

    assert client.delete(f"/api/sounds/{sound['id']}", headers=bearer(admin)).json() == {"ok": True}
    assert not path.exists()
    assert client.get("/api/sounds", headers=bearer(admin)).json() == []


def test_the_file_loads_for_the_call_not_for_outsiders(server, audio):
    client, people, _ = server
    sound = upload(client, people["admin"], audio["mp3"]).json()

    in_call(people, "admin", "room-1")
    in_call(people, "alice", "room-1")
    in_call(people, "bob", "room-2")

    r = client.get(sound["url"], headers=media_headers(people, "admin"))
    assert r.status_code == 200
    assert r.content[:4] == b"OggS"
    assert r.headers["content-type"] == "audio/ogg"
    assert r.headers["cache-control"] == "private, max-age=31536000, immutable"
    assert r.headers["x-content-type-options"] == "nosniff"

    assert client.get(sound["url"], headers=media_headers(people, "alice")).status_code == 200
    assert client.get(sound["url"], headers=media_headers(people, "bob")).status_code == 404
    assert client.get(sound["url"], headers=media_headers(people, "carol")).status_code == 404
    assert client.get(sound["url"]).status_code == 401


def test_call_sounds_lists_everyone_in_the_room(server, audio):
    client, people, _ = server
    mine = upload(client, people["admin"], audio["mp3"], name="A").json()
    theirs = upload(client, people["alice"], audio["mp3"], name="B").json()
    in_call(people, "admin", "room-1")
    in_call(people, "alice", "room-1")
    in_call(people, "bob", "room-2")

    got = client.get("/api/voice/room-1/sounds", headers=bearer(people["admin"])).json()
    assert {s["id"] for s in got} == {mine["id"], theirs["id"]}
    assert got == sorted(got, key=lambda s: (s["userId"], s["createdAt"], s["id"]))
    assert client.get("/api/voice/room-1/sounds", headers=bearer(people["bob"])).status_code == 404


def test_playing_reaches_only_the_room_and_is_rate_limited(server, audio):
    client, people, emits = server
    mine = upload(client, people["admin"], audio["mp3"], name="Mine").json()
    upload(client, people["bob"], audio["mp3"], name="Bobs")

    # Nobody in a call at all.
    assert asyncio.run(realtime.sound_play("sid-carol", {"soundId": mine["id"]}))["code"] == "noCall"
    # In a call, but the sound isn't theirs.
    in_call(people, "bob", "room-2")
    assert asyncio.run(realtime.sound_play("sid-bob", {"soundId": mine["id"]}))["code"] == "noSound"

    in_call(people, "admin", "room-1")
    in_call(people, "alice", "room-1")
    emits.clear()
    assert asyncio.run(realtime.sound_play("sid-admin", {"soundId": mine["id"]}))["ok"]
    event, payload, to, _ = next(e for e in emits if e[0] == "sound:played")
    assert event == "sound:played" and sorted(to) == ["sid-admin", "sid-alice"]
    assert payload["soundId"] == mine["id"] and payload["channelId"] == "room-1"
    assert payload["userId"] == people["admin"]["user"]["id"] and payload["url"] == mine["url"]
    assert payload["durationMs"] == mine["durationMs"] and len(payload["playId"]) == 32

    # Four in the window play; the fifth has to wait.
    for _ in range(3):
        assert asyncio.run(realtime.sound_play("sid-admin", {"soundId": mine["id"]}))["ok"]
    play_ids = [e[1]["playId"] for e in emits if e[0] == "sound:played"]
    assert len(set(play_ids)) == 4, "every play carries its own id"
    fifth = asyncio.run(realtime.sound_play("sid-admin", {"soundId": mine["id"]}))
    assert fifth["code"] == "tooFast"


def test_stopping_a_sound_reaches_only_the_room_and_is_rate_limited(server, audio):
    client, people, emits = server
    # Outside a call there is nothing to stop.
    assert asyncio.run(realtime.sound_stop("sid-carol", {}))["code"] == "noCall"

    in_call(people, "admin", "room-1")
    in_call(people, "alice", "room-1")
    in_call(people, "bob", "room-2")
    emits.clear()
    assert asyncio.run(realtime.sound_stop("sid-admin", {}))["ok"]
    event, payload, to, _ = next(e for e in emits if e[0] == "sound:stopped")
    assert event == "sound:stopped" and sorted(to) == ["sid-admin", "sid-alice"]
    assert payload == {"userId": people["admin"]["user"]["id"], "channelId": "room-1"}

    # Ten a window; the eleventh has to wait.
    for _ in range(9):
        assert asyncio.run(realtime.sound_stop("sid-admin", {}))["ok"]
    assert asyncio.run(realtime.sound_stop("sid-admin", {}))["code"] == "tooFast"


def test_the_orphan_sweep_covers_sound_files(server, audio):
    client, people, _ = server
    sound = upload(client, people["admin"], audio["mp3"]).json()
    live = sounds.SOUND_DIR / f"{sound['id']}.ogg"
    orphan = sounds.SOUND_DIR / "deadbeef.mp3"
    orphan.write_bytes(b"ID3")
    old = time.time() - 7200
    os.utime(orphan, (old, old))

    uploads.sweep_orphan_media()
    assert live.is_file()
    assert not orphan.exists()
