import os
import sys
import tempfile
import asyncio
from concurrent.futures import ThreadPoolExecutor

os.environ['DATA_DIR'] = tempfile.mkdtemp(prefix='gomex-review-')
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'server'))
from fastapi.testclient import TestClient
import jwt
from app import app
from gomex import users
from gomex.config import LIVEKIT_API_SECRET

PASSWORD = 'original-password-123'
def bearer(session):
    return {'Authorization': 'Bearer ' + session['token']}

with TestClient(app) as client:
    admin_r = client.post('/api/setup', json={'code': 'friends', 'serverName': 'Review', 'name': 'Reviewer', 'password': PASSWORD})
    assert admin_r.status_code == 200, admin_r.text
    admin = admin_r.json()
    invite = client.get('/api/invite', headers=bearer(admin)).json()['code']
    member_r = client.post('/api/register', json={'invite': invite, 'name': 'Member', 'password': PASSWORD})
    assert member_r.status_code == 200, member_r.text
    member = member_r.json()
    dm = client.post('/api/dms', headers=bearer(admin), json={'userId': member['user']['id']}).json()
    blocked = client.put('/api/blocks/' + member['user']['id'], headers=bearer(admin))
    assert blocked.status_code == 200, blocked.text
    voice = client.post('/api/voice-token', headers=bearer(member), json={'channelId': dm['id']})
    assert voice.status_code == 200, voice.text
    claims = jwt.decode(voice.json()['token'], LIVEKIT_API_SECRET, algorithms=['HS256'])
    assert claims['video']['room'] == 'dm-' + dm['id']
    assert claims['video']['roomJoin'] is True
    print('BLOCKED_VOICE: HTTP 200; signed roomJoin token for blocked DM, valid for', claims['exp'] - claims['nbf'], 'seconds')

    link_r = client.post('/api/users/' + member['user']['id'] + '/reset-link', headers=bearer(admin))
    assert link_r.status_code == 200, link_r.text
    link = link_r.json()['token']
    password_r = client.post('/api/me/password', headers=bearer(member), json={'current': PASSWORD, 'new': 'changed-password-123'})
    assert password_r.status_code == 200, password_r.text
    link_check = client.post('/api/reset/check', json={'token': link})
    stale_reset = client.post('/api/reset', json={'token': link, 'password': 'reset-by-old-link-123'})
    assert stale_reset.status_code == 200, stale_reset.text
    assert client.post('/api/login', json={'name': 'Member', 'password': 'reset-by-old-link-123'}).status_code == 200
    print('STALE_RESET_LINK: password change HTTP', password_r.status_code, '; old link check HTTP', link_check.status_code, '; old link changes password HTTP', stale_reset.status_code)

    recovery = stale_reset.json()['recoveryKey']
    original_work = users.password_work
    barrier = asyncio.Barrier(2)
    async def synchronized_work(fn, *args):
        result = await original_work(fn, *args)
        if fn is users.verify_password:
            await asyncio.wait_for(barrier.wait(), timeout=10)
        return result
    users.password_work = synchronized_work
    def recover(i):
        return client.post('/api/recover', json={'name': 'Member', 'key': recovery, 'password': 'parallel-password-' + str(i)})
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(recover, [1, 2]))
    finally:
        users.password_work = original_work
    assert [r.status_code for r in results] == [200, 200], [r.text for r in results]
    checks = [client.get('/api/bootstrap', headers=bearer(r.json())).status_code for r in results]
    print('ONE_TIME_RECOVERY_RACE: two simultaneous uses of the SAME key:', [r.status_code for r in results], '; returned token validity:', checks)

    # Two messages can share a millisecond at the pagination boundary.
    from gomex.db import connect_db, query, now_ms
    channel = query("SELECT id FROM channels WHERE kind = 'text' LIMIT 1")[0]['id']
    stamp = now_ms() - 10000
    with connect_db() as conn:
        conn.executemany("INSERT INTO messages (id, channel_id, user_id, content, created_at) VALUES (?, ?, ?, ?, ?)",
            [(f'page-{i}', channel, admin['user']['id'], f'message-{i}', stamp if i < 2 else stamp+i) for i in range(51)])
    first = client.get(f'/api/channels/{channel}/messages', headers=bearer(admin)).json()
    second = client.get(f'/api/channels/{channel}/messages', params={'before':first[0]['createdAt']}, headers=bearer(admin)).json()
    assert len(first) == 50 and len(second) == 0
    print('PAGINATION_COLLISION: 51 stored, first page', len(first), '; older page',len(second),'; one message unreachable')

    # A password checked before a reset must not yield a current session after the reset.
    import threading
    validated = threading.Event()
    resume = threading.Event()
    current = client.post('/api/login', json={'name':'Member','password':'parallel-password-1'})
    if current.status_code != 200:
        current = client.post('/api/login', json={'name':'Member','password':'parallel-password-2'})
        old_password = 'parallel-password-2'
    else:
        old_password = 'parallel-password-1'
    assert current.status_code == 200
    reset_link = client.post('/api/users/' + member['user']['id'] + '/reset-link', headers=bearer(admin)).json()['token']
    async def pause_validated_login(fn, *args):
        result = await original_work(fn, *args)
        if fn is users.verify_password and args[0] == old_password:
            validated.set()
            while not resume.is_set():
                await asyncio.sleep(0.005)
        return result
    users.password_work = pause_validated_login
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(client.post, '/api/login', json={'name':'Member','password':old_password})
            try:
                assert validated.wait(10), 'login did not reach password check'
                reset_result = client.post('/api/reset', json={'token':reset_link,'password':'after-security-reset'})
                assert reset_result.status_code == 200
            finally:
                resume.set()
            stale_login = pending.result(timeout=10)
    finally:
        users.password_work = original_work
    access = client.get('/api/bootstrap', headers=bearer(stale_login.json())).status_code
    assert stale_login.status_code == 200 and access == 200
    print('LOGIN_RESET_RACE: password validated before reset; login completed after reset HTTP', stale_login.status_code, '; resulting token HTTP',access)

    # The application's token version is unrelated to an issued LiveKit credential.
    from gomex import realtime
    current_session = reset_result.json()
    voice_channel = query("SELECT id FROM channels WHERE kind = 'voice' LIMIT 1")[0]['id']
    voice_credential = client.post('/api/voice-token', headers=bearer(current_session), json={'channelId':voice_channel})
    assert voice_credential.status_code == 200
    from unittest.mock import AsyncMock, Mock
    previous_disconnect = realtime.sio.disconnect
    previous_emit = realtime.sio.emit
    previous_remove = realtime.livekit_remove
    sid = 'review-revoked-voice-session'
    realtime.online[sid] = member['user']['id']
    realtime.voice[sid] = {'userId':member['user']['id'],'channelId':voice_channel,'kind':'channel','muted':False,'deafened':False,'video':False,'screen':False}
    removed = Mock()
    realtime.livekit_remove = removed
    realtime.sio.emit = AsyncMock()
    async def disconnect_fixture(socket_sid):
        await realtime.disconnect(socket_sid)
    realtime.sio.disconnect = disconnect_fixture
    try:
        signed_out = client.post('/api/logout-all', headers=bearer(current_session))
        assert signed_out.status_code == 200
        assert client.get('/api/bootstrap', headers=bearer(current_session)).status_code == 401
        live_claims = jwt.decode(voice_credential.json()['token'], LIVEKIT_API_SECRET, algorithms=['HS256'])
        assert live_claims['video']['roomJoin'] is True
        assert removed.call_count == 0
        print('VOICE_SESSION_REVOCATION: application token HTTP 401; voice JWT remains signed/unexpired; LiveKit removal calls:',removed.call_count)
    finally:
        realtime.sio.disconnect = previous_disconnect
        realtime.sio.emit = previous_emit
        realtime.livekit_remove = previous_remove
        realtime.online.pop(sid,None)
        realtime.voice.pop(sid,None)
