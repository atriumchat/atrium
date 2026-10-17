"""Hangout backend: invite-only auth, channels, chat, voice presence, LiveKit tokens.

The code lives in the gomex package, a module per domain; this file only puts the app together.

Run locally:  .venv/bin/uvicorn app:app --port 8000 --reload
"""

import asyncio

import socketio
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from gomex import channels, dms, realtime, uploads, users
from gomex.config import WEB_DIST
from gomex.db import init_db
from gomex.realtime import sio
from gomex.uploads import housekeeping
from gomex.users import expire_statuses

init_db()

api = FastAPI(title="Hangout", docs_url=None, redoc_url=None, openapi_url=None)
for module in (users, uploads, dms, channels, realtime):
    api.include_router(module.router)


class WebFiles(StaticFiles):
    """Vite names everything under /assets/ by its content hash, so the browser may keep those for good: a
    returning visitor downloads nothing. The rest (index.html above all) is revalidated, so deploys show up."""

    def file_response(self, full_path, stat_result, scope, status_code=200):
        response = super().file_response(full_path, stat_result, scope, status_code)
        immutable = scope["path"].startswith("/assets/")
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable" if immutable else "no-cache"
        return response


# After every router: a mount at "/" takes any path that nothing before it matched.
if WEB_DIST:
    api.mount("/", WebFiles(directory=WEB_DIST, html=True), name="web")

background_tasks: set[asyncio.Task] = set()  # held here: the loop keeps only weak references to tasks


async def on_startup() -> None:
    background_tasks.add(asyncio.create_task(housekeeping()))
    background_tasks.add(asyncio.create_task(expire_statuses()))


app = socketio.ASGIApp(sio, other_asgi_app=api, on_startup=on_startup)
