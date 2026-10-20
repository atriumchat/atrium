"""Who is asking: passwords, tokens, the media cookie, rate limits, admin rights."""

import asyncio
import hashlib
import hmac
import secrets
import time
from collections import deque

import jwt
from fastapi import Header, HTTPException, Request, Response
from fastapi.concurrency import run_in_threadpool

from .config import ADMINS, APP_SECRET, MEDIA_COOKIE, TOKEN_TTL
from .errors import ApiError
from .db import query


# scrypt cost: 2^15 x 8 = 32 MB per hash. Parameters are stored with each hash, so they can be raised later
# and old hashes are upgraded on the next successful login.
SCRYPT_N, SCRYPT_R, SCRYPT_P = 2**15, 8, 1
SCRYPT_MAXMEM = 64 * 1024 * 1024


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P, maxmem=SCRYPT_MAXMEM)
    return f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    parts = stored.split("$")
    if parts[0] == "scrypt":
        n, r, p = (int(x) for x in parts[1:4])
        salt_hex, digest_hex = parts[4], parts[5]
    else:  # the first format, "salt$digest" at n=2^14
        n, r, p = 2**14, 8, 1
        salt_hex, digest_hex = parts
    digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt_hex), n=n, r=r, p=p, maxmem=SCRYPT_MAXMEM)
    return hmac.compare_digest(digest.hex(), digest_hex)


def password_outdated(stored: str) -> bool:
    return not stored.startswith(f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}$")


# Checked against when the nick doesn't exist, so a login takes as long either way and doesn't reveal which nicks exist.
DUMMY_HASH = hash_password(secrets.token_hex(16))

# Every scrypt call holds 32 MB for its run. Unbounded, the 40-thread pool lets a burst of logins take over 1 GB
# and the container gets killed; three at a time caps it near 100 MB, the rest wait a few hundred ms.
PASSWORD_WORK = asyncio.Semaphore(3)


async def password_work(fn, *args):
    """hash_password / verify_password off the event loop, a few at a time. Always call scrypt through this."""
    async with PASSWORD_WORK:
        return await run_in_threadpool(fn, *args)


class RateLimit:
    """At most `limit` hits per `window` seconds for each key (an IP, a user id, ...). In memory: one process."""

    def __init__(self, limit: int, window: float):
        self.limit = limit
        self.window = window
        self.hits: dict[str, deque] = {}

    def wait(self, key: str) -> int:
        """Record a hit and return 0, or return how many seconds to wait without recording it."""
        now = time.monotonic()
        if len(self.hits) > 10_000:
            self.hits = {k: q for k, q in self.hits.items() if q and q[-1] > now - self.window}
        q = self.hits.setdefault(key, deque())
        while q and q[0] <= now - self.window:
            q.popleft()
        if len(q) >= self.limit:
            return int(q[0] + self.window - now) + 1
        q.append(now)
        return 0

    def check(self, key: str) -> None:
        if seconds := self.wait(key):
            wait = f"{seconds} с" if seconds < 60 else f"{-(-seconds // 60)} мин"
            raise ApiError(
                429, "tooManyTries", f"Слишком много попыток, повтор через {wait}", minutes=-(-seconds // 60), seconds=seconds
            )


LOGIN_BY_IP = RateLimit(20, 600)
LOGIN_BY_NAME = RateLimit(8, 600)
REGISTER_BY_IP = RateLimit(6, 3600)
UPLOADS_BY_USER = RateLimit(60, 600)
AVATARS_BY_USER = RateLimit(10, 600)
MESSAGES_BY_USER = RateLimit(20, 10)
FRIEND_REQUESTS_BY_USER = RateLimit(30, 3600)
GROUPS_BY_USER = RateLimit(20, 3600)
INVITE_RESETS_BY_USER = RateLimit(10, 86400)
INVITE_CHECKS_BY_IP = RateLimit(30, 600)
RESET_LINKS_BY_USER = RateLimit(20, 3600)
RESET_BY_IP = RateLimit(30, 600)


def client_ip(request: Request) -> str:
    # uvicorn runs with --proxy-headers trusting only Caddy on 127.0.0.1, so this is the real client address.
    return request.client.host if request.client else "?"


def public_user(row: dict) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "color": row["color"],
        "bio": row.get("bio") or "",
        "avatarUrl": f"/api/avatars/{row['avatar']}" if row.get("avatar") else None,
        "invitedBy": row.get("invited_by"),
        "createdAt": row["created_at"],
        # Invisible people look like everyone else here; they're simply left out of who's online.
        "status": "dnd" if row.get("status") == "dnd" else "online",
        "statusText": row.get("status_text") or "",
    }


def issue_token(user_id: str, scope: str = "api", *, version: int | None = None) -> str:
    now = int(time.time())
    if version is None:
        rows = query("SELECT token_version FROM users WHERE id = ?", (user_id,))
        version = rows[0]["token_version"] if rows else 0
    return jwt.encode({"sub": user_id, "scope": scope, "v": version, "iat": now, "exp": now + TOKEN_TTL}, APP_SECRET, algorithm="HS256")


def user_from_token(token: str | None, scope: str = "api") -> dict | None:
    if not token:
        return None
    try:
        payload = jwt.decode(token, APP_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    # Tokens from before scopes existed are API tokens. A media cookie can't be used as an API token or vice versa.
    if payload.get("scope", "api") != scope:
        return None
    rows = query("SELECT * FROM users WHERE id = ?", (payload.get("sub"),))
    # A token from before the last password change or recovery no longer counts.
    if not rows or rows[0]["token_version"] != payload.get("v", 0):
        return None
    return {**public_user(rows[0]), "_authVersion": rows[0]["token_version"]}


def current_user(authorization: str = Header(default="")) -> dict:
    token = authorization.removeprefix("Bearer ").strip()
    user = user_from_token(token)
    if not user:
        raise ApiError(401, "sessionExpired", "Нужно войти заново")
    return user


def media_user(request: Request) -> dict:
    """Avatars and chat images load through <img>, which can't send the Bearer header; they use an HttpOnly cookie."""
    user = user_from_token(request.cookies.get(MEDIA_COOKIE), scope="media")
    if not user:
        raise HTTPException(status_code=401)
    return user


def set_media_cookie(request: Request, response: Response, user_id: str, *, version: int | None = None) -> None:
    response.set_cookie(
        MEDIA_COOKIE,
        issue_token(user_id, scope="media", version=version),
        max_age=TOKEN_TTL,
        path="/api/",
        httponly=True,
        secure=request.url.scheme == "https",
        samesite="strict",
    )


def is_admin(user: dict) -> bool:
    if query("SELECT 1 FROM users WHERE is_admin = 1 LIMIT 1"):
        return bool(query("SELECT 1 FROM users WHERE id = ? AND is_admin = 1", (user["id"],)))
    # Nobody is an admin yet: everyone may manage the server, unless ADMINS says who will be.
    return not ADMINS


def is_account_admin(user_id: str) -> bool:
    """The account itself holds the admin flag. Unlike is_admin(), this is not true for everyone on a server that
    never got an admin: fine for renaming channels, not for taking over somebody's account."""
    return bool(query("SELECT 1 FROM users WHERE id = ? AND is_admin = 1", (user_id,)))
