"""The Gomex server, a module per domain; app.py (beside this folder) puts them together.

config    environment and limits          users      accounts, invites, status, blocks, friends, avatars, setup
db        SQLite, schema, migrations      channels   channels, messages in general, read marks, inbox
auth      passwords, tokens, rate limits  dms        direct messages and groups
                                          uploads    pictures and files
                                          realtime   Socket.IO events, online / voice / calls, LiveKit

config, db and auth import nothing else from here. The domain modules and realtime import one another, so each
imports them at its very end, after its own definitions: whichever loads first, the names it needs already exist.
"""
