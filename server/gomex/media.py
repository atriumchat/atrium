"""Immutable media can be copied during writes, but must not disappear during a backup."""

import fcntl
from pathlib import Path

from .config import DATA_DIR


MEDIA_LOCK = DATA_DIR / ".media.lock"
MEDIA_LOCK.touch(exist_ok=True)


def remove_media_files(paths) -> bool:
    # Never stall the event loop behind rsync. Housekeeping retries unreferenced files later.
    with MEDIA_LOCK.open("rb") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_SH | fcntl.LOCK_NB)
        except BlockingIOError:
            return False
        for path in paths:
            Path(path).unlink(missing_ok=True)
    return True
