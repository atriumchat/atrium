"""Account races, signalling authorization, stable cursors and backup-safe media deletion."""
import asyncio
import hashlib
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlencode
from unittest.mock import AsyncMock, Mock

import fcntl
import jwt
import pytest
from fastapi.testclient import TestClient

from gomex import auth, db, media, realtime, uploads, users
from gomex.config import INVITE_CODE, LIVEKIT_API_SECRET, MEDIA_COOKIE

PASSWORD = 'original-password-123'


def bearer(session):
    return {'Authorization': f"Bearer {session['token']}"}


@pytest.fixture
def accounts(tmp_path, monkeypatch):
    from app import app
    monkeypatch.setattr(db, 'DB_PATH', tmp_path / 'test.db')
    monkeypatch.setattr(db, '_db', threading.local())
    db.init_db()
    for name in ('online', 'voice', 'calls'):
        monkeypatch.setattr(realtime, name, {})
    monkeypatch.setattr(realtime, 'livekit_remove', Mock())
    with TestClient(app) as client:
        r = client.post('/api/setup', json={'code': INVITE_CODE, 'serverName':'Regression', 'name':'Admin', 'password':PASSWORD})
        assert r.status_code == 200, r.text
        admin = r.json()
        invite = client.get('/api/invite', headers=bearer(admin)).json()['code']
        members = []
        for name in ('Alice', 'Bob'):
            r = client.post('/api/register', json={'invite':invite, 'name':name, 'password':PASSWORD})
            assert r.status_code == 200, r.text
            members.append(r.json())
        yield client, admin, *members


def reset_link(client, admin, member):
    r = client.post(f"/api/users/{member['user']['id']}/reset-link", headers=bearer(admin))
    assert r.status_code == 200, r.text
    return r.json()['token']


def test_recovery_key_has_exactly_one_concurrent_winner(accounts, monkeypatch):
    client, _, alice, _ = accounts
    original = users.password_work
    barrier = asyncio.Barrier(2)
    async def synchronize(fn, *args):
        result = await original(fn, *args)
        if fn is users.verify_password:
            await asyncio.wait_for(barrier.wait(), timeout=10)
        return result
    monkeypatch.setattr(users, 'password_work', synchronize)
    def recover(i):
        return client.post('/api/recover', json={'name':'Alice', 'key':alice['recoveryKey'], 'password':f'new-password-{i}'})
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(recover, [1, 2]))
    assert sorted(r.status_code for r in responses) == [200, 401]
    winner = next(r.json() for r in responses if r.status_code == 200)
    assert client.get('/api/bootstrap', headers=bearer(winner)).status_code == 200


@pytest.mark.parametrize('legacy_hash', [False, True])
def test_password_reset_rejects_in_flight_old_password(accounts, monkeypatch, legacy_hash):
    client, admin, alice, _ = accounts
    if legacy_hash:
        salt = b'regression-salt!'
        digest = hashlib.scrypt(PASSWORD.encode(), salt=salt, n=2**14, r=8, p=1)
        db.execute('UPDATE users SET password_hash = ? WHERE id = ?', (salt.hex()+'$'+digest.hex(),alice['user']['id']))
    link = reset_link(client, admin, alice)
    original = users.password_work
    validated, resume = threading.Event(), threading.Event()
    async def pause(fn, *args):
        result = await original(fn, *args)
        if fn is users.verify_password and args[0] == PASSWORD:
            validated.set()
            while not resume.is_set():
                await asyncio.sleep(0.005)
        return result
    monkeypatch.setattr(users, 'password_work', pause)
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(client.post, '/api/login', json={'name':'Alice', 'password':PASSWORD})
        try:
            assert validated.wait(10)
            r = client.post('/api/reset', json={'token':link, 'password':'reset-password-123'})
            assert r.status_code == 200, r.text
        finally:
            resume.set()
        assert pending.result(timeout=10).status_code == 401
    monkeypatch.setattr(users, 'password_work', original)
    assert client.post('/api/login', json={'name':'Alice', 'password':'reset-password-123'}).status_code == 200
    assert client.post('/api/login', json={'name':'Alice', 'password':PASSWORD}).status_code == 401


@pytest.mark.parametrize('method', ['change', 'recovery'])
def test_password_update_invalidates_outstanding_reset_link(accounts, method):
    client, admin, alice, _ = accounts
    link = reset_link(client, admin, alice)
    if method == 'change':
        r = client.post('/api/me/password', headers=bearer(alice), json={'current':PASSWORD,'new':'changed-password'})
    else:
        r = client.post('/api/recover', json={'name':'Alice','key':alice['recoveryKey'],'password':'changed-password'})
    assert r.status_code == 200, r.text
    assert client.post('/api/reset/check', json={'token':link}).status_code == 404
    assert client.post('/api/reset', json={'token':link,'password':'unwanted-password'}).status_code == 404


def rtc_check(client, token):
    return client.get('/api/rtc/authorize', headers={'X-Forwarded-Uri':'/rtc?'+urlencode({'access_token':token})})


def test_in_flight_bootstrap_cannot_upgrade_media_cookie_after_revocation(accounts, monkeypatch):
    client, _, alice, _ = accounts
    original = users.set_media_cookie
    def revoke_then_set(request, response, user_id, **kwargs):
        db.execute('UPDATE users SET token_version = token_version + 1 WHERE id = ?', (user_id,))
        original(request, response, user_id, **kwargs)
    monkeypatch.setattr(users, 'set_media_cookie', revoke_then_set)
    response = client.get('/api/bootstrap', headers=bearer(alice))
    assert response.status_code == 200
    assert '_authVersion' not in response.json()['me']
    assert auth.user_from_token(response.cookies.get(MEDIA_COOKIE), scope='media') is None


def test_block_denies_old_and_new_voice_tokens_and_ends_existing_call(accounts, monkeypatch):
    client, _, alice, bob = accounts
    dm = client.post('/api/dms', headers=bearer(alice), json={'userId':bob['user']['id']}).json()
    old_token = client.post('/api/voice-token', headers=bearer(bob), json={'channelId':dm['id']}).json()['token']
    assert rtc_check(client, old_token).status_code == 200
    monkeypatch.setattr(realtime.sio, 'emit', AsyncMock())
    realtime.voice['bob-call'] = {'userId':bob['user']['id'],'channelId':dm['id'],'kind':'dm'}
    assert client.put('/api/blocks/'+bob['user']['id'], headers=bearer(alice)).status_code == 200
    assert client.post('/api/voice-token', headers=bearer(bob), json={'channelId':dm['id']}).status_code == 404
    assert rtc_check(client, old_token).status_code == 401
    assert 'bob-call' not in realtime.voice
    realtime.livekit_remove.assert_any_call('dm-'+dm['id'],bob['user']['id'])


def test_logout_revokes_media_even_without_presence_and_rejects_refreshed_token(accounts):
    client, _, alice, _ = accounts
    channel = db.query("SELECT id FROM channels WHERE kind='voice' LIMIT 1")[0]['id']
    token = client.post('/api/voice-token', headers=bearer(alice), json={'channelId':channel}).json()['token']
    claims = jwt.decode(token, LIVEKIT_API_SECRET, algorithms=['HS256'])
    claims['exp'] += 600  # LiveKit refreshes exp, preserving metadata.
    refreshed = jwt.encode(claims,LIVEKIT_API_SECRET,algorithm='HS256')
    assert rtc_check(client,refreshed).status_code == 200
    assert client.post('/api/logout-all', headers=bearer(alice)).status_code == 200
    assert client.get('/api/bootstrap', headers=bearer(alice)).status_code == 401
    assert rtc_check(client,token).status_code == 401
    assert rtc_check(client,refreshed).status_code == 401
    realtime.livekit_remove.assert_called_with('voice-'+channel, alice['user']['id'])


def test_rtc_gateway_rejects_tampering_unversioned_and_wrong_rooms(accounts):
    client, _, alice, _ = accounts
    token = client.post('/api/check-token',headers=bearer(alice)).json()['token']
    assert rtc_check(client,token).status_code == 200
    assert rtc_check(client,token[:-8]+'xxxxxxxx').status_code == 401
    claims = jwt.decode(token,LIVEKIT_API_SECRET,algorithms=['HS256'])
    for metadata, room in [('{}',claims['video']['room']), (claims['metadata'],'voice-no-such-room')]:
        candidate = {**claims,'metadata':metadata,'video':{**claims['video'],'room':room}}
        assert rtc_check(client,jwt.encode(candidate,LIVEKIT_API_SECRET,algorithm='HS256')).status_code == 401


@pytest.mark.parametrize('kind', ['channel', 'dm', 'inbox'])
def test_cursor_does_not_drop_equal_millisecond_messages(accounts, kind):
    client, _, alice, bob = accounts
    at = db.now_ms() - 10000
    if kind == 'dm':
        target = client.post('/api/dms',headers=bearer(alice),json={'userId':bob['user']['id']}).json()['id']
        table, column, endpoint, page_size = 'dm_messages','dm_id',f'/api/dms/{target}/messages',50
    else:
        target = db.query("SELECT id FROM channels WHERE kind='text' LIMIT 1")[0]['id']
        table, column = 'messages','channel_id'
        endpoint, page_size = ('/api/inbox',40) if kind == 'inbox' else (f'/api/channels/{target}/messages',50)
    count = page_size + 1
    with db.connect_db() as conn:
        conn.executemany(f'INSERT INTO {table} (id,{column},user_id,content,created_at) VALUES (?,?,?,?,?)',
            [(f'{i:032x}',target,bob['user']['id'],'<@all> message',at if i<2 else at+i) for i in range(count)])
    first = client.get(endpoint,headers=bearer(alice)).json()
    assert len(first) == page_size
    oldest = min(first,key=lambda m:(m['createdAt'],m['id']))
    rest = client.get(endpoint,headers=bearer(alice),params={'before':oldest['createdAt'],'beforeId':oldest['id']}).json()
    assert len(rest) == 1
    assert len({m['id'] for m in first+rest}) == count


def test_backup_lock_defers_deletion_without_stalling_and_housekeeping_retries(accounts,tmp_path,monkeypatch):
    lockpath = tmp_path/'.media.lock'
    lockpath.touch()
    monkeypatch.setattr(media,'MEDIA_LOCK',lockpath)
    upload_dir, avatar_dir = tmp_path/'uploads',tmp_path/'avatars'
    upload_dir.mkdir(); avatar_dir.mkdir()
    monkeypatch.setattr(uploads,'UPLOAD_DIR',upload_dir)
    monkeypatch.setattr(uploads,'AVATAR_DIR',avatar_dir)
    path = upload_dir/('a'*32+'.bin')
    path.write_bytes(b'backup fixture')
    os.utime(path,(time.time()-7200,)*2)
    with lockpath.open('rb') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        start = time.monotonic()
        assert media.remove_media_files([path]) is False
        assert time.monotonic()-start < 1
        assert path.read_bytes() == b'backup fixture'
    # No live DB reference: a deletion postponed by the snapshot can now finish.
    uploads.sweep_orphan_media()
    assert not path.exists()
