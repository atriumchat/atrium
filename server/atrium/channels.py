"""Server channels and messages in general: how a message looks to the client, read marks, the inbox, channel admin."""

import json
import uuid

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from .config import MAX_ATTACHMENTS, MAX_MESSAGE_LEN, MENTION
from .errors import ApiError, Rejected
from .db import connect_db, execute, now_ms, query
from .auth import current_user, is_admin


router = APIRouter()


def list_channels() -> list[dict]:
    return query(
        "SELECT id, name, kind, position, category_id AS categoryId FROM channels WHERE deleted_at IS NULL ORDER BY position, created_at"
    )


def list_categories() -> list[dict]:
    return query("SELECT id, name, position FROM categories ORDER BY position, created_at")


async def send_layout() -> list[dict]:
    """The categories, then the channels, to everyone (clients from before categories just ignore the first)."""
    await sio.emit("categories", list_categories())
    channels = list_channels()
    await sio.emit("channels", channels)
    return channels


def mentions_in(content: str) -> tuple[list[str], bool]:
    found = set(MENTION.findall(content))
    return sorted(found - {"all"}), "all" in found


def reactions_for(message_ids: list[str]) -> dict[str, list[dict]]:
    """Each message's reactions as [{emoji, users}], in the order the emojis were first used."""
    if not message_ids:
        return {}
    marks = ", ".join("?" * len(message_ids))
    rows = query(f"SELECT message_id, user_id, emoji FROM reactions WHERE message_id IN ({marks}) ORDER BY created_at", tuple(message_ids))
    out: dict[str, dict[str, list[str]]] = {}
    for r in rows:
        out.setdefault(r["message_id"], {}).setdefault(r["emoji"], []).append(r["user_id"])
    return {mid: [{"emoji": e, "users": u} for e, u in by_emoji.items()] for mid, by_emoji in out.items()}


def messages_out(rows: list[dict], table: str) -> list[dict]:
    """Messages as the client sees them, with what they reply to, their reactions and mentions (batched)."""
    reply_ids = sorted({r["reply_to"] for r in rows if r.get("reply_to")})
    replies = {}
    if reply_ids:
        marks = ", ".join("?" * len(reply_ids))
        replies = {r["id"]: r for r in query(f"SELECT id, user_id, content, attachments FROM {table} WHERE id IN ({marks})", tuple(reply_ids))}
    reactions = reactions_for([r["id"] for r in rows])
    out = []
    for r in rows:
        mentions, mentions_all = mentions_in(r["content"])
        message = {
            "id": r["id"],
            "channelId": r["dm_id"] if table == "dm_messages" else r["channel_id"],
            "userId": r["user_id"],
            "content": r["content"],
            "attachments": json.loads(r["attachments"]),
            "createdAt": r["created_at"],
            "editedAt": r.get("edited_at"),
            "reactions": reactions.get(r["id"], []),
            "mentions": mentions,
            "mentionsAll": mentions_all,
            "replyTo": None,
        }
        if r.get("reply_to"):
            original = replies.get(r["reply_to"])
            message["replyTo"] = (
                {
                    "id": original["id"],
                    "userId": original["user_id"],
                    "content": original["content"][:300],
                    "attachments": len(json.loads(original["attachments"])),
                }
                if original
                else {"id": r["reply_to"], "deleted": True}
            )
        if table == "dm_messages":
            message["dm"] = True
        out.append(message)
    return out


def message_out(row: dict) -> dict:
    return messages_out([row], "messages")[0]


def find_message(message_id: str) -> tuple[str, dict] | None:
    """(table, row) of a channel or DM message by id."""
    for table in ("messages", "dm_messages"):
        rows = query(f"SELECT * FROM {table} WHERE id = ?", (message_id,))
        if rows:
            return table, rows[0]
    return None


def can_read_message(user_id: str, table: str, row: dict) -> bool:
    return table == "messages" or dm_for(user_id, row["dm_id"]) is not None


async def emit_to_readers(event: str, payload: dict, table: str, row: dict) -> None:
    """Channel messages are public to the server; DM ones go only to the members' tabs."""
    if table == "messages":
        await sio.emit(event, payload)
    else:
        await sio.emit(event, payload, to=dm_rooms(row["dm_id"]))


def message_body(user_id: str, data) -> tuple[str, str, list[str]]:
    """Text, attachments (as stored JSON) and upload ids from a send payload; raises ValueError with a reason.

    Attachments are ids from POST /api/uploads; only the sender's own, not-yet-sent uploads can be attached,
    because sending fixes who may see the image (see claim_uploads).
    """
    data = data or {}
    content = str(data.get("content", "")).strip()
    ids = data.get("attachments") or []
    if not isinstance(ids, list) or len(ids) > MAX_ATTACHMENTS:
        raise Rejected("tooManyImages", f"Не больше {MAX_ATTACHMENTS} картинок в одном сообщении", n=MAX_ATTACHMENTS)
    ids = list(dict.fromkeys(str(i) for i in ids))
    uploads = {}
    if ids:
        marks = ", ".join("?" * len(ids))
        uploads = {
            r["id"]: r
            for r in query(f"SELECT * FROM uploads WHERE user_id = ? AND scope IS NULL AND id IN ({marks})", (user_id, *ids))
        }
    if len(uploads) != len(ids):
        raise Rejected("fileMissing", "Файл не найден, прикрепи его ещё раз")
    if len(content) > MAX_MESSAGE_LEN or (not content and not ids):
        raise Rejected("badMessage", "Пустое или слишком длинное сообщение")
    attachments = [attachment_out(uploads[i]) for i in ids]
    return content, json.dumps(attachments), ids


def reply_target(table: str, conversation_column: str, conversation_id: str, data) -> str | None:
    """The id of the message being answered, if it's in the same conversation."""
    reply_to = str((data or {}).get("replyTo") or "")
    if not reply_to:
        return None
    if not query(f"SELECT 1 FROM {table} WHERE id = ? AND {conversation_column} = ?", (reply_to, conversation_id)):
        raise Rejected("replyGone", "Сообщение для ответа уже удалено")
    return reply_to


class ChannelIn(BaseModel):
    name: str = Field(min_length=1, max_length=32)
    kind: str = Field(pattern="^(text|voice)$")
    categoryId: str | None = Field(default=None, max_length=64)


class CategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=32)


class CategoryOrderIn(BaseModel):
    ids: list[str] = Field(max_length=100)


class ChannelCategoryIn(BaseModel):
    categoryId: str | None = Field(default=None, max_length=64)


class ChannelRenameIn(BaseModel):
    name: str = Field(min_length=1, max_length=32)


class ChannelOrderIn(BaseModel):
    ids: list[str] = Field(max_length=200)


class ChannelMuteIn(BaseModel):
    muted: bool


MAX_COUNT = 99
TRASH_TTL_MS = 7 * 24 * 3600 * 1000


def read_marks(user: dict) -> dict[str, int]:
    """Where the person has read up to, per conversation; anything older than their account counts as read."""
    return {r["conversation_id"]: r["read_at"] for r in query("SELECT conversation_id, read_at FROM read_states WHERE user_id = ?", (user["id"],))}


def unread_counts(user: dict) -> tuple[dict[str, int], dict[str, int]]:
    """Unread messages and unread mentions of this person (or of everyone) per channel and DM, capped at 99."""
    marks = read_marks(user)
    since = lambda conversation_id: marks.get(conversation_id, user["createdAt"])  # noqa: E731
    mention = f"%<@{user['id']}>%"
    unread, mentions = {}, {}
    # Voice rooms count too: they have a chat of their own beside the call.
    conversations = [("messages", "channel_id", c["id"]) for c in query("SELECT id FROM channels WHERE deleted_at IS NULL")]
    conversations += [("dm_messages", "dm_id", r["dm_id"]) for r in query("SELECT dm_id FROM dm_members WHERE user_id = ?", (user["id"],))]
    with connect_db() as conn:
        for table, column, conversation_id in conversations:
            row = conn.execute(
                f"""SELECT COUNT(*) AS n,
                           SUM(CASE WHEN content LIKE ? OR content LIKE '%<@all>%' THEN 1 ELSE 0 END) AS m
                    FROM (SELECT content FROM {table} WHERE {column} = ? AND created_at > ? AND user_id != ? LIMIT ?)""",
                (mention, conversation_id, since(conversation_id), user["id"], MAX_COUNT),
            ).fetchone()
            if row["n"]:
                unread[conversation_id] = row["n"]
            if row["m"]:
                mentions[conversation_id] = row["m"]
    return unread, mentions


class ReadIn(BaseModel):
    conversationId: str = Field(max_length=64)
    at: int


async def save_read(user: dict, conversation_id: str, at: int) -> bool:
    """Read a channel or DM up to `at` (a message time); never goes backwards. Other tabs and devices hear of it."""
    readable = query("SELECT 1 FROM channels WHERE id = ? AND deleted_at IS NULL", (conversation_id,)) or dm_for(user["id"], conversation_id)
    if not readable:
        return False
    at = min(at, now_ms())
    execute(
        """INSERT INTO read_states (user_id, conversation_id, read_at) VALUES (?, ?, ?)
           ON CONFLICT (user_id, conversation_id) DO UPDATE SET read_at = MAX(read_at, excluded.read_at)""",
        (user["id"], conversation_id, at),
    )
    await sio.emit("read:state", {"conversationId": conversation_id, "at": at}, to=user_room(user["id"]))
    return True


@router.post("/api/read")
async def mark_read(body: ReadIn, user: dict = Depends(current_user)):
    """The same as the socket's "read", for when the socket is down."""
    if not await save_read(user, body.conversationId, body.at):
        raise ApiError(404, "noConversation", "Нет такого разговора")
    return {"ok": True}


def history_boundary(before: int | None, before_id: str, prefix: str = "") -> tuple[str, tuple]:
    at = before if before is not None else now_ms() + 1
    if before_id and before is not None:
        return f"({prefix}created_at < ? OR ({prefix}created_at = ? AND {prefix}id < ?))", (at, at, before_id)
    return f"{prefix}created_at < ?", (at,)


@router.get("/api/inbox")
def inbox(before: int | None = None, before_id: str = Query("", alias="beforeId", max_length=64), user: dict = Depends(current_user)):
    """Messages that mention you (or everyone) or answer you, from every channel and your DMs, newest first."""
    marks = read_marks(user)
    mention = f"%<@{user['id']}>%"
    boundary, cursor = history_boundary(before, before_id, "m.")
    channel_rows = query(
        f"""SELECT m.* FROM messages m JOIN channels c ON c.id = m.channel_id AND c.deleted_at IS NULL
           WHERE m.user_id != ? AND {boundary}
             AND (m.content LIKE ? OR m.content LIKE '%<@all>%'
                  OR m.reply_to IN (SELECT id FROM messages WHERE user_id = ?))
           ORDER BY m.created_at DESC, m.id DESC LIMIT 40""",
        (user["id"], *cursor, mention, user["id"]),
    )
    dm_rows = query(
        f"""SELECT m.* FROM dm_messages m JOIN dm_members dm ON dm.dm_id = m.dm_id AND dm.user_id = ?
           WHERE m.user_id != ? AND {boundary}
             AND (m.content LIKE ? OR m.content LIKE '%<@all>%'
                  OR m.reply_to IN (SELECT id FROM dm_messages WHERE user_id = ?))
           ORDER BY m.created_at DESC, m.id DESC LIMIT 40""",
        (user["id"], user["id"], *cursor, mention, user["id"]),
    )
    items = messages_out(channel_rows, "messages") + messages_out(dm_rows, "dm_messages")
    items.sort(key=lambda m: (m["createdAt"], m["id"]), reverse=True)
    for m in items[:40]:
        m["unread"] = m["createdAt"] > marks.get(m["channelId"], user["createdAt"])
    return items[:40]


@router.get("/api/channels/{channel_id}/messages")
def channel_messages(channel_id: str, before: int | None = None, limit: int = 50,
                     before_id: str = Query("", alias="beforeId", max_length=64), user: dict = Depends(current_user)):
    limit = max(1, min(limit, 100))
    if not query("SELECT 1 FROM channels WHERE id = ? AND deleted_at IS NULL", (channel_id,)):
        raise ApiError(404, "noChannel", "Нет такого канала")
    boundary, cursor = history_boundary(before, before_id)
    rows = query(
        f"SELECT * FROM messages WHERE channel_id = ? AND {boundary} ORDER BY created_at DESC, id DESC LIMIT ?",
        (channel_id, *cursor, limit),
    )
    return messages_out(list(reversed(rows)), "messages")


def channel_name(raw: str, kind: str) -> str:
    """Spaces squeezed; text channels are lower-case-with-dashes, Discord-style. Raises 400 when nothing is left."""
    name = " ".join(raw.split())
    if kind == "text":
        name = name.lower().replace(" ", "-")
    if not name:
        raise ApiError(400, "emptyName", "Пустое название")
    return name


def channel_or_404(channel_id: str) -> dict:
    rows = query("SELECT * FROM channels WHERE id = ? AND deleted_at IS NULL", (channel_id,))
    if not rows:
        raise ApiError(404, "noChannel", "Нет такого канала")
    return rows[0]


def muted_channels(user_id: str) -> list[str]:
    return [r["channel_id"] for r in query("SELECT channel_id FROM channel_mutes WHERE user_id = ?", (user_id,))]


@router.post("/api/channels")
async def create_channel(body: ChannelIn, user: dict = Depends(current_user)):
    if not is_admin(user):
        raise ApiError(403, "adminCreateChannels", "Каналы создаёт только админ")
    name = channel_name(body.name, body.kind)
    category = category_or_404(body.categoryId)["id"] if body.categoryId else None
    position = query("SELECT COALESCE(MAX(position), 0) + 1 AS p FROM channels WHERE deleted_at IS NULL")[0]["p"]
    execute(
        "INSERT INTO channels (id, name, kind, position, created_at, category_id) VALUES (?, ?, ?, ?, ?, ?)",
        (uuid.uuid4().hex, name, body.kind, position, now_ms(), category),
    )
    return await send_layout()


@router.patch("/api/channels/{channel_id}")
async def rename_channel(channel_id: str, body: ChannelRenameIn, user: dict = Depends(current_user)):
    if not is_admin(user):
        raise ApiError(403, "adminRenameChannels", "Каналы переименовывает только админ")
    channel = channel_or_404(channel_id)
    execute("UPDATE channels SET name = ? WHERE id = ?", (channel_name(body.name, channel["kind"]), channel_id))
    return await send_layout()


@router.put("/api/channels/order")
async def reorder_channels(body: ChannelOrderIn, user: dict = Depends(current_user)):
    """The new order of one kind of channel in one category (or in none), dragged in the list; the rest keep their places."""
    if not is_admin(user):
        raise ApiError(403, "adminMoveChannels", "Каналы двигает только админ")
    current = list_channels()
    by_id = {c["id"]: c for c in current}
    groups = {(by_id[i]["kind"], by_id[i]["categoryId"]) for i in body.ids if i in by_id}
    if len(groups) != 1:
        raise ApiError(400, "wrongList", "Не тот список")
    group = groups.pop()
    same = [c["id"] for c in current if (c["kind"], c["categoryId"]) == group]
    if sorted(body.ids) != sorted(same):
        raise ApiError(409, "channelsChanged", "Список каналов изменился")
    moved = iter(body.ids)
    order = [next(moved) if (c["kind"], c["categoryId"]) == group else c["id"] for c in current]
    with connect_db() as conn:
        conn.executemany("UPDATE channels SET position = ? WHERE id = ?", list(enumerate(order)))
    return await send_layout()


@router.put("/api/channels/{channel_id}/mute")
async def mute_channel(channel_id: str, body: ChannelMuteIn, user: dict = Depends(current_user)):
    channel_or_404(channel_id)
    if body.muted:
        execute("INSERT OR IGNORE INTO channel_mutes (user_id, channel_id) VALUES (?, ?)", (user["id"], channel_id))
    else:
        execute("DELETE FROM channel_mutes WHERE user_id = ? AND channel_id = ?", (user["id"], channel_id))
    muted = muted_channels(user["id"])
    # Their other devices follow.
    await sio.emit("channels:muted", muted, to=user_room(user["id"]))
    return muted


def purge_channel(channel_id: str) -> None:
    """Delete a channel for good, with its messages, reactions, read marks and uploads."""
    # All channels share the 'channel' upload scope, so this channel's images are found through its messages.
    upload_ids = sorted(
        {
            a["url"].rsplit("/", 1)[-1]
            for r in query("SELECT attachments FROM messages WHERE channel_id = ? AND attachments != '[]'", (channel_id,))
            for a in json.loads(r["attachments"])
        }
    )
    with connect_db() as conn:
        if upload_ids:
            conn.execute(f"DELETE FROM uploads WHERE id IN ({', '.join('?' * len(upload_ids))})", upload_ids)
        # No foreign key reaches reactions or read marks (see leave_group), so they go by hand, before the messages.
        conn.execute("DELETE FROM reactions WHERE message_id IN (SELECT id FROM messages WHERE channel_id = ?)", (channel_id,))
        conn.execute("DELETE FROM read_states WHERE conversation_id = ?", (channel_id,))
        conn.execute("DELETE FROM messages WHERE channel_id = ?", (channel_id,))
        conn.execute("DELETE FROM channels WHERE id = ?", (channel_id,))
    remove_upload_files(upload_ids)


def purge_deleted_channels() -> int:
    """Channels that have been in the trash for a week go for good."""
    ids = [r["id"] for r in query("SELECT id FROM channels WHERE deleted_at IS NOT NULL AND deleted_at < ?", (now_ms() - TRASH_TTL_MS,))]
    for channel_id in ids:
        purge_channel(channel_id)
    return len(ids)


@router.get("/api/channels/deleted")
def deleted_channels(user: dict = Depends(current_user)):
    if not is_admin(user):
        raise ApiError(403, "adminSeeDeleted", "Удалённые каналы видит только админ")
    return query(
        """SELECT c.id, c.name, c.kind, c.deleted_at AS deletedAt,
                  (SELECT COUNT(*) FROM messages m WHERE m.channel_id = c.id) AS messages
           FROM channels c WHERE c.deleted_at IS NOT NULL ORDER BY c.deleted_at DESC"""
    )


@router.post("/api/channels/{channel_id}/restore")
async def restore_channel(channel_id: str, user: dict = Depends(current_user)):
    if not is_admin(user):
        raise ApiError(403, "adminRestoreChannels", "Каналы возвращает только админ")
    if not query("SELECT 1 FROM channels WHERE id = ? AND deleted_at IS NOT NULL", (channel_id,)):
        raise ApiError(404, "noChannel", "Нет такого канала")
    execute("UPDATE channels SET deleted_at = NULL WHERE id = ?", (channel_id,))
    # Its category may have gone meanwhile: then it comes back to the plain sections.
    execute("UPDATE channels SET category_id = NULL WHERE id = ? AND category_id NOT IN (SELECT id FROM categories)", (channel_id,))
    return await send_layout()


@router.delete("/api/channels/{channel_id}")
async def delete_channel(channel_id: str, user: dict = Depends(current_user)):
    if not is_admin(user):
        raise ApiError(403, "adminDeleteChannels", "Каналы удаляет только админ")
    if channel_or_404(channel_id)["kind"] == "text" and query("SELECT COUNT(*) AS n FROM channels WHERE kind = 'text' AND deleted_at IS NULL")[0]["n"] <= 1:
        raise ApiError(400, "lastTextChannel", "Последний текстовый канал удалить нельзя")
    execute("UPDATE channels SET deleted_at = ? WHERE id = ?", (now_ms(), channel_id))
    purge_deleted_channels()
    channels = await send_layout()
    # Whoever was in the room is hung up; their apps leave the LiveKit room once the channel is gone.
    in_room = [sid for sid, e in voice.items() if e["kind"] == "channel" and e["channelId"] == channel_id]
    for sid in in_room:
        del voice[sid]
    if in_room:
        await sio.emit("voice:state", voice_payload())
    return channels


def category_or_404(category_id: str | None) -> dict:
    rows = query("SELECT * FROM categories WHERE id = ?", (category_id,)) if category_id else []
    if not rows:
        raise ApiError(404, "noCategory", "Нет такой категории")
    return rows[0]


def category_name(raw: str) -> str:
    name = " ".join(raw.split())
    if not name:
        raise ApiError(400, "emptyName", "Пустое название")
    return name


@router.post("/api/categories")
async def create_category(body: CategoryIn, user: dict = Depends(current_user)):
    if not is_admin(user):
        raise ApiError(403, "adminCategories", "Категориями управляет только админ")
    position = query("SELECT COALESCE(MAX(position), 0) + 1 AS p FROM categories")[0]["p"]
    execute("INSERT INTO categories (id, name, position, created_at) VALUES (?, ?, ?, ?)", (uuid.uuid4().hex, category_name(body.name), position, now_ms()))
    await send_layout()
    return list_categories()


@router.patch("/api/categories/{category_id}")
async def rename_category(category_id: str, body: CategoryIn, user: dict = Depends(current_user)):
    if not is_admin(user):
        raise ApiError(403, "adminCategories", "Категориями управляет только админ")
    category_or_404(category_id)
    execute("UPDATE categories SET name = ? WHERE id = ?", (category_name(body.name), category_id))
    await send_layout()
    return list_categories()


@router.delete("/api/categories/{category_id}")
async def delete_category(category_id: str, user: dict = Depends(current_user)):
    """The category goes; its channels stay, in the plain sections."""
    if not is_admin(user):
        raise ApiError(403, "adminCategories", "Категориями управляет только админ")
    category_or_404(category_id)
    with connect_db() as conn:
        conn.execute("UPDATE channels SET category_id = NULL WHERE category_id = ?", (category_id,))
        conn.execute("DELETE FROM categories WHERE id = ?", (category_id,))
    await send_layout()
    return list_categories()


@router.put("/api/categories/order")
async def reorder_categories(body: CategoryOrderIn, user: dict = Depends(current_user)):
    if not is_admin(user):
        raise ApiError(403, "adminCategories", "Категориями управляет только админ")
    if sorted(body.ids) != sorted(c["id"] for c in list_categories()):
        raise ApiError(409, "categoriesChanged", "Список категорий изменился")
    with connect_db() as conn:
        conn.executemany("UPDATE categories SET position = ? WHERE id = ?", list(enumerate(body.ids)))
    await send_layout()
    return list_categories()


@router.put("/api/channels/{channel_id}/category")
async def move_channel(channel_id: str, body: ChannelCategoryIn, user: dict = Depends(current_user)):
    """Into a category (at its end), or out of any (categoryId null) back into the plain sections."""
    if not is_admin(user):
        raise ApiError(403, "adminMoveChannels", "Каналы двигает только админ")
    channel_or_404(channel_id)
    category = category_or_404(body.categoryId)["id"] if body.categoryId else None
    position = query("SELECT COALESCE(MAX(position), 0) + 1 AS p FROM channels WHERE deleted_at IS NULL")[0]["p"]
    execute("UPDATE channels SET category_id = ?, position = ? WHERE id = ?", (category, position, channel_id))
    return await send_layout()


# The other atrium modules import this one too: they come last, once everything above is defined.
from .dms import dm_for, dm_rooms
from .uploads import attachment_out, remove_upload_files
from .realtime import sio, user_room, voice, voice_payload
