"""Run the real deploy scripts against disposable commands and data; no host configuration changes."""
from pathlib import Path
import io
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tarfile

import pytest

ROOT = Path(__file__).resolve().parents[2]


def function(name):
    source = (ROOT/'deploy/install.sh').read_text()
    match = re.search(r'^'+name+r'\(\) \{\n.*?^\}',source,re.M|re.S)
    assert match, name
    return match.group(0)


@pytest.mark.parametrize('failure', ['cp','tar','install'])
def test_installer_propagates_file_step_failures_inside_run(tmp_path, failure):
    archive = tmp_path/'release.tgz'
    with tarfile.open(archive,'w:gz') as tar:
        for name in ['docker-compose.yml','Caddyfile','backup.sh','livekit.yaml.tmpl']:
            content = b'fixture\n'
            entry = tarfile.TarInfo('gomex-fixture/deploy/'+name)
            entry.size = len(content)
            tar.addfile(entry,io.BytesIO(content))
    script = '''set -Eeuo pipefail
TTY=0 GOMEX_PROGRESS=0 SECONDS=0 C_DIM='' C_RESET='' RELEASE_VERSION=fixture
progress(){ :; }; log(){ :; }; line(){ :; }; say(){ :; }
ok(){ echo REPORTED_SUCCESS; }; bad(){ echo REPORTED_FAILURE; }; die(){ exit 1; }
sha256_ok(){ return 0; }
'''
    for key, value in {'GOMEX_TMP':tmp_path,'GOMEX_DIR':tmp_path/'destination','TARBALL_SRC':archive,'TARBALL_SHA256':'fixture','LOG':tmp_path/'test.log'}.items():
        script += f'{key}={str(value)!r}\n'
    script += failure+'(){ return 23; }\n'+function('step_files')+'\n'+function('run')+"\nrun fixture step_files\n"
    result = subprocess.run(['bash','-c',script],capture_output=True,text=True)
    assert result.returncode != 0, result.stdout+result.stderr
    assert 'REPORTED_SUCCESS' not in result.stdout
    assert 'REPORTED_FAILURE' in result.stdout


def test_firewall_does_not_enable_after_failed_allow_rule():
    script = '''set -Eeuo pipefail
progress(){ :; }
ufw(){ if [[ $1 == allow ]]; then return 23; fi; echo "$*"; }
'''+function('step_firewall')+"\nstep_firewall || exit $?\n"
    result = subprocess.run(['bash','-c',script],capture_output=True,text=True)
    assert result.returncode == 23
    assert '--force enable' not in result.stdout


def executable(path, source):
    path.write_text(source)
    path.chmod(0o755)


@pytest.mark.parametrize('copy_fails',[False,True])
def test_backup_keeps_snapshot_media_and_only_publishes_complete_copies(tmp_path,copy_fails):
    if not shutil.which('rsync'):
        pytest.skip('rsync is required by backup.sh')
    deploy = tmp_path/'deploy'
    data = deploy/'data'
    (data/'uploads').mkdir(parents=True)
    (data/'avatars').mkdir()
    (data/'.media.lock').touch()
    (data/'uploads/fixture.bin').write_bytes(b'attachment')
    with sqlite3.connect(data/'hangout.db') as conn:
        conn.execute('CREATE TABLE uploads (id TEXT PRIMARY KEY)')
        conn.execute("INSERT INTO uploads VALUES ('fixture.bin')")
    daily = tmp_path/'backups/daily'
    current = daily/subprocess.check_output(['date','+%Y-%m-%d'],text=True).strip()
    current.mkdir(parents=True)
    (current/'hangout.db').write_bytes(b'previous complete backup')
    bins = tmp_path/'bin'
    bins.mkdir()
    python = '#!'+sys.executable+'\n'
    executable(bins/'docker',python+'''
import os, sqlite3, sys
from pathlib import Path
from gomex.media import remove_media_files
data=Path.cwd()/'data'
# Execute backup.sh's real SQLite program, adapting only the container's data mount.
exec(sys.argv[-1].replace('/data',str(data)))
with sqlite3.connect(data/'hangout.db') as conn:
 conn.execute('DELETE FROM uploads')
assert remove_media_files([data/'uploads/fixture.bin']) is False
''')
    # macOS lacks the Linux flock/date spellings. The lock still uses the real kernel flock.
    executable(bins/'flock',python+"import fcntl,sys\nfcntl.flock(int(sys.argv[-1]),fcntl.LOCK_EX)\n")
    executable(bins/'date','#!/bin/sh\nif [ "$1" = -Is ]; then exec /bin/date +%Y-%m-%dT%H:%M:%S; fi\nexec /bin/date "$@"\n')
    if copy_fails:
        executable(bins/'rsync','#!/bin/sh\nexit 23\n')
    source = (ROOT/'deploy/backup.sh').read_text().replace('/root/gomex-backups',str(tmp_path/'backups')).replace('df -Pk /root','df -Pk '+str(tmp_path))
    script = deploy/'backup.sh'
    script.write_text(source)
    env = {**os.environ,'PATH':str(bins)+os.pathsep+os.environ['PATH'],'PYTHONPATH':str(ROOT/'server'),'DATA_DIR':str(data)}
    result = subprocess.run(['bash',str(script)],env=env,capture_output=True,text=True,timeout=15)
    if copy_fails:
        assert result.returncode == 23, result.stderr
        assert (current/'hangout.db').read_bytes() == b'previous complete backup'
    else:
        assert result.returncode == 0, result.stdout+result.stderr
        with sqlite3.connect(current/'hangout.db') as conn:
            rows = conn.execute('SELECT id FROM uploads').fetchall()
        assert rows == [('fixture.bin',)]
        assert (current/'media/uploads/fixture.bin').read_bytes() == b'attachment'
    assert not list(daily.glob('.backup.*'))
    assert not list(daily.glob('.previous-*'))
