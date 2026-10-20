"""Run backup.sh on a disposable tree; emulate a message/file deletion after its SQLite snapshot."""
from pathlib import Path
import os
import sqlite3
import subprocess
import tempfile

root = Path(tempfile.mkdtemp(prefix='gomex-backup-review-'))
deploy = root / 'deploy'
data = deploy / 'data'
(data / 'uploads').mkdir(parents=True)
(data / 'avatars').mkdir()
(data / 'uploads' / 'fixture.bin').write_bytes(b'disposable test attachment')
with sqlite3.connect(data / 'hangout.db') as db:
    db.execute('CREATE TABLE uploads (id TEXT PRIMARY KEY)')
    db.execute("INSERT INTO uploads VALUES ('fixture.bin')")
# A previous media tree also avoids the empty-array quirk in macOS Bash 3.2.
(root/'backups'/'daily'/'2000-01-01'/'media'/'uploads').mkdir(parents=True)
(root/'backups'/'daily'/'2000-01-01'/'media'/'avatars').mkdir()
mockbin = root / 'bin'
mockbin.mkdir()
(mockbin / 'docker').write_text('''#!/usr/bin/env python3
import sqlite3
from pathlib import Path
data=Path.cwd()/'data'
with sqlite3.connect(data/'hangout.db') as src, sqlite3.connect(data/'.backup.db') as dst:
 src.backup(dst)
# A concurrent message deletion immediately after the DB snapshot.
with sqlite3.connect(data/'hangout.db') as src:
 src.execute('DELETE FROM uploads')
(data/'uploads'/'fixture.bin').unlink()
''')
(mockbin / 'docker').chmod(0o755)
# Linux's date -Is spelling is not available on macOS. Only its log timestamp is adapted.
(mockbin / 'date').write_text('''#!/bin/sh
if [ "$1" = -Is ]; then exec /bin/date '+%Y-%m-%dT%H:%M:%S'; fi
exec /bin/date "$@"
''')
(mockbin / 'date').chmod(0o755)
source = (Path(__file__).resolve().parents[2] / 'deploy' / 'backup.sh').read_text()
script = deploy / 'backup.sh'
script.write_text(source.replace('/root/gomex-backups', str(root / 'backups')).replace('df -Pk /root', 'df -Pk '+str(root)))
result = subprocess.run(['bash', str(script)], env={**os.environ,'PATH': str(mockbin)+os.pathsep+os.environ['PATH']},capture_output=True,text=True)
backups = list((root / 'backups' / 'daily').glob('*/hangout.db'))
assert len(backups)==1,(result.stdout,result.stderr)
with sqlite3.connect(backups[0]) as db:
    rows = db.execute('SELECT id FROM uploads').fetchall()
missing = [row[0] for row in rows if not (backups[0].parent/'media'/'uploads'/row[0]).exists()]
assert missing == ['fixture.bin'], missing
assert result.returncode == 0, (result.stdout,result.stderr)
print('BACKUP_FILE_RACE: snapshot references',missing,'but media copy does not contain it; backup exit',result.returncode)
