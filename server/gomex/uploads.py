"""Pictures and files in messages: Pillow, storage on disk, who may load them, the hourly clean-up."""

import asyncio
import io
import re
import shutil
import urllib.parse
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from PIL import Image, ImageOps, ImageSequence, UnidentifiedImageError

from .config import (
    ANIMATION_MAX_SIDE,
    ANIMATION_PIXEL_BUDGET,
    AVATAR_SIZE,
    IMAGE_MAX_SIDE,
    MAX_FILE_NAME,
    MAX_FILE_UPLOAD,
    MAX_IMAGE_PIXELS,
    MAX_IMAGE_UPLOAD,
    MIN_FREE_DISK,
    PREVIEW_SIDE,
    UNSENT_UPLOAD_TTL_MS,
    UPLOAD_BYTES_PER_DAY,
    UPLOAD_DIR,
)
from .db import connect_db, execute, now_ms, query
from .auth import UPLOADS_BY_USER, current_user, media_user


Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS

router = APIRouter()


def open_checked(data: bytes, shrink_to: int) -> Image.Image:
    """Open a picture without decoding it yet, refusing ones too big to decode safely.

    JPEGs (most phone photos) are then decoded straight at a fraction of their size, at least `shrink_to` on each
    side: a 12 MP photo needs a quarter of the memory and time.
    """
    img = Image.open(io.BytesIO(data))
    if img.width * img.height > MAX_IMAGE_PIXELS:
        img.close()
        raise HTTPException(status_code=413, detail="Картинка слишком большая")
    img.draft("RGB", (shrink_to, shrink_to))
    return img


# Decoding pictures is the one thing that can take hundreds of MB: one at a time, so a few uploads at once can't
# push the box (and the calls with it) out of memory.
IMAGE_WORK = asyncio.Semaphore(1)


async def process_image(fn, *args):
    async with IMAGE_WORK:
        return await run_in_threadpool(fn, *args)


def make_avatar(data: bytes, size: int = AVATAR_SIZE) -> bytes:
    """Square-crop to `size` and re-encode as WebP. Re-encoding drops EXIF (e.g. GPS) and anything odd in the file."""
    try:
        with open_checked(data, size) as img:
            img = ImageOps.exif_transpose(img)  # respect phone camera rotation before EXIF is discarded
            img = img.convert("RGBA") if img.mode in ("RGBA", "LA", "P") else img.convert("RGB")
            img = ImageOps.fit(img, (size, size), method=Image.Resampling.LANCZOS)
            out = io.BytesIO()
            img.save(out, format="WEBP", quality=85)
            return out.getvalue()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise HTTPException(status_code=400, detail="Это не похоже на картинку")


def make_image(data: bytes) -> tuple[bytes, int, int, bytes | None]:
    """Shrink a chat image to IMAGE_MAX_SIDE and re-encode as WebP, keeping animation.

    Returns (webp, width, height, preview): the preview is a PREVIEW_SIDE copy for the chat itself, None when the
    picture is no bigger than that (animations always are). Like avatars, re-encoding drops EXIF (phone photos
    carry GPS) and anything that isn't pixels.
    """
    try:
        with open_checked(data, IMAGE_MAX_SIDE) as img:
            if getattr(img, "n_frames", 1) > 1:
                scale = min(1.0, ANIMATION_MAX_SIDE / max(img.size))
                size = (max(1, round(img.width * scale)), max(1, round(img.height * scale)))
                if size[0] * size[1] * img.n_frames > ANIMATION_PIXEL_BUDGET:
                    raise HTTPException(status_code=413, detail="Гифка слишком длинная или большая")
                frames, durations = [], []
                for frame in ImageSequence.Iterator(img):
                    frames.append(frame.convert("RGBA").resize(size, Image.Resampling.LANCZOS))
                    durations.append(frame.info.get("duration") or 100)
                out = io.BytesIO()
                frames[0].save(out, format="WEBP", save_all=True, append_images=frames[1:], duration=durations, loop=0, quality=80)
                return out.getvalue(), size[0], size[1], None

            img = ImageOps.exif_transpose(img)  # respect phone camera rotation before EXIF is discarded
            img = img.convert("RGBA") if img.mode in ("RGBA", "LA", "P", "PA") else img.convert("RGB")
            img.thumbnail((IMAGE_MAX_SIDE, IMAGE_MAX_SIDE), Image.Resampling.LANCZOS)
            out = io.BytesIO()
            img.save(out, format="WEBP", quality=85)
            preview = None
            if max(img.size) > PREVIEW_SIDE:
                small = img.copy()
                small.thumbnail((PREVIEW_SIDE, PREVIEW_SIDE), Image.Resampling.LANCZOS)
                preview_out = io.BytesIO()
                small.save(preview_out, format="WEBP", quality=80)
                preview = preview_out.getvalue()
            return out.getvalue(), img.width, img.height, preview
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise HTTPException(status_code=400, detail="Не получилось открыть картинку: нужен JPG, PNG, WebP или GIF")


UPLOAD_NAME = re.compile(r"([0-9a-f]{32})(\.p)?\.(webp|bin)")


def preview_name(upload_id: str) -> str:
    """A picture's chat-sized copy sits next to it: <id>.p.webp."""
    return upload_id.removesuffix(".webp") + ".p.webp"


def remove_upload_files(upload_ids) -> None:
    for upload_id in upload_ids:
        (UPLOAD_DIR / upload_id).unlink(missing_ok=True)
        (UPLOAD_DIR / preview_name(upload_id)).unlink(missing_ok=True)


def attachment_out(upload: dict) -> dict:
    """A picture is {url, width, height}; any other file is {url, name, size, kind: "file"}."""
    if upload.get("file_name"):
        return {"url": f"/api/uploads/{upload['id']}", "name": upload["file_name"], "size": upload["file_size"], "kind": "file", "width": 0, "height": 0}
    out = {"url": f"/api/uploads/{upload['id']}", "width": upload["width"], "height": upload["height"]}
    if (UPLOAD_DIR / preview_name(upload["id"])).is_file():
        out["previewUrl"] = f"/api/uploads/{preview_name(upload['id'])}"
    return out


def claim_uploads(ids: list[str], scope: str) -> None:
    """Images become visible to whoever can read the conversation they were sent to."""
    if ids:
        execute(f"UPDATE uploads SET scope = ? WHERE id IN ({', '.join('?' * len(ids))})", (scope, *ids))


def can_see_upload(user_id: str, upload: dict) -> bool:
    scope = upload["scope"]
    if scope is None:
        return upload["user_id"] == user_id
    if scope == "channel":
        return True
    return scope.startswith("dm:") and dm_for(user_id, scope[3:]) is not None


PRIVATE_IMAGE_HEADERS = {"Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff"}


def check_upload_room(user_id: str, size: int) -> None:
    """Refuse an upload that would fill the disk or go over the person's daily allowance."""
    if shutil.disk_usage(UPLOAD_DIR).free - size < MIN_FREE_DISK:
        raise HTTPException(status_code=507, detail="На сервере кончается место, загрузки пока закрыты")
    used = query(
        "SELECT COALESCE(SUM(file_size), 0) AS n FROM uploads WHERE user_id = ? AND created_at > ?",
        (user_id, now_ms() - 24 * 3600 * 1000),
    )[0]["n"]
    if used + size > UPLOAD_BYTES_PER_DAY:
        raise HTTPException(status_code=413, detail=f"Лимит загрузок на сутки: {UPLOAD_BYTES_PER_DAY // 1024 // 1024} МБ")


@router.post("/api/uploads")
async def upload_file_or_image(request: Request, name: str = "", user: dict = Depends(current_user)):
    """Raw bytes in the body; returns an id to put in a message's `attachments`.

    Pictures (JPG, PNG, WebP, GIF) are shrunk and re-encoded as WebP; anything else, or a picture that won't
    open, is kept byte for byte as a file named `name`, only ever offered as a download.
    """
    UPLOADS_BY_USER.check(user["id"])
    if int(request.headers.get("content-length") or 0) > MAX_FILE_UPLOAD:
        raise HTTPException(status_code=413, detail="Файл больше 25 МБ")
    data = await request.body()
    if not data:
        raise HTTPException(status_code=400, detail="Пустой файл")
    check_upload_room(user["id"], len(data))
    content_type = request.headers.get("content-type", "")
    if content_type.startswith("image/") and content_type != "image/svg+xml" and len(data) <= MAX_IMAGE_UPLOAD:
        try:
            # Decoding a big photo takes a while; keep it off the event loop that also runs chat and presence.
            webp, width, height, preview = await process_image(make_image, data)
        except HTTPException:
            if not name:
                raise
        else:
            image_id = f"{uuid.uuid4().hex}.webp"
            (UPLOAD_DIR / image_id).write_bytes(webp)
            if preview:
                (UPLOAD_DIR / preview_name(image_id)).write_bytes(preview)
            # file_size here is only what the picture takes on disk, for the daily allowance.
            execute(
                "INSERT INTO uploads (id, user_id, width, height, created_at, file_size) VALUES (?, ?, ?, ?, ?, ?)",
                (image_id, user["id"], width, height, now_ms(), len(webp) + len(preview or b"")),
            )
            upload = {"id": image_id, "width": width, "height": height}
            return {"id": image_id, **attachment_out(upload)}
    if len(data) > MAX_FILE_UPLOAD:
        raise HTTPException(status_code=413, detail="Файл больше 25 МБ")
    file_name = " ".join(Path(name.replace("\\", "/")).name.split())[:MAX_FILE_NAME] or "файл"
    if not all(ch.isprintable() for ch in file_name):
        file_name = "файл"
    file_id = f"{uuid.uuid4().hex}.bin"
    (UPLOAD_DIR / file_id).write_bytes(data)
    execute(
        "INSERT INTO uploads (id, user_id, width, height, created_at, file_name, file_size, file_type) VALUES (?, ?, 0, 0, ?, ?, ?, ?)",
        (file_id, user["id"], now_ms(), file_name, len(data), content_type[:100]),
    )
    return {"id": file_id, "url": f"/api/uploads/{file_id}", "width": 0, "height": 0, "name": file_name, "size": len(data), "kind": "file"}


@router.get("/api/uploads/{name}")
def upload_file(name: str, user: dict = Depends(media_user)):
    match = UPLOAD_NAME.fullmatch(name)
    if not match:
        raise HTTPException(status_code=404)
    # A preview (<id>.p.webp) is seen by whoever may see the picture itself.
    upload_id = f"{match[1]}.{match[3]}"
    rows = query("SELECT user_id, scope, file_name FROM uploads WHERE id = ?", (upload_id,))
    # 404 rather than 403, so a link doesn't even confirm the file exists to someone outside the conversation.
    if not rows or not can_see_upload(user["id"], rows[0]):
        raise HTTPException(status_code=404)
    path = UPLOAD_DIR / name
    if not path.is_file():
        raise HTTPException(status_code=404)
    if rows[0]["file_name"]:
        # Never rendered in the browser (an uploaded HTML page would run on our domain): always a download.
        quoted = urllib.parse.quote(rows[0]["file_name"])
        headers = {**PRIVATE_IMAGE_HEADERS, "Content-Disposition": f"attachment; filename*=UTF-8''{quoted}"}
        return FileResponse(path, media_type="application/octet-stream", headers=headers)
    return FileResponse(path, media_type="image/webp", headers=PRIVATE_IMAGE_HEADERS)


def sweep_unsent_uploads() -> int:
    """Delete pictures and files uploaded but never sent (a closed tab, a cancelled message)."""
    rows = query("SELECT id FROM uploads WHERE scope IS NULL AND created_at < ?", (now_ms() - UNSENT_UPLOAD_TTL_MS,))
    ids = [r["id"] for r in rows]
    if ids:
        with connect_db() as conn:
            conn.execute(f"DELETE FROM uploads WHERE id IN ({', '.join('?' * len(ids))})", ids)
        remove_upload_files(ids)
    return len(ids)


async def housekeeping() -> None:
    while True:
        try:
            await run_in_threadpool(sweep_unsent_uploads)
        except Exception as e:  # never let a bad hour stop the loop
            print(f"housekeeping failed: {e!r}", flush=True)
        await asyncio.sleep(3600)


# The other gomex modules import this one too: they come last, once everything above is defined.
from .dms import dm_for
