# Installation

[Русский](install.ru.md) · [Back to the README](../README.md)

## Your own server from the app

The easiest way is the Mac or Windows app ([download](https://github.com/atriumchat/atrium/releases/tag/desktop)).
You don't need a terminal or a domain of your own.

1. **A VPS.** Ubuntu or Debian (x86_64 or arm64), 1–2 GB RAM, 3 GB disk, root access. Your hosting provider gives
   you the IP and root password.
2. **"Your own server" in the app.** Enter the IP and root password. For the address, take a free
   `name.dedyn.io` from [deSEC](https://desec.io) (a name and an email you confirm) or use your own domain with three
   A records.
3. **Install.** About five minutes, steps shown on screen. The app runs the same installer over SSH, then opens the
   server setup: name, icon, administrator, invite link.

Password login is switched off after the install, and the app keeps its own key (in the system keychain). If the
deSEC email doesn't arrive within 15 minutes, the app lets you try another email or your own domain.

## Install by command

For your own domain, or if you prefer a terminal. You need:

- A VPS on Ubuntu or Debian (x86_64 or arm64), root access. At least 1 GB of memory (2 is better), 3 GB of free disk,
  ports 80 and 443 free.
- A domain with three A records pointing at the server IP: the domain itself, `app.` and a subdomain for calls. The
  installer picks that name and shows the records to add. On Cloudflare, use the grey cloud (DNS only): calls can't go
  through its proxy.

On the server:

```bash
curl -fsSL https://github.com/atriumchat/atrium/releases/latest/download/install.sh | sh
```

If GitHub is unavailable, the same release is on npm as the `@atriumchat/install` package (no Node needed on the
server):

```bash
curl -fsSL https://cdn.jsdelivr.net/npm/@atriumchat/install@latest/install.sh | sh
```

The installer fetches the release archive from there too when GitHub doesn't answer, and checks the same SHA-256.

The wizard checks the server, asks for the domain, shows a summary and sets everything up: Docker (get.docker.com),
ufw, SSH key login, `.env` with secrets, nightly backups, the release images. At the end it prints the link
`https://app.DOMAIN/?setup=CODE`. Arrows and Enter choose, Esc goes back a step. Without a terminal or without gum, the
same steps run as plain prompts.

Non-interactive, for scripts:

```bash
curl -fsSL https://github.com/atriumchat/atrium/releases/latest/download/install.sh | DOMAIN=chat.example.com ATRIUM_YES=1 sh
```

To update, run it again, or non-interactively:

```bash
curl -fsSL https://github.com/atriumchat/atrium/releases/latest/download/install.sh | sh -s update
```

To print the first-setup link (with the setup code) again, while setup isn't finished:

```bash
curl -fsSL https://github.com/atriumchat/atrium/releases/latest/download/install.sh | sh -s link
```

To restore data from a nightly backup (after a mistake or a broken server; on a new server, first copy the backups
into `/root/atrium-backups/daily`):

```bash
curl -fsSL https://github.com/atriumchat/atrium/releases/latest/download/install.sh | sh -s restore
```

The installer lists the backups with their date and size and asks which one to restore
(`ATRIUM_YES=1 ATRIUM_RESTORE=2026-10-18` skips the question). It saves the current data as a `pre-restore-<time>`
backup in the same folder, stops the app, puts the data back, starts the app and checks that it responds. To undo a
wrong pick, run `restore` again and choose the `pre-restore-…` backup.

A deleted channel doesn't need this: it stays in "Server → Deleted channels" for a week, and an admin can restore
it from there.

To remove Atrium from the server:

```bash
curl -fsSL https://github.com/atriumchat/atrium/releases/latest/download/install.sh | sh -s uninstall
```

The installer asks for confirmation (`ATRIUM_YES=1` skips it), stops the containers and removes their images, the
`/opt/atrium` folder (`.env`, chats, files), the backups in `/root/atrium-backups`, the nightly timer, and its own copy and
log in `/root` and `/var/log`. SSH login goes back to how it was: the `00-atrium-key-only.conf` file and the app's key
(the line commented `atrium-app`) are removed. Docker and ufw stay. Nothing removed can be recovered, backups included.

Updates leave `.env` and the data alone. More installer variables are described at the top of
[`deploy/install.sh`](../deploy/install.sh): `SERVER_NAME`, `TURN_HOST`, `ATRIUM_DIR` (default `/opt/atrium`),
`ATRIUM_NO_GUM=1`, `ATRIUM_FIREWALL=0`, `ATRIUM_SSH=0`, and options for your own release archive or image registry.

The installer rewrites the cover page on the root domain on every update. To serve your own site, put it in
`/opt/atrium/landing/site` along with an empty `.custom` file, and the installer will leave it alone. Pages open without
`.html`: `/about` serves `about.html`.

Your own Caddy blocks go in `*.caddy` files in `/opt/atrium/deploy/sites`; updates leave them alone. For example,
`www.caddy` to redirect from `www.` (needs a `www` A record):

```caddy
www.{$DOMAIN}, http://www.{$DOMAIN} {
	redir https://{$DOMAIN}{uri} permanent
}
```

Your own routes inside the app (`app.DOMAIN`) go in `*.caddy` files in `/opt/atrium/deploy/routes/app` and take
priority over the app's routes; updates leave them alone, and there are none by default. Every page of the app loads
`/owner.js`, which is empty by default; to run your own script, serve it from a route there:

```caddy
handle /owner.js {
	root * /etc/caddy/routes/app
	file_server
}
```

The app's CSP allows only its own origin, so anything that script talks to has to go through a route like this too.

To apply changes without dropping calls:
`cd /opt/atrium/deploy && docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile`.
