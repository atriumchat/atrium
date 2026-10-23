"""Settings from the environment, and the limits the rest of the server is built on."""

import os
import re
from pathlib import Path


# Default: server/data, beside app.py.
DATA_DIR = Path(os.environ.get("DATA_DIR", Path(__file__).parent.parent / "data"))
APP_SECRET = os.environ.get("APP_SECRET", "dev-secret-change-me")
# Only for the very first account on an empty server; after that people join with personal one-time invites.
INVITE_CODE = os.environ.get("INVITE_CODE", "friends")
LIVEKIT_API_KEY = os.environ.get("LIVEKIT_API_KEY", "devkey")
LIVEKIT_API_SECRET = os.environ.get("LIVEKIT_API_SECRET", "secret")
# Address the browser uses to reach LiveKit (not the container-internal one).
LIVEKIT_URL = os.environ.get("LIVEKIT_URL", "ws://localhost:7880")
# Where this server reaches LiveKit's own API (same machine, host networking).
LIVEKIT_API = os.environ.get("LIVEKIT_API", "http://127.0.0.1:7880")
WEB_DIST = os.environ.get("WEB_DIST")
SERVER_NAME = os.environ.get("SERVER_NAME", "Atrium")
# Calls only through the TURN relay on 443 (no direct or plain-UDP paths): for networks where everything else
# gets cut. Each person can also turn it on for themselves.
RELAY_ONLY = os.environ.get("RELAY_ONLY", "") in ("1", "true", "yes")
# Nicks to make admins, only while the server has none (see seed_admins). From then on admin rights belong to
# the account (users.is_admin), not to the nick: a nick can be changed, so a nick freed up must not carry them.
ADMINS = {n.strip().casefold() for n in os.environ.get("ADMINS", "").split(",") if n.strip()}

if WEB_DIST and (APP_SECRET == "dev-secret-change-me" or LIVEKIT_API_SECRET == "secret" or INVITE_CODE == "friends"):
    # WEB_DIST is only set in the production image; never run it with the dev defaults (with the dev invite code
    # anyone could set up a fresh server and become its admin).
    raise RuntimeError("APP_SECRET, LIVEKIT_API_SECRET and INVITE_CODE must be set in production")

TOKEN_TTL = 180 * 24 * 3600
VOICE_TOKEN_TTL = 10 * 60
MAX_MESSAGE_LEN = 4000
MIN_PASSWORD_LEN = 8
# Everyone has one personal invite link; this many people can sign up with it (admins: no limit).
INVITE_LIMIT = int(os.environ.get("INVITE_LIMIT", "5"))
# Invite codes: 8 characters without look-alikes (0/O, 1/I/L), shown as XXXX-XXXX.
INVITE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
MAX_GROUP_MEMBERS = 10
RING_SECONDS = 45
MEDIA_COOKIE = "gx_media"
MAX_AVATAR_UPLOAD = 8 * 1024 * 1024
AVATAR_SIZE = 256
# The server's own icon: big enough for a phone's home screen when the app is installed from the browser.
SERVER_ICON_SIZE = 512
MAX_IMAGE_UPLOAD = 20 * 1024 * 1024
MAX_ATTACHMENTS = 10
# Any file that isn't a picture: kept as is (the disk is small, so the limit is too) and always downloaded, never shown.
MAX_FILE_UPLOAD = 25 * 1024 * 1024
MAX_FILE_NAME = 120
# Mentions are stored by id so a renamed person is still mentioned: <@32-hex-id>, or <@all> for everyone.
MENTION = re.compile(r"<@([0-9a-f]{32}|all)>")
MAX_EMOJI_LEN = 32
IMAGE_MAX_SIDE = 2560
# Animated images are decoded frame by frame into memory, so they get a smaller size and a total pixel budget.
ANIMATION_MAX_SIDE = 800
ANIMATION_PIXEL_BUDGET = 40_000_000
# Bigger pictures are refused before decoding: Pillow's own limit lets ~180 million pixels through, ~700 MB
# once decoded, on a box with 4 GB for everything.
MAX_IMAGE_PIXELS = 40_000_000
# What the chat shows inline; the full picture only opens on a click.
PREVIEW_SIDE = 960
# Per person per day, and uploads stop altogether when the disk runs low: the server has ~10 GB for the
# database, backups and Docker too.
UPLOAD_BYTES_PER_DAY = int(os.environ.get("UPLOAD_MB_PER_DAY", "500")) * 1024 * 1024
MIN_FREE_DISK = 1024**3
# Sent pictures and files no message ever claimed are deleted after this long.
UNSENT_UPLOAD_TTL_MS = 24 * 3600 * 1000
USER_COLORS = ["#5865f2", "#3ba55c", "#faa61a", "#ed4245", "#eb459e", "#1abc9c", "#9b59b6", "#e67e22"]
DEFAULT_CHANNELS = [("общий", "text"), ("игры", "text"), ("Общий", "voice"), ("Катка", "voice")]

DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "hangout.db"
AVATAR_DIR = DATA_DIR / "avatars"
AVATAR_DIR.mkdir(exist_ok=True)
UPLOAD_DIR = DATA_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

# Times from clients are milliseconds; anything past 2^53 isn't one, and SQLite can't hold numbers past 2^63 anyway.
MAX_TIME = 2**53
