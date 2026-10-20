# Development

[Русский](development.ru.md) · [Back to the README](../README.md)

## Local development

Needs Python 3.13, Node 22 and [LiveKit](https://docs.livekit.io/home/self-hosting/local/). Three processes in three
terminals.

LiveKit in dev mode: its keys `devkey` / `secret` match the server's default settings.

```bash
brew install livekit
livekit-server --dev
```

The server on port 8010 (Vite proxies to it), data in `server/data`:

```bash
cd server
python3.13 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app:app --port 8010 --reload
```

The client on http://localhost:5190, with `/api` and `/socket.io` going to the server:

```bash
cd web
npm ci
npm run dev
```

On an empty database the first-run wizard opens. The default code is `friends`.

Desktop against the local client. `npm run dev` points at the old port 5180, so the address is set explicitly:

```bash
cd desktop
npm ci
GOMEX_URL=http://localhost:5190 npx electron .
```

`GOMEX_LANG=ru` or `GOMEX_LANG=en` forces the desktop language; by default it follows the system's.

Checks before a commit:

```bash
(cd web && npm run build)   # tsc and build
(cd desktop && npm run check:i18n)   # English and Russian have the same keys
(cd desktop && node --test tests/*.test.cjs)  # SSH transport failures
server/.venv/bin/python -m pytest -q server/tests  # isolated SQLite and deploy fixtures
deploy/release.sh lint      # bash -n and shellcheck on all scripts in deploy/
```

Browser regressions: run `bash web/tests/run-regressions.sh`, open the printed localhost URL and click
**Run checks**. The harness uses the actual source modules with controlled HTTP, room and desktop IPC responses;
it does not open a microphone. Stop the script to remove the temporary harness modules.

With Caddy installed, `server/.venv/bin/python server/tests/check_rtc_proxy.py` checks the production app route
against the real ASGI authorization handler and a recording media upstream on loopback ports. A real LiveKit call
and a VPS install/restore still need integration testing.

## Releases

Maintainer only, from a Mac, from a committed tree.

**Server.** Tag, images, archive and the installer pinned to them:

```bash
deploy/release.sh 1.2.3
```

The script sets the tag `v1.2.3` and pushes it. GitHub Actions builds and publishes the images to
`ghcr.io/<owner>`. The script waits for the build, takes the image digests, builds the archive with `git archive`,
writes the version, SHA-256 and digests into `deploy/install.sh`, publishes the archive and installer as the GitHub
Release `v1.2.3` (SHA-256 and digests in the release notes), checks them by their public links and commits
`install.sh`. Install and update take `releases/latest/download/install.sh`, which takes the archive of its own
release. A version with a suffix (`1.2.3-rc.1`) goes out as a pre-release and doesn't move `latest`.
The script publishes the same two files to npm as `@gomex.llc/install@1.2.3`, a mirror for when GitHub is
unavailable. npm must be logged in (`npm login`) and asks for a two-factor code on publishing.
`GOMEX_SKIP_NPM=1` releases without the mirror.
After the very first release, the `gomex-app` and `gomex-caddy` packages on GitHub must be made public once,
otherwise servers can't pull them. The script stops and gives the links.

**Desktop.** Raise `version` in `desktop/package.json`, then:

```bash
deploy/release-desktop.sh            # Mac (Apple Silicon and Intel) and Windows
```

Builds go to this repository's GitHub Releases: `desktop-v1.2.3` holds the version's files, `desktop` always holds
the latest version under permanent names plus `update.json`, which installed apps check. Both are pre-releases;
`latest` stays with the server release. The "Download app" button on any server leads to `desktop`.

Builds are signed with the key `~/.gomex/seed-update-signing-key.pem`, created on the first run. It must be backed up
at once: without it, installed apps stop updating. The public half, `desktop/update-key.pem`, is committed and pushed
before the release. The build has no server address; the app asks for it on first start. `GOMEX_DEFAULT_URL=https://…`
builds one in.
