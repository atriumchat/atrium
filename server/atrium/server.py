"""The server as people see it: its name and icon. Both are set in the first-run setup and changed later by an admin
in the settings. The icon is shown on the sign-in page and in the installed app's manifest too, before anyone signs
in, so unlike avatars it loads without the media cookie."""

import json
import secrets
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from .config import AVATAR_DIR, MAX_AVATAR_UPLOAD, SERVER_ICON_SIZE, WEB_DIST
from .errors import ApiError
from .db import execute, query
from .auth import AVATARS_BY_USER, current_user, is_admin


router = APIRouter()


def icon_file() -> str | None:
    rows = query("SELECT value FROM settings WHERE key = 'server_icon'")
    return rows[0]["value"] if rows else None


def icon_version(name: str) -> str:
    # Files are named server-<random>.webp; the random part tells one icon from the next.
    return name.removeprefix("server-").removesuffix(".webp")


def icon_url() -> str | None:
    """One address for the icon, with its version in the query: a new icon is a new URL, so each can be cached for good."""
    name = icon_file()
    return f"/api/server/icon?v={icon_version(name)}" if name else None


def server_info() -> dict:
    return {"serverName": server_name(), "serverIcon": icon_url()}


async def announce() -> None:
    await sio.emit("server:updated", server_info())


def check_admin(user: dict) -> None:
    if not is_admin(user):
        raise ApiError(403, "adminServerSettings", "Сервер настраивает только админ")


@router.get("/api/server/icon")
def server_icon(v: str = ""):
    name = icon_file()
    path = AVATAR_DIR / name if name else None
    if not path or not path.is_file():
        raise HTTPException(status_code=404)
    # An old version asked for gets today's icon, but not for keeps.
    cache = "public, max-age=31536000, immutable" if v == icon_version(name) else "no-cache"
    return FileResponse(path, media_type="image/webp", headers={"Cache-Control": cache, "X-Content-Type-Options": "nosniff"})


@router.post("/api/server/icon")
async def upload_server_icon(request: Request, user: dict = Depends(current_user)):
    """Raw image bytes in the body, as for avatars; stored as a square WebP big enough for a home-screen icon."""
    check_admin(user)
    if int(request.headers.get("content-length") or 0) > MAX_AVATAR_UPLOAD:
        raise ApiError(413, "imageOver8", "Картинка больше 8 МБ")
    data = await request.body()
    if not data:
        raise ApiError(400, "emptyFile", "Пустой файл")
    if len(data) > MAX_AVATAR_UPLOAD:
        raise ApiError(413, "imageOver8", "Картинка больше 8 МБ")
    AVATARS_BY_USER.check(user["id"])
    webp = await process_image(make_avatar, data, SERVER_ICON_SIZE)
    name = f"server-{secrets.token_hex(8)}.webp"
    await run_in_threadpool((AVATAR_DIR / name).write_bytes, webp)
    old = icon_file()
    execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('server_icon', ?)", (name,))
    remove_avatar_file(old)
    await announce()
    return server_info()


@router.delete("/api/server/icon")
async def delete_server_icon(user: dict = Depends(current_user)):
    check_admin(user)
    old = icon_file()
    execute("DELETE FROM settings WHERE key = 'server_icon'")
    remove_avatar_file(old)
    await announce()
    return server_info()


class ServerIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)


class EarlyAccessIn(BaseModel):
    enabled: bool


@router.patch("/api/server")
async def rename_server(body: ServerIn, user: dict = Depends(current_user)):
    check_admin(user)
    title = " ".join(body.name.split())
    if not title:
        raise ApiError(400, "emptyServerName", "Пустое название сервера")
    execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('server_name', ?)", (title,))
    await announce()
    return server_info()


def early_access_info() -> dict:
    return {"enabled": telemetry.enabled(), "numbers": telemetry.numbers(), "lastSent": telemetry.last_sent()}


@router.get("/api/server/early-access")
def get_early_access(user: dict = Depends(current_user)):
    """For the admin: whether it's on, and exactly the numbers a ping would send now."""
    check_admin(user)
    return early_access_info()


@router.put("/api/server/early-access")
def put_early_access(body: EarlyAccessIn, user: dict = Depends(current_user)):
    check_admin(user)
    telemetry.set_enabled(body.enabled)
    return early_access_info()


@router.get("/api/server/channel")
def update_channel():
    """Read by install.sh on update: early access takes pre-releases, everyone else stable releases only."""
    return {"channel": "early" if telemetry.enabled() else "stable"}


# The installed app's manifest: the built one, with the server's icon in place of Atrium's once there is one. Only
# where the server serves the built client; in development Vite serves web/public's copy as it is.
if WEB_DIST:

    # Read once: the built file only changes with a new image, and a new image is a new process.
    _manifest = Path(WEB_DIST) / "manifest.webmanifest"
    BUILT_MANIFEST = _manifest.read_text(encoding="utf-8") if _manifest.is_file() else "{}"

    @router.get("/manifest.webmanifest")
    def manifest():
        built = json.loads(BUILT_MANIFEST)
        url = icon_url()
        if url:
            size = f"{SERVER_ICON_SIZE}x{SERVER_ICON_SIZE}"
            built["icons"] = [{"src": url, "sizes": size, "type": "image/webp", "purpose": "any"}]
        return JSONResponse(built, media_type="application/manifest+json", headers={"Cache-Control": "no-cache"})


# The other atrium modules import this one too: they come last, once everything above is defined.
from .users import remove_avatar_file, server_name
from .uploads import make_avatar, process_image
from . import telemetry
from .realtime import sio
