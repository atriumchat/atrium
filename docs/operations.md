# Operation

[Русский](operations.ru.md) · [Back to the README](../README.md)

## Usage

1. Open the `https://app.DOMAIN/?setup=CODE` link from the installer output. The wizard in the browser asks for the
   server name, creates the administrator and checks that calls get through.
2. Invite friends: everyone has a personal invite link that can register 5 people (`INVITE_LIMIT`), and the invitee
   becomes a friend right away. Administrators have no limit.
3. The desktop app for Mac (Apple Silicon and Intel) and Windows: the "Download app" button in the app, or the
   [desktop](https://github.com/gomex-inc/gomex/releases/tag/desktop) release. On first start it asks for the server
   address: paste `app.DOMAIN`. It can be changed later from the tray, "Server address…".

There is no public API: HTTP and Socket.IO are the client's internal protocol, with no versioning and no
compatibility promises.

## Settings

Everything is in `deploy/.env`. The installer writes it; after a manual edit, `docker compose up -d` in `deploy/`.

| Variable | Default | What it does |
|---|---|---|
| `DOMAIN` | — | Root domain; the app is on `app.DOMAIN` |
| `SERVER_NAME` | `Atrium` | Server name until it's set in the browser |
| `TURN_HOST` | random | Subdomain of the call relay |
| `INVITE_CODE` | random | Code for the first account on an empty server |
| `APP_SECRET`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | random | Session signing and LiveKit keys; `livekit.yaml` is built from them |
| `ADMINS` | empty | Nicknames that become administrators while the server has none |
| `INVITE_LIMIT` | `5` | How many people one personal link can register |
| `UPLOAD_MB_PER_DAY` | `500` | How many megabytes of files one person can upload per day |
| `RELAY_ONLY` | off | `1`: all calls only through TURN on 443, no direct or UDP paths |
| `GOMEX_REGISTRY`, `GOMEX_VERSION`, `GOMEX_APP_DIGEST`, `GOMEX_CADDY_DIGEST` | from the release | Which images to run; written by the installer |

Don't edit `livekit.yaml` by hand: every install and update rewrites it from
[`deploy/livekit.yaml.tmpl`](../deploy/livekit.yaml.tmpl).

## Network and ports

| Port | Outside | Listener | Purpose |
|---|---|---|---|
| 22/tcp | yes, rate-limited | sshd | Access, key only |
| 80/tcp | yes | Caddy | Certificate issuing, redirect to HTTPS |
| 443/tcp | yes | Caddy layer4 | Sites and TURN over TLS, SNI routing |
| 443/udp | yes | LiveKit | TURN over UDP (HTTP/3 is off for it) |
| 7881/tcp | yes | LiveKit | Media over TCP |
| 50000–60000/udp | yes | LiveKit | Direct media |
| 8443/tcp | no | Caddy | Sites behind layer4, with PROXY protocol |
| 8000/tcp | no, 127.0.0.1 | app | API, Socket.IO, web client |
| 7880/tcp | no, 127.0.0.1 | LiveKit | Signaling, reached from outside through `/rtc` |
| 5349/tcp | no | LiveKit | TURN TLS, where layer4 sends it after TLS |
| 8081/tcp | no, 127.0.0.1 | Caddy | Cover page for the relay's name: layer4 sends its web requests here after TLS |

## Server maintenance

The install lives in `/opt/gomex`. Everything below runs from `deploy/`.

```bash
cd /opt/gomex/deploy
docker compose ps                  # what's running
docker compose logs -f app         # app logs; likewise livekit, caddy
journalctl -u gomex-backup         # nightly backup log
```

- **Data:** `data/` (the `hangout.db` database, avatars, uploads), secrets in `.env`, certificates in `caddy-data/`.
- **Backups:** a systemd timer at 04:30 server time, copies in `/root/gomex-backups/daily`, kept 14 days. Images are
  hard-linked between days, so 14 copies take about the space of one. With under 1 GB free on disk the backup is
  skipped and says so in the log.
