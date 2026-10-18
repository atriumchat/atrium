"""Accounts: sign-up, sign-in and recovery, invites, profile and status, blocks, friends, avatars, first-run setup."""

import asyncio
import hashlib
import hmac
import secrets
import sqlite3
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from .config import (
    AVATAR_DIR,
    INVITE_ALPHABET,
    INVITE_CODE,
    INVITE_LIMIT,
    LIVEKIT_URL,
    MAX_AVATAR_UPLOAD,
    MEDIA_COOKIE,
    MIN_PASSWORD_LEN,
    RELAY_ONLY,
    SERVER_NAME,
    USER_COLORS,
)
from .errors import ApiError
from .db import connect_db, execute, now_ms, query, seed_admins
from .auth import (
    AVATARS_BY_USER,
    DUMMY_HASH,
    FRIEND_REQUESTS_BY_USER,
    INVITE_CHECKS_BY_IP,
    INVITE_RESETS_BY_USER,
    LOGIN_BY_IP,
    LOGIN_BY_NAME,
    REGISTER_BY_IP,
    RESET_BY_IP,
    RESET_LINKS_BY_USER,
    RateLimit,
    client_ip,
    current_user,
    hash_password,
    is_account_admin,
    is_admin,
    issue_token,
    media_user,
    password_outdated,
    password_work,
    public_user,
    set_media_cookie,
    verify_password,
)


router = APIRouter()


def remove_avatar_file(name: str | None) -> None:
    if name:
        (AVATAR_DIR / name).unlink(missing_ok=True)


def is_cyrillic(ch: str) -> bool:
    return "\u0400" <= ch <= "\u04ff"


def check_nick(name: str) -> None:
    """Refuse empty nicks, invisible characters, and Latin mixed with Cyrillic in one word: "Bаla" with a Cyrillic
    "а" looks exactly like "Bala" and is how someone would pose as another person."""
    if not name or not all(ch.isprintable() for ch in name):
        raise ApiError(400, "badNick", "Пустой ник или невидимые символы")
    for word in name.split():
        letters = [ch for ch in word if ch.isalpha()]
        if any(is_cyrillic(ch) for ch in letters) and any(ch.isascii() for ch in letters):
            raise ApiError(400, "mixedScripts", "В одном слове ника смешаны русские и латинские буквы")


def find_user_by_name(name: str) -> dict | None:
    rows = query("SELECT * FROM users WHERE name_key = ?", (" ".join(name.split()).casefold(),))
    return rows[0] if rows else None


def setting(key: str, default: str = "") -> str:
    rows = query("SELECT value FROM settings WHERE key = ?", (key,))
    return rows[0]["value"] if rows else default


def server_name() -> str:
    return setting("server_name", SERVER_NAME)


def blocked_between(a: str, b: str) -> bool:
    """Either one blocked the other."""
    return bool(query("SELECT 1 FROM blocks WHERE (user_id = ? AND blocked_id = ?) OR (user_id = ? AND blocked_id = ?)", (a, b, b, a)))


# --- friends ---

def ordered_pair(a: str, b: str) -> tuple[str, str]:
    return (a, b) if a < b else (b, a)


def friendship(a: str, b: str) -> dict | None:
    rows = query("SELECT * FROM friendships WHERE user_a = ? AND user_b = ?", ordered_pair(a, b))
    return rows[0] if rows else None


def friends_of(user_id: str) -> list[dict]:
    """Everyone with a relationship to user_id: friend, incoming request or outgoing request."""
    rows = query("SELECT * FROM friendships WHERE user_a = ? OR user_b = ?", (user_id, user_id))
    out = []
    for r in rows:
        other = r["user_b"] if r["user_a"] == user_id else r["user_a"]
        if r["status"] == "accepted":
            status = "friend"
        elif r["requested_by"] == user_id:
            status = "outgoing"
        else:
            status = "incoming"
        out.append({"userId": other, "status": status})
    return out


async def notify_friends_changed(*user_ids: str) -> None:
    for user_id in user_ids:
        await sio.emit("friends:changed", to=user_room(user_id))


def friend_ids(user_id: str) -> set[str]:
    return {f["userId"] for f in friends_of(user_id) if f["status"] == "friend"}


class RegisterIn(BaseModel):
    # A personal invite code (or, for the very first account, INVITE_CODE).
    invite: str = Field(max_length=200)
    name: str = Field(min_length=1, max_length=32)
    password: str = Field(min_length=MIN_PASSWORD_LEN, max_length=128)


class LoginIn(BaseModel):
    name: str = Field(min_length=1, max_length=32)
    password: str = Field(min_length=1, max_length=128)


class FriendRequestIn(BaseModel):
    name: str = Field(min_length=1, max_length=32)


class ProfileIn(BaseModel):
    bio: str = Field(max_length=190)


INVITE_GONE = "Ссылка-приглашение не работает: её сбросили или все места по ней уже заняты"


class InviteFull(Exception):
    """The inviter's last place was taken by someone registering at the same moment."""


def invite_limit(inviter: dict) -> int | None:
    """How many people may sign up with this person's link; None = no limit (admins)."""
    return None if inviter.get("is_admin") else INVITE_LIMIT


def invited_count(user_id: str) -> int:
    return query("SELECT COUNT(*) AS n FROM users WHERE invited_by = ?", (user_id,))[0]["n"]


def normalize_invite(code: str) -> str:
    return "".join(ch for ch in code.upper() if ch in INVITE_ALPHABET)


def my_invite(user_id: str) -> dict:
    row = query("SELECT id, name, invite_code, is_admin FROM users WHERE id = ?", (user_id,))[0]
    code = row["invite_code"] or new_invite_code(user_id)
    invited = [r["id"] for r in query("SELECT id FROM users WHERE invited_by = ? ORDER BY created_at", (user_id,))]
    return {"code": code, "invited": invited, "limit": invite_limit(row)}


def new_invite_code(user_id: str) -> str:
    """Give the user a fresh code; the old link stops working. Retries on the (unlikely) clash."""
    while True:
        code = "".join(secrets.choice(INVITE_ALPHABET) for _ in range(8))
        try:
            execute("UPDATE users SET invite_code = ? WHERE id = ?", (code, user_id))
            return code
        except sqlite3.IntegrityError:
            continue


@router.post("/api/register")
async def register(body: RegisterIn, request: Request, response: Response):
    REGISTER_BY_IP.check(client_ip(request))
    inviter = None
    first_account = not query("SELECT 1 FROM users LIMIT 1")
    if not (first_account and hmac.compare_digest(body.invite.strip().encode(), INVITE_CODE.encode())):
        code = normalize_invite(body.invite)
        rows = query("SELECT * FROM users WHERE invite_code = ?", (code,)) if code else []
        inviter = rows[0] if rows else None
        limit = inviter and invite_limit(inviter)
        if not inviter or (limit is not None and invited_count(inviter["id"]) >= limit):
            raise ApiError(403, "inviteGone", INVITE_GONE)
    name = " ".join(body.name.split())
    check_nick(name)
    if find_user_by_name(name):
        raise ApiError(409, "nickTaken", "Этот ник уже занят")

    created_at = now_ms()
    user_id = uuid.uuid4().hex
    password_hash = await password_work(hash_password, body.password)
    recovery_key, recovery_hash = await fresh_recovery_key()
    try:
        # One transaction: the account, the limit check (SQLite holds the write lock from the INSERT on, so two
        # sign-ups can't both take the last place), and the friendship with whoever invited them.
        with connect_db() as conn:
            conn.execute(
                "INSERT INTO users (id, name, name_key, password_hash, recovery_hash, color, created_at, invited_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (user_id, name, name.casefold(), password_hash, recovery_hash, secrets.choice(USER_COLORS), created_at, inviter and inviter["id"]),
            )
            # The person ADMINS names may sign up after the server started.
            seed_admins(conn)
            if inviter:
                limit = invite_limit(inviter)
                taken = conn.execute("SELECT COUNT(*) FROM users WHERE invited_by = ?", (inviter["id"],)).fetchone()[0]
                if limit is not None and taken > limit:
                    raise InviteFull()
                a, b = ordered_pair(inviter["id"], user_id)
                conn.execute(
                    "INSERT INTO friendships (user_a, user_b, requested_by, status, created_at) VALUES (?, ?, ?, 'accepted', ?)",
                    (a, b, inviter["id"], created_at),
                )
    except sqlite3.IntegrityError:
        # Someone registered the same nick a moment ago.
        raise ApiError(409, "nickJustTaken", "Этот ник только что заняли")
    except InviteFull:
        raise ApiError(403, "inviteGone", INVITE_GONE)
    user = public_user(query("SELECT * FROM users WHERE id = ?", (user_id,))[0])
    await sio.emit("user:new", user)
    if inviter:
        await notify_friends_changed(inviter["id"])
        await sio.emit("invite:used", to=user_room(inviter["id"]))
    set_media_cookie(request, response, user_id)
    # The key is shown once, on the screen right after sign-up; whoever forgets the password later has nothing else.
    return {"token": issue_token(user_id), "user": user, "recoveryKey": recovery_key, "serverName": server_name()}


@router.post("/api/login")
async def login(body: LoginIn, request: Request, response: Response):
    LOGIN_BY_IP.check(client_ip(request))
    LOGIN_BY_NAME.check(" ".join(body.name.split()).casefold())
    row = find_user_by_name(body.name)
    valid = await password_work(verify_password, body.password, row["password_hash"] if row else DUMMY_HASH)
    if not row or not valid:
        raise ApiError(401, "badCredentials", "Неверный ник или пароль")
    if password_outdated(row["password_hash"]):
        password_hash = await password_work(hash_password, body.password)
        execute("UPDATE users SET password_hash = ? WHERE id = ?", (password_hash, row["id"]))
    set_media_cookie(request, response, row["id"])
    return {"token": issue_token(row["id"]), "user": public_user(row)}


@router.post("/api/logout")
def logout(response: Response):
    """Only drops the media cookie. Kept for a token that no longer works, where /api/logout-all can't be used."""
    response.delete_cookie(MEDIA_COOKIE, path="/api/")
    return {"ok": True}


# Tokens are stateless and live TOKEN_TTL (180 days, so friends on flaky networks rarely have to sign in again);
# one can't be revoked alone, so signing out ends every token this person has, the way a password change does.
# The web client's "Выйти" calls this: a copied or forgotten token stops working the moment you sign out.
@router.post("/api/logout-all")
async def logout_all(response: Response, user: dict = Depends(current_user)):
    execute("UPDATE users SET token_version = token_version + 1 WHERE id = ?", (user["id"],))
    await disconnect_user(user["id"])
    response.delete_cookie(MEDIA_COOKIE, path="/api/")
    return {"ok": True}


@router.get("/api/invite")
def get_my_invite(user: dict = Depends(current_user)):
    """Your personal invite link's code, who signed up with it, and how many may."""
    return my_invite(user["id"])


@router.post("/api/invite/reset")
def reset_my_invite(user: dict = Depends(current_user)):
    """New code for when the link got somewhere it shouldn't; the old one stops working. Places already used stay used."""
    INVITE_RESETS_BY_USER.check(user["id"])
    new_invite_code(user["id"])
    return my_invite(user["id"])


@router.get("/api/invite/check/{code}")
def check_invite(code: str, request: Request):
    """For the sign-up page opened from an invite link: does it still work, and whose is it."""
    INVITE_CHECKS_BY_IP.check(client_ip(request))
    normalized = normalize_invite(code)
    rows = query("SELECT * FROM users WHERE invite_code = ?", (normalized,)) if normalized else []
    if not rows:
        raise ApiError(404, "inviteGone", INVITE_GONE)
    limit = invite_limit(rows[0])
    left = None if limit is None else limit - invited_count(rows[0]["id"])
    if left is not None and left <= 0:
        raise ApiError(404, "inviteGone", INVITE_GONE)
    return {"inviter": rows[0]["name"], "left": left}


@router.patch("/api/me")
async def update_me(body: ProfileIn, user: dict = Depends(current_user)):
    execute("UPDATE users SET bio = ? WHERE id = ?", (body.bio.strip(), user["id"]))
    updated = public_user(query("SELECT * FROM users WHERE id = ?", (user["id"],))[0])
    await sio.emit("user:updated", updated)
    return updated


class StatusIn(BaseModel):
    status: str = Field(pattern="^(online|dnd|invisible)$")
    text: str = Field(default="", max_length=64)
    # For "do not disturb" / "invisible": how long, in minutes; 0 = until changed, None = keep the current end
    # (changing only the line of text mustn't reset a timer).
    minutes: int | None = Field(default=None, ge=0, le=60 * 24 * 30)


async def announce_status(user_id: str, status: str, text: str, until: int | None) -> None:
    updated = public_user(query("SELECT * FROM users WHERE id = ?", (user_id,))[0])
    await sio.emit("user:updated", updated)
    await sio.emit("presence", presence_payload())
    # Your own tabs learn the real status (others only ever see online / do not disturb).
    await sio.emit("me:status", {"status": status, "text": text, "until": until}, to=user_room(user_id))


@router.patch("/api/me/status")
async def set_status(body: StatusIn, user: dict = Depends(current_user)):
    text = " ".join(body.text.split())
    if body.status == "online" or body.minutes == 0:
        until = None
    elif body.minutes:
        until = now_ms() + body.minutes * 60_000
    else:
        row = query("SELECT status, status_until FROM users WHERE id = ?", (user["id"],))[0]
        until = row["status_until"] if row["status"] == body.status else None
    execute("UPDATE users SET status = ?, status_text = ?, status_until = ? WHERE id = ?", (body.status, text, until, user["id"]))
    await announce_status(user["id"], body.status, text, until)
    return {"status": body.status, "text": text, "until": until}


async def expire_statuses() -> None:
    """Timed statuses run out: back online, everyone told."""
    while True:
        try:
            due = query("SELECT id, status_text FROM users WHERE status_until IS NOT NULL AND status_until <= ?", (now_ms(),))
            for row in due:
                execute("UPDATE users SET status = 'online', status_until = NULL WHERE id = ?", (row["id"],))
                await announce_status(row["id"], "online", row["status_text"], None)
        except Exception as e:  # never let one bad pass stop the loop
            print(f"status expiry failed: {e!r}", flush=True)
        await asyncio.sleep(30)


class NameChangeIn(BaseModel):
    name: str = Field(min_length=1, max_length=32)
    password: str = Field(max_length=128)


@router.patch("/api/me/name")
async def change_name(body: NameChangeIn, request: Request, user: dict = Depends(current_user)):
    LOGIN_BY_NAME.check(f"change:{user['id']}")
    row = query("SELECT * FROM users WHERE id = ?", (user["id"],))[0]
    if not await password_work(verify_password, body.password, row["password_hash"]):
        raise ApiError(403, "badPassword", "Неверный пароль")
    name = " ".join(body.name.split())
    check_nick(name)
    taken = find_user_by_name(name)
    if taken and taken["id"] != user["id"]:
        raise ApiError(409, "nickTaken", "Этот ник уже занят")
    execute("UPDATE users SET name = ?, name_key = ? WHERE id = ?", (name, name.casefold(), user["id"]))
    updated = public_user(query("SELECT * FROM users WHERE id = ?", (user["id"],))[0])
    await sio.emit("user:updated", updated)
    return updated


class PasswordChangeIn(BaseModel):
    current: str = Field(max_length=128)
    new: str = Field(min_length=MIN_PASSWORD_LEN, max_length=128)


@router.post("/api/me/password")
async def change_password(body: PasswordChangeIn, request: Request, response: Response, user: dict = Depends(current_user)):
    """New password; every other device is signed out, this one gets a fresh token."""
    LOGIN_BY_NAME.check(f"change:{user['id']}")
    row = query("SELECT * FROM users WHERE id = ?", (user["id"],))[0]
    if not await password_work(verify_password, body.current, row["password_hash"]):
        raise ApiError(403, "badCurrentPassword", "Неверный текущий пароль")
    password_hash = await password_work(hash_password, body.new)
    execute("UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?", (password_hash, user["id"]))
    await disconnect_user(user["id"])
    set_media_cookie(request, response, user["id"])
    return {"token": issue_token(user["id"])}


RECOVERY_KEY_LEN = 16


def new_recovery_key() -> str:
    """XXXX-XXXX-XXXX-XXXX: 16 characters, about 79 bits. Guessing is capped at a few tries per nick every ten
    minutes and the stored hash is scrypt, so that is far out of reach, and it is short enough for the sign-in page to
    take it in boxes. Keys made before were 32 characters; they still work, normalize_key doesn't look at the length."""
    raw = "".join(secrets.choice(INVITE_ALPHABET) for _ in range(RECOVERY_KEY_LEN))
    return "-".join(raw[i : i + 4] for i in range(0, RECOVERY_KEY_LEN, 4))


def normalize_key(key: str) -> str:
    return "".join(ch for ch in key.upper() if ch.isalnum())


async def fresh_recovery_key() -> tuple[str, str]:
    """A new key to show the person, and the hash to store."""
    key = new_recovery_key()
    return key, await password_work(hash_password, normalize_key(key))


class RecoveryKeyIn(BaseModel):
    password: str = Field(max_length=128)


@router.post("/api/me/recovery-key")
async def make_recovery_key(body: RecoveryKeyIn, user: dict = Depends(current_user)):
    """A new recovery key, shown once; only its hash is kept. Replaces the old one."""
    LOGIN_BY_NAME.check(f"change:{user['id']}")
    row = query("SELECT * FROM users WHERE id = ?", (user["id"],))[0]
    if not await password_work(verify_password, body.password, row["password_hash"]):
        raise ApiError(403, "badPassword", "Неверный пароль")
    key, key_hash = await fresh_recovery_key()
    execute("UPDATE users SET recovery_hash = ? WHERE id = ?", (key_hash, user["id"]))
    return {"key": key}


class RecoverIn(BaseModel):
    name: str = Field(min_length=1, max_length=32)
    key: str = Field(max_length=64)
    password: str = Field(min_length=MIN_PASSWORD_LEN, max_length=128)


@router.post("/api/recover")
async def recover(body: RecoverIn, request: Request, response: Response):
    """Forgot the password: nick + recovery key + a new password. The key works once, so the next one comes back
    with the sign-in; old sessions end."""
    LOGIN_BY_IP.check(client_ip(request))
    LOGIN_BY_NAME.check(" ".join(body.name.split()).casefold())
    row = find_user_by_name(body.name)
    stored = row["recovery_hash"] if row and row["recovery_hash"] else DUMMY_HASH
    valid = await password_work(verify_password, normalize_key(body.key), stored)
    if not row or not row["recovery_hash"] or not valid:
        raise ApiError(401, "badRecovery", "Неверный ник или ключ восстановления")
    password_hash = await password_work(hash_password, body.password)
    recovery_key, recovery_hash = await fresh_recovery_key()
    execute(
        "UPDATE users SET password_hash = ?, recovery_hash = ?, token_version = token_version + 1 WHERE id = ?",
        (password_hash, recovery_hash, row["id"]),
    )
    await disconnect_user(row["id"])
    set_media_cookie(request, response, row["id"])
    return {"token": issue_token(row["id"]), "user": public_user(row), "recoveryKey": recovery_key, "serverName": server_name()}


# --- admin reset link: for someone who lost the password and the recovery key (there's no e-mail to send it to) ---

RESET_TTL_MS = 24 * 3600 * 1000
RESET_GONE = "Ссылка не работает: ей больше суток, по ней уже входили или сделали новую"


def token_digest(token: str) -> str:
    # The token is 256 random bits, so a plain SHA-256 is enough to keep it unreadable in the database, and it can be
    # looked up by its hash.
    return hashlib.sha256(token.encode()).hexdigest()


@router.post("/api/users/{user_id}/reset-link")
def make_reset_link(user_id: str, user: dict = Depends(current_user)):
    """A one-time token for a new password, to be put in a link the admin passes on. It lives 24 hours and a newer
    one replaces it. Only the hash is kept, so it is shown here and never again."""
    if not is_account_admin(user["id"]):
        raise ApiError(403, "adminOnly", "Это может только админ")
    RESET_LINKS_BY_USER.check(user["id"])
    rows = query("SELECT id, is_admin FROM users WHERE id = ?", (user_id,))
    if not rows:
        raise ApiError(404, "noUser", "Нет такого пользователя")
    if rows[0]["is_admin"] and user_id != user["id"]:
        # Servers have one admin; with several (ADMINS), one must not be able to take another's account.
        raise ApiError(403, "noAdminReset", "Для другого админа ссылку сделать нельзя")
    token = secrets.token_urlsafe(32)
    expires_at = now_ms() + RESET_TTL_MS
    execute(
        "INSERT OR REPLACE INTO password_resets (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)",
        (user_id, token_digest(token), expires_at, now_ms()),
    )
    return {"token": token, "expiresAt": expires_at}


class ResetCheckIn(BaseModel):
    token: str = Field(max_length=200)


class ResetIn(BaseModel):
    token: str = Field(max_length=200)
    password: str = Field(min_length=MIN_PASSWORD_LEN, max_length=128)


def find_reset(digest: str) -> dict | None:
    rows = query(
        "SELECT password_resets.user_id, users.name FROM password_resets JOIN users ON users.id = password_resets.user_id"
        " WHERE token_hash = ? AND expires_at > ?",
        (digest, now_ms()),
    )
    return rows[0] if rows else None


@router.post("/api/reset/check")
def check_reset(body: ResetCheckIn, request: Request):
    """For the page a reset link opens: whether the link still works, and whose password it sets."""
    RESET_BY_IP.check(client_ip(request))
    reset = find_reset(token_digest(body.token))
    if not reset:
        raise ApiError(404, "resetGone", RESET_GONE)
    return {"name": reset["name"]}


@router.post("/api/reset")
async def reset_password(body: ResetIn, request: Request, response: Response):
    """The reset link's page: a new password and, signed in with it, a fresh recovery key. The link works once; old
    sessions end."""
    RESET_BY_IP.check(client_ip(request))
    digest = token_digest(body.token)
    if not find_reset(digest):
        # Before the two scrypt runs below: a wrong token costs next to nothing.
        raise ApiError(404, "resetGone", RESET_GONE)
    password_hash = await password_work(hash_password, body.password)
    recovery_key, recovery_hash = await fresh_recovery_key()
    with connect_db() as conn:
        # Whoever deletes the row owns the link, so two requests with the same token can't both set a password.
        reset = find_reset(digest)
        if not reset or not conn.execute("DELETE FROM password_resets WHERE token_hash = ?", (digest,)).rowcount:
            raise ApiError(404, "resetGone", RESET_GONE)
        conn.execute(
            "UPDATE users SET password_hash = ?, recovery_hash = ?, token_version = token_version + 1 WHERE id = ?",
            (password_hash, recovery_hash, reset["user_id"]),
        )
    user_id = reset["user_id"]
    await disconnect_user(user_id)
    set_media_cookie(request, response, user_id)
    user = public_user(query("SELECT * FROM users WHERE id = ?", (user_id,))[0])
    return {"token": issue_token(user_id), "user": user, "recoveryKey": recovery_key, "serverName": server_name()}


def blocked_ids(user_id: str) -> list[str]:
    return [r["blocked_id"] for r in query("SELECT blocked_id FROM blocks WHERE user_id = ? ORDER BY created_at", (user_id,))]


@router.put("/api/blocks/{other_id}")
async def block(other_id: str, user: dict = Depends(current_user)):
    """Block someone: the friendship (or request) goes, and you stop hearing from them."""
    if other_id == user["id"] or not query("SELECT 1 FROM users WHERE id = ?", (other_id,)):
        raise ApiError(404, "noUser", "Нет такого пользователя")
    execute("INSERT OR IGNORE INTO blocks (user_id, blocked_id, created_at) VALUES (?, ?, ?)", (user["id"], other_id, now_ms()))
    execute("DELETE FROM friendships WHERE user_a = ? AND user_b = ?", ordered_pair(user["id"], other_id))
    await notify_friends_changed(user["id"], other_id)
    await sio.emit("blocks", blocked_ids(user["id"]), to=user_room(user["id"]))
    return blocked_ids(user["id"])


@router.delete("/api/blocks/{other_id}")
async def unblock(other_id: str, user: dict = Depends(current_user)):
    execute("DELETE FROM blocks WHERE user_id = ? AND blocked_id = ?", (user["id"], other_id))
    await sio.emit("blocks", blocked_ids(user["id"]), to=user_room(user["id"]))
    return blocked_ids(user["id"])


@router.post("/api/me/avatar")
async def upload_avatar(request: Request, user: dict = Depends(current_user)):
    """Raw image bytes in the body (any common format); stored as a 256px WebP."""
    if int(request.headers.get("content-length") or 0) > MAX_AVATAR_UPLOAD:
        raise ApiError(413, "imageOver8", "Картинка больше 8 МБ")
    data = await request.body()
    if not data:
        raise ApiError(400, "emptyFile", "Пустой файл")
    if len(data) > MAX_AVATAR_UPLOAD:
        raise ApiError(413, "imageOver8", "Картинка больше 8 МБ")
    AVATARS_BY_USER.check(user["id"])
    webp = await process_image(make_avatar, data)
    # A fresh random name per upload so browsers never show a cached old picture.
    name = f"{user['id']}-{secrets.token_hex(8)}.webp"
    (AVATAR_DIR / name).write_bytes(webp)
    old = query("SELECT avatar FROM users WHERE id = ?", (user["id"],))[0]["avatar"]
    execute("UPDATE users SET avatar = ? WHERE id = ?", (name, user["id"]))
    remove_avatar_file(old)
    updated = public_user(query("SELECT * FROM users WHERE id = ?", (user["id"],))[0])
    await sio.emit("user:updated", updated)
    return updated


@router.delete("/api/me/avatar")
async def delete_avatar(user: dict = Depends(current_user)):
    old = query("SELECT avatar FROM users WHERE id = ?", (user["id"],))[0]["avatar"]
    execute("UPDATE users SET avatar = NULL WHERE id = ?", (user["id"],))
    remove_avatar_file(old)
    updated = public_user(query("SELECT * FROM users WHERE id = ?", (user["id"],))[0])
    await sio.emit("user:updated", updated)
    return updated


@router.get("/api/avatars/{name}")
def avatar_file(name: str, user: dict = Depends(media_user)):
    # Names are generated server-side; reject anything that could walk out of the folder.
    if "/" in name or "\\" in name or not name.endswith(".webp"):
        raise HTTPException(status_code=404)
    path = AVATAR_DIR / name
    if not path.is_file():
        raise HTTPException(status_code=404)
    return FileResponse(path, media_type="image/webp", headers=PRIVATE_IMAGE_HEADERS)


@router.get("/api/friends")
def list_friends(user: dict = Depends(current_user)):
    return friends_of(user["id"])


@router.post("/api/friends")
async def add_friend(body: FriendRequestIn, user: dict = Depends(current_user)):
    FRIEND_REQUESTS_BY_USER.check(user["id"])
    other = find_user_by_name(body.name)
    if not other:
        raise ApiError(404, "noUserByNick", "Нет пользователя с таким ником")
    if other["id"] == user["id"]:
        raise ApiError(400, "selfFriend", "Себя добавить нельзя")
    if blocked_between(user["id"], other["id"]):
        raise ApiError(403, "blocked", "Нельзя: один из вас заблокировал другого")
    existing = friendship(user["id"], other["id"])
    if existing and existing["status"] == "accepted":
        raise ApiError(409, "alreadyFriends", "Вы уже друзья")
    if existing and existing["requested_by"] == user["id"]:
        raise ApiError(409, "requestSent", "Заявка уже отправлена")
    if existing:
        # They already asked us: sending a request back means accepting it.
        execute("UPDATE friendships SET status = 'accepted' WHERE user_a = ? AND user_b = ?", ordered_pair(user["id"], other["id"]))
    else:
        a, b = ordered_pair(user["id"], other["id"])
        execute(
            "INSERT INTO friendships (user_a, user_b, requested_by, status, created_at) VALUES (?, ?, ?, 'pending', ?)",
            (a, b, user["id"], now_ms()),
        )
    await notify_friends_changed(user["id"], other["id"])
    return friends_of(user["id"])


@router.post("/api/friends/{other_id}/accept")
async def accept_friend(other_id: str, user: dict = Depends(current_user)):
    existing = friendship(user["id"], other_id)
    if not existing or existing["status"] != "pending" or existing["requested_by"] == user["id"]:
        raise ApiError(404, "noRequest", "Нет такой заявки")
    execute("UPDATE friendships SET status = 'accepted' WHERE user_a = ? AND user_b = ?", ordered_pair(user["id"], other_id))
    await notify_friends_changed(user["id"], other_id)
    return friends_of(user["id"])


@router.delete("/api/friends/{other_id}")
async def remove_friend(other_id: str, user: dict = Depends(current_user)):
    """Decline an incoming request, cancel an outgoing one, or unfriend."""
    execute("DELETE FROM friendships WHERE user_a = ? AND user_b = ?", ordered_pair(user["id"], other_id))
    await notify_friends_changed(user["id"], other_id)
    return friends_of(user["id"])


SETUP_BY_IP = RateLimit(20, 600)


def setup_needed() -> bool:
    return not query("SELECT 1 FROM users LIMIT 1")


@router.get("/api/setup")
def setup_status():
    """Whether this server still waits for its first-run setup (no accounts yet)."""
    return {"needed": setup_needed(), "serverName": server_name(), "serverIcon": icon_url()}


class SetupCodeIn(BaseModel):
    code: str = Field(max_length=200)


def check_setup_code(code: str, request: Request) -> None:
    SETUP_BY_IP.check(client_ip(request))
    if not setup_needed():
        raise ApiError(409, "alreadySetup", "Сервер уже настроен")
    if not hmac.compare_digest(code.strip().encode(), INVITE_CODE.encode()):
        raise ApiError(403, "badSetupCode", "Код не подходит. Он в файле .env на сервере, строка INVITE_CODE")


@router.post("/api/setup/check")
def setup_check(body: SetupCodeIn, request: Request):
    check_setup_code(body.code, request)
    return {"ok": True}


class SetupIn(BaseModel):
    code: str = Field(max_length=200)
    serverName: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=32)
    password: str = Field(min_length=MIN_PASSWORD_LEN, max_length=128)


@router.post("/api/setup")
async def setup(body: SetupIn, request: Request, response: Response):
    """First run: name the server and create its admin. Works once, with the code from .env."""
    check_setup_code(body.code, request)
    name = " ".join(body.name.split())
    title = " ".join(body.serverName.split())
    check_nick(name)
    if not title:
        raise ApiError(400, "emptyServerName", "Пустое название сервера")
    user_id = uuid.uuid4().hex
    password_hash = await password_work(hash_password, body.password)
    try:
        with connect_db() as conn:
            # Inside the transaction: two tabs racing through setup can't both make an admin.
            if conn.execute("SELECT 1 FROM users LIMIT 1").fetchone():
                raise ApiError(409, "alreadySetup", "Сервер уже настроен")
            conn.execute(
                "INSERT INTO users (id, name, name_key, password_hash, color, created_at, is_admin) VALUES (?, ?, ?, ?, ?, ?, 1)",
                (user_id, name, name.casefold(), password_hash, secrets.choice(USER_COLORS), now_ms()),
            )
            conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('server_name', ?)", (title,))
    except sqlite3.IntegrityError:
        raise ApiError(409, "alreadySetup", "Сервер уже настроен")
    user = public_user(query("SELECT * FROM users WHERE id = ?", (user_id,))[0])
    set_media_cookie(request, response, user_id)
    await sio.emit("user:new", user)
    return {"token": issue_token(user_id), "user": user}


def my_account(user_id: str) -> dict:
    """What only you see about yourself: your real status, whether a recovery key exists and whether you are the admin."""
    row = query("SELECT status, status_text, status_until, recovery_hash FROM users WHERE id = ?", (user_id,))[0]
    return {
        "myStatus": row["status"],
        "myStatusText": row["status_text"],
        "myStatusUntil": row["status_until"],
        "hasRecoveryKey": bool(row["recovery_hash"]),
        "isAdmin": is_account_admin(user_id),
    }


@router.get("/api/bootstrap")
def bootstrap(request: Request, response: Response, user: dict = Depends(current_user)):
    users = [public_user(r) for r in query("SELECT * FROM users ORDER BY name")]
    # Sessions from before the media cookie existed get it here, and everyone's gets renewed.
    set_media_cookie(request, response, user["id"])
    return {
        "me": user,
        "users": users,
        "channels": list_channels(),
        "livekitUrl": LIVEKIT_URL,
        "serverName": server_name(),
        "serverIcon": icon_url(),
        "relayOnly": RELAY_ONLY,
        "canManageChannels": is_admin(user),
        "mutedChannels": muted_channels(user["id"]),
        **dict(zip(("unread", "mentions"), unread_counts(user))),
        "blocked": blocked_ids(user["id"]),
        **my_account(user["id"]),
    }


# The other gomex modules import this one too: they come last, once everything above is defined.
from .channels import list_channels, muted_channels, unread_counts
from .uploads import PRIVATE_IMAGE_HEADERS, make_avatar, process_image
from .realtime import disconnect_user, presence_payload, sio, user_room
from .server import icon_url
