"""Early access: an admin turns it on (off by default), the server then updates to pre-releases (install.sh reads
GET /api/server/channel) and once a week sends seven numbers to PING_URL. No names, messages, people's ids or
addresses leave the server, only counts made here: how many accounts, and how many people keep coming back to voice
rooms where 3+ people talk at once. The admin sees exactly what goes out (GET /api/server/early-access)."""

import asyncio
import json
import secrets
import urllib.request
from datetime import datetime, timedelta, timezone

from fastapi.concurrency import run_in_threadpool

from .config import ATRIUM_VERSION, PING_URL
from .db import connect_db, execute, now_ms, query

WEEK_MS = 7 * 24 * 3600 * 1000
KEEP_DAYS = 30


def today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def days_ago(n: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=n)).strftime("%Y-%m-%d")


def setting(key: str) -> str | None:
    rows = query("SELECT value FROM settings WHERE key = ?", (key,))
    return rows[0]["value"] if rows else None


def set_setting(key: str, value: str) -> None:
    execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (key, value))


def server_id() -> str:
    """A random id made once, so pings from one server can be told apart from another's: not its address."""
    found = setting("server_id")
    if not found:
        found = secrets.token_hex(16)
        set_setting("server_id", found)
    return found


def installed_at() -> int:
    found = setting("installed_at")
    if not found:
        # A server from before this: its first account is as close to its install as we can know.
        first = query("SELECT MIN(created_at) AS t FROM users")[0]["t"]
        found = str(first or now_ms())
        set_setting("installed_at", found)
    return int(found)


def enabled() -> bool:
    return setting("early_access") == "1"


def set_enabled(on: bool) -> None:
    set_setting("early_access", "1" if on else "0")
    if on:
        # The first ping goes within the hour, so the admin can see it went.
        execute("DELETE FROM settings WHERE key = 'ping_last'")


def note_room(channel_id: str) -> None:
    """Everyone in this voice room was in voice today; if 3+ are in it together, it was a real call for all of them."""
    from .realtime import voice

    people = {e["userId"] for e in voice.values() if e["kind"] == "channel" and e["channelId"] == channel_id}
    if not people:
        return
    day = today()
    crowded = 1 if len(people) >= 3 else 0
    with connect_db() as conn:
        for user_id in people:
            conn.execute("INSERT OR IGNORE INTO voice_days (user_id, day) VALUES (?, ?)", (user_id, day))
            if crowded:
                conn.execute("UPDATE voice_days SET crowded = 1 WHERE user_id = ? AND day = ?", (user_id, day))


def note_all_rooms() -> None:
    """For whoever sits in a room past midnight: today counts for them too."""
    from .realtime import voice

    for channel_id in {e["channelId"] for e in voice.values() if e["kind"] == "channel"}:
        note_room(channel_id)


def numbers() -> dict:
    """Exactly what a ping sends: the last 7 days, counted here."""
    since = days_ago(6)
    crowded = query(
        "SELECT user_id, COUNT(DISTINCT day) AS days FROM voice_days WHERE crowded = 1 AND day >= ? GROUP BY user_id",
        (since,),
    )
    return {
        "server": server_id(),
        "version": ATRIUM_VERSION,
        "days_since_install": max(0, (now_ms() - installed_at()) // (24 * 3600 * 1000)),
        "members": query("SELECT COUNT(*) AS n FROM users WHERE removed = 0")[0]["n"],
        "voice3_people": len(crowded),
        "active2d": sum(1 for row in crowded if row["days"] >= 2),
        "voice3_days": query("SELECT COUNT(DISTINCT day) AS n FROM voice_days WHERE crowded = 1 AND day >= ?", (since,))[0]["n"],
    }


def send(body: dict) -> None:
    request = urllib.request.Request(
        PING_URL,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "User-Agent": f"Atrium/{ATRIUM_VERSION}"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=10):
        pass


async def ping_if_due() -> None:
    last = int(setting("ping_last") or 0)
    if not enabled() or now_ms() - last < WEEK_MS:
        return
    body = numbers()
    await run_in_threadpool(send, body)
    set_setting("ping_last", str(now_ms()))
    set_setting("ping_last_body", json.dumps(body))


def last_sent() -> dict | None:
    if not setting("ping_last"):
        return None
    return {"at": int(setting("ping_last") or 0), "numbers": json.loads(setting("ping_last_body") or "{}")}


async def ping_loop() -> None:
    server_id()
    installed_at()
    while True:
        try:
            note_all_rooms()
            execute("DELETE FROM voice_days WHERE day < ?", (days_ago(KEEP_DAYS),))
            await ping_if_due()
        except Exception as e:  # a bad hour, or the site down: try again next hour
            print(f"early access ping failed: {e!r}", flush=True)
        await asyncio.sleep(3600)

