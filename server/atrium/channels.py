"""Server channels and messages in general: how a message looks to the client, read marks, the inbox, channel admin."""

import json
import re
import uuid

from fastapi import APIRouter, Depends, Query
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from .config import MAX_ATTACHMENTS, MAX_MESSAGE_LEN, MAX_TIME, MENTION
from .errors import ApiError, Rejected
from .db import connect_db, execute, now_ms, query
from .auth import current_user


router = APIRouter()


def list_channels() -> list[dict]:
    """Every channel, private ones included: for what each person sees, channels_for()."""
    rows = query(
        "SELECT id, name, kind, position, category_id AS categoryId, private FROM channels WHERE deleted_at IS NULL ORDER BY position, created_at"
    )
    return [{**r, "private": bool(r["private"])} for r in rows]


def list_categories() -> list[dict]:
    return query("SELECT id, name, position FROM categories ORDER BY position, created_at")


async def send_layout(user: dict | None = None) -> list[dict]:
    """The categories, then the channels, to everyone (clients from before categories just ignore the first): one
    list for all while every channel is public, otherwise each person's own. Returns what `user` sees."""
    await sio.emit("categories", list_categories())
    channels = list_channels()
    if not any(c["private"] for c in channels):
        await sio.emit("channels", channels)
    else:
        for user_id in online_users():
            hidden = hidden_channels(user_id)
            await sio.emit("channels", [c for c in channels if c["id"] not in hidden], to=user_room(user_id))
    return channels_for(user["id"]) if user else channels


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
    pinned = set()
    if table == "messages" and rows:
        ids = [r["id"] for r in rows]
        pinned = {r["message_id"] for r in query(f"SELECT message_id FROM message_pins WHERE message_id IN ({','.join('?' for _ in ids)})", tuple(ids))}
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
            "pinned": r["id"] in pinned,
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
    if table == "messages":
        return can_see_channel(user_id, row["channel_id"])
    return dm_for(user_id, row["dm_id"]) is not None


async def emit_to_readers(event: str, payload: dict, table: str, row: dict) -> None:
    """Channel messages go to whoever sees the channel; DM ones only to the members' tabs."""
    if table == "messages":
        await emit_channel(event, payload, row["channel_id"])
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
    # Made private from the start: seen by its maker (and admins) until access is given to roles or people.
    private: bool = False


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


def unread_snapshot(user: dict) -> dict:
    marks = read_marks(user)
    unread, mentions, first, manual = {}, {}, {}, {}
    conversations = [("messages", "channel_id", c["id"]) for c in channels_for(user["id"])]
    conversations += [("dm_messages", "dm_id", r["dm_id"]) for r in query("SELECT dm_id FROM dm_members WHERE user_id = ?", (user["id"],))]
    with connect_db() as conn:
        markers = {r["conversation_id"]: r for r in conn.execute("SELECT * FROM unread_markers WHERE user_id = ?", (user["id"],))}
        for table, column, cid in conversations:
            marker = markers.get(cid)
            if marker:
                predicate = "(created_at, id) >= (?, ?) AND (user_id != ? OR id = ?)"
                params = (marker["message_at"], marker["message_id"], user["id"], marker["message_id"])
                manual[cid] = marker["token"]
            else:
                predicate = "created_at > ? AND user_id != ?"
                params = (marks.get(cid, user["createdAt"]), user["id"])
            rows = conn.execute(
                f"SELECT id, content FROM {table} WHERE {column} = ? AND {predicate} ORDER BY created_at, id LIMIT ?",
                (cid, *params, MAX_COUNT),
            ).fetchall()
            if rows:
                first[cid] = rows[0]["id"]
                unread[cid] = len(rows)
                count = sum(f"<@{user['id']}>" in r["content"] or "<@all>" in r["content"] for r in rows)
                if count:
                    mentions[cid] = count
    return {"unread": unread, "mentions": mentions, "firstUnread": first, "manualUnread": manual}


@router.post("/api/messages/{message_id}/unread")
async def mark_unread(message_id: str, user: dict = Depends(current_user)):
    target = find_message(message_id)
    if not target or not can_read_message(user["id"], *target):
        raise ApiError(404, "noMessage", "Нет такого сообщения")
    table, row = target
    cid = row["dm_id"] if table == "dm_messages" else row["channel_id"]
    if table == "messages":
        channel_or_404(cid, user)
    token = uuid.uuid4().hex
    execute("""INSERT INTO unread_markers (user_id, conversation_id, message_id, message_at, token)
               VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, conversation_id) DO UPDATE SET
               message_id=excluded.message_id, message_at=excluded.message_at, token=excluded.token""",
            (user["id"], cid, message_id, row["created_at"], token))
    snapshot = unread_snapshot(user)
    event = {"conversationId": cid, "first": snapshot["firstUnread"].get(cid), "count": snapshot["unread"].get(cid, 0),
             "mentions": snapshot["mentions"].get(cid, 0), "token": token}
    await sio.emit("unread:marker", event, to=user_room(user["id"]))
    return event


@router.get("/api/channels/{channel_id}/pins")
def list_pins(channel_id: str, user: dict = Depends(current_user)):
    channel_or_404(channel_id, user)
    return messages_out(query("""SELECT m.* FROM messages m JOIN message_pins p ON p.message_id = m.id
                                 WHERE m.channel_id = ? ORDER BY p.pinned_at DESC, m.id""", (channel_id,)), "messages")


class PinIn(BaseModel):
    pinned: bool


@router.put("/api/channels/{channel_id}/pins/{message_id}")
async def set_pin(channel_id: str, message_id: str, body: PinIn, user: dict = Depends(current_user)):
    channel_or_404(channel_id, user)
    if not can(user, "manageMessages"):
        raise ApiError(403, "noPermission", "Недостаточно прав")
    if not query("SELECT 1 FROM messages WHERE channel_id = ? AND id = ?", (channel_id, message_id)):
        raise ApiError(404, "noMessage", "Нет такого сообщения")
    if body.pinned:
        execute("INSERT OR IGNORE INTO message_pins SELECT id, ? FROM messages WHERE id = ? AND channel_id = ?",
                (now_ms(), message_id, channel_id))
    else:
        execute("DELETE FROM message_pins WHERE message_id = ?", (message_id,))
    await emit_channel("pins:changed", {"channelId": channel_id, "id": message_id, "pinned": body.pinned}, channel_id)
    return {"ok": True}


class ReadIn(BaseModel):
    conversationId: str = Field(max_length=64)
    at: int = Field(ge=0, le=MAX_TIME)
    marker: str | None = Field(default=None, max_length=64)


async def save_read(user: dict, conversation_id: str, at: int, marker: str | None = None) -> bool:
    """Read a channel or DM up to `at` (a message time); never goes backwards. Other tabs and devices hear of it."""
    readable = (
        query("SELECT 1 FROM channels WHERE id = ? AND deleted_at IS NULL", (conversation_id,)) and can_see_channel(user["id"], conversation_id)
    ) or dm_for(user["id"], conversation_id)
    if not readable:
        return False
    at = max(0, min(at, now_ms()))
    with connect_db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        current = conn.execute("SELECT token FROM unread_markers WHERE user_id = ? AND conversation_id = ?", (user["id"], conversation_id)).fetchone()
        if current and current["token"] != marker:
            return True
        if current:
            conn.execute("DELETE FROM unread_markers WHERE user_id = ? AND conversation_id = ?", (user["id"], conversation_id))
        conn.execute("""INSERT INTO read_states (user_id, conversation_id, read_at) VALUES (?, ?, ?)
                        ON CONFLICT (user_id, conversation_id) DO UPDATE SET read_at = MAX(read_at, excluded.read_at)""",
                     (user["id"], conversation_id, at))
        conn.commit()
    await sio.emit("read:state", {"conversationId": conversation_id, "at": at, "marker": marker}, to=user_room(user["id"]))
    return True


@router.post("/api/read")
async def mark_read(body: ReadIn, user: dict = Depends(current_user)):
    """The same as the socket's "read", for when the socket is down."""
    if not await save_read(user, body.conversationId, body.at, body.marker):
        raise ApiError(404, "noConversation", "Нет такого разговора")
    return {"ok": True}


def history_boundary(before: int | None, before_id: str, prefix: str = "") -> tuple[str, tuple]:
    at = before if before is not None else now_ms() + 1
    if before_id and before is not None:
        return f"({prefix}created_at < ? OR ({prefix}created_at = ? AND {prefix}id < ?))", (at, at, before_id)
    return f"{prefix}created_at < ?", (at,)


@router.get("/api/inbox")
def inbox(before: int | None = Query(None, ge=0, le=MAX_TIME), before_id: str = Query("", alias="beforeId", max_length=64), user: dict = Depends(current_user)):
    """Messages that mention you (or everyone) or answer you, from every channel and your DMs, newest first."""
    marks = read_marks(user)
    mention = f"%<@{user['id']}>%"
    boundary, cursor = history_boundary(before, before_id, "m.")
    hidden = sorted(hidden_channels(user["id"]))
    channel_rows = query(
        f"""SELECT m.* FROM messages m JOIN channels c ON c.id = m.channel_id AND c.deleted_at IS NULL
           WHERE m.user_id != ? AND {boundary}
             {f"AND c.id NOT IN ({', '.join('?' * len(hidden))})" if hidden else ""}
             AND (m.content LIKE ? OR m.content LIKE '%<@all>%'
                  OR m.reply_to IN (SELECT id FROM messages WHERE user_id = ?))
           ORDER BY m.created_at DESC, m.id DESC LIMIT 40""",
        (user["id"], *cursor, *hidden, mention, user["id"]),
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


@router.get("/api/messages/{message_id}/context")
def message_context(message_id: str, user: dict = Depends(current_user)):
    target = find_message(message_id)
    if not target or not can_read_message(user["id"], *target):
        raise ApiError(404, "noMessage", "Нет такого сообщения")
    table, row = target
    column = "dm_id" if table == "dm_messages" else "channel_id"
    if column == "channel_id":
        channel_or_404(row[column], user)
    anchor = (row[column], row["created_at"], row["id"])
    # Two composite-index seeks, independent of the distance from the newest message.
    rows = query(f"""SELECT * FROM (
                       SELECT * FROM {table} WHERE {column} = ? AND (created_at, id) <= (?, ?)
                       ORDER BY created_at DESC, id DESC LIMIT 21)
                     UNION ALL SELECT * FROM (
                       SELECT * FROM {table} WHERE {column} = ? AND (created_at, id) > (?, ?)
                       ORDER BY created_at, id LIMIT 20)
                     ORDER BY created_at, id""", anchor + anchor)
    if not any(r["id"] == message_id for r in rows):
        raise ApiError(404, "noMessage", "Нет такого сообщения")
    return messages_out(rows, table)


@router.get("/api/messages/search")
def search_messages(q: str = Query("", max_length=256), author: str = Query("", max_length=64),
                    conversation: str = Query("", max_length=64), file: bool = False, link: bool = False,
                    before: int | None = Query(None, ge=0, le=MAX_TIME),
                    before_id: str = Query("", alias="beforeId", max_length=64), user: dict = Depends(current_user)):
    terms = re.findall(r"[^\W_]+", q, re.UNICODE)
    if not (terms or author or conversation or file or link) or (q.strip() and not terms):
        return []
    match = " AND ".join(f'"{term}"*' for term in terms)
    boundary, cursor = history_boundary(before, before_id, "m.")
    hidden = sorted(hidden_channels(user["id"]))
    rows = []
    for table, column in (("messages", "channel_id"), ("dm_messages", "dm_id")):
        where, params = [boundary], list(cursor)
        if column == "channel_id":
            join = "JOIN channels c ON c.id = m.channel_id"
            where.append("c.deleted_at IS NULL")
            if hidden:
                where.append(f"c.id NOT IN ({', '.join('?' * len(hidden))})")
                params.extend(hidden)
        else:
            join = "JOIN dm_members peers ON peers.dm_id = m.dm_id"
            where.append("peers.user_id = ?")
            params.append(user["id"])
        if match:
            where.append(f"m.rowid IN (SELECT rowid FROM {table}_fts WHERE {table}_fts MATCH ?)")
            params.append(match)
        if conversation:
            where.append(f"m.{column} = ?")
            params.append(conversation)
        if author:
            where.append("m.user_id = ?")
            params.append(author)
        if file:
            where.append("json_array_length(m.attachments) > 0")
        if link:
            where.append("message_has_link(m.content)")
        where.append("m.user_id NOT IN (SELECT blocked_id FROM blocks WHERE user_id = ?)")
        params.append(user["id"])
        rows.extend(query(
            f"""SELECT m.id, m.{column} AS channelId, m.user_id AS userId, m.content,
                       m.created_at AS createdAt, json_array_length(m.attachments) AS fileCount,
                       {int(column == "dm_id")} AS dm
                FROM {table} m {join} WHERE {' AND '.join(where)}
                ORDER BY m.created_at DESC, m.id DESC LIMIT 40""", tuple(params)))
    return sorted(rows, key=lambda row: (row["createdAt"], row["id"]), reverse=True)[:40]


@router.get("/api/channels/{channel_id}/messages")
def channel_messages(channel_id: str, before: int | None = Query(None, ge=0, le=MAX_TIME), limit: int = 50,
                     before_id: str = Query("", alias="beforeId", max_length=64), user: dict = Depends(current_user)):
    limit = max(1, min(limit, 100))
    channel_or_404(channel_id, user)
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


def channel_or_404(channel_id: str, user: dict | None = None) -> dict:
    """A channel that isn't in the trash; with `user`, also one they see (a private one is 404 to everyone else)."""
    rows = query("SELECT * FROM channels WHERE id = ? AND deleted_at IS NULL", (channel_id,))
    if not rows or (user and not can_see_channel(user["id"], channel_id)):
        raise ApiError(404, "noChannel", "Нет такого канала")
    return rows[0]


def muted_channels(user_id: str) -> list[str]:
    return [r["channel_id"] for r in query("SELECT channel_id FROM channel_mutes WHERE user_id = ?", (user_id,))]


@router.post("/api/channels")
async def create_channel(body: ChannelIn, user: dict = Depends(current_user)):
    if not can(user, "manageChannels"):
        raise ApiError(403, "adminCreateChannels", "Каналы создаёт только админ")
    name = channel_name(body.name, body.kind)
    category = category_or_404(body.categoryId)["id"] if body.categoryId else None
    position = query("SELECT COALESCE(MAX(position), 0) + 1 AS p FROM channels WHERE deleted_at IS NULL")[0]["p"]
    channel_id = uuid.uuid4().hex
    with connect_db() as conn:
        conn.execute(
            "INSERT INTO channels (id, name, kind, position, created_at, category_id) VALUES (?, ?, ?, ?, ?, ?)",
            (channel_id, name, body.kind, position, now_ms(), category),
        )
        if body.private:
            save_channel_access(conn, channel_id, True, set(), keep_myself(access_of(user["id"]), True, set(), set()))
    return await send_layout(user)


@router.patch("/api/channels/{channel_id}")
async def rename_channel(channel_id: str, body: ChannelRenameIn, user: dict = Depends(current_user)):
    if not can(user, "manageChannels"):
        raise ApiError(403, "adminRenameChannels", "Каналы переименовывает только админ")
    channel = channel_or_404(channel_id, user)
    execute("UPDATE channels SET name = ? WHERE id = ?", (channel_name(body.name, channel["kind"]), channel_id))
    return await send_layout(user)


@router.put("/api/channels/order")
async def reorder_channels(body: ChannelOrderIn, user: dict = Depends(current_user)):
    """The new order of one kind of channel in one category (or in none), dragged in the list; the rest keep their places."""
    if not can(user, "manageChannels"):
        raise ApiError(403, "adminMoveChannels", "Каналы двигает только админ")
    current = list_channels()
    # Private channels this person doesn't see keep their places; the ones they see swap among themselves.
    hidden = hidden_channels(user["id"])
    by_id = {c["id"]: c for c in current if c["id"] not in hidden}
    groups = {(by_id[i]["kind"], by_id[i]["categoryId"]) for i in body.ids if i in by_id}
    if len(groups) != 1:
        raise ApiError(400, "wrongList", "Не тот список")
    group = groups.pop()
    moving = lambda c: (c["kind"], c["categoryId"]) == group and c["id"] not in hidden  # noqa: E731
    same = [c["id"] for c in current if moving(c)]
    if sorted(body.ids) != sorted(same):
        raise ApiError(409, "channelsChanged", "Список каналов изменился")
    moved = iter(body.ids)
    order = [next(moved) if moving(c) else c["id"] for c in current]
    with connect_db() as conn:
        conn.executemany("UPDATE channels SET position = ? WHERE id = ?", list(enumerate(order)))
    return await send_layout(user)


@router.put("/api/channels/{channel_id}/mute")
async def mute_channel(channel_id: str, body: ChannelMuteIn, user: dict = Depends(current_user)):
    channel_or_404(channel_id, user)
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
    # Images sent before roles shared one 'channel' scope; going through the messages finds every one of them.
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
        conn.execute("DELETE FROM voice_grants WHERE room = ?", (f"voice-{channel_id}",))
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
    if not can(user, "manageChannels"):
        raise ApiError(403, "adminSeeDeleted", "Удалённые каналы видит только админ")
    hidden = hidden_channels(user["id"])
    rows = query(
        """SELECT c.id, c.name, c.kind, c.deleted_at AS deletedAt,
                  (SELECT COUNT(*) FROM messages m WHERE m.channel_id = c.id) AS messages
           FROM channels c WHERE c.deleted_at IS NOT NULL ORDER BY c.deleted_at DESC"""
    )
    return [r for r in rows if r["id"] not in hidden]


@router.post("/api/channels/{channel_id}/restore")
async def restore_channel(channel_id: str, user: dict = Depends(current_user)):
    if not can(user, "manageChannels"):
        raise ApiError(403, "adminRestoreChannels", "Каналы возвращает только админ")
    if not query("SELECT 1 FROM channels WHERE id = ? AND deleted_at IS NOT NULL", (channel_id,)) or not can_see_channel(user["id"], channel_id):
        raise ApiError(404, "noChannel", "Нет такого канала")
    execute("UPDATE channels SET deleted_at = NULL WHERE id = ?", (channel_id,))
    # Its category may have gone meanwhile: then it comes back to the plain sections.
    execute("UPDATE channels SET category_id = NULL WHERE id = ? AND category_id NOT IN (SELECT id FROM categories)", (channel_id,))
    return await send_layout(user)


@router.delete("/api/channels/{channel_id}")
async def delete_channel(channel_id: str, user: dict = Depends(current_user)):
    if not can(user, "manageChannels"):
        raise ApiError(403, "adminDeleteChannels", "Каналы удаляет только админ")
    if channel_or_404(channel_id, user)["kind"] == "text" and query("SELECT COUNT(*) AS n FROM channels WHERE kind = 'text' AND deleted_at IS NULL")[0]["n"] <= 1:
        raise ApiError(400, "lastTextChannel", "Последний текстовый канал удалить нельзя")
    execute("UPDATE channels SET deleted_at = ? WHERE id = ?", (now_ms(), channel_id))
    # Clearing out week-old trash removes messages and files: off the event loop.
    await run_in_threadpool(purge_deleted_channels)
    channels = await send_layout(user)
    # Whoever was in the room is hung up; their apps leave the LiveKit room once the channel is gone.
    in_room = [sid for sid, e in voice.items() if e["kind"] == "channel" and e["channelId"] == channel_id]
    for sid in in_room:
        del voice[sid]
    if in_room:
        await send_voice_state()
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
    if not can(user, "manageChannels"):
        raise ApiError(403, "adminCategories", "Категориями управляет только админ")
    position = query("SELECT COALESCE(MAX(position), 0) + 1 AS p FROM categories")[0]["p"]
    execute("INSERT INTO categories (id, name, position, created_at) VALUES (?, ?, ?, ?)", (uuid.uuid4().hex, category_name(body.name), position, now_ms()))
    await send_layout()
    return list_categories()


@router.patch("/api/categories/{category_id}")
async def rename_category(category_id: str, body: CategoryIn, user: dict = Depends(current_user)):
    if not can(user, "manageChannels"):
        raise ApiError(403, "adminCategories", "Категориями управляет только админ")
    category_or_404(category_id)
    execute("UPDATE categories SET name = ? WHERE id = ?", (category_name(body.name), category_id))
    await send_layout()
    return list_categories()


@router.delete("/api/categories/{category_id}")
async def delete_category(category_id: str, user: dict = Depends(current_user)):
    """The category goes; its channels stay, in the plain sections."""
    if not can(user, "manageChannels"):
        raise ApiError(403, "adminCategories", "Категориями управляет только админ")
    category_or_404(category_id)
    with connect_db() as conn:
        conn.execute("UPDATE channels SET category_id = NULL WHERE category_id = ?", (category_id,))
        conn.execute("DELETE FROM categories WHERE id = ?", (category_id,))
    await send_layout()
    return list_categories()


@router.put("/api/categories/order")
async def reorder_categories(body: CategoryOrderIn, user: dict = Depends(current_user)):
    if not can(user, "manageChannels"):
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
    if not can(user, "manageChannels"):
        raise ApiError(403, "adminMoveChannels", "Каналы двигает только админ")
    channel_or_404(channel_id, user)
    category = category_or_404(body.categoryId)["id"] if body.categoryId else None
    position = query("SELECT COALESCE(MAX(position), 0) + 1 AS p FROM channels WHERE deleted_at IS NULL")[0]["p"]
    execute("UPDATE channels SET category_id = ?, position = ? WHERE id = ?", (category, position, channel_id))
    return await send_layout(user)


# The other atrium modules import this one too: they come last, once everything above is defined.
from .dms import dm_for, dm_rooms
from .uploads import attachment_out, remove_upload_files
from .realtime import send_voice_state, sio, user_room, voice
from .roles import access_of, can, can_see_channel, channels_for, emit_channel, hidden_channels, keep_myself, online_users, save_channel_access
