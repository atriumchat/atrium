"""Manual Caddy + real ASGI authorization integration. Run with .venv/bin/python tests/check_rtc_proxy.py.
Requires caddy and loopback bindings. LiveKit's media/signalling upstream is a recording stub.
"""
from contextlib import ExitStack
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import urlopen
from unittest.mock import Mock

with tempfile.TemporaryDirectory(prefix='atrium-rtc-proxy-') as tmp:
    os.environ['DATA_DIR'] = str(Path(tmp)/'data')
    sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
    from fastapi.testclient import TestClient
    from app import app
    from atrium import realtime
    from atrium.config import INVITE_CODE
    realtime.livekit_remove = Mock()
    with TestClient(app) as client, ExitStack() as stack:
        session = client.post('/api/setup',json={'code':INVITE_CODE,'name':'Proxy fixture','password':'fixture-password','serverName':'Fixture'}).json()
        headers = {'Authorization':'Bearer '+session['token']}
        token = client.post('/api/check-token',headers=headers).json()['token']
        hits = []
        auth_uris = []
        class Auth(BaseHTTPRequestHandler):
            def log_message(self,*args): pass
            def do_GET(self):
                auth_uris.append(self.headers.get('X-Forwarded-Uri'))
                answer = client.get(self.path,headers=dict(self.headers))
                self.send_response(answer.status_code)
                self.end_headers()
                self.wfile.write(answer.content)
        class Media(BaseHTTPRequestHandler):
            def log_message(self,*args): pass
            def do_GET(self):
                hits.append(self.path)
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'media-stub')
        ports = []
        for handler in (Auth,Media):
            server = ThreadingHTTPServer(('127.0.0.1',0),handler)
            threading.Thread(target=server.serve_forever,daemon=True).start()
            stack.callback(server.server_close)
            stack.callback(server.shutdown)
            ports.append(server.server_port)
        with socket.socket() as reserve:
            reserve.bind(('127.0.0.1',0)); port=reserve.getsockname()[1]
        source = (Path(__file__).resolve().parents[2]/'deploy/Caddyfile').read_text()
        app_route = source.split('(app) {\n',1)[1].split('\n}\n',1)[0]
        app_route = app_route.replace('127.0.0.1:8000',f'127.0.0.1:{ports[0]}').replace('127.0.0.1:7880',f'127.0.0.1:{ports[1]}')
        config = Path(tmp)/'Caddyfile'
        config.write_text('{\n admin off\n auto_https off\n}\n'+f'http://127.0.0.1:{port} {{\n'+app_route+'\n}\n')
        with (Path(tmp)/'caddy.log').open('wb') as log:
            process = subprocess.Popen(['caddy','run','--config',str(config),'--adapter','caddyfile'],stdout=log,stderr=log,env={**os.environ,'XDG_DATA_HOME':tmp,'XDG_CONFIG_HOME':tmp})
            stack.callback(process.wait,timeout=5)
            stack.callback(process.terminate)
            base = f'http://127.0.0.1:{port}'
            for _ in range(50):
                try:
                    with urlopen(base+'/api/rtc/authorize',timeout=1): pass
                except HTTPError: break
                except URLError: time.sleep(.1)
                else: break
            path='/rtc?'+urlencode({'access_token':token,'auto_subscribe':'1'})
            with urlopen(base+path,timeout=2) as response:
                assert response.status==200 and response.read()==b'media-stub'
            assert hits==[path]
            assert path in auth_uris
            assert client.post('/api/logout-all',headers=headers).status_code==200
            for denied in (path,'/rtc?access_token=invalid','/rtc/validate?access_token=invalid'):
                try:
                    urlopen(base+denied,timeout=2)
                except HTTPError as error:
                    assert error.code==401, error.code
                else:
                    raise AssertionError('revoked token reached media')
            assert hits==[path],hits
            print('PASS: real Caddy app route + ASGI JWT authorization: valid=200, revoked/invalid=401; denied requests never reach media stub.')
