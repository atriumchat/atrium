# Installation

[Русский](install.ru.md) · [Back to the README](../README.md)

## Your own server from the app

The main path: the app for Mac or Windows ([download](https://github.com/gomex-inc/gomex/releases/tag/desktop)),
no terminal and no domain of one's own needed.

1. **VPS server.** Ubuntu or Debian (x86_64 or arm64), 1–2 GB RAM, 3 GB disk, root access. The IP and password come
   from the hosting company.
2. **"Your own server" in the app.** IP and root password. Address: a free `name.dedyn.io` on
   [deSEC](https://desec.io) (name and email, confirmed by letter) or an own domain with three A records.
3. **Install.** About five minutes, steps shown on screen. The app runs the same installer over SSH, then opens the
   server setup: name, icon, administrator, invite link.

Password login is switched off after the install, and the app keeps its own key (in the system keychain). If the
deSEC letter doesn't arrive within 15 minutes, the app offers another email or an own domain.

## Install by command

For an own domain, and for anyone installing from a terminal. Needed:

- A VPS on Ubuntu or Debian (x86_64 or arm64), root access. Memory from 1 GB (2 is better), 3 GB or more free disk,
  ports 80 and 443 free.
- A domain with three A records pointing at the server IP: the domain itself, `app.` and a subdomain for calls. The
  installer picks its name and shows a table. On Cloudflare: grey cloud, DNS only; calls don't pass through the proxy.

On the server:

```bash
curl -fsSL https://github.com/gomex-inc/gomex/releases/latest/download/install.sh | sh
```

If GitHub is unavailable, the same release is on npm as the `@gomex.llc/install` package (no Node needed on the
server):

```bash
curl -fsSL https://cdn.jsdelivr.net/npm/@gomex.llc/install@latest/install.sh | sh
```

The installer fetches the release archive from there too when GitHub doesn't answer, and checks the same SHA-256.

The wizard checks the server, asks for the domain, shows a summary and sets everything up: Docker (get.docker.com),
ufw, SSH key login, `.env` with secrets, nightly backups, the release images. At the end: the link
`https://app.DOMAIN/?setup=CODE`. Arrows and Enter choose, Esc goes a step back. Without a terminal or without gum the
same steps run as plain questions.

Without questions, for scripts:

```bash
curl -fsSL https://github.com/gomex-inc/gomex/releases/latest/download/install.sh | DOMAIN=chat.example.com GOMEX_YES=1 sh
```

Update: run it again, or without questions:

```bash
curl -fsSL https://github.com/gomex-inc/gomex/releases/latest/download/install.sh | sh -s update
```

The first-setup link (with the install code) once more, while the setup isn't finished:

```bash
curl -fsSL https://github.com/gomex-inc/gomex/releases/latest/download/install.sh | sh -s link
```

Restore data from a nightly copy (a channel deleted by mistake, or a broken server; on a new server, first put the
copies into `/root/gomex-backups/daily`):

```bash
curl -fsSL https://github.com/gomex-inc/gomex/releases/latest/download/install.sh | sh -s restore
```

The installer lists the copies with date and size, asks which one to restore (`GOMEX_YES=1 GOMEX_RESTORE=2026-10-18`
skips the question), saves the current data as a `pre-restore-<time>` copy in the same folder, stops the app, puts the
data back, starts it and checks that it answers. A wrong choice is undone by the same `restore` with the
`pre-restore-…` copy.

A deleted channel doesn't need this: it sits for a week in "Server → Deleted channels", and an admin restores it
from there.

Remove Atrium from the server:

```bash
curl -fsSL https://github.com/gomex-inc/gomex/releases/latest/download/install.sh | sh -s uninstall
```

The installer asks for confirmation (`GOMEX_YES=1` skips it), stops the containers and removes their images, the
`/opt/gomex` folder (`.env`, chats, files), the backups in `/root/gomex-backups`, the nightly timer, its own file and
log in `/root` and `/var/log`. SSH login goes back to what it was: the `00-gomex-key-only.conf` file and the app's key
(the line commented `gomex-app`) are removed. Docker and ufw stay. What's removed can't be restored, backups included.

`.env` and the data are left alone on update. Extra installer variables are described in the header of
[`deploy/install.sh`](../deploy/install.sh): `SERVER_NAME`, `TURN_HOST`, `GOMEX_DIR` (default `/opt/gomex`),
`GOMEX_NO_GUM=1`, `GOMEX_FIREWALL=0`, `GOMEX_SSH=0`, an own release archive or image registry.

The cover page on the domain itself is rewritten by the installer on every update. An own site goes into
`/opt/gomex/landing/site` together with an empty `.custom` file: then the installer leaves it alone. Pages open without
`.html`: `/about` is `about.html`.

Own Caddy blocks go in `*.caddy` files in `/opt/gomex/deploy/sites`; updates leave them alone. For example,
`www.caddy` to redirect from `www.` (needs a `www` A record):

```caddy
www.{$DOMAIN}, http://www.{$DOMAIN} {
	redir https://{$DOMAIN}{uri} permanent
}
```

Own routes inside the app (`app.DOMAIN`) go in `*.caddy` files in `/opt/gomex/deploy/routes/app`, ahead of the
app's own; updates leave them alone, and there are none by default. Every page of the app loads `/owner.js`, empty in
Atrium; to run a script of one's own, serve it from a route there:

```caddy
handle /owner.js {
	root * /etc/caddy/routes/app
	file_server
}
```

The app's CSP allows only its own address, so whatever that script talks to goes through a route of the same kind.

After editing, without dropping calls:
`cd /opt/gomex/deploy && docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile`.
