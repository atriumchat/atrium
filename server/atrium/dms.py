"""Direct messages and groups."""

import json
import sqlite3
import uuid

from fastapi import APIRouter, Depends, Query
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from .config import MAX_GROUP_MEMBERS
from .errors import ApiError
from .db import connect_db, execute, now_ms, query
from .auth import GROUPS_BY_USER, current_user


router = APIRouter()


def dm_for(user_id: str, dm_id: str) -> dict | None:
    """The DM/group row if user_id is a member of it, else None."""
    rows = query(
        "SELECT d.* FROM dms d JOIN dm_members m ON m.dm_id = d.id WHERE d.id = ? AND m.user_id = ?",
        (dm_id, user_id),
    )
    return rows[0] if rows else None


def dm_member_ids(dm_id: str) -> list[str]:
    return [r["user_id"] for r in query("SELECT user_id FROM dm_members WHERE dm_id = ? ORDER BY joined_at, user_id", (dm_id,))]


def dm_rooms(dm_id: str) -> list[str]:
    return [user_room(u) for u in dm_member_ids(dm_id)]


def dms_out(rows: list[dict], me: str) -> list[dict]:
    """DMs and groups as the client sees them, with members and the last message: three queries for any number."""
    if not rows:
        return []
    ids = [r["id"] for r in rows]
    marks = ", ".join("?" * len(ids))
    members: dict[str, list[str]] = {}
    for m in query(f"SELECT dm_id, user_id FROM dm_members WHERE dm_id IN ({marks}) ORDER BY joined_at, user_id", tuple(ids)):
        members.setdefault(m["dm_id"], []).append(m["user_id"])
    # Each one's newest message, found through the (dm_id, created_at) index rather than by reading the history.
    last = {
        m["dm_id"]: m
        for m in query(
            f"""SELECT m.dm_id, m.user_id, m.content, m.attachments, m.created_at FROM dm_messages m
                WHERE m.dm_id IN ({marks})
                  AND m.id = (SELECT id FROM dm_messages WHERE dm_id = m.dm_id ORDER BY created_at DESC LIMIT 1)""",
            tuple(ids),
        )
    }
    out = []
    for row in rows:
        latest = last.get(row["id"])
        dm = {
            "id": row["id"],
            "kind": row["kind"],
            "name": row["name"],
            "ownerId": row["owner_id"],
            "members": members.get(row["id"], []),
            "lastMessageAt": latest["created_at"] if latest else row["created_at"],
            # For the conversation list on phones: who wrote last and what.
            "preview": (
                {"userId": latest["user_id"], "text": latest["content"][:140], "images": len(json.loads(latest["attachments"]))}
                if latest
                else None
            ),
        }
        if row["kind"] == "dm":
            dm["userId"] = next((m for m in dm["members"] if m != me), me)
        out.append(dm)
    return out


def dm_out(row: dict, me: str) -> dict:
    return dms_out([row], me)[0]


async def notify_dms_changed(*user_ids: str) -> None:
    for user_id in set(user_ids):
        await sio.emit("dms:changed", to=user_room(user_id))


def dm_message_out(row: dict) -> dict:
    return messages_out([row], "dm_messages")[0]


class DmIn(BaseModel):
    userId: str


class GroupIn(BaseModel):
    userIds: list[str] = Field(min_length=2, max_length=MAX_GROUP_MEMBERS - 1)
    name: str = Field(default="", max_length=48)


class GroupMembersIn(BaseModel):
    userIds: list[str] = Field(min_length=1, max_length=MAX_GROUP_MEMBERS - 1)


class GroupRenameIn(BaseModel):
    name: str = Field(max_length=48)


@router.get("/api/dms")
def list_dms(user: dict = Depends(current_user)):
    rows = query("SELECT d.* FROM dms d JOIN dm_members m ON m.dm_id = d.id WHERE m.user_id = ?", (user["id"],))
    return sorted(dms_out(rows, user["id"]), key=lambda d: d["lastMessageAt"], reverse=True)


@router.post("/api/dms")
def open_dm(body: DmIn, user: dict = Depends(current_user)):
    if body.userId == user["id"] or not query("SELECT 1 FROM users WHERE id = ?", (body.userId,)):
        raise ApiError(404, "noUser", "Нет такого пользователя")
    pair_key = ":".join(ordered_pair(user["id"], body.userId))
    rows = query("SELECT * FROM dms WHERE pair_key = ?", (pair_key,))
    if not rows:
        dm_id, now = uuid.uuid4().hex, now_ms()
        try:
            with connect_db() as conn:
                conn.execute("INSERT INTO dms (id, kind, pair_key, created_at) VALUES (?, 'dm', ?, ?)", (dm_id, pair_key, now))
                conn.executemany(
                    "INSERT INTO dm_members (dm_id, user_id, joined_at) VALUES (?, ?, ?)",
                    [(dm_id, user["id"], now), (dm_id, body.userId, now)],
                )
        except sqlite3.IntegrityError:
            pass  # created concurrently from the other side
        rows = query("SELECT * FROM dms WHERE pair_key = ?", (pair_key,))
    return dm_out(rows[0], user["id"])


def group_for(user_id: str, group_id: str) -> dict:
    dm = dm_for(user_id, group_id)
    if not dm or dm["kind"] != "group":
        raise ApiError(404, "noGroup", "Нет такой группы")
    return dm


def check_can_add(user_id: str, others: set[str]) -> None:
    """Only your friends can be put in a group, so strangers can't pull people into chats."""
    if not others <= friend_ids(user_id):
        raise ApiError(400, "groupFriendsOnly", "В группу можно добавить только друзей")


@router.post("/api/groups")
async def create_group(body: GroupIn, user: dict = Depends(current_user)):
    GROUPS_BY_USER.check(user["id"])
    others = set(body.userIds) - {user["id"]}
    if len(others) < 2:
        raise ApiError(400, "groupNeedsTwo", "Для группы нужно хотя бы два друга")
    check_can_add(user["id"], others)
    group_id, now = uuid.uuid4().hex, now_ms()
    with connect_db() as conn:
        conn.execute(
            "INSERT INTO dms (id, kind, name, owner_id, created_at) VALUES (?, 'group', ?, ?, ?)",
            (group_id, " ".join(body.name.split()), user["id"], now),
        )
        conn.executemany(
            "INSERT INTO dm_members (dm_id, user_id, joined_at) VALUES (?, ?, ?)",
            [(group_id, member, now) for member in [user["id"], *sorted(others)]],
        )
    await notify_dms_changed(user["id"], *others)
    return dm_out(query("SELECT * FROM dms WHERE id = ?", (group_id,))[0], user["id"])


@router.post("/api/groups/{group_id}/members")
async def add_group_members(group_id: str, body: GroupMembersIn, user: dict = Depends(current_user)):
    group = group_for(user["id"], group_id)
    members = set(dm_member_ids(group_id))
    new = set(body.userIds) - members
    if not new:
        raise ApiError(400, "alreadyInGroup", "Они уже в группе")
    check_can_add(user["id"], new)
    if len(members) + len(new) > MAX_GROUP_MEMBERS:
        raise ApiError(400, "groupFull", f"В группе может быть не больше {MAX_GROUP_MEMBERS} человек", n=MAX_GROUP_MEMBERS)
    now = now_ms()
    with connect_db() as conn:
        conn.executemany("INSERT INTO dm_members (dm_id, user_id, joined_at) VALUES (?, ?, ?)", [(group_id, m, now) for m in new])
    await notify_dms_changed(*members, *new)
    return dm_out(group, user["id"])


@router.patch("/api/groups/{group_id}")
async def rename_group(group_id: str, body: GroupRenameIn, user: dict = Depends(current_user)):
    group = group_for(user["id"], group_id)
    execute("UPDATE dms SET name = ? WHERE id = ?", (" ".join(body.name.split()), group_id))
    await notify_dms_changed(*dm_member_ids(group_id))
    return dm_out({**group, "name": " ".join(body.name.split())}, user["id"])


@router.delete("/api/groups/{group_id}/members/me")
async def leave_group(group_id: str, user: dict = Depends(current_user)):
    group = group_for(user["id"], group_id)
    execute("DELETE FROM dm_members WHERE dm_id = ? AND user_id = ?", (group_id, user["id"]))
    remaining = dm_member_ids(group_id)
    if not remaining:
        # Nobody left to read it: drop the conversation, its messages and its images.
        remove_upload_files(r["id"] for r in query("SELECT id FROM uploads WHERE scope = ?", (f"dm:{group_id}",)))
        with connect_db() as conn:
            conn.execute("DELETE FROM uploads WHERE scope = ?", (f"dm:{group_id}",))
            # Reactions and read marks point at messages and conversations by id, with no foreign key to cascade
            # along; without this they'd outlive the group. Before the dms row, while its messages still exist.
            conn.execute("DELETE FROM reactions WHERE message_id IN (SELECT id FROM dm_messages WHERE dm_id = ?)", (group_id,))
            conn.execute("DELETE FROM read_states WHERE conversation_id = ?", (group_id,))
            conn.execute("DELETE FROM dms WHERE id = ?", (group_id,))
    elif group["owner_id"] == user["id"]:
        execute("UPDATE dms SET owner_id = ? WHERE id = ?", (remaining[0], group_id))
    # Hang them up if they were in the group's call, in LiveKit too: their app could otherwise stay in the room.
    for sid in [s for s, e in voice.items() if e["channelId"] == group_id and e["userId"] == user["id"]]:
        del voice[sid]
    await run_in_threadpool(livekit_remove, f"dm-{group_id}", user["id"])
    if group_id in calls:
        calls[group_id]["ringing"].discard(user["id"])
        await sync_call(group_id)
    await notify_dms_changed(user["id"], *remaining)
    return {"ok": True}


@router.get("/api/dms/{dm_id}/messages")
def dm_messages(dm_id: str, before: int | None = None, limit: int = 50,
                before_id: str = Query("", alias="beforeId", max_length=64), user: dict = Depends(current_user)):
    if not dm_for(user["id"], dm_id):
        raise ApiError(404, "noDm", "Нет такой переписки")
    limit = max(1, min(limit, 100))
    boundary, cursor = history_boundary(before, before_id)
    rows = query(
        f"SELECT * FROM dm_messages WHERE dm_id = ? AND {boundary} ORDER BY created_at DESC, id DESC LIMIT ?",
        (dm_id, *cursor, limit),
    )
    return messages_out(list(reversed(rows)), "dm_messages")


# The other atrium modules import this one too: they come last, once everything above is defined.
from .users import friend_ids, ordered_pair
from .channels import history_boundary, messages_out
from .uploads import remove_upload_files
from .realtime import calls, livekit_remove, sio, sync_call, user_room, voice
