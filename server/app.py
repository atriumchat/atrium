"""Hangout backend: invite-only auth, channels, chat, voice presence, LiveKit tokens.

The code lives in the atrium package, a module per domain; this file only puts the app together.

Run locally:  .venv/bin/uvicorn app:app --port 8000 --reload
"""

import asyncio

import socketio
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from atrium import channels, discord_import, dms, realtime, server, uploads, users
from atrium.config import WEB_DIST
from atrium.db import init_db
from atrium.errors import ApiError
from atrium.realtime import sio
from atrium.telemetry import ping_loop
from atrium.uploads import housekeeping
from atrium.users import expire_statuses

init_db()

api = FastAPI(title="Hangout", docs_url=None, redoc_url=None, openapi_url=None)
for module in (users, server, uploads, dms, channels, discord_import, realtime):
    api.include_router(module.router)


@api.exception_handler(ApiError)
async def api_error(request: Request, exc: ApiError):
    """The usual {"detail": text} plus a stable `code` (and `params`) for clients that translate themselves."""
    content = {"detail": exc.detail, "code": exc.code, **({"params": exc.params} if exc.params else {})}
    return JSONResponse(content, status_code=exc.status_code, headers=exc.headers)


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
    background_tasks.add(asyncio.create_task(ping_loop()))


app = socketio.ASGIApp(sio, other_asgi_app=api, on_startup=on_startup)
