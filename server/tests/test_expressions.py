import json
import io

import pytest
from PIL import Image

from atrium import channels
from atrium.config import MAX_ATTACHMENTS
from atrium.errors import Rejected
from atrium.expressions import make_sticker


def test_klipy_sends_store_the_slug_without_changing_local_uploads(monkeypatch):
    monkeypatch.setattr(channels, "klipy_key", lambda: "local-test-key")
    monkeypatch.setattr(channels, "query", lambda *_: [{"id": "local.webp"}])
    monkeypatch.setattr(channels, "attachment_out", lambda row: {"url": "/api/uploads/" + row["id"]})

    content, attachments, uploads = channels.message_body("sender", {
        "content": "a GIF and a picture",
        "attachments": ["local.webp"],
        "gifId": "hello-hi-662",
    })
    assert content == "a GIF and a picture"
    assert uploads == ["local.webp"]
    assert json.loads(attachments) == [
        {"url": "/api/uploads/local.webp"},
        {"kind": "klipy", "gifId": "hello-hi-662", "url": "https://klipy.com/gifs/hello-hi-662", "width": 0, "height": 0},
    ]

    with pytest.raises(Rejected):
        channels.message_body("sender", {"gifId": "https://example.test/image.gif"})
    with pytest.raises(Rejected):
        channels.message_body("sender", {"attachments": ["upload"] * MAX_ATTACHMENTS, "gifId": "gif123"})

    monkeypatch.setattr(channels, "klipy_key", lambda: "")
    with pytest.raises(Rejected):
        channels.message_body("sender", {"gifId": "gif123"})
    assert channels.message_body("sender", {"content": "old client"}) == ("old client", "[]", [])


def test_sticker_only_message_uses_immutable_reference(monkeypatch):
    sticker_id = "a" * 32
    row = {"name": "Привет", "description": "Машет лапой", "width": 120, "height": 90, "animated": 1}
    monkeypatch.setattr(channels, "query", lambda _, values: [row] if values == (sticker_id,) else [])
    content, attachments, uploads = channels.message_body("sender", {"stickerId": sticker_id})
    assert content == "" and uploads == []
    assert json.loads(attachments) == [{
        **row, "animated": True, "kind": "sticker", "url": f"/api/server/stickers/{sticker_id}/image",
    }]
    with pytest.raises(Rejected):
        channels.message_body("sender", {"stickerId": "b" * 32})


def test_animated_sticker_has_a_still_and_keeps_transparency():
    source = io.BytesIO()
    frames = [Image.new("RGBA", (400, 200), color) for color in ((255, 0, 0, 40), (0, 0, 255, 255))]
    frames[0].save(source, "PNG", save_all=True, append_images=frames[1:], duration=[100, 100])
    image, still, width, height = make_sticker(source.getvalue())
    assert (width, height) == (320, 160)
    with Image.open(io.BytesIO(image)) as animated, Image.open(io.BytesIO(still)) as static:
        assert animated.n_frames == 2
        assert static.n_frames == 1
        assert static.getpixel((0, 0))[3] == 40
