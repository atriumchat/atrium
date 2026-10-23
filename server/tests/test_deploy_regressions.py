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
            entry = tarfile.TarInfo('atrium-fixture/deploy/'+name)
            entry.size = len(content)
            tar.addfile(entry,io.BytesIO(content))
    script = '''set -Eeuo pipefail
TTY=0 ATRIUM_PROGRESS=0 SECONDS=0 C_DIM='' C_RESET='' RELEASE_VERSION=fixture
progress(){ :; }; log(){ :; }; line(){ :; }; say(){ :; }
ok(){ echo REPORTED_SUCCESS; }; bad(){ echo REPORTED_FAILURE; }; die(){ exit 1; }
sha256_ok(){ return 0; }
'''
    for key, value in {'ATRIUM_TMP':tmp_path,'ATRIUM_DIR':tmp_path/'destination','TARBALL_SRC':archive,'TARBALL_SHA256':'fixture','LOG':tmp_path/'test.log'}.items():
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
from atrium.media import remove_media_files
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
    source = (ROOT/'deploy/backup.sh').read_text().replace('/root/atrium-backups',str(tmp_path/'backups')).replace('df -Pk /root','df -Pk '+str(tmp_path))
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


def test_agent_status_and_logs_run_next_to_the_env_file(tmp_path):
    deploy = tmp_path/'deploy'
    deploy.mkdir()
    shutil.copy(ROOT/'deploy/atrium-agent',deploy/'atrium-agent')
    (deploy/'.env').write_text('DOMAIN=example.test\nATRIUM_VERSION=9.9.9\n')
    executable(deploy/'backup.sh','#!/bin/sh\necho backup ran\n')
    bins = tmp_path/'bin'
    bins.mkdir()
    executable(bins/'docker','#!/bin/sh\necho "docker $* in $(pwd)"\n')
    env = {**os.environ,'PATH':str(bins)+os.pathsep+os.environ['PATH']}
    def agent(command):
        result = subprocess.run(['bash',str(deploy/'atrium-agent')],env={**env,'SSH_ORIGINAL_COMMAND':command},capture_output=True,text=True,timeout=10)
        assert result.returncode == 0, result.stderr
        return result.stdout
    where = str(deploy.resolve())
    assert agent('status') == f'ATRIUM_VERSION=9.9.9\ndocker compose ps --format {{{{.Service}}}} {{{{.State}}}} in {where}\n'
    assert agent('logs') == f'docker compose logs --no-color --tail 200 app in {where}\n'
    assert agent('backup') == 'backup ran\n'


def restore_run(tmp_path, cp_fails_into=None, symlink=False):
    """restore_all with its real helpers and exit trap; docker, curl and chown stubbed, cp optionally failing."""
    deploy = tmp_path/'atrium/deploy'
    data = deploy/'data'
    (data/'avatars').mkdir(parents=True)
    (data/'hangout.db').write_bytes(b'live database')
    (data/'hangout.db-wal').write_bytes(b'live wal')
    (data/'avatars/live.webp').write_bytes(b'live avatar')
    outside = tmp_path/'outside'
    outside.mkdir()
    (outside/'canary.txt').write_text('not Atrium')
    if symlink:
        (data/'uploads').symlink_to(outside)
    else:
        (data/'uploads').mkdir()
        (data/'uploads/live.bin').write_bytes(b'live upload')
    backups = tmp_path/'backups'
    picked = backups/'2026-10-22'
    (picked/'media/uploads').mkdir(parents=True)
    (picked/'hangout.db').write_bytes(b'backup database')
    (picked/'media/uploads/old.bin').write_bytes(b'backup upload')
    (backups/'2026-10-21').mkdir()
    (backups/'2026-10-21/hangout.db').write_bytes(b'older')

    bins = tmp_path/'bin'
    bins.mkdir()
    calls = tmp_path/'docker.calls'
    executable(bins/'docker',f'#!/bin/sh\necho "$*" >>{str(calls)!r}\n')
    executable(bins/'curl','#!/bin/sh\nexit 0\n')
    if cp_fails_into:
        # A full disk: the copy of the database comes out short and cp says nothing (as seen on a real server),
        # or a media copy fails outright.
        real = shutil.which('cp')
        executable(bins/'cp',f'''#!/bin/bash
to="${{@: -1}}"; from="${{@: -2:1}}"
if [[ $to == *{cp_fails_into}* ]]; then
  if [[ $from == *hangout.db ]]; then head -c 3 "$from" >"$to"; exit 0; fi
  exit 1
fi
exec {real} "$@"
''')

    source = (ROOT/'deploy/install.sh').read_text()
    names = re.search(r'^DATA_NAMES=.*$',source,re.M).group(0)
    restore = function('restore_all').replace('(( EUID == 0 )) || die','true || die')
    script = '''set -Eeuo pipefail
TTY=0 EXISTING=1 DIED=0 APP_DOWN=0 BG_PID=''
say(){ :; }; line(){ :; }; dim(){ :; }; title(){ :; }; log(){ :; }
ok(){ echo "ok: $*"; }; bad(){ echo "bad: $*"; }
chown(){ :; }
'''
    for key, value in {'LOG':tmp_path/'install.log','ATRIUM_DIR':tmp_path/'atrium','BACKUPS':backups,'ATRIUM_TMP':tmp_path/'atrium.tmp'}.items():
        script += f'{key}={str(value)!r}\n'
    script += names+'\n'
    for name in ['die','cleanup','restore_keep','restore_stage','restore_swap']:
        script += function(name)+'\n'
    script += restore+'\ntrap cleanup EXIT\nrestore_all\n'
    env = {**os.environ,'PATH':str(bins)+os.pathsep+os.environ['PATH'],'ATRIUM_YES':'1','ATRIUM_RESTORE':'2026-10-22'}
    result = subprocess.run(['bash','-c',script],env=env,capture_output=True,text=True,timeout=20)
    docker = calls.read_text().splitlines() if calls.exists() else []
    return result, data, outside, backups, docker


def test_restore_never_writes_through_a_planted_symlink(tmp_path):
    result, data, outside, backups, docker = restore_run(tmp_path,symlink=True)
    assert result.returncode == 0, result.stdout+result.stderr
    # The link is gone and the backup's files are in a real folder; what the link pointed at is untouched.
    assert sorted(p.name for p in outside.iterdir()) == ['canary.txt']
    assert not (data/'uploads').is_symlink()
    assert (data/'uploads/old.bin').read_bytes() == b'backup upload'
    assert (data/'hangout.db').read_bytes() == b'backup database'
    assert not (data/'hangout.db-wal').exists() and not (data/'avatars').exists()
    assert not list(data.glob('.restore-*'))
    kept, = backups.glob('pre-restore-*')
    assert (kept/'hangout.db').read_bytes() == b'live database'
    assert (kept/'hangout.db-wal').read_bytes() == b'live wal'
    assert (kept/'media/avatars/live.webp').read_bytes() == b'live avatar'
    assert not (kept/'media/uploads').exists()
    assert docker == ['compose stop app','compose up -d app']


@pytest.mark.parametrize('fails_into',['pre-restore','.restore-new'])
def test_restore_failure_before_the_swap_keeps_the_data_and_restarts_the_app(tmp_path,fails_into):
    result, data, outside, backups, docker = restore_run(tmp_path,cp_fails_into=fails_into)
    assert result.returncode != 0
    assert 'Ничего не изменено' in result.stdout
    assert (data/'hangout.db').read_bytes() == b'live database'
    assert (data/'hangout.db-wal').read_bytes() == b'live wal'
    assert (data/'avatars/live.webp').read_bytes() == b'live avatar'
    assert (data/'uploads/live.bin').read_bytes() == b'live upload'
    assert not list(data.glob('.restore-*'))
    # A short safety copy is not left looking like a backup that could be restored.
    if fails_into == 'pre-restore':
        assert not list(backups.glob('pre-restore-*'))
    assert docker == ['compose stop app','compose up -d app']
