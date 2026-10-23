"""A server's structure from Discord: its categories and channels, in order, from a server template link.

In Discord: Server Settings → Server Template → the link (discord.new/CODE). Discord gives a template to anyone
with its code, no bot and no login, so the server fetches it itself (it's abroad, where Discord answers). What comes
over: categories, text and voice channels and their order; forums, announcements and stages become text or voice
channels. What doesn't: messages, members, roles and permissions, the icon (a template has none).
"""

import json
import re
import urllib.error
import urllib.request
import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from .auth import current_user, is_admin
from .channels import channel_name, list_categories, list_channels, send_layout
from .db import connect_db, now_ms, query
from .errors import ApiError

router = APIRouter()

TEMPLATE_URL = "https://discord.com/api/v10/guilds/templates/{code}"
CODE = re.compile(r"(?:discord\.new/|discord(?:app)?\.com/template/)?([A-Za-z0-9]{4,40})/?$")
# Discord's channel types: text, announcement, forum, media → text; voice, stage → voice. Categories are 4.
TEXT_TYPES = {0, 5, 15, 16}
VOICE_TYPES = {2, 13}
CATEGORY = 4
# A server here keeps to a list people can take in: what a template brings beyond this is left out.
MAX_CHANNELS = 150


class TemplateIn(BaseModel):
    link: str = Field(min_length=4, max_length=200)


class ImportIn(TemplateIn):
    # Channels and categories (their keys from the preview) left out by the admin.
    skip: list[str] = Field(default_factory=list, max_length=600)
    # On a server just made: its own channels with nothing in them yet give way to the imported ones.
    replaceEmpty: bool = False


def template_code(link: str) -> str:
    match = CODE.search(link.strip())
    if not match:
        raise ApiError(400, "templateLink", "Нужна ссылка на шаблон сервера Discord")
    return match.group(1)


def fetch_template(code: str) -> dict:
    request = urllib.request.Request(TEMPLATE_URL.format(code=code), headers={"User-Agent": "Atrium (server import)"})
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as error:
        if error.code in (400, 404):
            raise ApiError(404, "templateNotFound", "Шаблон не найден: проверьте ссылку")
        raise ApiError(502, "templateUnavailable", "Discord не ответил, попробуйте ещё раз")
    except (urllib.error.URLError, TimeoutError, ValueError):
        raise ApiError(502, "templateUnavailable", "Discord не ответил, попробуйте ещё раз")


def structure(template: dict) -> dict:
    """{name, categories: [{key, name, channels}], loose: [channels], roles}; a channel is {key, name, kind}."""
    source = template.get("serialized_source_guild") or {}
    channels = sorted(source.get("channels") or [], key=lambda c: (c.get("position", 0), str(c.get("id"))))
    categories = [{"key": f"c{c['id']}", "name": c.get("name") or "", "channels": []} for c in channels if c.get("type") == CATEGORY]
    by_id = {c["key"][1:]: c for c in categories}
    loose = []
    for c in channels:
        kind = "text" if c.get("type") in TEXT_TYPES else "voice" if c.get("type") in VOICE_TYPES else None
        if not kind or not c.get("name"):
            continue
        item = {"key": f"h{c['id']}", "name": c["name"], "kind": kind}
        parent = by_id.get(str(c.get("parent_id")))
        (parent["channels"] if parent else loose).append(item)
    roles = [r for r in source.get("roles") or [] if r.get("name") != "@everyone"]
    return {"name": template.get("name") or source.get("name") or "", "categories": categories, "loose": loose, "roles": len(roles)}


@router.post("/api/import/discord/preview")
def preview(body: TemplateIn, user: dict = Depends(current_user)):
    if not is_admin(user):
        raise ApiError(403, "adminImport", "Переносит сервер только админ")
    return structure(fetch_template(template_code(body.link)))


@router.post("/api/import/discord")
async def import_template(body: ImportIn, user: dict = Depends(current_user)):
    """Creates the template's categories and channels after the ones there are, without those in `skip`."""
    if not is_admin(user):
        raise ApiError(403, "adminImport", "Переносит сервер только админ")
    found = structure(fetch_template(template_code(body.link)))
    skip = set(body.skip)
    plan = [(None, c) for c in found["loose"] if c["key"] not in skip]
    for category in found["categories"]:
        if category["key"] in skip:
            continue
        kept = [c for c in category["channels"] if c["key"] not in skip]
        plan += [(category, c) for c in kept] or [(category, None)]
    if not any(c for _, c in plan):
        raise ApiError(400, "importNothing", "Нечего переносить")

    existing = list_channels()
    # Only what nobody has written in yet makes way, and only when text channels come to replace it.
    empty = []
    if body.replaceEmpty and any(c and c["kind"] == "text" for _, c in plan):
        empty = [c["id"] for c in existing if not query("SELECT 1 FROM messages WHERE channel_id = ? LIMIT 1", (c["id"],))]
    room = MAX_CHANNELS - (len(existing) - len(empty))
    now = now_ms()
    position = query("SELECT COALESCE(MAX(position), 0) + 1 AS p FROM channels WHERE deleted_at IS NULL")[0]["p"]
    category_position = query("SELECT COALESCE(MAX(position), 0) + 1 AS p FROM categories")[0]["p"]
    made: dict[str, str] = {}
    added = 0
    with connect_db() as conn:
        if empty:
            conn.execute(f"UPDATE channels SET deleted_at = ? WHERE id IN ({', '.join('?' * len(empty))})", (now, *empty))
        for category, channel in plan:
            category_id = None
            if category:
                if category["key"] not in made:
                    made[category["key"]] = uuid.uuid4().hex
                    name = " ".join(category["name"].split())[:32] or "—"
                    conn.execute(
                        "INSERT INTO categories (id, name, position, created_at) VALUES (?, ?, ?, ?)",
                        (made[category["key"]], name, category_position, now),
                    )
                    category_position += 1
                category_id = made[category["key"]]
            if not channel or added >= room:
                continue
            try:
                name = channel_name(channel["name"][:32], channel["kind"])
            except ApiError:
                continue
            conn.execute(
                "INSERT INTO channels (id, name, kind, position, created_at, category_id) VALUES (?, ?, ?, ?, ?, ?)",
                (uuid.uuid4().hex, name, channel["kind"], position, now, category_id),
            )
            position += 1
            added += 1
    await send_layout()
    return {"channels": list_channels(), "categories": list_categories(), "added": added, "removed": len(empty)}
