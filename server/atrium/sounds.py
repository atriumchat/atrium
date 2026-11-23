"""A personal soundboard: short sounds a person keeps and plays in a voice call.

The file is written to SOUND_DIR under a name of our own; the row holds its name, emoji and volume. In a call the
server only says who played what (realtime.sound:play) and every client plays the file itself. A sound is its owner's:
nobody else may edit or delete it, and only the people in the same call may load the file.
"""

import math
import shutil
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .config import (
    MAX_SOUND_BYTES,
    MAX_SOUND_NAME,
    MAX_SOUNDS_PER_USER,
    MIN_FREE_DISK,
    SOUND_DIR,
)
from .errors import ApiError
from .db import connect_db, execute, now_ms, query
from .auth import SOUNDS_BY_USER, current_user, media_user
from .media import remove_media_files


router = APIRouter()

# The kind is decided by the file's first bytes, never by its name or the type the client claimed.
SOUND_TYPES = {
    "mp3": "audio/mpeg",
    "ogg": "audio/ogg",
    "wav": "audio/wav",
    "flac": "audio/flac",
    "m4a": "audio/mp4",
    "webm": "audio/webm",
}
# A sound's file never changes (edits touch only the row), so a browser may keep it for good.
SOUND_HEADERS = {"Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff"}


def sound_kind(data: bytes) -> str | None:
    """The extension for a sound by its magic bytes, or None for anything that isn't one of ours."""
    if data[:3] == b"ID3" or (len(data) >= 2 and data[0] == 0xFF and (data[1] & 0xE0) == 0xE0):
        return "mp3"
    if data[:4] == b"OggS":
        return "ogg"
    if data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        return "wav"
    if data[:4] == b"fLaC":
        return "flac"
    if data[4:8] == b"ftyp":
        return "m4a"
    if data[:4] == b"\x1a\x45\xdf\xa3":
        return "webm"
    return None


def sound_out(sound: dict) -> dict:
    """A sound as the client sees it: its file sits behind a url that can be cached for good."""
    return {
        "id": sound["id"],
        "userId": sound["user_id"],
        "name": sound["name"],
        "emoji": sound["emoji"],
        "volume": sound["volume"],
        "url": f"/api/sounds/{sound['id']}/file",
        "createdAt": sound["created_at"],
    }


def sound_name(raw: str) -> str:
    name = " ".join(raw.split())[:MAX_SOUND_NAME]
    if not name:
        raise ApiError(400, "emptyName", "Пустое название")
    return name


def sound_emoji(raw: str) -> str:
    emoji = raw.strip()
    if emoji and not realtime.is_emoji(emoji):
        raise ApiError(400, "notEmoji", "Это не эмодзи")
    return emoji


def sound_volume(value: float) -> float:
    # "nan" and "inf" parse as floats too; SQLite would turn NaN into NULL.
    return min(max(value, 0.0), 1.0) if math.isfinite(value) else 1.0


def my_sound(user_id: str, sound_id: str) -> dict:
    rows = query("SELECT * FROM sounds WHERE id = ? AND user_id = ?", (sound_id, user_id))
    if not rows:
        raise ApiError(404, "noSound", "Нет такого звука")
    return rows[0]


def sound_count(user_id: str) -> int:
    return query("SELECT COUNT(*) AS n FROM sounds WHERE user_id = ?", (user_id,))[0]["n"]


def too_many() -> ApiError:
    return ApiError(409, "tooManySounds", "Не больше 20 звуков", n=MAX_SOUNDS_PER_USER)


def check_sound_room(size: int) -> None:
    """Refuse a sound that would fill the disk; the daily upload allowance doesn't apply to soundboards."""
    if shutil.disk_usage(SOUND_DIR).free - size < MIN_FREE_DISK:
        raise ApiError(507, "diskFull", "На сервере кончается место, загрузки пока закрыты")


def shares_call(user_id: str, owner_id: str) -> bool:
    """True when both are in the same call (either may be in several rooms, one entry per tab)."""
    mine = {e["channelId"] for e in realtime.voice.values() if e["userId"] == user_id}
    theirs = {e["channelId"] for e in realtime.voice.values() if e["userId"] == owner_id}
    return bool(mine & theirs)


@router.get("/api/sounds")
def get_sounds(user: dict = Depends(current_user)):
    return [sound_out(s) for s in query("SELECT * FROM sounds WHERE user_id = ? ORDER BY created_at, id", (user["id"],))]


@router.post("/api/sounds")
async def add_sound(request: Request, name: str = "", emoji: str = "", volume: float = 1, user: dict = Depends(current_user)):
    """Raw bytes in the body (like /api/uploads): a short mp3, ogg, wav, m4a, flac or webm."""
    if int(request.headers.get("content-length") or 0) > MAX_SOUND_BYTES:
        raise ApiError(413, "soundTooBig", "Звук больше 512 КБ")
    data = await request.body()
    if not data:
        raise ApiError(400, "emptyFile", "Пустой файл")
    if len(data) > MAX_SOUND_BYTES:
        raise ApiError(413, "soundTooBig", "Звук больше 512 КБ")
    kind = sound_kind(data)
    if not kind:
        raise ApiError(415, "badSound", "Нужен звук: mp3, ogg, wav, m4a, flac или webm")
    sound = {"name": sound_name(name), "emoji": sound_emoji(emoji), "volume": sound_volume(volume)}
    if sound_count(user["id"]) >= MAX_SOUNDS_PER_USER:
        raise too_many()
    SOUNDS_BY_USER.check(user["id"])
    check_sound_room(len(data))
    sound_id = uuid.uuid4().hex
    file_name = f"{sound_id}.{kind}"
    # Writing off the event loop: a slow disk mustn't hold up chat and calls.
    await run_in_threadpool((SOUND_DIR / file_name).write_bytes, data)
    try:
        with connect_db() as conn:
            conn.execute(
                "INSERT INTO sounds (id, user_id, name, emoji, volume, file, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (sound_id, user["id"], sound["name"], sound["emoji"], sound["volume"], file_name, len(data), now_ms()),
            )
            # Two uploads at once both passed the count above; the later one is rolled back here.
            if conn.execute("SELECT COUNT(*) FROM sounds WHERE user_id = ?", (user["id"],)).fetchone()[0] > MAX_SOUNDS_PER_USER:
                raise too_many()
    except ApiError:
        remove_media_files([SOUND_DIR / file_name])
        raise
    return sound_out(query("SELECT * FROM sounds WHERE id = ?", (sound_id,))[0])


class SoundIn(BaseModel):
    name: str | None = None
    emoji: str | None = None
    volume: float | None = None


@router.patch("/api/sounds/{sound_id}")
def update_sound(sound_id: str, body: SoundIn, user: dict = Depends(current_user)):
    """Change your sound's name, emoji or volume; the file itself stays as it was."""
    my_sound(user["id"], sound_id)
    changes = {}
    if body.name is not None:
        changes["name"] = sound_name(body.name)
    if body.emoji is not None:
        changes["emoji"] = sound_emoji(body.emoji)
    if body.volume is not None:
        changes["volume"] = sound_volume(body.volume)
    if changes:
        execute(f"UPDATE sounds SET {', '.join(f'{k} = ?' for k in changes)} WHERE id = ?", (*changes.values(), sound_id))
    return sound_out(query("SELECT * FROM sounds WHERE id = ?", (sound_id,))[0])


@router.delete("/api/sounds/{sound_id}")
def delete_sound(sound_id: str, user: dict = Depends(current_user)):
    sound = my_sound(user["id"], sound_id)
    with connect_db() as conn:
        conn.execute("DELETE FROM sounds WHERE id = ?", (sound_id,))
    remove_media_files([SOUND_DIR / sound["file"]])
    return {"ok": True}


@router.get("/api/voice/{channel_id}/sounds")
def call_sounds(channel_id: str, user: dict = Depends(current_user)):
    """The sounds of everyone in this call, oldest first per person; clients use it to preload them."""
    entries = [e for e in realtime.voice.values() if e["channelId"] == channel_id]
    if not any(e["userId"] == user["id"] for e in entries):
        raise ApiError(404, "noCall", "Нет такого звонка")
    user_ids = sorted({e["userId"] for e in entries})
    rows = query(
        f"SELECT * FROM sounds WHERE user_id IN ({', '.join('?' * len(user_ids))}) ORDER BY user_id, created_at, id",
        tuple(user_ids),
    )
    return [sound_out(s) for s in rows]


@router.get("/api/sounds/{sound_id}/file")
def sound_file(sound_id: str, user: dict = Depends(media_user)):
    """The owner, or anyone in the same call, may load it; the file loads through a cookie, like chat images."""
    rows = query("SELECT * FROM sounds WHERE id = ?", (sound_id,))
    if not rows or (rows[0]["user_id"] != user["id"] and not shares_call(user["id"], rows[0]["user_id"])):
        raise HTTPException(status_code=404)
    path = SOUND_DIR / rows[0]["file"]
    if not path.is_file():
        raise HTTPException(status_code=404)
    extension = rows[0]["file"].rsplit(".", 1)[-1].lower()
    return FileResponse(path, media_type=SOUND_TYPES.get(extension, "application/octet-stream"), headers=SOUND_HEADERS)


# The other atrium modules import this one too: they come last, once everything above is defined.
from . import realtime
