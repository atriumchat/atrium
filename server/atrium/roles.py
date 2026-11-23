"""Roles and private channels: who may manage what, and who sees which channel.

The admin (users.is_admin) may do everything, as before roles. Anyone else gets permissions from their roles, and a
role-holder only manages what is below their own top role: they edit and hand out lower roles only, never grant a
permission they don't hold themselves, and take off the server only people below them.

A private channel is seen by admins, by roles that see every channel, and by the roles and people it names. Everything
about it — the channel list, history, sending, reactions, typing, read marks, unread counts, the inbox, its files, who
is in its voice room and the voice token — goes only to them.
"""

import asyncio
import json
import uuid
from dataclasses import dataclass

from fastapi import APIRouter, Depends
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from .auth import current_user, everyone_is_admin, is_admin, log_event, public_user
from .db import ALL_PERMISSIONS, connect_db, now_ms, query
from .errors import ApiError


router = APIRouter()

ADMIN_TOP = 1 << 62
NO_ROLE = -(1 << 62)


@dataclass(frozen=True)
class Access:
    """What one person may do. `admin` is is_admin(): true for everyone on a server that has no admin yet."""

    user_id: str
    admin: bool
    role_permissions: frozenset
    role_top: int
    roles: frozenset

    def can(self, permission: str) -> bool:
        return self.admin or permission in self.role_permissions

    @property
    def top(self) -> int:
        return ADMIN_TOP if self.admin else self.role_top

    def above(self, position: int) -> bool:
        """This person's top role is higher than `position` (admins are above every role)."""
        return self.admin or position < self.role_top


def access_of(user_id: str) -> Access:
    rows = query(
        "SELECT r.id, r.position, r.permissions FROM roles r JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = ?",
        (user_id,),
    )
    permissions = {p for r in rows for p in json.loads(r["permissions"]) if p in ALL_PERMISSIONS}
    return Access(
        user_id,
        is_admin({"id": user_id}),
        frozenset(permissions),
        max((r["position"] for r in rows), default=NO_ROLE),
        frozenset(r["id"] for r in rows),
    )


def can(user: dict, permission: str) -> bool:
    return access_of(user["id"]).can(permission)


def my_permissions(user_id: str) -> list[str]:
    access = access_of(user_id)
    return [p for p in ALL_PERMISSIONS if access.can(p)]


# --- who sees which channel ---


def hidden_channels(user_id: str) -> set[str]:
    """Private channels this person doesn't see (deleted ones included)."""
    if access_of(user_id).can("seeAllChannels"):
        return set()
    return {
        r["id"]
        for r in query(
            """SELECT id FROM channels WHERE private = 1
                 AND id NOT IN (SELECT channel_id FROM channel_users WHERE user_id = ?)
                 AND id NOT IN (SELECT cr.channel_id FROM channel_roles cr JOIN user_roles ur ON ur.role_id = cr.role_id
                                WHERE ur.user_id = ?)""",
            (user_id, user_id),
        )
    }


def can_see_channel(user_id: str, channel_id: str) -> bool:
    """The channel exists (in the trash too) and this person sees it."""
    rows = query("SELECT private FROM channels WHERE id = ?", (channel_id,))
    if not rows:
        return False
    if not rows[0]["private"] or access_of(user_id).can("seeAllChannels"):
        return True
    return bool(
        query(
            """SELECT 1 FROM channel_users WHERE channel_id = ? AND user_id = ?
               UNION ALL
               SELECT 1 FROM channel_roles cr JOIN user_roles ur ON ur.role_id = cr.role_id
               WHERE cr.channel_id = ? AND ur.user_id = ? LIMIT 1""",
            (channel_id, user_id, channel_id, user_id),
        )
    )


def channel_viewers(channel_id: str) -> list[str] | None:
    """Everyone who sees a private channel, or None for a public one (it goes to everybody)."""
    rows = query("SELECT private FROM channels WHERE id = ?", (channel_id,))
    if not rows:
        return []
    if not rows[0]["private"] or everyone_is_admin():
        return None
    see_all = [r["id"] for r in query("SELECT id, permissions FROM roles") if "seeAllChannels" in json.loads(r["permissions"])]
    marks = ", ".join("?" * len(see_all)) or "NULL"
    return [
        r["id"]
        for r in query(
            f"""SELECT id FROM users WHERE is_admin = 1
                UNION SELECT user_id FROM channel_users WHERE channel_id = ?
                UNION SELECT user_id FROM user_roles
                      WHERE role_id IN (SELECT role_id FROM channel_roles WHERE channel_id = ?) OR role_id IN ({marks})""",
            (channel_id, channel_id, *see_all),
        )
    ]


async def emit_channel(event: str, payload, channel_id: str, skip_sid: str | None = None) -> None:
    """A channel's event to whoever sees the channel: everyone for a public one, the viewers' tabs for a private one."""
    viewers = channel_viewers(channel_id)
    if viewers is None:
        await sio.emit(event, payload, skip_sid=skip_sid)
    elif viewers:
        await sio.emit(event, payload, to=[user_room(u) for u in viewers], skip_sid=skip_sid)


def channels_for(user_id: str) -> list[dict]:
    hidden = hidden_channels(user_id)
    return [c for c in list_channels() if c["id"] not in hidden]


def online_users() -> set[str]:
    return set(realtime.online.values())


# --- roles ---


def list_roles() -> list[dict]:
    """Every role, highest first."""
    return [
        {"id": r["id"], "name": r["name"], "color": r["color"], "position": r["position"], "permissions": json.loads(r["permissions"])}
        for r in query("SELECT * FROM roles ORDER BY position DESC, created_at")
    ]


def access_payload(user_id: str) -> dict:
    permissions = my_permissions(user_id)
    return {"permissions": permissions, "canManageChannels": "manageChannels" in permissions}


async def access_changed() -> None:
    """After a change to roles, someone's roles or a channel's access: everyone's own channel list and permissions
    again, the voice rooms as each now sees them, and whoever sits in a room they no longer see is taken out of it."""
    await sio.emit("roles", list_roles())
    await send_layout()
    lost = [(sid, e) for sid, e in list(realtime.voice.items()) if e["kind"] == "channel" and not can_see_channel(e["userId"], e["channelId"])]
    for sid, entry in lost:
        realtime.voice.pop(sid, None)
        await sio.emit("voice:ended", {"channelId": entry["channelId"]}, to=sid)
        await realtime.sound_ended(entry)
    await send_voice_state()
    for user_id in online_users():
        await sio.emit("me:access", access_payload(user_id), to=user_room(user_id))
    # A refreshed LiveKit token is refused by /api/rtc/authorize from now on; this ends the connection already open.
    await asyncio.gather(*(run_in_threadpool(realtime.livekit_remove, livekit_room("channel", e["channelId"]), e["userId"]) for _, e in lost))


class RoleIn(BaseModel):
    name: str = Field(min_length=1, max_length=32)
    color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    permissions: list[str] = Field(default_factory=list, max_length=len(ALL_PERMISSIONS))


class RoleOrderIn(BaseModel):
    ids: list[str] = Field(max_length=200)


class UserRolesIn(BaseModel):
    roleIds: list[str] = Field(max_length=200)


class ChannelAccessIn(BaseModel):
    private: bool
    roleIds: list[str] = Field(default_factory=list, max_length=200)
    userIds: list[str] = Field(default_factory=list, max_length=1000)


def role_manager(user: dict) -> Access:
    access = access_of(user["id"])
    if not access.can("manageRoles"):
        raise ApiError(403, "noManageRoles", "Нет права управлять ролями")
    return access


def role_or_404(role_id: str) -> dict:
    rows = query("SELECT * FROM roles WHERE id = ?", (role_id,))
    if not rows:
        raise ApiError(404, "noRole", "Нет такой роли")
    return rows[0]


def role_name(raw: str) -> str:
    name = " ".join(raw.split())
    if not name:
        raise ApiError(400, "emptyName", "Пустое название")
    return name


def check_permissions(access: Access, wanted: set[str], before: set[str] = frozenset()) -> None:
    """Known permissions only, and only ones the manager holds can be given or taken away."""
    if wanted - set(ALL_PERMISSIONS):
        raise ApiError(400, "badPermission", "Нет такого права")
    if not access.admin and (wanted ^ before) - access.role_permissions:
        raise ApiError(403, "notYourPermission", "Нельзя выдать право, которого нет у тебя")


def check_below(access: Access, role: dict) -> None:
    if not access.above(role["position"]):
        raise ApiError(403, "roleAbove", "Эта роль не ниже твоей")


def role_ids_of(user_id: str) -> list[str]:
    return [
        r["role_id"]
        for r in query(
            "SELECT ur.role_id FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ? ORDER BY r.position DESC",
            (user_id,),
        )
    ]


@router.get("/api/roles")
def get_roles(user: dict = Depends(current_user)):
    return list_roles()


@router.post("/api/roles")
async def create_role(body: RoleIn, user: dict = Depends(current_user)):
    """A new role goes to the bottom of the list, below everyone's."""
    access = role_manager(user)
    check_permissions(access, set(body.permissions))
    position = query("SELECT COALESCE(MIN(position), 1) - 1 AS p FROM roles")[0]["p"]
    role_id = uuid.uuid4().hex
    with connect_db() as conn:
        conn.execute(
            "INSERT INTO roles (id, name, color, position, permissions, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (role_id, role_name(body.name), body.color, position, json.dumps(sorted(set(body.permissions))), now_ms()),
        )
    log_event("role_created", by=user["id"], role=role_id)
    await access_changed()
    return list_roles()


@router.put("/api/roles/order")
async def reorder_roles(body: RoleOrderIn, user: dict = Depends(current_user)):
    """The roles below one's own, highest first; they swap places among themselves and stay below."""
    access = role_manager(user)
    movable = [r for r in list_roles() if access.above(r["position"])]
    if sorted(body.ids) != sorted(r["id"] for r in movable):
        raise ApiError(409, "rolesChanged", "Список ролей изменился")
    slots = sorted((r["position"] for r in movable), reverse=True)
    with connect_db() as conn:
        conn.executemany("UPDATE roles SET position = ? WHERE id = ?", list(zip(slots, body.ids)))
    await access_changed()
    return list_roles()


@router.put("/api/roles/{role_id}")
async def update_role(role_id: str, body: RoleIn, user: dict = Depends(current_user)):
    access = role_manager(user)
    role = role_or_404(role_id)
    check_below(access, role)
    check_permissions(access, set(body.permissions), set(json.loads(role["permissions"])))
    with connect_db() as conn:
        conn.execute(
            "UPDATE roles SET name = ?, color = ?, permissions = ? WHERE id = ?",
            (role_name(body.name), body.color, json.dumps(sorted(set(body.permissions))), role_id),
        )
    log_event("role_changed", by=user["id"], role=role_id, permissions=sorted(set(body.permissions)))
    await access_changed()
    return list_roles()


@router.delete("/api/roles/{role_id}")
async def delete_role(role_id: str, user: dict = Depends(current_user)):
    access = role_manager(user)
    check_below(access, role_or_404(role_id))
    holders = [r["user_id"] for r in query("SELECT user_id FROM user_roles WHERE role_id = ?", (role_id,))]
    with connect_db() as conn:
        conn.execute("DELETE FROM user_roles WHERE role_id = ?", (role_id,))
        conn.execute("DELETE FROM channel_roles WHERE role_id = ?", (role_id,))
        conn.execute("DELETE FROM roles WHERE id = ?", (role_id,))
    log_event("role_deleted", by=user["id"], role=role_id)
    for holder in holders:
        await sio.emit("user:updated", public_user(query("SELECT * FROM users WHERE id = ?", (holder,))[0]))
    await access_changed()
    return list_roles()


@router.put("/api/users/{user_id}/roles")
async def set_user_roles(user_id: str, body: UserRolesIn, user: dict = Depends(current_user)):
    """Someone's roles, all at once. Only roles below one's own change, and only for people below one (or oneself)."""
    access = role_manager(user)
    rows = query("SELECT * FROM users WHERE id = ?", (user_id,))
    if not rows:
        raise ApiError(404, "noUser", "Нет такого пользователя")
    if user_id != user["id"] and not access.admin and (rows[0]["is_admin"] or access_of(user_id).top >= access.top):
        raise ApiError(403, "memberAbove", "Этот участник не ниже тебя")
    roles = {r["id"]: r for r in list_roles()}
    wanted = set(body.roleIds)
    if wanted - roles.keys():
        raise ApiError(404, "noRole", "Нет такой роли")
    current = set(role_ids_of(user_id))
    for role_id in wanted ^ current:
        check_below(access, roles[role_id])
    with connect_db() as conn:
        conn.executemany("DELETE FROM user_roles WHERE user_id = ? AND role_id = ?", [(user_id, r) for r in current - wanted])
        conn.executemany("INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)", [(user_id, r) for r in wanted - current])
    log_event("roles_set", by=user["id"], user=user_id, roles=sorted(wanted))
    updated = public_user(query("SELECT * FROM users WHERE id = ?", (user_id,))[0])
    await sio.emit("user:updated", updated)
    await access_changed()
    return updated


# --- a channel's access ---


def channel_manager(user: dict, channel_id: str) -> Access:
    access = access_of(user["id"])
    if not access.can("manageChannels"):
        raise ApiError(403, "noManageChannels", "Нет права управлять каналами")
    channel_or_404(channel_id)
    if not can_see_channel(user["id"], channel_id):
        raise ApiError(404, "noChannel", "Нет такого канала")
    return access


def channel_access(channel_id: str) -> dict:
    return {
        "private": bool(query("SELECT private FROM channels WHERE id = ?", (channel_id,))[0]["private"]),
        "roleIds": [r["role_id"] for r in query("SELECT role_id FROM channel_roles WHERE channel_id = ?", (channel_id,))],
        "userIds": [r["user_id"] for r in query("SELECT user_id FROM channel_users WHERE channel_id = ?", (channel_id,))],
    }


@router.get("/api/channels/{channel_id}/access")
def get_channel_access(channel_id: str, user: dict = Depends(current_user)):
    channel_manager(user, channel_id)
    return channel_access(channel_id)


def save_channel_access(conn, channel_id: str, private: bool, role_ids: set[str], user_ids: set[str]) -> None:
    conn.execute("UPDATE channels SET private = ? WHERE id = ?", (int(private), channel_id))
    conn.execute("DELETE FROM channel_roles WHERE channel_id = ?", (channel_id,))
    conn.execute("DELETE FROM channel_users WHERE channel_id = ?", (channel_id,))
    conn.executemany("INSERT INTO channel_roles (channel_id, role_id) VALUES (?, ?)", [(channel_id, r) for r in role_ids])
    conn.executemany("INSERT INTO channel_users (channel_id, user_id) VALUES (?, ?)", [(channel_id, u) for u in user_ids])


def keep_myself(access: Access, private: bool, role_ids: set[str], user_ids: set[str]) -> set[str]:
    """Whoever makes a channel private stays in it, unless they see every channel anyway."""
    if private and not access.can("seeAllChannels") and not (access.roles & role_ids):
        return user_ids | {access.user_id}
    return user_ids


@router.put("/api/channels/{channel_id}/access")
async def set_channel_access(channel_id: str, body: ChannelAccessIn, user: dict = Depends(current_user)):
    access = channel_manager(user, channel_id)
    role_ids, user_ids = set(body.roleIds), set(body.userIds)
    if role_ids - {r["id"] for r in query("SELECT id FROM roles")}:
        raise ApiError(404, "noRole", "Нет такой роли")
    if user_ids - {r["id"] for r in query("SELECT id FROM users")}:
        raise ApiError(404, "noUser", "Нет такого пользователя")
    user_ids = keep_myself(access, body.private, role_ids, user_ids)
    with connect_db() as conn:
        save_channel_access(conn, channel_id, body.private, role_ids, user_ids)
    log_event("channel_access", by=user["id"], channel=channel_id, private=body.private, roles=sorted(role_ids), users=sorted(user_ids))
    await access_changed()
    return channel_access(channel_id)


# The other atrium modules import this one too: they come last, once everything above is defined.
from .channels import channel_or_404, list_channels, send_layout
from . import realtime
from .realtime import livekit_room, send_voice_state, sio, user_room
