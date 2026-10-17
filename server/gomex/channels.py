"""Server channels and messages in general: how a message looks to the client, read marks, the inbox, channel admin."""

import json
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .config import MAX_ATTACHMENTS, MAX_MESSAGE_LEN, MENTION
from .db import connect_db, execute, now_ms, query
from .auth import current_user, is_admin


router = APIRouter()


def list_channels() -> list[dict]:
    return query("SELECT id, name, kind, position FROM channels ORDER BY position, created_at")


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
        raise ValueError(f"Не больше {MAX_ATTACHMENTS} картинок в одном сообщении")
    ids = list(dict.fromkeys(str(i) for i in ids))
    uploads = {}
    if ids:
        marks = ", ".join("?" * len(ids))
        uploads = {
            r["id"]: r
            for r in query(f"SELECT * FROM uploads WHERE user_id = ? AND scope IS NULL AND id IN ({marks})", (user_id, *ids))
        }
    if len(uploads) != len(ids):
        raise ValueError("Файл не найден, прикрепи его ещё раз")
    if len(content) > MAX_MESSAGE_LEN or (not content and not ids):
        raise ValueError("Пустое или слишком длинное сообщение")
    attachments = [attachment_out(uploads[i]) for i in ids]
    return content, json.dumps(attachments), ids


def reply_target(table: str, conversation_column: str, conversation_id: str, data) -> str | None:
    """The id of the message being answered, if it's in the same conversation."""
    reply_to = str((data or {}).get("replyTo") or "")
    if not reply_to:
        return None
    if not query(f"SELECT 1 FROM {table} WHERE id = ? AND {conversation_column} = ?", (reply_to, conversation_id)):
        raise ValueError("Сообщение для ответа уже удалено")
    return reply_to


class ChannelIn(BaseModel):
    name: str = Field(min_length=1, max_length=32)
    kind: str = Field(pattern="^(text|voice)$")


class ChannelRenameIn(BaseModel):
    name: str = Field(min_length=1, max_length=32)


class ChannelOrderIn(BaseModel):
    ids: list[str] = Field(max_length=200)


class ChannelMuteIn(BaseModel):
    muted: bool


MAX_COUNT = 99


def read_marks(user: dict) -> dict[str, int]:
    """Where the person has read up to, per conversation; anything older than their account counts as read."""
    return {r["conversation_id"]: r["read_at"] for r in query("SELECT conversation_id, read_at FROM read_states WHERE user_id = ?", (user["id"],))}


def unread_counts(user: dict) -> tuple[dict[str, int], dict[str, int]]:
    """Unread messages and unread mentions of this person (or of everyone) per channel and DM, capped at 99."""
    marks = read_marks(user)
    since = lambda conversation_id: marks.get(conversation_id, user["createdAt"])  # noqa: E731
    mention = f"%<@{user['id']}>%"
    unread, mentions = {}, {}
    conversations = [("messages", "channel_id", c["id"]) for c in query("SELECT id FROM channels WHERE kind = 'text'")]
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
    readable = query("SELECT 1 FROM channels WHERE id = ? AND kind = 'text'", (conversation_id,)) or dm_for(user["id"], conversation_id)
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
        raise HTTPException(status_code=404, detail="Нет такого разговора")
    return {"ok": True}


@router.get("/api/inbox")
def inbox(before: int | None = None, user: dict = Depends(current_user)):
    """Messages that mention you (or everyone) or answer you, from every channel and your DMs, newest first."""
    marks = read_marks(user)
    mention = f"%<@{user['id']}>%"
    before = before or now_ms() + 1
    channel_rows = query(
        """SELECT m.* FROM messages m
           WHERE m.user_id != ? AND m.created_at < ?
             AND (m.content LIKE ? OR m.content LIKE '%<@all>%'
                  OR m.reply_to IN (SELECT id FROM messages WHERE user_id = ?))
           ORDER BY m.created_at DESC LIMIT 40""",
        (user["id"], before, mention, user["id"]),
    )
    dm_rows = query(
        """SELECT m.* FROM dm_messages m JOIN dm_members dm ON dm.dm_id = m.dm_id AND dm.user_id = ?
           WHERE m.user_id != ? AND m.created_at < ?
             AND (m.content LIKE ? OR m.content LIKE '%<@all>%'
                  OR m.reply_to IN (SELECT id FROM dm_messages WHERE user_id = ?))
           ORDER BY m.created_at DESC LIMIT 40""",
        (user["id"], user["id"], before, mention, user["id"]),
    )
    items = messages_out(channel_rows, "messages") + messages_out(dm_rows, "dm_messages")
    items.sort(key=lambda m: m["createdAt"], reverse=True)
    for m in items[:40]:
        m["unread"] = m["createdAt"] > marks.get(m["channelId"], user["createdAt"])
    return items[:40]


@router.get("/api/channels/{channel_id}/messages")
def channel_messages(channel_id: str, before: int | None = None, limit: int = 50, user: dict = Depends(current_user)):
    limit = max(1, min(limit, 100))
    rows = query(
        "SELECT * FROM messages WHERE channel_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?",
        (channel_id, before or now_ms() + 1, limit),
    )
    return messages_out(list(reversed(rows)), "messages")


def channel_name(raw: str, kind: str) -> str:
    """Spaces squeezed; text channels are lower-case-with-dashes, Discord-style. Raises 400 when nothing is left."""
    name = " ".join(raw.split())
    if kind == "text":
        name = name.lower().replace(" ", "-")
    if not name:
        raise HTTPException(status_code=400, detail="Пустое название")
    return name


def channel_or_404(channel_id: str) -> dict:
    rows = query("SELECT * FROM channels WHERE id = ?", (channel_id,))
    if not rows:
        raise HTTPException(status_code=404, detail="Нет такого канала")
    return rows[0]


def muted_channels(user_id: str) -> list[str]:
    return [r["channel_id"] for r in query("SELECT channel_id FROM channel_mutes WHERE user_id = ?", (user_id,))]


@router.post("/api/channels")
async def create_channel(body: ChannelIn, user: dict = Depends(current_user)):
    if not is_admin(user):
        raise HTTPException(status_code=403, detail="Каналы создаёт только админ")
    name = channel_name(body.name, body.kind)
    position = query("SELECT COALESCE(MAX(position), 0) + 1 AS p FROM channels")[0]["p"]
    execute(
        "INSERT INTO channels (id, name, kind, position, created_at) VALUES (?, ?, ?, ?, ?)",
        (uuid.uuid4().hex, name, body.kind, position, now_ms()),
    )
    channels = list_channels()
    await sio.emit("channels", channels)
    return channels


@router.patch("/api/channels/{channel_id}")
async def rename_channel(channel_id: str, body: ChannelRenameIn, user: dict = Depends(current_user)):
    if not is_admin(user):
        raise HTTPException(status_code=403, detail="Каналы переименовывает только админ")
    channel = channel_or_404(channel_id)
    execute("UPDATE channels SET name = ? WHERE id = ?", (channel_name(body.name, channel["kind"]), channel_id))
    channels = list_channels()
    await sio.emit("channels", channels)
    return channels


@router.put("/api/channels/order")
async def reorder_channels(body: ChannelOrderIn, user: dict = Depends(current_user)):
    """The new order of one kind of channel (dragged in the list); the other kind keeps its places."""
    if not is_admin(user):
        raise HTTPException(status_code=403, detail="Каналы двигает только админ")
    current = list_channels()
    by_id = {c["id"]: c for c in current}
    kinds = {by_id[i]["kind"] for i in body.ids if i in by_id}
    if len(kinds) != 1:
        raise HTTPException(status_code=400, detail="Не тот список")
    kind = kinds.pop()
    same = [c["id"] for c in current if c["kind"] == kind]
    if sorted(body.ids) != sorted(same):
        raise HTTPException(status_code=409, detail="Список каналов изменился")
    moved = iter(body.ids)
    order = [next(moved) if c["kind"] == kind else c["id"] for c in current]
    with connect_db() as conn:
        conn.executemany("UPDATE channels SET position = ? WHERE id = ?", list(enumerate(order)))
    channels = list_channels()
    await sio.emit("channels", channels)
    return channels


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


@router.delete("/api/channels/{channel_id}")
async def delete_channel(channel_id: str, user: dict = Depends(current_user)):
    if not is_admin(user):
        raise HTTPException(status_code=403, detail="Каналы удаляет только админ")
    if channel_or_404(channel_id)["kind"] == "text" and query("SELECT COUNT(*) AS n FROM channels WHERE kind = 'text'")[0]["n"] <= 1:
        raise HTTPException(status_code=400, detail="Последний текстовый канал удалить нельзя")
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
    channels = list_channels()
    await sio.emit("channels", channels)
    # Whoever was in the room is hung up; their apps leave the LiveKit room once the channel is gone.
    in_room = [sid for sid, e in voice.items() if e["kind"] == "channel" and e["channelId"] == channel_id]
    for sid in in_room:
        del voice[sid]
    if in_room:
        await sio.emit("voice:state", voice_payload())
    return channels


# The other gomex modules import this one too: they come last, once everything above is defined.
from .dms import dm_for, dm_rooms
from .uploads import attachment_out, remove_upload_files
from .realtime import sio, user_room, voice, voice_payload
