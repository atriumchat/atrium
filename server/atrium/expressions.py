"""Server-owned expressions and the optional public client key for KLIPY."""

import re
import sqlite3
import io
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from .auth import AVATARS_BY_USER, RateLimit, current_user, media_user
from .db import connect_db, execute, query
from .errors import ApiError

router = APIRouter()
EMOJI_NAME = re.compile(r"[a-z0-9_а-яё]{2,32}")
KLIPY_SLUG = re.compile(r"[A-Za-z0-9_-]{1,180}")
STICKER_ID = re.compile(r"[a-f0-9]{32}")
MAX_EMOJI_BYTES = 512 * 1024
MAX_CUSTOM_EMOJI = 100
MAX_STICKERS = 100
STICKERS_BY_USER = RateLimit(10, 60)


def giphy_key() -> str:
    rows = query("SELECT value FROM settings WHERE key = 'giphy_key'")
    return rows[0]["value"] if rows else ""


def klipy_key() -> str:
    rows = query("SELECT value FROM settings WHERE key = 'klipy_key'")
    return rows[0]["value"] if rows else ""


def sticker_catalog() -> list[dict]:
    rows = query("SELECT id, name, emoji, description, width, height, active FROM custom_stickers ORDER BY name COLLATE NOCASE, id")
    return [{**row, "active": bool(row["active"])} for row in rows]


def emoji_catalog() -> dict:
    rows = query("SELECT name, active FROM custom_emoji ORDER BY name")
    return {r["name"]: bool(r["active"]) for r in rows}


class KlipyIn(BaseModel):
    key: str = Field(max_length=128)


@router.put("/api/server/klipy")
async def configure_klipy(body: KlipyIn, user: dict = Depends(current_user)):
    from .realtime import sio
    from .server import check_admin

    check_admin(user)
    key = body.key.strip()
    if key and not re.fullmatch(r"[A-Za-z0-9_-]{8,128}", key):
        raise ApiError(400, "klipyKeyInvalid", "Проверь ключ KLIPY")
    execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('klipy_key', ?)", (key,))
    await sio.emit("klipy:updated", {"klipyKey": key})
    return {"klipyKey": key}


async def announce_emoji():
    from .realtime import sio

    catalog = emoji_catalog()
    await sio.emit("emoji:updated", catalog)
    return catalog


@router.post("/api/server/emoji/{name}")
async def upload_emoji(name: str, request: Request, user: dict = Depends(current_user)):
    from .server import check_admin
    from .uploads import make_avatar, process_image

    check_admin(user)
    if not EMOJI_NAME.fullmatch(name):
        raise ApiError(400, "emojiNameInvalid", "Имя эмодзи должно содержать 2–32 буквы, цифры или подчёркивания")
    AVATARS_BY_USER.check(user["id"])
    data = bytearray()
    async for chunk in request.stream():
        if len(data) + len(chunk) > MAX_EMOJI_BYTES:
            raise ApiError(413, "emojiTooBig", "Картинка эмодзи больше 512 КБ")
        data.extend(chunk)
    if not data:
        raise ApiError(400, "emptyFile", "Пустой файл")
    image = await process_image(make_avatar, bytes(data), 128)
    with connect_db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        if conn.execute("SELECT COUNT(*) FROM custom_emoji").fetchone()[0] >= MAX_CUSTOM_EMOJI:
            raise ApiError(409, "emojiLimit", "На сервере уже 100 эмодзи")
        try:
            conn.execute("INSERT INTO custom_emoji (name, image) VALUES (?, ?)", (name, image))
        except sqlite3.IntegrityError:
            raise ApiError(409, "emojiNameTaken", "Это имя эмодзи уже занято") from None
    return await announce_emoji()


class EmojiState(BaseModel):
    active: bool


@router.put("/api/server/emoji/{name}")
async def set_emoji_state(name: str, body: EmojiState, user: dict = Depends(current_user)):
    from .server import check_admin

    check_admin(user)
    # Keep the image and name stable for messages and reactions already sent.
    with connect_db() as conn:
        if not conn.execute("UPDATE custom_emoji SET active = ? WHERE name = ?", (body.active, name)).rowcount:
            raise HTTPException(status_code=404)
    return await announce_emoji()


@router.get("/api/server/emoji/{name}")
def get_emoji(name: str, user: dict = Depends(media_user)):
    from .uploads import PRIVATE_IMAGE_HEADERS

    if not EMOJI_NAME.fullmatch(name):
        raise HTTPException(status_code=404)
    rows = query("SELECT image FROM custom_emoji WHERE name = ?", (name,))
    if not rows:
        raise HTTPException(status_code=404)
    return Response(rows[0]["image"], media_type="image/webp", headers=PRIVATE_IMAGE_HEADERS)


def make_sticker(data: bytes):
    from PIL import Image, UnidentifiedImageError
    from .uploads import make_image

    try:
        with Image.open(io.BytesIO(data)) as source:
            if source.format not in {"PNG", "JPEG", "GIF", "WEBP"}:
                raise ApiError(400, "stickerFormat", "Поддерживаются PNG, APNG, JPG, GIF и WebP")
            animated = getattr(source, "is_animated", False)
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise ApiError(400, "stickerFormat", "Поддерживаются PNG, APNG, JPG, GIF и WebP") from None
    image, width, height, _ = make_image(data, 320)
    still = None
    if animated:
        with Image.open(io.BytesIO(image)) as decoded, io.BytesIO() as preview:
            decoded.save(preview, format="WEBP", quality=85)
            still = preview.getvalue()
    return image, still, width, height


async def announce_stickers():
    from .realtime import sio

    stickers = sticker_catalog()
    await sio.emit("stickers:updated", stickers)
    return stickers


@router.post("/api/server/stickers")
async def upload_sticker(request: Request, name: str = "", emoji: str = "", description: str = "", user: dict = Depends(current_user)):
    from .realtime import is_emoji
    from .server import check_admin
    from .uploads import process_image

    check_admin(user)
    name, emoji, description = " ".join(name.split()), emoji.strip(), description.strip()
    if not 2 <= len(name) <= 32 or not is_emoji(emoji) or len(description) > 200:
        raise ApiError(400, "stickerFields", "Укажи имя и связанный эмодзи")
    STICKERS_BY_USER.check(user["id"])
    data = bytearray()
    async for chunk in request.stream():
        if len(data) + len(chunk) > MAX_EMOJI_BYTES:
            raise ApiError(413, "stickerTooBig", "Файл стикера больше 512 КБ")
        data.extend(chunk)
    if not data:
        raise ApiError(400, "emptyFile", "Пустой файл")
    image, still, width, height = await process_image(make_sticker, bytes(data))
    with connect_db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        if conn.execute("SELECT COUNT(*) FROM custom_stickers").fetchone()[0] >= MAX_STICKERS:
            raise ApiError(409, "stickerLimit", "На сервере уже 100 стикеров")
        conn.execute(
            "INSERT INTO custom_stickers (id, name, emoji, description, width, height, image, still) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (uuid.uuid4().hex, name, emoji, description, width, height, image, still),
        )
    return await announce_stickers()


@router.put("/api/server/stickers/{id}")
async def set_sticker_state(id: str, body: EmojiState, user: dict = Depends(current_user)):
    from .server import check_admin

    check_admin(user)
    with connect_db() as conn:
        if not conn.execute("UPDATE custom_stickers SET active = ? WHERE id = ?", (body.active, id)).rowcount:
            raise HTTPException(status_code=404)
    return await announce_stickers()


@router.get("/api/server/stickers/{id}/image")
def get_sticker(id: str, still: bool = False, user: dict = Depends(media_user)):
    from .uploads import PRIVATE_IMAGE_HEADERS

    if not STICKER_ID.fullmatch(id):
        raise HTTPException(status_code=404)
    column = "COALESCE(still, image)" if still else "image"
    rows = query(f"SELECT {column} AS content FROM custom_stickers WHERE id = ?", (id,))
    if not rows:
        raise HTTPException(status_code=404)
    return Response(rows[0]["content"], media_type="image/webp", headers=PRIVATE_IMAGE_HEADERS)
