"""Video and audio in the chat play inline; anything else stays a download. Run: .venv/bin/pytest"""

import pytest
from fastapi.testclient import TestClient

from atrium import auth

PASSWORD = "correct horse battery"


@pytest.fixture(scope="module")
def signed_in():
    from app import app

    # The media cookie is Secure: only an https client sends it back.
    client = TestClient(app, base_url="https://testserver")
    r = client.post("/api/setup", json={"code": "friends", "serverName": "Тест", "name": "Админ", "password": PASSWORD})
    if r.status_code == 409:  # another test file set the server up first, with the same admin
        r = client.post("/api/login", json={"name": "Админ", "password": PASSWORD})
    assert r.status_code == 200, r.text
    yield client, {"Authorization": f"Bearer {r.json()['token']}"}
    # The next file's module fixture signs in before the per-test reset runs.
    for limit in (auth.LOGIN_BY_IP, auth.LOGIN_BY_NAME, auth.LOGIN_BY_NICK):
        limit.hits.clear()


def upload(client, headers, name: str, data: bytes) -> str:
    r = client.post(f"/api/uploads?name={name}", content=data, headers={**headers, "Content-Type": "text/html"})
    assert r.status_code == 200, r.text
    return r.json()["url"]


def test_video_and_audio_go_out_as_media_with_ranges(signed_in):
    client, headers = signed_in
    video = upload(client, headers, "clip.MP4", b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 200)
    r = client.get(video)
    assert r.status_code == 200
    assert r.headers["content-type"] == "video/mp4"
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["content-disposition"].startswith("attachment;")
    # Seeking in the player asks for a range.
    part = client.get(video, headers={"Range": "bytes=0-7"})
    assert part.status_code == 206 and len(part.content) == 8

    assert client.get(upload(client, headers, "voice.ogg", b"OggS" + b"\x00" * 50)).headers["content-type"] == "audio/ogg"


def test_other_files_stay_downloads_whatever_type_was_claimed(signed_in):
    client, headers = signed_in
    page = client.get(upload(client, headers, "page.html", b"<script>alert(1)</script>"))
    assert page.headers["content-type"] == "application/octet-stream"
    assert page.headers["content-disposition"].startswith("attachment;")
