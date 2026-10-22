#!/usr/bin/env bash
# Nightly backup, run by the atrium-backup systemd timer that install.sh installs: a consistent copy of the
# database plus avatars and chat files (media/), kept for 14 days in /root/atrium-backups/daily.
set -euo pipefail
umask 077
cd "$(dirname "$0")"

root=/root/atrium-backups/daily
dest=$root/$(date +%Y-%m-%d)
# The newest earlier backup: its pictures are hard-linked rather than copied again (below).
# shellcheck disable=SC2012  # our own dated folder names, nothing odd in them
prev=$(ls -1d "$root"/*/ 2>/dev/null | sed 's:/$::' | grep -vx "$dest" | tail -1 || true)

# Backups share the small disk with the live database: if less than 1 GB is free, stop here rather than
# fill it up and stop the chat with it. The timer's journal shows the failure.
free_kb=$(df -Pk /root | awk 'NR == 2 { print $4 }')
if (( free_kb < 1024 * 1024 )); then
  echo "$(date -Is) backup skipped: only $((free_kb / 1024)) MB free on disk" >&2
  exit 1
fi
mkdir -p "$root"
# Same inode as atrium.media: uploads have unique names, and deletions wait until this snapshot is copied.
exec 9< data/.media.lock
flock -x 9
stage=$(mktemp -d "$root/.backup.XXXXXX")
old=$root/.previous-$$
cleanup() {
  if [[ -d "$old" && ! -d "$dest" ]]; then mv "$old" "$dest"; fi
  rm -rf -- "$stage"
}
trap cleanup EXIT

# SQLite's backup API copies consistently while the app keeps writing. It lands in the data folder
# because that's the only place the read-only app container can write to that the host can see.
docker compose exec -T app python -c "
import sqlite3
src = sqlite3.connect('/data/hangout.db')
dst = sqlite3.connect('/data/.backup.db')
src.backup(dst)
dst.close()
"
mv data/.backup.db "$stage/snapshot.db"
# Pictures and files as plain copies, hard-linked to the previous backup where unchanged: 14 days cost about
# one copy plus what was new each day (a daily tar of everything cost 14 full copies). They're WebP and
# user files, already compressed, so no gzip either.
link=()
[[ -n "$prev" && -d "$prev/media" ]] && link=(--link-dest="$prev/media")
rsync -a --delete ${link[@]+"${link[@]}"} data/avatars data/uploads "$stage/media/"
# Only complete copies have hangout.db and a dated name visible to restore.
mv "$stage/snapshot.db" "$stage/hangout.db"
chmod -R go-rwx "$stage"
if [[ -d "$dest" ]]; then mv "$dest" "$old"; fi
mv "$stage" "$dest"
rm -rf -- "$old"

chmod -R go-rwx /root/atrium-backups
find /root/atrium-backups/daily -mindepth 1 -maxdepth 1 -type d -mtime +14 -exec rm -rf {} +
echo "$(date -Is) backup ok: $dest"
