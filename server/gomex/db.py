"""SQLite: the connection each thread keeps, the schema and its migrations."""

import json
import sqlite3
import threading
import time
import uuid
from contextlib import closing

from .config import ADMINS, DB_PATH, DEFAULT_CHANNELS


DMS_TABLES = """
-- Private conversation: a 'dm' between two people (pair_key "a:b" with a < b, so one per pair)
-- or a 'group' of up to MAX_GROUP_MEMBERS. Who's in it lives in dm_members.
CREATE TABLE IF NOT EXISTS {dms} (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'dm' CHECK (kind IN ('dm', 'group')),
  name TEXT NOT NULL DEFAULT '',
  owner_id TEXT REFERENCES users(id),
  pair_key TEXT UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS dm_members (
  dm_id TEXT NOT NULL REFERENCES dms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (dm_id, user_id)
);
CREATE INDEX IF NOT EXISTS dm_members_user ON dm_members(user_id);
"""

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,  -- casefolded name; SQLite NOCASE only folds ASCII, not Cyrillic
  password_hash TEXT NOT NULL,
  color TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('text', 'voice')),
  position INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_channel_time ON messages(channel_id, created_at);
-- One row per pair, user_a < user_b.
CREATE TABLE IF NOT EXISTS friendships (
  user_a TEXT NOT NULL REFERENCES users(id),
  user_b TEXT NOT NULL REFERENCES users(id),
  requested_by TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_a, user_b)
);
{DMS_TABLES}
CREATE TABLE IF NOT EXISTS dm_messages (
  id TEXT PRIMARY KEY,
  dm_id TEXT NOT NULL REFERENCES dms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS dm_messages_time ON dm_messages(dm_id, created_at);
-- Images uploaded for messages; the file is UPLOAD_DIR/<id>.
-- scope says who may load it: NULL = not sent yet (uploader only), 'channel', or 'dm:<id>'.
CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  scope TEXT
);
-- Channels a person muted: no counter on them and nothing added to the app badge.
CREATE TABLE IF NOT EXISTS channel_mutes (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, channel_id)
);
""".replace("{DMS_TABLES}", DMS_TABLES.replace("{dms}", "dms"))


def now_ms() -> int:
    return int(time.time() * 1000)


_db = threading.local()


def connect_db() -> sqlite3.Connection:
    """This thread's connection, opened once and kept (the event loop and each worker thread have their own).

    Use it as `with connect_db() as conn:` for anything that writes: that's one transaction, committed at the end
    or rolled back on an error, so a kept connection never sits on an open write.
    """
    conn = getattr(_db, "conn", None)
    if conn is None:
        conn = sqlite3.connect(DB_PATH, timeout=5)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        # With WAL this is still crash-safe; it only skips the fsync on every commit, which on a cheap VPS disk
        # costs milliseconds each, inside the event loop.
        conn.execute("PRAGMA synchronous = NORMAL")
        _db.conn = conn
    return conn


def query(sql: str, params: tuple = ()) -> list[dict]:
    return [dict(row) for row in connect_db().execute(sql, params).fetchall()]


def execute(sql: str, params: tuple = ()) -> None:
    with connect_db() as conn:
        conn.execute(sql, params)


def migrate_dms() -> None:
    """dms used to hold exactly two people (user_a, user_b). Rebuild it so groups fit, members moving to dm_members.

    Uses SQLite's documented table-rebuild steps; foreign keys must be off, or dropping the old table
    would cascade-delete every DM message.
    """
    with closing(sqlite3.connect(DB_PATH)) as conn:
        columns = {row[1] for row in conn.execute("PRAGMA table_info(dms)")}
        if not columns or "kind" in columns:
            return
        conn.execute("PRAGMA foreign_keys = OFF")
        conn.executescript(
            "BEGIN;"
            + DMS_TABLES.replace("{dms}", "dms_new")
            + """
            INSERT INTO dms_new (id, kind, name, owner_id, pair_key, created_at)
              SELECT id, 'dm', '', NULL, user_a || ':' || user_b, created_at FROM dms;
            INSERT OR IGNORE INTO dm_members (dm_id, user_id, joined_at) SELECT id, user_a, created_at FROM dms;
            INSERT OR IGNORE INTO dm_members (dm_id, user_id, joined_at) SELECT id, user_b, created_at FROM dms;
            DROP TABLE dms;
            ALTER TABLE dms_new RENAME TO dms;
            COMMIT;
            """
        )
        if conn.execute("PRAGMA foreign_key_check").fetchall():
            raise RuntimeError("DM migration left broken references; restore the backup")


def seed_admins(conn: sqlite3.Connection) -> None:
    """Make the accounts named in ADMINS admins, but only while the server has no admin at all.

    Once someone is an admin, ADMINS is ignored: otherwise whoever took an admin's old nick after a rename would
    become an admin on the next restart.
    """
    if not ADMINS or conn.execute("SELECT 1 FROM users WHERE is_admin = 1 LIMIT 1").fetchone():
        return
    marks = ", ".join("?" * len(ADMINS))
    conn.execute(f"UPDATE users SET is_admin = 1 WHERE name_key IN ({marks})", tuple(ADMINS))


def init_db() -> None:
    migrate_dms()
    with connect_db() as conn:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.executescript(SCHEMA)
        user_columns = {row[1] for row in conn.execute("PRAGMA table_info(users)")}
        if "bio" not in user_columns:
            conn.execute("ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT ''")
        if "avatar" not in user_columns:
            conn.execute("ALTER TABLE users ADD COLUMN avatar TEXT")
        if "invited_by" not in user_columns:
            conn.execute("ALTER TABLE users ADD COLUMN invited_by TEXT REFERENCES users(id)")
        if "invite_code" not in user_columns:
            # The personal invite link's code; made on first use, replaced when the owner resets it.
            conn.execute("ALTER TABLE users ADD COLUMN invite_code TEXT")
        conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS users_invite_code ON users(invite_code)")
        # The short-lived one-time-invites design, replaced by one personal link per person. People who joined
        # through it become friends with whoever invited them, as joining by invite does now.
        if conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'invites'").fetchone():
            conn.execute(
                """INSERT INTO friendships (user_a, user_b, requested_by, status, created_at)
                   SELECT MIN(invited_by, id), MAX(invited_by, id), invited_by, 'accepted', created_at
                   FROM users WHERE invited_by IS NOT NULL
                   ON CONFLICT (user_a, user_b) DO UPDATE SET status = 'accepted'"""
            )
            conn.execute("DROP TABLE invites")
        for table in ("messages", "dm_messages"):
            if "attachments" not in {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}:
                # JSON list of {url, width, height}
                conn.execute(f"ALTER TABLE {table} ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]'")
        for table in ("messages", "dm_messages"):
            columns = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
            if "reply_to" not in columns:
                # The message this one answers, in the same conversation; it may since have been deleted.
                conn.execute(f"ALTER TABLE {table} ADD COLUMN reply_to TEXT")
            if "edited_at" not in columns:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN edited_at INTEGER")
        had_read_states = conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'read_states'").fetchone()
        conn.executescript(
            """
            -- One row per person per emoji on a message (channel or DM: message ids are unique across both).
            CREATE TABLE IF NOT EXISTS reactions (
              message_id TEXT NOT NULL,
              user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              emoji TEXT NOT NULL,
              created_at INTEGER NOT NULL,
              PRIMARY KEY (message_id, user_id, emoji)
            );
            CREATE INDEX IF NOT EXISTS reactions_message ON reactions(message_id);
            -- How far each person has read each channel or DM (the newest message time they've seen), so
            -- unread counts are the same on every device.
            CREATE TABLE IF NOT EXISTS read_states (
              user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              conversation_id TEXT NOT NULL,
              read_at INTEGER NOT NULL,
              PRIMARY KEY (user_id, conversation_id)
            );
            """
        )
        if not had_read_states:
            # Upgrading a server from before read marks: everything said until now counts as read, rather than
            # every channel and DM lighting up with its whole history at once.
            upgraded_at = now_ms()
            conn.execute(
                """INSERT OR IGNORE INTO read_states (user_id, conversation_id, read_at)
                   SELECT users.id, channels.id, ? FROM users, channels WHERE channels.kind = 'text'""",
                (upgraded_at,),
            )
            conn.execute(
                "INSERT OR IGNORE INTO read_states (user_id, conversation_id, read_at) SELECT user_id, dm_id, ? FROM dm_members",
                (upgraded_at,),
            )
        user_columns = {row[1] for row in conn.execute("PRAGMA table_info(users)")}
        if "token_version" not in user_columns:
            # Bumped on a password change or recovery: every token issued before stops working.
            conn.execute("ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0")
        if "recovery_hash" not in user_columns:
            # Hash of the one-time recovery key (there's no e-mail to reset a password with).
            conn.execute("ALTER TABLE users ADD COLUMN recovery_hash TEXT")
        if "is_admin" not in user_columns:
            # Set for whoever finished the first-run setup, or named in ADMINS (seed_admins). While nobody has
            # it, everyone may manage the server, as before setups existed.
            conn.execute("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0")
        seed_admins(conn)
        if "status" not in user_columns:
            # 'online', 'dnd' (do not disturb) or 'invisible' (looks offline), plus a line of one's own.
            conn.execute("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'online'")
            conn.execute("ALTER TABLE users ADD COLUMN status_text TEXT NOT NULL DEFAULT ''")
        if "status_until" not in user_columns:
            # When a timed "do not disturb" / "invisible" runs out and you're back online (ms); NULL = until changed.
            conn.execute("ALTER TABLE users ADD COLUMN status_until INTEGER")
        conn.executescript(
            """
            -- user_id doesn't want to hear from blocked_id: no DMs or calls between them, no friend requests,
            -- and blocked_id's messages are folded away for user_id.
            -- Server-wide settings made in the browser (the first-run setup), e.g. the server's name.
            CREATE TABLE IF NOT EXISTS settings (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS blocks (
              user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              created_at INTEGER NOT NULL,
              PRIMARY KEY (user_id, blocked_id)
            );
            -- The link an admin makes for someone who lost both password and recovery key. One per person (a newer
            -- link replaces the older one); only the SHA-256 of the token is kept, and using it deletes the row.
            CREATE TABLE IF NOT EXISTS password_resets (
              user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
              token_hash TEXT NOT NULL UNIQUE,
              expires_at INTEGER NOT NULL,
              created_at INTEGER NOT NULL
            );
            """
        )
        upload_columns = {row[1] for row in conn.execute("PRAGMA table_info(uploads)")}
        if "file_name" not in upload_columns:
            # Set for plain files (not pictures): the original name, size in bytes and type, for the download.
            conn.execute("ALTER TABLE uploads ADD COLUMN file_name TEXT")
            conn.execute("ALTER TABLE uploads ADD COLUMN file_size INTEGER")
            conn.execute("ALTER TABLE uploads ADD COLUMN file_type TEXT")
        if "scope" not in {row[1] for row in conn.execute("PRAGMA table_info(uploads)")}:
            conn.execute("ALTER TABLE uploads ADD COLUMN scope TEXT")
            # Images sent before scopes existed: derive who may see them from the message they're in.
            for table, scope_sql in (("messages", "'channel'"), ("dm_messages", "'dm:' || dm_id")):
                for row in conn.execute(f"SELECT attachments, {scope_sql} AS scope FROM {table} WHERE attachments != '[]'"):
                    for a in json.loads(row["attachments"]):
                        conn.execute("UPDATE uploads SET scope = ? WHERE id = ?", (row["scope"], a["url"].rsplit("/", 1)[-1]))
        conn.executescript(
            """
            -- The daily upload allowance and the sweep of never-sent uploads.
            CREATE INDEX IF NOT EXISTS uploads_user_time ON uploads(user_id, created_at);
            -- The inbox: newest messages first, and "answers to my messages".
            CREATE INDEX IF NOT EXISTS messages_time ON messages(created_at);
            CREATE INDEX IF NOT EXISTS messages_user ON messages(user_id);
            CREATE INDEX IF NOT EXISTS dm_messages_user ON dm_messages(user_id);
            """
        )
        # Channels and groups deleted before their reactions and read marks were cleaned up with them.
        conn.execute("DELETE FROM reactions WHERE message_id NOT IN (SELECT id FROM messages UNION ALL SELECT id FROM dm_messages)")
        conn.execute("DELETE FROM read_states WHERE conversation_id NOT IN (SELECT id FROM channels UNION ALL SELECT id FROM dms)")
        if conn.execute("SELECT COUNT(*) FROM channels").fetchone()[0] == 0:
            for position, (name, kind) in enumerate(DEFAULT_CHANNELS):
                conn.execute(
                    "INSERT INTO channels (id, name, kind, position, created_at) VALUES (?, ?, ?, ?, ?)",
                    (uuid.uuid4().hex, name, kind, position, now_ms()),
                )
