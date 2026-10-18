"""The live side: Socket.IO events, who is online, voice rooms and calls, LiveKit tokens."""

import asyncio
import json
import re
import time
import urllib.request
import uuid

import jwt
import socketio
from fastapi import APIRouter, Depends
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from .config import (
    LIVEKIT_API,
    LIVEKIT_API_KEY,
    LIVEKIT_API_SECRET,
    LIVEKIT_URL,
    MAX_EMOJI_LEN,
    MAX_MESSAGE_LEN,
    RING_SECONDS,
    VOICE_TOKEN_TTL,
)
from .errors import ApiError, Rejected, socket_error, socket_rejected
from .db import connect_db, execute, now_ms, query
from .auth import MESSAGES_BY_USER, RateLimit, current_user, is_admin, user_from_token


router = APIRouter()


def livekit_token(user: dict, room: str) -> str:
    now = int(time.time())
    claims = {
        "iss": LIVEKIT_API_KEY,
        "sub": user["id"],
        "name": user["name"],
        "nbf": now - 10,
        "exp": now + VOICE_TOKEN_TTL,
        "metadata": json.dumps({"color": user["color"]}),
        "video": {
            "room": room,
            "roomJoin": True,
            "canPublish": True,
            "canSubscribe": True,
            "canPublishData": True,
        },
    }
    return jwt.encode(claims, LIVEKIT_API_SECRET, algorithm="HS256")


def livekit_room(kind: str, target: str) -> str:
    """Separate LiveKit room names: only a DM's members ever get a token for its room."""
    return f"voice-{target}" if kind == "channel" else f"dm-{target}"


def livekit_remove(room: str, identity: str) -> None:
    """Drop someone from a LiveKit room (LiveKit's RoomService API on the same machine). Quietly does nothing
    when they aren't in it or LiveKit can't be reached."""
    now = int(time.time())
    token = jwt.encode(
        {"iss": LIVEKIT_API_KEY, "sub": "gomex-server", "nbf": now - 10, "exp": now + 60, "video": {"room": room, "roomAdmin": True}},
        LIVEKIT_API_SECRET,
        algorithm="HS256",
    )
    request = urllib.request.Request(
        f"{LIVEKIT_API}/twirp/livekit.RoomService/RemoveParticipant",
        data=json.dumps({"room": room, "identity": identity}).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    try:
        urllib.request.urlopen(request, timeout=3).close()
    except OSError:  # URLError/HTTPError: not in the room, or no LiveKit (local dev)
        pass


# --- realtime state ---------------------------------------------------------

sio = socketio.AsyncServer(async_mode="asgi")  # default CORS policy: same origin only

online: dict[str, str] = {}  # sid -> user id
# sid -> {channelId, userId, muted, deafened, video, screen, kind}; kind "channel" = voice room, "dm" = call in a DM/group
voice: dict[str, dict] = {}
# DM/group id -> {"startedAt": ms, "ringing": set of user ids being called, "timer": task that stops the ringing}
calls: dict[str, dict] = {}


def presence_payload() -> list[str]:
    invisible = {r["id"] for r in query("SELECT id FROM users WHERE status = 'invisible'")}
    return sorted(set(online.values()) - invisible)


def voice_payload() -> list[dict]:
    """Who's in which server voice room; public to everyone. DM calls are private and go out as call:state."""
    return [e for e in voice.values() if e["kind"] == "channel"]


def user_room(user_id: str) -> str:
    """Socket.IO room holding every open tab of one user, for private events."""
    return f"user:{user_id}"


# --- calls in DMs and groups ---

def call_payload(dm_id: str) -> dict:
    call = calls.get(dm_id)
    participants = {e["userId"]: e for e in voice.values() if e["channelId"] == dm_id}
    return {
        "dmId": dm_id,
        "participants": list(participants.values()),
        "ringing": sorted(call["ringing"]) if call else [],
        "startedAt": call["startedAt"] if call else None,
    }


async def sync_call(dm_id: str) -> None:
    """Start, update or end the call in a DM after someone joined or left, and tell its members."""
    present = {e["userId"] for e in voice.values() if e["channelId"] == dm_id}
    call = calls.get(dm_id)
    if not present:
        if call:
            if call["timer"]:
                call["timer"].cancel()
            del calls[dm_id]
    elif not call:
        # The first one in starts the call and rings everyone else.
        calls[dm_id] = {"startedAt": now_ms(), "ringing": set(dm_member_ids(dm_id)) - present, "timer": None}
        restart_ring_timer(dm_id)
    else:
        call["ringing"] -= present
    await sio.emit("call:state", call_payload(dm_id), to=dm_rooms(dm_id))


def restart_ring_timer(dm_id: str) -> None:
    call = calls[dm_id]
    if call["timer"]:
        call["timer"].cancel()

    async def stop_ringing():
        await asyncio.sleep(RING_SECONDS)
        current = calls.get(dm_id)
        if current is call and call["ringing"]:
            call["ringing"].clear()
            await sio.emit("call:state", call_payload(dm_id), to=dm_rooms(dm_id))

    call["timer"] = asyncio.create_task(stop_ringing())


async def voice_changed(entry: dict) -> None:
    if entry["kind"] == "dm":
        await sync_call(entry["channelId"])
    else:
        await sio.emit("voice:state", voice_payload())


@sio.event
async def connect(sid, environ, auth):
    user = user_from_token((auth or {}).get("token"))
    if not user:
        raise socketio.exceptions.ConnectionRefusedError("unauthorized")
    await sio.save_session(sid, {"user": user})
    await sio.enter_room(sid, user_room(user["id"]))
    online[sid] = user["id"]
    await sio.emit("presence", presence_payload())
    await sio.emit("voice:state", voice_payload(), to=sid)
    # Calls going on in this user's DMs/groups, including ones ringing them right now.
    for dm_id in list(calls):
        if dm_for(user["id"], dm_id):
            await sio.emit("call:state", call_payload(dm_id), to=sid)


@sio.event
async def disconnect(sid, reason=None):
    online.pop(sid, None)
    entry = voice.pop(sid, None)
    await sio.emit("presence", presence_payload())
    if entry:
        await voice_changed(entry)


@sio.on("message:send")
async def message_send(sid, data):
    user = (await sio.get_session(sid))["user"]
    channel_id = str((data or {}).get("channelId", ""))
    if MESSAGES_BY_USER.wait(user["id"]):
        return socket_error("tooFast", "Слишком часто, пауза пару секунд")
    try:
        content, attachments, upload_ids = message_body(user["id"], data)
    except Rejected as e:
        return socket_rejected(e)
    if not query("SELECT 1 FROM channels WHERE id = ? AND kind = 'text' AND deleted_at IS NULL", (channel_id,)):
        return {"ok": False, "error": "Нет такого канала"}
    try:
        reply_to = reply_target("messages", "channel_id", channel_id, data)
    except Rejected as e:
        return socket_rejected(e)
    row = {
        "id": uuid.uuid4().hex,
        "channel_id": channel_id,
        "user_id": user["id"],
        "content": content,
        "attachments": attachments,
        "created_at": now_ms(),
        "reply_to": reply_to,
    }
    execute(
        "INSERT INTO messages (id, channel_id, user_id, content, attachments, created_at, reply_to) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (row["id"], row["channel_id"], row["user_id"], row["content"], row["attachments"], row["created_at"], row["reply_to"]),
    )
    claim_uploads(upload_ids, "channel")
    message = message_out(row)
    await sio.emit("message:new", message)
    return {"ok": True, "message": message}


@sio.on("dm:send")
async def dm_send(sid, data):
    user = (await sio.get_session(sid))["user"]
    dm = dm_for(user["id"], str((data or {}).get("dmId", "")))
    if not dm:
        return {"ok": False, "error": "Нет такой переписки"}
    if dm["kind"] == "dm" and any(blocked_between(user["id"], m) for m in dm_member_ids(dm["id"]) if m != user["id"]):
        return socket_error("dmBlocked", "Написать нельзя: один из вас заблокировал другого")
    if MESSAGES_BY_USER.wait(user["id"]):
        return socket_error("tooFast", "Слишком часто, пауза пару секунд")
    try:
        content, attachments, upload_ids = message_body(user["id"], data)
    except Rejected as e:
        return socket_rejected(e)
    try:
        reply_to = reply_target("dm_messages", "dm_id", dm["id"], data)
    except Rejected as e:
        return socket_rejected(e)
    row = {
        "id": uuid.uuid4().hex,
        "dm_id": dm["id"],
        "user_id": user["id"],
        "content": content,
        "attachments": attachments,
        "created_at": now_ms(),
        "reply_to": reply_to,
    }
    execute(
        "INSERT INTO dm_messages (id, dm_id, user_id, content, attachments, created_at, reply_to) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (row["id"], row["dm_id"], row["user_id"], row["content"], row["attachments"], row["created_at"], row["reply_to"]),
    )
    claim_uploads(upload_ids, f"dm:{dm['id']}")
    message = dm_message_out(row)
    # Private: only the members' tabs get it.
    await sio.emit("message:new", message, to=dm_rooms(dm["id"]))
    return {"ok": True, "message": message}


@sio.on("typing")
async def typing(sid, data):
    user = (await sio.get_session(sid))["user"]
    if TYPING_BY_USER.wait(user["id"]):
        return
    channel_id = str((data or {}).get("channelId", ""))
    payload = {"channelId": channel_id, "userId": user["id"]}
    if dm_for(user["id"], channel_id):
        await sio.emit("typing", payload, to=[r for r in dm_rooms(channel_id) if r != user_room(user["id"])])
    elif query("SELECT 1 FROM channels WHERE id = ? AND deleted_at IS NULL", (channel_id,)):
        await sio.emit("typing", payload, skip_sid=sid)


@sio.on("message:edit")
async def message_edit(sid, data):
    """Change the text of your own message; pictures and files stay as they were."""
    user = (await sio.get_session(sid))["user"]
    found = find_message(str((data or {}).get("id", "")))
    # Readable as well as yours: someone who left a group mustn't keep rewriting what they said there.
    if not found or not can_read_message(user["id"], *found):
        return socket_error("noMessage", "Нет такого сообщения")
    table, row = found
    if row["user_id"] != user["id"]:
        return socket_error("ownEditOnly", "Можно менять только свои сообщения")
    content = str((data or {}).get("content", "")).strip()
    if len(content) > MAX_MESSAGE_LEN or (not content and row["attachments"] == "[]"):
        return socket_error("badMessage", "Пустое или слишком длинное сообщение")
    if MESSAGES_BY_USER.wait(user["id"]):
        return socket_error("tooFast", "Слишком часто, пауза пару секунд")
    edited_at = now_ms()
    execute(f"UPDATE {table} SET content = ?, edited_at = ? WHERE id = ?", (content, edited_at, row["id"]))
    message = messages_out([{**row, "content": content, "edited_at": edited_at}], table)[0]
    await emit_to_readers("message:updated", message, table, row)
    return {"ok": True, "message": message}


@sio.on("message:delete")
async def message_delete(sid, data):
    """Your own message, or anyone's in a server channel if you're an admin. Its pictures and files go with it."""
    user = (await sio.get_session(sid))["user"]
    found = find_message(str((data or {}).get("id", "")))
    if not found or not can_read_message(user["id"], *found):
        return socket_error("noMessage", "Нет такого сообщения")
    table, row = found
    if row["user_id"] != user["id"] and not (table == "messages" and is_admin(user)):
        return socket_error("ownDeleteOnly", "Можно удалять только свои сообщения")
    upload_ids = [a["url"].rsplit("/", 1)[-1] for a in json.loads(row["attachments"])]
    with connect_db() as conn:
        conn.execute(f"DELETE FROM {table} WHERE id = ?", (row["id"],))
        conn.execute("DELETE FROM reactions WHERE message_id = ?", (row["id"],))
        if upload_ids:
            conn.execute(f"DELETE FROM uploads WHERE id IN ({', '.join('?' * len(upload_ids))})", tuple(upload_ids))
    remove_upload_files(upload_ids)
    conversation = row["dm_id"] if table == "dm_messages" else row["channel_id"]
    await emit_to_readers("message:deleted", {"id": row["id"], "channelId": conversation}, table, row)
    return {"ok": True}


REACTIONS_BY_USER = RateLimit(40, 10)
# These go out to every open tab: a stuck or hostile client mustn't turn them into a flood.
TYPING_BY_USER = RateLimit(10, 10)
VOICE_EVENTS_BY_USER = RateLimit(30, 10)
RINGS_BY_USER = RateLimit(5, 60)
READS_BY_USER = RateLimit(30, 10)
# A report a minute plus one on leaving; a few extra for rejoins.
CALL_QUALITY_BY_USER = RateLimit(10, 60)


@sio.on("reaction:toggle")
async def reaction_toggle(sid, data):
    """Add your reaction with this emoji, or take it back if it's already there."""
    user = (await sio.get_session(sid))["user"]
    emoji = str((data or {}).get("emoji", "")).strip()
    found = find_message(str((data or {}).get("messageId", "")))
    if not found or not can_read_message(user["id"], *found):
        return socket_error("noMessage", "Нет такого сообщения")
    # One emoji (with skin tone / ZWJ joins), never arbitrary text.
    if not emoji or len(emoji) > MAX_EMOJI_LEN or not re.search(r"[\u2190-\u2bff\U0001f000-\U0001faff]", emoji) or re.search(r"[\w\s]", emoji):
        return socket_error("notEmoji", "Это не эмодзи")
    if REACTIONS_BY_USER.wait(user["id"]):
        return socket_error("slowDown", "Не так быстро")
    table, row = found
    with connect_db() as conn:
        removed = conn.execute(
            "DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?", (row["id"], user["id"], emoji)
        ).rowcount
        if not removed:
            if conn.execute("SELECT COUNT(DISTINCT emoji) FROM reactions WHERE message_id = ?", (row["id"],)).fetchone()[0] >= 20:
                return socket_error("reactionLimit", "На сообщении уже 20 разных реакций")
            conn.execute(
                "INSERT INTO reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)",
                (row["id"], user["id"], emoji, now_ms()),
            )
    conversation = row["dm_id"] if table == "dm_messages" else row["channel_id"]
    payload = {"id": row["id"], "channelId": conversation, "reactions": reactions_for([row["id"]]).get(row["id"], [])}
    await emit_to_readers("message:reactions", payload, table, row)
    return {"ok": True}


def voice_target(user_id: str, target: str) -> str | None:
    """'channel' for a server voice room, 'dm' for a DM/group the user is in, None if they can't join it."""
    if query("SELECT 1 FROM channels WHERE id = ? AND kind = 'voice' AND deleted_at IS NULL", (target,)):
        return "channel"
    if dm_for(user_id, target):
        return "dm"
    return None


@sio.on("voice:join")
async def voice_join(sid, data):
    user = (await sio.get_session(sid))["user"]
    if VOICE_EVENTS_BY_USER.wait(user["id"]):
        return
    target = str((data or {}).get("channelId", ""))
    kind = voice_target(user["id"], target)
    if not kind:
        return
    if kind == "dm":
        dm = dm_for(user["id"], target)
        if dm and dm["kind"] == "dm" and any(blocked_between(user["id"], m) for m in dm_member_ids(target) if m != user["id"]):
            return
    previous = voice.get(sid)
    voice[sid] = {
        "channelId": target,
        "userId": user["id"],
        "muted": bool((data or {}).get("muted", False)),
        "deafened": bool((data or {}).get("deafened", False)),
        "video": False,
        "screen": False,
        "kind": kind,
    }
    if previous and previous["channelId"] != target:
        await voice_changed(previous)
    await end_other_devices(sid)
    await voice_changed(voice[sid])


async def end_other_devices(sid: str) -> None:
    """One voice connection per person: joining from another tab or device ends the one before. Otherwise it
    stays in the room's list with its own mute state until its socket drops (a sleeping phone, a forgotten tab)."""
    entry = voice[sid]
    for other in [s for s, e in voice.items() if e["userId"] == entry["userId"] and s != sid]:
        old = voice.pop(other)
        await sio.emit("voice:moved", to=other)
        if old["channelId"] != entry["channelId"]:
            # In the same room LiveKit drops the old connection itself (one per identity); elsewhere it's up to us.
            await run_in_threadpool(livekit_remove, livekit_room(old["kind"], old["channelId"]), entry["userId"])
            await voice_changed(old)


@sio.on("voice:leave")
async def voice_leave(sid, data=None):
    entry = voice.pop(sid, None)
    if entry:
        await voice_changed(entry)


# Broadcasts held back by the rate limit, one per person, so a change is late at worst, never lost.
voice_pending: dict[str, asyncio.Task] = {}


@sio.on("voice:update")
async def voice_update(sid, data):
    entry = voice.get(sid)
    if not entry:
        return
    changed = False
    for key in ("muted", "deafened", "video", "screen"):
        if key in (data or {}) and entry[key] != bool(data[key]):
            entry[key] = bool(data[key])
            changed = True
    # Clients repeat their state (every push-to-talk press, every track change): only a change goes out.
    if not changed:
        return
    wait = VOICE_EVENTS_BY_USER.wait(entry["userId"])
    if not wait:
        await voice_changed(entry)
    elif entry["userId"] not in voice_pending:

        async def later():
            await asyncio.sleep(wait)
            del voice_pending[entry["userId"]]
            await voice_changed(entry)

        voice_pending[entry["userId"]] = asyncio.create_task(later())


@sio.on("call:decline")
async def call_decline(sid, data):
    user = (await sio.get_session(sid))["user"]
    call = calls.get(str((data or {}).get("dmId", "")))
    if call and user["id"] in call["ringing"]:
        call["ringing"].discard(user["id"])
        await sio.emit("call:state", call_payload(data["dmId"]), to=dm_rooms(data["dmId"]))


@sio.on("call:ring")
async def call_ring(sid, data):
    """Someone in the call rings the members who aren't in it (again)."""
    entry = voice.get(sid)
    dm_id = str((data or {}).get("dmId", ""))
    if not entry or entry["channelId"] != dm_id or dm_id not in calls or RINGS_BY_USER.wait(entry["userId"]):
        return
    present = {e["userId"] for e in voice.values() if e["channelId"] == dm_id}
    calls[dm_id]["ringing"] = set(dm_member_ids(dm_id)) - present
    restart_ring_timer(dm_id)
    await sio.emit("call:state", call_payload(dm_id), to=dm_rooms(dm_id))


class VoiceTokenIn(BaseModel):
    channelId: str


async def disconnect_user(user_id: str) -> None:
    """Drop every open socket of this person (their old tokens just stopped working)."""
    for sid in [sid for sid, uid in online.items() if uid == user_id]:
        await sio.disconnect(sid)


@router.post("/api/check-token")
def check_token(user: dict = Depends(current_user)):
    """A LiveKit token for a room of one, to test whether calls get through (setup step and the check page)."""
    return {"token": livekit_token(user, f"check-{user['id']}"), "url": LIVEKIT_URL}


@sio.on("read")
async def read_socket(sid, data):
    """Read marks ride the open socket: no HTTP request per message read."""
    user = (await sio.get_session(sid))["user"]
    if READS_BY_USER.wait(user["id"]):
        return socket_error("slowDown", "Не так быстро")
    try:
        conversation_id, at = str((data or {})["conversationId"])[:64], int(data["at"])
    except (KeyError, TypeError, ValueError):
        return {"ok": False, "error": "Нет такого разговора"}
    if not await save_read(user, conversation_id, at):
        return {"ok": False, "error": "Нет такого разговора"}
    return {"ok": True}


@router.post("/api/voice-token")
def voice_token(body: VoiceTokenIn, user: dict = Depends(current_user)):
    kind = voice_target(user["id"], body.channelId)
    if not kind:
        raise ApiError(404, "noCall", "Нет такого звонка")
    return {"token": livekit_token(user, livekit_room(kind, body.channelId)), "url": LIVEKIT_URL}


class CallQualityIn(BaseModel):
    channelId: str
    # Where the report came from: "tick" during the call, "leave" at its end.
    when: str = "tick"
    transport: str = ""
    lossIn: float | None = None
    lossInWorst: float | None = None
    jitter: float | None = None
    jitterWorst: float | None = None
    rtt: float | None = None
    lossOut: float | None = None
    screenAudio: bool = False


def _num(value: float | None, top: float, unit: str) -> str:
    """A report number clamped to what is plausible, or '-' when the browser had none."""
    if value is None or value != value:
        return "-"
    return f"{min(max(value, 0), top):.1f}".rstrip("0").rstrip(".") + unit


@router.post("/api/call-quality")
def call_quality(body: CallQualityIn, user: dict = Depends(current_user)):
    """One log line per report from a call (nothing is stored), so a bad call can be looked at afterwards."""
    CALL_QUALITY_BY_USER.check(user["id"])
    if not voice_target(user["id"], body.channelId):
        raise ApiError(404, "noCall", "Нет такого звонка")
    # The transport is free text from the browser: only a short word like "relay/turn-tls" gets into the log.
    transport = body.transport if re.fullmatch(r"[a-z0-9/-]{1,24}", body.transport) else "?"
    when = "leave" if body.when == "leave" else "tick"
    print(
        f"call quality: user={user['id']} room={body.channelId} at={when} transport={transport}"
        f" loss_in={_num(body.lossIn, 100, '%')} loss_in_worst={_num(body.lossInWorst, 100, '%')}"
        f" jitter_in={_num(body.jitter, 10000, 'ms')} jitter_in_worst={_num(body.jitterWorst, 10000, 'ms')}"
        f" rtt={_num(body.rtt, 60000, 'ms')} loss_out={_num(body.lossOut, 100, '%')}"
        f" screen_audio={'yes' if body.screenAudio else 'no'}",
        flush=True,
    )
    return {"ok": True}


# The other gomex modules import this one too: they come last, once everything above is defined.
from .users import blocked_between
from .channels import (
    can_read_message,
    emit_to_readers,
    find_message,
    message_body,
    message_out,
    messages_out,
    reactions_for,
    reply_target,
    save_read,
)
from .dms import dm_for, dm_member_ids, dm_message_out, dm_rooms
from .uploads import claim_uploads, remove_upload_files
