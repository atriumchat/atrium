#!/bin/sh
# Atrium installer, for a fresh VPS (Ubuntu or Debian), as root:
#   curl -fsSL https://github.com/atriumchat/atrium/releases/latest/download/install.sh | sh   # the wizard
#   curl -fsSL …/install.sh | sh -s update                                 # update, no questions
#   curl -fsSL …/install.sh | sh -s uninstall                              # take Atrium off the server again
#   curl -fsSL …/install.sh | sh -s restore                               # put data back from a nightly backup
#   curl -fsSL …/install.sh | sh -s link                                   # the setup link again, while setup is not done
#   curl -fsSL …/install.sh | DOMAIN=chat.example.com ATRIUM_YES=1 sh       # no questions at all
# Each installer takes its own release's tarball from that GitHub Release, checked against the SHA-256 pinned
# below. The npm package @atriumchat/install mirrors both files, so the same works without GitHub:
#   curl -fsSL https://cdn.jsdelivr.net/npm/@atriumchat/install/install.sh | sh
# Where Node is already installed, the same package runs with npx (its bin is atrium-install):
#   npx @atriumchat/install            # update: npx @atriumchat/install update
# Re-running is an update: .env (all the secrets) and the data stay.
# link prints the link with the setup code (https://app.DOMAIN/?setup=CODE) again, or says that setup is already done.
# restore lists the nightly backups in /root/atrium-backups/daily with their date and size and asks which one to put
# back (ATRIUM_YES=1 ATRIUM_RESTORE=<folder name, e.g. 2026-10-18> asks nothing). It first saves the current data as one
# more backup, pre-restore-<time>, in the same folder, then stops the app, puts the chosen database and files back,
# starts the app and checks that it answers. Works on the same server and on a new one with the backups copied to
# /root/atrium-backups/daily after a normal install.
# uninstall asks first (ATRIUM_YES=1 skips the question), then removes: the containers and their images, ATRIUM_DIR
# (/opt/atrium: .env, the data, the files), /root/atrium-backups, the nightly backup service and timer, this installer's
# copy (/root/atrium-install.sh) and log (/var/log/atrium-install.log), and what it changed for SSH: its key-only
# drop-in (password login is back as it was) and the desktop app's key (the line with the comment atrium-app).
# Docker and ufw stay. Nothing of it can be brought back, backups included.
# More knobs, all optional: SERVER_NAME, TURN_HOST, ATRIUM_DIR (/opt/atrium), ATRIUM_NO_GUM=1 (plain prompts),
# ATRIUM_FIREWALL=0 and ATRIUM_SSH=0 (leave ufw / sshd alone), ATRIUM_TARBALL + ATRIUM_TARBALL_SHA256 (a local or
# mirrored release), ATRIUM_REGISTRY + ATRIUM_APP_DIGEST + ATRIUM_CADDY_DIGEST (another image registry).
# For the desktop app, which installs over SSH: ATRIUM_AUTHORIZED_KEY (its public key, added for root, so password
# login can go) and ATRIUM_PROGRESS=1 (machine-readable "::atrium …" lines next to the usual output).
#
# This POSIX part only gets the program below onto bash with the terminal on stdin. Under `curl | sh` stdin is the
# script itself, so no prompt could ever read an answer: the bash program is saved to a temporary file and run
# from there. (It sits in a heredoc so sh never parses it; `deploy/release.sh lint` checks it with shellcheck.)
set -eu
umask 077
ATRIUM_TMP=$(mktemp -d "${TMPDIR:-/tmp}/atrium.XXXXXX")
export ATRIUM_TMP
trap 'rm -rf "$ATRIUM_TMP"' EXIT
# Ctrl+C reaches the bash program too; wait for it to clean up and only then remove the folder.
trap ':' INT TERM HUP
cat > "$ATRIUM_TMP/install.bash" <<'ATRIUM_INSTALLER'
#!/usr/bin/env bash
# The Atrium installer itself; the POSIX wrapper above starts it. Screens: welcome → server check → domain →
# summary → install → link (the server's name is given in the browser setup). Pretty prompts with gum
# (charmbracelet), fetched for this run only and checked against a pinned SHA-256; without gum or without a
# terminal the same steps run on plain `read` prompts.
set -Eeuo pipefail
shopt -s inherit_errexit 2>/dev/null || true
# "&" in a ${s//x/y} replacement means the match in bash 5.2; the templates must never do that.
shopt -u patsub_replacement 2>/dev/null || true
umask 022

# == The release this installer puts on the server. deploy/release.sh rewrites these lines.
RELEASE_VERSION=0.8.1
RELEASE_SHA256=1b1ef6a3fd3953adb42919bd9a42cbc19de4617cd6fc64c71d1a6a380548580d
RELEASE_REPO=atriumchat/atrium
# The npm package that mirrors each release's install.sh and tarball (deploy/release.sh publishes it).
RELEASE_NPM=@atriumchat/install
RELEASE_REGISTRY=ghcr.io/atriumchat
RELEASE_APP_DIGEST=sha256:e7866c6f96d0329a1d4319b2f11105d8ac74d3ded5cca39da7539b9acac944d3
RELEASE_CADDY_DIGEST=sha256:cd2cf5a7985bb21afa94786e9779dcf972b89e7e281a0a9b616acc659ce30bbf

# == gum, for this run only.
GUM_VERSION=0.17.0
GUM_SHA256_x86_64=69ee169bd6387331928864e94d47ed01ef649fbfe875baed1bbf27b5377a6fdb
GUM_SHA256_arm64=b0b9ed95cbf7c8b7073f17b9591811f5c001e33c7cfd066ca83ce8a07c576f9c

ACCENT_HEX='#ffffff'
# Neutral names for the TURN relay's subdomain: "turn." is an easy thing to find and block, and a random pick
# keeps installs from sharing that fingerprint.
TURN_NAMES=(media static cdn files assets img edge content res storage dl s3)

ATRIUM_TMP=${ATRIUM_TMP:-$(mktemp -d "${TMPDIR:-/tmp}/atrium.XXXXXX")}
LOG=/var/log/atrium-install.log
LOCK=/run/atrium-install.lock
GUM=
BG_PID=

# ---------------------------------------------------------------------------------------------- terminal

TTY=0
[[ -t 0 && -t 1 ]] && TTY=1
C_ACCENT='' C_BOLD='' C_DIM='' C_GREEN='' C_YELLOW='' C_RED='' C_RESET=''
if (( TTY )) && [[ -z ${NO_COLOR:-} && ${TERM:-dumb} != dumb ]]; then
  if [[ ${COLORTERM:-} == *truecolor* || ${COLORTERM:-} == *24bit* ]]; then
    C_ACCENT=$'\e[38;2;255;255;255m'
  else
    C_ACCENT=$'\e[97m'
  fi
  C_BOLD=$'\e[1m' C_DIM=$'\e[2m' C_GREEN=$'\e[32m' C_YELLOW=$'\e[33m' C_RED=$'\e[31m' C_RESET=$'\e[0m'
fi
# gum follows NO_COLOR by itself (monochrome); a dumb terminal gets plain prompts.

# Column maths on Cyrillic needs a UTF-8 locale (a fresh VPS or container may have none set).
if [[ ${LC_ALL:-${LC_CTYPE:-${LANG:-}}} != *[Uu][Tt][Ff]* ]]; then
  for l in C.UTF-8 C.utf8 en_US.UTF-8; do
    if locale -a 2>/dev/null | grep -qix "${l/UTF-8/utf8}\|$l"; then export LC_ALL=$l; break; fi
  done
fi

COLS=80
if (( TTY )); then
  COLS=$(stty size 2>/dev/null | awk '{print $2}') || true
  # A terminal that reports no size (0) gets the full 80 too.
  [[ $COLS =~ ^[0-9]+$ ]] && (( COLS >= 40 )) || COLS=80
  (( COLS > 80 )) && COLS=80
fi

say() { printf '%s\n' "$*"; }
# pad TEXT WIDTH: bash's printf pads by bytes, which skews every Cyrillic column.
pad() { printf '%s%*s' "$1" $(($2 > ${#1} ? $2 - ${#1} : 0)) ''; }
line() { printf '  %s\n' "$*"; }
ok() { line "${C_GREEN}✓${C_RESET} $*"; }
warn() { line "${C_YELLOW}!${C_RESET} $*"; }
bad() { line "${C_RED}✗${C_RESET} $*"; }
# Plain, not the accent: next to a red ✗ a red bullet would read as one more error.
bullet() { line "• $*"; }
dim() { line "${C_DIM}$*${C_RESET}"; }
log() { printf '%s %s\n' "$(date '+%F %T')" "$*" >>"$LOG" 2>/dev/null || true; }
# For the desktop app (ATRIUM_PROGRESS=1): "::atrium run|done|fail STEP [seconds|why]", "::atrium sub TEXT" (what the
# running step is doing now), "::atrium ready URL".
progress() { if [[ ${ATRIUM_PROGRESS:-} == 1 ]]; then printf '::atrium %s\n' "$*"; fi; }
# What a step prints, into the log and on to the desktop app a line at a time (indented, so it is plain output next to
# the "::atrium" lines, which go through as they are): the app shows the last one when a step takes long.
relay_output() {
  local text
  while IFS= read -r text || [[ -n $text ]]; do
    if [[ $text == '::atrium '* ]]; then
      printf '%s\n' "$text"
    else
      printf '%s\n' "$text" >>"$LOG"
      printf '    %s\n' "$text"
    fi
  done
}
DIED=0
die() {
  DIED=1
  say
  bad "$*"
  [[ -s $LOG ]] && dim "Лог: $LOG"
  exit 1
}
clear_screen() { if (( TTY )); then printf '\e[H\e[2J\e[3J'; fi; }

# ---------------------------------------------------------------------------------------------- cleanup

kill_tree() {
  local pid=$1 child
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do kill_tree "$child"; done
  kill -TERM "$pid" 2>/dev/null || true
}
cleanup() {
  local rc=$?
  # This function's own non-zero return isn't an error to log.
  trap - ERR
  [[ -n $BG_PID ]] && kill_tree "$BG_PID"
  (( TTY )) && printf '\e[?25h'
  # Anything that failed without saying so (set -e): at least say where to look.
  if (( rc != 0 && rc != 130 && ! DIED )); then
    say
    bad "Установка прервалась на неожиданной ошибке."
    dim "Лог: $LOG"
  fi
  [[ $ATRIUM_TMP == */atrium.* ]] && rm -rf -- "$ATRIUM_TMP"
  return "$rc"
}
interrupted() {
  trap - INT TERM HUP
  say
  dim "Прервано."
  exit 130
}
trap cleanup EXIT
trap interrupted INT TERM HUP
trap 'log "error: line $LINENO: $BASH_COMMAND"' ERR

# ---------------------------------------------------------------------------------------------- helpers

# fetch URL FILE [max seconds]: HTTPS only.
fetch() {
  if command -v curl >/dev/null; then
    curl --proto '=https' --tlsv1.2 -fsSL --retry 2 --connect-timeout 10 --max-time "${3:-300}" -o "$2" "$1"
  elif command -v wget >/dev/null; then
    wget -q --https-only -T "${3:-300}" -O "$2" "$1"
  else
    return 1
  fi
}
sha256_ok() { [[ $(sha256sum "$1" | awk '{print $1}') == "$2" ]]; }
rand() {
  local s
  s=$(head -c 96 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')
  printf '%s' "${s:0:$1}"
}
apt_ready=0
apt_install() {
  command -v apt-get >/dev/null || return 1
  if (( ! apt_ready )); then
    DEBIAN_FRONTEND=noninteractive apt-get update -q || return
    apt_ready=1
  fi
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends "$@"
}

# .env: KEY=value lines, read by docker compose. Never sourced here.
env_get() {
  [[ -f $1 ]] || return 0
  sed -n "s/^$2=//p" "$1" | tail -n1 | sed -e "s/^'\(.*\)'\$/\1/" -e 's/^"\(.*\)"$/\1/'
}
env_set() {
  local file=$1 tmp
  tmp=$(mktemp "$file.XXXXXX") || return
  K=$2 V=$3 awk 'index($0, ENVIRON["K"] "=") == 1 { if (!done) print ENVIRON["K"] "=" ENVIRON["V"]; done = 1; next }
    { print } END { if (!done) print ENVIRON["K"] "=" ENVIRON["V"] }' "$file" >"$tmp" || { rm -f "$tmp"; return 1; }
  chmod 600 "$tmp" || return
  mv -f "$tmp" "$file"
}

valid_domain() {
  [[ ${#1} -le 200 && $1 =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$ ]]
}
normalize_domain() {
  local d=${1,,}
  d=${d//[[:space:]]/}
  d=${d#*://}
  d=${d%%/*}
  d=${d%.}
  printf '%s' "$d"
}
valid_name() {
  [[ -n $1 && ${#1} -le 40 && $1 != *[\'\"\\\$\`]* && $1 != *[[:cntrl:]]* ]]
}

# ---------------------------------------------------------------------------------------------- the server

detect_install() {
  ATRIUM_DIR=${ATRIUM_DIR:-/opt/atrium}
  ENV_FILE=$ATRIUM_DIR/deploy/.env
  EXISTING=0
  if [[ -f $ENV_FILE ]]; then
    EXISTING=1
    OLD_DOMAIN=$(env_get "$ENV_FILE" DOMAIN)
    OLD_VERSION=$(env_get "$ENV_FILE" ATRIUM_VERSION)
    DOMAIN=${DOMAIN:-$OLD_DOMAIN}
    SERVER_NAME=${SERVER_NAME:-$(env_get "$ENV_FILE" SERVER_NAME)}
    TURN_HOST=${TURN_HOST:-$(env_get "$ENV_FILE" TURN_HOST)}
    # Installs from before TURN_HOST existed keep their turn.DOMAIN: its DNS record is already there.
    TURN_HOST=${TURN_HOST:-turn}
  fi
  SERVER_NAME=${SERVER_NAME:-Atrium}
  TURN_HOST=${TURN_HOST:-${TURN_NAMES[RANDOM % ${#TURN_NAMES[@]}]}}
}

# Listening sockets on a port, from /proc (no ss/netstat needed): prints the process name when ss can tell.
port_busy() {
  local proto=$1 port=$2 hex state files
  printf -v hex '%04X' "$port"
  if [[ $proto == tcp ]]; then state=0A files=(/proc/net/tcp /proc/net/tcp6); else state=07 files=(/proc/net/udp /proc/net/udp6); fi
  awk -v p=":$hex" -v s="$state" '$2 ~ p"$" && $4 == s { found = 1 } END { exit !found }' "${files[@]}" 2>/dev/null || return 1
  if command -v ss >/dev/null; then
    ss -Hlnp -"${proto:0:1}" "sport = :$port" 2>/dev/null | sed -n 's/.*users:(("\([^"]*\)".*/\1/p' | head -n1 || true
  fi
  return 0
}

# The server's public IPv4: asked from outside (a VPS behind NAT doesn't know it), else the outgoing interface's.
detect_ip() {
  local ip url
  for url in https://api.ipify.org https://ifconfig.me/ip https://icanhazip.com; do
    ip=$(curl -4 -fsS --max-time 4 "$url" 2>/dev/null | tr -d '[:space:]') || true
    [[ $ip =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] && { printf '%s' "$ip"; return; }
  done
  ip=$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p') || true
  printf '%s' "$ip"
}
local_ips() {
  { hostname -I 2>/dev/null || true; ip -o -4 addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 || true; } |
    tr ' ' '\n' | { grep -E '^[0-9.]+$' || true; } | sort -u | tr '\n' ' '
}

# A records as the world sees them: DNS over HTTPS skips this box's resolver cache, which may still hold
# "no such name" from before the record was added.
resolve4() {
  local out url
  for url in "https://cloudflare-dns.com/dns-query?name=$1&type=A" "https://dns.google/resolve?name=$1&type=A"; do
    if out=$(curl -fsS --max-time 5 -H 'accept: application/dns-json' "$url" 2>/dev/null); then
      { grep -oE '"data": ?"[0-9]+(\.[0-9]+){3}"' <<<"$out" || true; } | grep -oE '[0-9]+(\.[0-9]+){3}' | sort -u | tr '\n' ' ' || true
      return
    fi
  done
  getent ahostsv4 "$1" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ' || true
}
# Cloudflare's proxy ("orange cloud") ranges: calls can't go through it.
cloudflare_ip() {
  [[ $1 =~ ^(104\.(1[6-9]|2[0-9]|3[01])|172\.(6[4-9]|7[01])|188\.114\.(9[6-9]|10[0-9]|11[01])|162\.158|141\.101|108\.162|190\.93|198\.41|173\.245|103\.2[1-2]|103\.31)\. ]]
}

check_add() {
  CHECK_LINES+=("$1|$2")
  [[ $1 == bad ]] && CHECK_FATAL=1
  # Each check as it's made, so the desktop app shows where the server check is.
  progress sub "$2"
  return 0
}

run_checks() {
  CHECK_LINES=() CHECK_FATAL=0

  if (( EUID == 0 )); then check_add ok "Права root"; else check_add bad "Нужен root: curl … | sudo sh"; fi

  local os_name=Linux os_id='' arch
  if [[ -r /etc/os-release ]]; then
    # shellcheck source=/dev/null
    os_name=$(. /etc/os-release && printf '%s' "${PRETTY_NAME:-Linux}")
    # shellcheck source=/dev/null
    os_id=$(. /etc/os-release && printf '%s' "${ID:-} ${ID_LIKE:-}")
  fi
  arch=$(uname -m)
  case $arch in
    x86_64 | amd64 | aarch64 | arm64) ;;
    *) check_add bad "Процессор $arch не поддерживается"; arch='' ;;
  esac
  if [[ $(uname -s) != Linux ]]; then
    check_add bad "Нужен Linux"
  elif [[ -n $arch ]]; then
    if [[ $os_id == *ubuntu* || $os_id == *debian* ]]; then check_add ok "$os_name · $arch"; else check_add warn "$os_name · $arch: не проверялось"; fi
  fi

  local who p busy=()
  for p in tcp/80 tcp/443 udp/443; do
    if who=$(port_busy "${p%/*}" "${p#*/}"); then busy+=("${p#*/}/${p%/*}${who:+ ($who)}"); fi
  done
  if (( ${#busy[@]} == 0 )); then
    check_add ok "Порты 80 и 443 свободны"
  elif (( EXISTING )); then
    check_add ok "Порты 80 и 443: уже Atrium"
  else
    check_add bad "Порты заняты: ${busy[*]}"
  fi

  DOCKER_OK=0
  if command -v docker >/dev/null && docker compose version >/dev/null 2>&1; then
    DOCKER_OK=1
    check_add ok "Docker $(docker version --format '{{.Server.Version}}' 2>/dev/null || docker --version | awk '{print $3}' | tr -d ,)"
  else
    check_add info "Docker: поставим"
  fi

  local mem_mb disk_mb
  mem_mb=$(awk '/^MemTotal:/ { print int($2 / 1024) }' /proc/meminfo 2>/dev/null || echo 0)
  disk_mb=$(df -Pm /var/lib 2>/dev/null | awk 'NR == 2 { print $4 }' || echo 0)
  local mem disk
  mem=$(awk -v m="$mem_mb" 'BEGIN { printf "%.1f", m / 1024 }')
  disk=$(awk -v m="$disk_mb" 'BEGIN { printf "%.0f", m / 1024 }')
  if (( disk_mb < 2500 )); then
    check_add bad "Диск: свободно $disk ГБ, нужно от 3 ГБ"
  elif (( mem_mb < 900 )); then
    check_add warn "Память $mem ГБ: мало, лучше от 1 ГБ"
  else
    check_add ok "Память $mem ГБ · диск $disk ГБ свободно"
  fi

  SSH_PLAN=keys
  if [[ ${ATRIUM_SSH:-1} == 0 ]]; then
    SSH_PLAN=off
  elif ! command -v sshd >/dev/null; then
    SSH_PLAN=none
  elif ! has_ssh_key; then
    SSH_PLAN=nokey
    check_add warn "SSH-ключа нет: вход по паролю оставим"
  elif [[ -d /etc/ssh/sshd_config.d ]] && grep -Eqi '^\s*Include\s+/etc/ssh/sshd_config\.d' /etc/ssh/sshd_config 2>/dev/null; then
    check_add ok "SSH-ключ есть: вход по паролю выключим"
  else
    SSH_PLAN=noinclude
  fi

  if [[ ! -d /run/systemd/system ]]; then check_add warn "Нет systemd: без ночных бэкапов"; fi
  if [[ -n ${SERVER_IP:-} ]]; then check_add ok "IP $SERVER_IP"; else check_add warn "Внешний IP не определился"; fi
}

has_ssh_key() {
  local f home
  for f in /root/.ssh/authorized_keys /root/.ssh/authorized_keys2; do
    grep -Eqs '^[^#]*(ssh-(ed25519|rsa|dss)|ecdsa-sha2-|sk-(ssh|ecdsa))' "$f" && return 0
  done
  if [[ -n ${SUDO_USER:-} ]]; then
    home=$(getent passwd "$SUDO_USER" | cut -d: -f6) || true
    grep -Eqs '^[^#]*(ssh-(ed25519|rsa|dss)|ecdsa-sha2-|sk-(ssh|ecdsa))' "$home/.ssh/authorized_keys" && return 0
  fi
  return 1
}

# The first fatal check, for the desktop app to show.
first_bad_check() {
  local item
  for item in "${CHECK_LINES[@]}"; do
    [[ ${item%%|*} == bad ]] && { printf '%s' "${item#*|}"; return; }
  done
}

# ATRIUM_AUTHORIZED_KEY: the desktop app's own SSH key, for root. With a key in place the install switches password
# login off (step_ssh), and the app keeps coming in with its key for updates.
add_app_key() {
  local key=${ATRIUM_AUTHORIZED_KEY:-}
  [[ -n $key ]] || return 0
  [[ $key =~ ^ssh-ed25519\ [A-Za-z0-9+/]+=*(\ [A-Za-z0-9@._-]+)?$ ]] || die "ATRIUM_AUTHORIZED_KEY: это не ключ ssh-ed25519"
  progress sub "Ключ приложения для входа"
  mkdir -p /root/.ssh
  chmod 700 /root/.ssh
  touch /root/.ssh/authorized_keys
  chmod 600 /root/.ssh/authorized_keys
  # Already there (a run again from the app), maybe already pinned to the agent: once is enough.
  grep -qF "${key#ssh-ed25519 }" /root/.ssh/authorized_keys || printf '%s\n' "$key" >>/root/.ssh/authorized_keys
  log "desktop app key added for root"
}

# Once Atrium runs, the desktop app's key (the line with the comment atrium-app) stops being root: it is pinned to
# deploy/atrium-agent, which only understands status, update, backup and logs, and loses forwarding and a terminal.
# The install itself still had the full key (it may need running again); an update pins servers installed before.
lock_app_key() {
  local f=/root/.ssh/authorized_keys agent=$ATRIUM_DIR/deploy/atrium-agent
  [[ -f $f && -x $agent ]] || return 0
  grep -Eq '^ssh-ed25519 [^ ]+ atrium-app[[:space:]]*$' "$f" || return 0
  sed -i -E "s|^(ssh-ed25519 [^ ]+ atrium-app)[[:space:]]*\$|restrict,command=\"$agent\" \\1|" "$f"
  log "desktop app key pinned to $agent"
}

# The desktop app sets the address up just before it installs (a free name on dedyn.io, or the person's own
# records), and a new name can take minutes to reach every resolver. Only the start and the certificates need it, so
# the installer waits here after everything else is done (install_all): the wait mostly hides behind Docker and the
# images instead of holding the install up from its second step.
wait_dns() {
  [[ ${ATRIUM_PROGRESS:-} == 1 ]] || return 0
  local i
  progress run address
  for i in $(seq 1 60); do
    check_dns
    progress sub "Записей на месте: $DNS_HITS из 3"
    (( DNS_OK )) && dns_everywhere && break
    (( DNS_OK )) && progress sub "Адрес расходится по интернету"
    sleep 3
  done
  progress "done" address
}

# Every name answers from both Cloudflare and Google with this server's address. Let's Encrypt asks from its own
# resolvers, and a name one big resolver has while another still fails it (dedyn.io's delegation shows up a little
# later in some) can fail the certificate; Caddy then waits longer and longer before it tries again (step_https).
dns_everywhere() {
  local host url out
  for host in "$DOMAIN" "app.$DOMAIN" "$TURN_HOST.$DOMAIN"; do
    for url in "https://cloudflare-dns.com/dns-query?name=$host&type=A" "https://dns.google/resolve?name=$host&type=A"; do
      out=$(curl -fsS --max-time 5 -H 'accept: application/dns-json' "$url" 2>/dev/null) || return 1
      [[ $out == *'"Status":0'* || $out == *'"Status": 0'* ]] || return 1
      [[ -z ${SERVER_IP:-} || $out == *"\"$SERVER_IP\""* ]] || return 1
    done
  done
}

print_checks() {
  local item
  for item in "${CHECK_LINES[@]}"; do
    case ${item%%|*} in
      ok) ok "${item#*|}" ;;
      warn) warn "${item#*|}" ;;
      bad) bad "${item#*|}" ;;
      *) bullet "${item#*|}" ;;
    esac
  done
}

# DNS_ROWS: "host|now" per name that must point here; DNS_OK=1 when all do (DNS_HITS of them so far).
check_dns() {
  local host got status want_ips
  want_ips="${SERVER_IP:-} $(local_ips)"
  DNS_ROWS=() DNS_OK=1 DNS_HITS=0
  for host in "$DOMAIN" "app.$DOMAIN" "$TURN_HOST.$DOMAIN"; do
    got=$(resolve4 "$host")
    got=${got% }
    if [[ -z $got ]]; then
      status="${C_RED}✗${C_RESET} нет записи"
      DNS_OK=0
    elif [[ -n ${SERVER_IP:-} && " $want_ips " == *" ${got%% *} "* && $got != *" "* ]]; then
      status="${C_GREEN}✓${C_RESET}"
      DNS_HITS=$((DNS_HITS + 1))
    elif cloudflare_ip "${got%% *}"; then
      status="${C_RED}✗${C_RESET} прокси Cloudflare"
      DNS_OK=0
    elif [[ -z ${SERVER_IP:-} ]]; then
      status="${C_YELLOW}?${C_RESET} $got"
      DNS_OK=0
    else
      status="${C_RED}✗${C_RESET} $got"
      DNS_OK=0
    fi
    DNS_ROWS+=("$host|$status")
  done
}

print_dns() {
  local row host w=0
  for row in "${DNS_ROWS[@]}"; do host=${row%%|*}; (( ${#host} > w )) && w=${#host}; done
  (( w += 2 ))
  line "${C_DIM}$(pad Имя "$w")$(pad Тип 5)$(pad Значение 17)Сейчас${C_RESET}"
  for row in "${DNS_ROWS[@]}"; do
    line "$(pad "${row%%|*}" "$w")$(pad A 5)$(pad "${SERVER_IP:-IP сервера}" 17)${row#*|}"
  done
}

# ---------------------------------------------------------------------------------------------- prompts

get_gum() {
  (( TTY )) && [[ ${ATRIUM_NO_GUM:-} != 1 && ${TERM:-dumb} != dumb ]] || return 1
  local arch sum name
  case $(uname -m) in
    x86_64 | amd64) arch=x86_64 sum=$GUM_SHA256_x86_64 ;;
    aarch64 | arm64) arch=arm64 sum=$GUM_SHA256_arm64 ;;
    *) return 1 ;;
  esac
  name=gum_${GUM_VERSION}_Linux_$arch
  fetch "https://github.com/charmbracelet/gum/releases/download/v$GUM_VERSION/$name.tar.gz" "$ATRIUM_TMP/gum.tgz" 30 || return 1
  sha256_ok "$ATRIUM_TMP/gum.tgz" "$sum" || { log "gum: SHA-256 mismatch"; return 1; }
  tar -xzf "$ATRIUM_TMP/gum.tgz" -C "$ATRIUM_TMP" "$name/gum" 2>/dev/null || return 1
  "$ATRIUM_TMP/$name/gum" --version >/dev/null 2>&1 || return 1
  GUM=$ATRIUM_TMP/$name/gum
  log "gum $GUM_VERSION ($arch) ready"
}

# choose OPTION... → CHOICE (0-based). Returns 1 for "back" (Esc, or "<" in plain mode); Ctrl+C quits.
# ESC_MEANS says what Esc does on this screen.
ESC_MEANS=назад
choose() {
  local rc=0 out i options=("$@")
  if [[ -n $GUM ]]; then
    dim "↑↓ выбор · Enter · Esc — $ESC_MEANS"
    out=$("$GUM" choose --cursor "› " --cursor.foreground "$ACCENT_HEX" --header "" --no-show-help \
      --padding "0 0 0 2" "$@") || rc=$?
    (( rc == 130 )) && interrupted
    (( rc != 0 )) && return 1
    CHOICE=0
    for i in "${!options[@]}"; do
      [[ ${options[i]} == "$out" ]] && CHOICE=$i
    done
    return 0
  fi
  local o
  i=1
  for o in "$@"; do line "${C_ACCENT}$i${C_RESET}) $o"; i=$((i + 1)); done
  while :; do
    read -r -p "  › [1] " out || interrupted
    [[ -z $out ]] && out=1
    [[ $out == "<" || $out == *$'\e'* ]] && return 1
    if [[ $out =~ ^[0-9]+$ ]] && (( out >= 1 && out <= $# )); then CHOICE=$((out - 1)); return 0; fi
  done
}

# ask LABEL DEFAULT PLACEHOLDER → ANSWER. Returns 1 for "back".
ask() {
  local rc=0
  if [[ -n $GUM ]]; then
    dim "Enter · Esc — $ESC_MEANS"
    ANSWER=$("$GUM" input --prompt "› " --prompt.foreground "$ACCENT_HEX" --cursor.foreground "$ACCENT_HEX" \
      --placeholder "$3" --value "$2" --width 60 --char-limit 200 --no-show-help --padding "0 0 0 2") || rc=$?
    (( rc == 130 )) && interrupted
    return "$rc"
  fi
  # Plain read, not readline: readline would swallow Esc as a Meta prefix.
  dim "Enter · «<» или Esc, Enter — $ESC_MEANS"
  read -r -p "  ›${2:+ [$2]} " ANSWER || interrupted
  [[ $ANSWER == "<" || $ANSWER == *$'\e'* ]] && return 1
  [[ -n $ANSWER ]] || ANSWER=$2
  return 0
}

# A spinner while CMD runs in the background (its output goes to the log). Ctrl+C stops it and quits.
spin() {
  local title=$1 rc=0 g=0 frames='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏' i=0
  shift
  "$@" >>"$LOG" 2>&1 &
  BG_PID=$!
  if [[ -n $GUM ]]; then
    "$GUM" spin --spinner dot --spinner.foreground "$ACCENT_HEX" --title "$title" --padding "0 0 0 2" \
      -- tail --pid="$BG_PID" -f /dev/null || g=$?
    (( g == 130 )) && interrupted
  elif (( TTY )); then
    printf '\e[?25l'
    while kill -0 "$BG_PID" 2>/dev/null; do
      printf '\r  %s %s' "${C_ACCENT}${frames:i++%10:1}${C_RESET}" "$title"
      sleep 0.1
    done
    printf '\r\e[2K\e[?25h'
  fi
  wait "$BG_PID" || rc=$?
  BG_PID=
  return "$rc"
}

# ---------------------------------------------------------------------------------------------- screens

# The logo, 70 columns of half blocks traced from the mark and wordmark (logo-atrium/atrium-logo-short.svg): white
# on the terminal's own background, black and white like the brand.
LOGO=$(cat <<'EOF'
      ████▄                    ▄▄          ██
     ██████▄                   ██▄
    ████████         ▄██████  █████ ██████ ██  ██    ██  ████████████
   ███    ▀██        ▀▀   ███  ██   ███▀   ██  ██    ██  ██   ██▀  ███
  ▄██      ███       ▄███▀███  ██   ███    ██  ██    ██  ██   ██   ███
 ▄███      ████      ██   ▄██  ██▄  ███    ██  ██▄  ▄██  ██   ██   ███
 ████      █████     ▀████▀██   ▀██ ███    ██  ▀▀████▀   ██   ██   ███
EOF
)

print_logo() {
  say
  if (( COLS >= 72 )); then
    while IFS= read -r l; do say " ${C_ACCENT}${l}${C_RESET}"; done <<<"$LOGO"
  else
    line "${C_ACCENT}${C_BOLD}A T R I U M${C_RESET}"
  fi
  say
}

STEPS=(Проверка Домен Итог Установка)
# header N: the brand line and where we are, N = 1..4.
header() {
  local i out=''
  clear_screen
  say
  line "${C_ACCENT}${C_BOLD}Atrium${C_RESET} ${C_DIM}$RELEASE_VERSION${C_RESET}"
  for i in "${!STEPS[@]}"; do
    (( i > 0 )) && out+="${C_DIM} › ${C_RESET}"
    if (( i + 1 == $1 )); then
      out+="${C_ACCENT}${C_BOLD}${STEPS[i]}${C_RESET}"
    elif (( i + 1 < $1 )); then
      out+="${STEPS[i]}"
    else
      out+="${C_DIM}${STEPS[i]}${C_RESET}"
    fi
  done
  line "$out"
  local rule
  printf -v rule '%*s' $((COLS - 4)) ''
  dim "${rule// /─}"
  say
}

title() { line "${C_BOLD}$*${C_RESET}"; say; }

screen_welcome() {
  clear_screen
  print_logo
  line "${C_BOLD}Чат и звонки для своих${C_RESET}"
  dim "Atrium $RELEASE_VERSION · установка на этот сервер"
  say
  if (( EXISTING )); then
    line "Уже стоит: ${C_BOLD}${OLD_DOMAIN:-?}${C_RESET} ${C_DIM}${OLD_VERSION:+· $OLD_VERSION}${C_RESET}"
    say
    ESC_MEANS=выход
    choose "Обновить до $RELEASE_VERSION" "Настроить заново" "Выйти" || exit 0
    ESC_MEANS=назад
    case $CHOICE in 0) return 2 ;; 1) return 0 ;; *) exit 0 ;; esac
  fi
  dim "Понадобятся домен и пять минут."
  say
  ESC_MEANS=выход
  choose "Начать" "Выйти" || exit 0
  ESC_MEANS=назад
  (( CHOICE == 0 )) || exit 0
}

screen_checks() {
  header 1
  title "Проверка сервера"
  if [[ -z ${SERVER_IP:-} ]]; then
    spin "Проверяем сервер" detect_ip_to_file || true
    SERVER_IP=$(cat "$ATRIUM_TMP/ip" 2>/dev/null || true)
  fi
  run_checks
  print_checks
  say
  if (( CHECK_FATAL )); then
    choose "Проверить снова" "Выйти" || return 1
    (( CHOICE == 0 )) && return 3
    DIED=1
    exit 1
  fi
  choose "Дальше" "Проверить снова" || return 1
  (( CHOICE == 0 )) || return 3
}
detect_ip_to_file() { detect_ip >"$ATRIUM_TMP/ip"; }

screen_domain() {
  local err=''
  while :; do
    header 2
    title "Домен"
    dim "Адрес, по которому друзья откроют Atrium. Например: chat.example.com"
    say
    [[ -n $err ]] && { bad "$err"; say; }
    ask "Домен" "${DOMAIN:-}" "chat.example.com" || return 1
    local d
    d=$(normalize_domain "$ANSWER")
    if ! valid_domain "$d"; then
      err="Не похоже на домен: ${ANSWER:-пусто}"
      continue
    fi
    DOMAIN=$d err=''
    screen_dns && return 0
  done
}

# Returns 0 to go on, 1 to retype the domain.
screen_dns() {
  while :; do
    header 2
    title "DNS · $DOMAIN"
    spin "Проверяем DNS" check_dns_to_file || true
    # shellcheck source=/dev/null
    . "$ATRIUM_TMP/dns"
    if (( DNS_OK )); then
      ok "Все три имени ведут на этот сервер"
      sleep 1
      return 0
    fi
    line "Добавь A-записи у регистратора домена:"
    say
    print_dns
    say
    dim "Cloudflare: серое облако, только DNS."
    say
    choose "Проверить снова" "Продолжить без DNS" "Другой домен" || return 1
    case $CHOICE in 0) continue ;; 1) return 0 ;; *) return 1 ;; esac
  done
}
# Sourced inside a function: -g, or the results would be that function's locals.
check_dns_to_file() { check_dns; declare -p DNS_ROWS DNS_OK | sed 's/^declare /declare -g /' >"$ATRIUM_TMP/dns"; }

plan_lines() {
  if (( DOCKER_OK )); then ok "Docker уже есть"; else bullet "Docker"; fi
  if [[ ${ATRIUM_FIREWALL:-1} != 0 ]]; then bullet "Файрвол: 22, 80, 443, 7881, 50000–60000"; fi
  case $SSH_PLAN in
    keys) bullet "SSH только по ключу" ;;
    nokey) warn "SSH: пароль остаётся, ключа нет" ;;
  esac
  [[ -d /run/systemd/system ]] && bullet "Ночные бэкапы"
  bullet "Atrium $RELEASE_VERSION в $ATRIUM_DIR"
}

screen_summary() {
  header 3
  title "Всё готово к установке"
  local k
  for k in "Домен|$DOMAIN" "Приложение|app.$DOMAIN" "Звонки|$TURN_HOST.$DOMAIN"; do
    line "${C_DIM}$(pad "${k%%|*}" 13)${C_RESET}${k#*|}"
  done
  (( DNS_OK )) || line "${C_DIM}$(pad DNS 13)${C_RESET}${C_YELLOW}ещё не готов${C_RESET}"
  say
  plan_lines
  say
  choose "Установить" "Назад" || return 1
  (( CHOICE == 0 )) || return 1
}

# ---------------------------------------------------------------------------------------------- install steps
# run/spin capture exit codes in conditionals, which disables errexit inside the steps and their helpers.
# Required commands must propagate failures explicitly, even with set -e enabled.

step_docker() {
  command -v curl >/dev/null || apt_install curl ca-certificates || return
  if ! command -v docker >/dev/null; then
    progress sub "Скачиваем установщик Docker"
    fetch https://get.docker.com "$ATRIUM_TMP/get-docker.sh" 60 || return
    progress sub "Ставим пакеты Docker"
    # Without systemd it starts dockerd itself, which must not inherit the lock (main) and hold it for good.
    sh "$ATRIUM_TMP/get-docker.sh" 9>&- || return
  fi
  progress sub "Запускаем Docker"
  systemctl enable --now docker 2>/dev/null || true
  docker compose version >/dev/null 2>&1 || apt_install docker-compose-plugin || apt_install docker-compose-v2
  docker compose version
}

# Web, TURN over TLS and UDP on 443, LiveKit's TCP fallback and media ports;
# SSH rate-limited ("limit": the 6th new connection within 30 s is refused) on whatever port sshd listens on.
step_firewall() {
  command -v ufw >/dev/null || { progress sub "Ставим ufw"; apt_install ufw || return; }
  ufw default deny incoming || return
  ufw default allow outgoing || return
  local rule port ports
  progress sub "Открываем порты 80, 443 и для звонков"
  for rule in 80/tcp 443/tcp 443/udp 7881/tcp 50000:60000/udp; do ufw allow "$rule" || return; done
  mkdir -p /run/sshd || return
  ports=$(sshd -T 2>/dev/null | awk '$1 == "port" { print $2 }' || true)
  progress sub "Ограничиваем частоту входов по SSH"
  for port in ${ports:-22}; do
    ufw limit "$port/tcp" || return
    ufw delete allow "$port/tcp" >/dev/null 2>&1 || true
    ufw delete allow "$port" >/dev/null 2>&1 || true
  done
  ufw delete allow OpenSSH >/dev/null 2>&1 || true
  progress sub "Включаем файрвол"
  ufw --force enable
}

# Key-only login. Only reached when authorized_keys holds a key (run_checks), so nobody gets locked out.
# Its own file in sshd_config.d: no other file's settings get overwritten.
step_ssh() {
  local conf=/etc/ssh/sshd_config.d/00-atrium-key-only.conf
  progress sub "Выключаем вход по паролю"
  mkdir -p /run/sshd || return
  printf '%s\n' '# Written by the Atrium installer: log in with an SSH key only.' \
    'PasswordAuthentication no' 'KbdInteractiveAuthentication no' 'PermitRootLogin prohibit-password' >"$conf" || return
  progress sub "Проверяем настройки sshd"
  if ! sshd -t; then
    rm -f "$conf"
    return 1
  fi
  # No systemd (or another unit name): the file is valid and applies at sshd's next start, which isn't a failure.
  systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
}

step_files() {
  local tgz=$ATRIUM_TMP/atrium.tar.gz stage=$ATRIUM_TMP/release f src got=0
  if [[ -f $TARBALL_SRC ]]; then
    cp "$TARBALL_SRC" "$tgz" || return
    sha256_ok "$tgz" "$TARBALL_SHA256" && got=1
  else
    # The first source that gives the pinned bytes; a mirror can't slip anything else in.
    for src in "$TARBALL_SRC" ${TARBALL_MIRRORS[@]+"${TARBALL_MIRRORS[@]}"}; do
      progress sub "Скачиваем Atrium $RELEASE_VERSION"
      echo "Tarball from $src"
      if fetch "$src" "$tgz" 300 && sha256_ok "$tgz" "$TARBALL_SHA256"; then got=1; break; fi
      echo "Not usable: $src"
    done
  fi
  (( got )) || { echo "No source gave the release's tarball with SHA-256 $TARBALL_SHA256"; return 1; }
  progress sub "Раскладываем файлы"
  mkdir -p "$stage" || return
  tar -xzf "$tgz" -C "$stage" --strip-components=1 --no-same-owner || return
  for f in deploy/docker-compose.yml deploy/Caddyfile deploy/backup.sh deploy/atrium-agent deploy/livekit.yaml.tmpl; do
    [[ -f $stage/$f ]] || { echo "Release has no $f"; return 1; }
  done
  mkdir -p "$ATRIUM_DIR/deploy" "$ATRIUM_DIR/landing" || return
  # Caddy reads the Caddyfile once: an update that changes it needs Caddy recreated (step_up).
  if [[ -f $ATRIUM_DIR/deploy/Caddyfile ]] && ! cmp -s "$stage/deploy/Caddyfile" "$ATRIUM_DIR/deploy/Caddyfile"; then
    touch "$ATRIUM_TMP/caddyfile-changed" || return
  fi
  install -m 644 "$stage/deploy/docker-compose.yml" "$stage/deploy/Caddyfile" "$stage/deploy/livekit.yaml.tmpl" "$ATRIUM_DIR/deploy/" || return
  install -m 755 "$stage/deploy/backup.sh" "$stage/deploy/atrium-agent" "$ATRIUM_DIR/deploy/" || return
  return 0
}

# replace_dir SRC DIR: DIR ends up with exactly SRC's files, so none a release drops linger. DIR itself stays: Caddy's
# bind mount holds on to that folder, and a new one renamed in at the same path would stay invisible to it.
replace_dir() {
  mkdir -p "$2" || return
  find "$2" -mindepth 1 -delete || return
  cp -R "$1/." "$2/" || return
  chmod -R a+rX "$2"
}

# A random CSS class name.
css_name() {
  local letters=abcdefghijklmnopqrstuvwxyz r
  r=$(rand 6)
  printf '%s%s' "${letters:RANDOM % 26:1}" "${r,,}"
}

# The server's name as the app has it: given in the browser setup (SERVER_NAME from .env until then).
app_server_name() {
  local json name re='"serverName": ?"(([^"\\]|\\.)*)"'
  json=$(curl -fsS --max-time 5 http://127.0.0.1:8000/api/setup 2>/dev/null) || return 0
  [[ $json =~ $re ]] || return 0
  # Undo JSON's \" and \\, in that order.
  name=${BASH_REMATCH[1]}
  name=${name//\\\"/\"}
  name=${name//\\\\/\\}
  printf '%s' "$name"
}

# The server's icon as the app has it (its path on app.DOMAIN, e.g. /api/server/icon?v=…), empty while there's none.
app_server_icon() {
  local json re='"serverIcon": ?"(/[^"]*)"'
  json=$(curl -fsS --max-time 5 http://127.0.0.1:8000/api/setup 2>/dev/null) || return 0
  [[ $json =~ $re ]] && printf '%s' "${BASH_REMATCH[1]}"
  return 0
}

# Where "make your own" leads: Atrium's own site.
ATRIUM_SITE=https://www.atriumcalls.app

# write_landing SEED: the root domain's page, for someone who comes to it: whose server this is (its icon and name),
# the way in, and under it an offer to make one of their own. Atrium's black and white, one HTML file, no scripts.
# Class names are random per install (SEED, LANDING_SEED in .env, keeps them across updates).
write_landing() {
  local name icon initial tile w t s b f dir=$ATRIUM_TMP/landing
  RANDOM=$(( $1 % 32768 ))
  # The name people gave the server in the browser setup; the domain while it's still the default one.
  name=$(app_server_name)
  [[ -n $name && ${name,,} != atrium ]] || name=$DOMAIN
  initial=${name:0:1}
  initial=${initial^^}
  name=${name//&/&amp;} name=${name//</&lt;} name=${name//>/&gt;} name=${name//\"/&quot;} name=${name//\'/&#39;}
  initial=${initial//&/&amp;} initial=${initial//</&lt;} initial=${initial//>/&gt;}
  icon=$(app_server_icon)
  w=$(css_name) t=$(css_name) s=$(css_name) b=$(css_name) f=$(css_name) tile=$(css_name)
  if [[ -n $icon ]]; then
    icon="<img src=\"https://app.$DOMAIN${icon//\"/}\" alt=\"\">"
  else
    icon="<span>$initial</span>"
  fi

  rm -rf "$dir" || return
  mkdir -p "$dir" || return
  cat >"$dir/index.html" <<EOF || return
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#0c0c0e">
<title>$name</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='4' fill='%23ffffff'/%3E%3C/svg%3E">
<style>
* { box-sizing: border-box; }
html, body { margin: 0; }
body { display: flex; flex-direction: column; min-height: 100vh; min-height: 100dvh; background: #0c0c0e; color: #ededef; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; -webkit-font-smoothing: antialiased; }
.$w { display: flex; flex: 1; flex-direction: column; align-items: center; justify-content: center; padding: 48px 24px 24px; text-align: center; }
.$tile { display: grid; width: 104px; height: 104px; margin-bottom: 28px; place-items: center; overflow: hidden; border-radius: 26px; background: #ffffff; color: #0c0c0e; font-size: 44px; font-weight: 500; box-shadow: 0 2px 4px rgba(0,0,0,.35), 0 18px 40px rgba(0,0,0,.5); }
.$tile img { width: 100%; height: 100%; object-fit: cover; }
.$t { max-width: 640px; margin: 0; font-size: clamp(36px, 7vw, 56px); font-weight: 300; letter-spacing: -0.03em; line-height: 1.08; overflow-wrap: anywhere; }
.$s { margin: 12px 0 0; color: #8b8b93; font-size: 17px; line-height: 1.4; }
.$b { display: inline-flex; height: 56px; margin-top: 36px; padding: 0 40px; align-items: center; border-radius: 999px; background: #ffffff; color: #0c0c0e; font-size: 17px; font-weight: 600; text-decoration: none; white-space: nowrap; }
.$b:hover { background: #e4e4e7; }
.$b:focus-visible, .$f a:focus-visible { outline: 2px solid #ededef; outline-offset: 3px; }
.$f { padding: 0 16px 24px; }
.$f a { display: flex; width: 100%; max-width: 480px; margin: 0 auto; align-items: center; gap: 16px; padding: 14px 14px 14px 16px; border: 1px solid #26262b; border-radius: 20px; background: linear-gradient(180deg, #141417, #0e0e10); color: #ededef; text-decoration: none; transition: border-color .15s ease, transform .15s ease; }
.$f a:hover { border-color: #4a4a52; transform: translateY(-1px); }
.$f svg { flex: none; width: 44px; height: 44px; padding: 10px; border-radius: 12px; background: #ededef; color: #0c0c0e; }
.$f b { display: block; font-size: 16px; font-weight: 500; }
.$f small { display: block; margin-top: 2px; color: #8b8b93; font-size: 14px; }
.$f i { flex: none; margin-left: auto; display: grid; width: 36px; height: 36px; place-items: center; border-radius: 999px; background: #ededef; color: #0c0c0e; font-style: normal; font-size: 18px; }
</style>
</head>
<body>
<main class="$w">
<div class="$tile">$icon</div>
<h1 class="$t">$name</h1>
<p class="$s">Голос, чат и показ экрана · по приглашению</p>
<a class="$b" href="https://app.$DOMAIN">Войти</a>
</main>
<footer class="$f"><a href="$ATRIUM_SITE/?utm_source=cover"><svg viewBox="-10 -25 150 150" aria-hidden="true"><path fill="currentColor" d="M53.37 0L76.63 0A7 7 0 0 1 82.92 3.92L126.47 92.8A5 5 0 0 1 121.98 100L89 100A2 2 0 0 1 87 98L87 62A22 22 0 0 0 43 62L43 98A2 2 0 0 1 41 100L8.02 100A5 5 0 0 1 3.53 92.8L47.08 3.92A7 7 0 0 1 53.37 0Z"/></svg><span><b>Свой сервер за 5 минут</b><small>Голос, чат и экран для своей компании</small></span><i>→</i></a></footer>
</body>
</html>
EOF
  replace_dir "$dir" "$ATRIUM_DIR/landing/site"
}

step_config() {
  cd "$ATRIUM_DIR/deploy" || return
  progress sub "Секреты и настройки"
  if [[ ! -f .env ]]; then
    (umask 077 && cat >.env <<EOF
DOMAIN=$DOMAIN
SERVER_NAME='$SERVER_NAME'
INVITE_CODE=$(rand 10)
# The TURN relay's subdomain. A plain-sounding name: a "turn." host is an easy thing to find and block.
TURN_HOST=$TURN_HOST
APP_SECRET=$(rand 48)
LIVEKIT_API_KEY=API$(rand 12)
LIVEKIT_API_SECRET=$(rand 40)
EOF
    ) || return
  fi
  chmod 600 .env || return
  env_set .env DOMAIN "$DOMAIN" || return
  env_set .env TURN_HOST "$TURN_HOST" || return
  if [[ ${NAME_SET:-0} == 1 ]]; then env_set .env SERVER_NAME "'$SERVER_NAME'" || return; fi
  # Which images run: this release's, pinned by digest.
  env_set .env ATRIUM_REGISTRY "$REGISTRY" || return
  env_set .env ATRIUM_VERSION "$RELEASE_VERSION" || return
  env_set .env ATRIUM_APP_DIGEST "$APP_DIGEST" || return
  env_set .env ATRIUM_CADDY_DIGEST "$CADDY_DIGEST" || return

  # LiveKit's config comes from .env, so its keys always match the app's.
  local s key
  progress sub "Настройки звонков"
  s=$(<livekit.yaml.tmpl) || return
  for key in DOMAIN TURN_HOST LIVEKIT_API_KEY LIVEKIT_API_SECRET; do
    s=${s//"{{$key}}"/$(env_get .env "$key")}
  done
  [[ $s != *'{{'* ]] || { echo "livekit.yaml.tmpl: unknown placeholder"; return 1; }
  if [[ -f livekit.yaml ]] && [[ $(<livekit.yaml) != "$s" ]]; then touch "$ATRIUM_TMP/livekit-changed" || return; fi
  (umask 077 && printf '%s\n' "$s" >livekit.yaml) || return

  mkdir -p data caddy-data caddy-config sites routes/app || return
  # The app runs as uid 10001 in its container; only it may touch the data.
  chown -R 10001:10001 data || return
  chmod 700 data || return

  # The cover page's look; step_up writes the page.
  if [[ ! $(env_get .env LANDING_SEED) =~ ^[0-9]{1,10}$ ]]; then
    env_set .env LANDING_SEED "$(((RANDOM << 15) | RANDOM))" || return
  fi
}

# Nightly backup at 04:30 server time, a systemd timer (a fresh server may have no cron). Log: journalctl -u atrium-backup
step_backups() {
  command -v rsync >/dev/null || apt_install rsync || return
  command -v flock >/dev/null || apt_install util-linux || return
  progress sub "Служба и таймер на 04:30"
  cat >/etc/systemd/system/atrium-backup.service <<EOF || return
[Unit]
Description=Atrium nightly backup

[Service]
Type=oneshot
ExecStart=$ATRIUM_DIR/deploy/backup.sh
EOF
  cat >/etc/systemd/system/atrium-backup.timer <<'EOF' || return
[Unit]
Description=Atrium nightly backup at 04:30

[Timer]
OnCalendar=*-*-* 04:30:00
Persistent=true

[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload || return
  systemctl enable --now atrium-backup.timer
}

step_pull() {
  cd "$ATRIUM_DIR/deploy" || return
  progress sub "Образы приложения, звонков и веб-сервера"
  # The desktop app shows the last line of this; the plain installer keeps it quiet.
  if [[ ${ATRIUM_PROGRESS:-} == 1 ]]; then docker compose pull; else docker compose pull --quiet; fi
}

step_up() {
  cd "$ATRIUM_DIR/deploy" || return
  progress sub "Запускаем контейнеры"
  docker compose up -d --remove-orphans || return
  # Bind-mounted single files: an update swaps in new files the running containers never see.
  if [[ -f $ATRIUM_TMP/caddyfile-changed ]]; then docker compose up -d --force-recreate --no-deps caddy || return; fi
  # Restarting LiveKit drops calls in progress, so only when its config changed.
  if [[ -f $ATRIUM_TMP/livekit-changed ]]; then docker compose up -d --force-recreate --no-deps livekit || return; fi
  local i
  progress sub "Ждём ответ приложения"
  for i in $(seq 1 90); do
    curl -fsS --max-time 3 -o /dev/null http://127.0.0.1:8000/api/setup && break
    (( i == 90 )) && { docker compose ps; docker compose logs --tail 30 app; return 1; }
    sleep 1
  done
  # Once the app answers: the cover page carries the name it has. A site of one's own in landing/site, marked by a
  # file named .custom there, stays as it is.
  progress sub "Пишем обложку сайта"
  [[ -e $ATRIUM_DIR/landing/site/.custom ]] || write_landing "$(env_get .env LANDING_SEED)" || return
  # Images of earlier releases.
  docker image prune -f
}

# The certificate. Caddy asks for it as it starts; when that first try fails (the name not seen everywhere yet), it
# waits a minute, then two, four… before the next. A minute without one, Caddy is started again, which asks at once:
# the certificate comes within a minute of the name being everywhere instead of after Caddy's next turn. Four minutes
# in all; past that it's left to Caddy and the install still ends (screen_done says so).
step_https() {
  local i
  cd "$ATRIUM_DIR/deploy" || return
  progress sub "Ждём сертификат от Let's Encrypt"
  for i in $(seq 1 80); do
    curl -fsS --max-time 5 -o /dev/null --resolve "app.$DOMAIN:443:127.0.0.1" "https://app.$DOMAIN/api/setup" && return 0
    if (( i % 20 == 0 )); then
      progress sub "Просим сертификат ещё раз"
      docker compose restart caddy >/dev/null 2>&1 || true
    fi
    sleep 3
  done
  return 1
}

# run TITLE FUNCTION [soft]: one line per step, ✓ with the time it took or ✗ with the log's tail.
run() {
  local title=$1 fn=$2 soft=${3:-} start rc=0 took=''
  log "== $title"
  progress run "${fn#step_}"
  start=$SECONDS
  if (( TTY )); then
    spin "$title" "$fn" || rc=$?
  elif [[ ${ATRIUM_PROGRESS:-} == 1 ]]; then
    # The log as always, and the output on to the desktop app, which shows its last line when a step takes long.
    line "… $title"
    "$fn" 2>&1 | relay_output || rc=$?
  else
    line "… $title"
    "$fn" >>"$LOG" 2>&1 || rc=$?
  fi
  (( SECONDS - start >= 3 )) && took=" ${C_DIM}$((SECONDS - start)) с${C_RESET}"
  if (( rc == 0 )); then
    ok "$title$took"
    progress "done" "${fn#step_}" "$((SECONDS - start))"
    return 0
  fi
  if [[ -n $soft ]]; then
    warn "$soft"
    progress "done" "${fn#step_}" "$((SECONDS - start))"
    return 1
  fi
  bad "$title"
  progress fail "${fn#step_}" "$title"
  say
  tail -n 12 "$LOG" | sed "s/^/    ${C_DIM}/; s/\$/${C_RESET}/"
  die "Не получилось. Исправь и запусти установку снова — данные не пропадут."
}

install_all() {
  [[ -n ${WIZARD:-} ]] || say
  if (( DOCKER_OK )); then ok "Docker уже есть"; progress "done" docker 0; else run "Docker" step_docker; fi
  if [[ ${ATRIUM_FIREWALL:-1} != 0 ]]; then run "Файрвол" step_firewall; fi
  case $SSH_PLAN in
    keys) run "SSH только по ключу" step_ssh ;;
    nokey) warn "SSH: пароль остаётся, ключа нет"; progress "done" ssh 0 ;;
    noinclude) warn "SSH: не трогаем, старый sshd без sshd_config.d"; progress "done" ssh 0 ;;
    *) progress "done" ssh 0 ;;
  esac
  run "Файлы Atrium $RELEASE_VERSION" step_files
  run "Настройки и ключи" step_config
  if [[ -d /run/systemd/system ]]; then run "Ночные бэкапы" step_backups; fi
  run "Скачиваем образы" step_pull
  if [[ ${ATRIUM_PROGRESS:-} == 1 ]]; then
    wait_dns
    check_dns
  fi
  run "Запуск" step_up
  HTTPS_OK=0
  if (( DNS_OK )); then
    run "HTTPS-сертификаты" step_https "HTTPS ещё настраивается" && HTTPS_OK=1
  fi
  return 0
}

screen_done() {
  local code needed url next
  code=$(env_get "$ENV_FILE" INVITE_CODE)
  needed=$(curl -fsS --max-time 5 http://127.0.0.1:8000/api/setup 2>/dev/null || true)
  if [[ $needed == *'"needed":true'* || $needed == *'"needed": true'* ]]; then
    url="https://app.$DOMAIN/?setup=$code"
    next="Открой ссылку: создашь админа и позовёшь друзей."
  else
    url="https://app.$DOMAIN"
    next="Atrium $RELEASE_VERSION работает."
  fi
  say
  if [[ -n $GUM ]]; then
    "$GUM" style --border rounded --border-foreground "$ACCENT_HEX" --bold --padding "1 3" --margin "0 2" "$url"
  else
    local bar
    bar=$(printf '%*s' $((${#url} + 6)) '' | sed 's/ /─/g')
    line "${C_ACCENT}╭${bar}╮${C_RESET}"
    line "${C_ACCENT}│${C_RESET}   ${C_BOLD}${url}${C_RESET}   ${C_ACCENT}│${C_RESET}"
    line "${C_ACCENT}╰${bar}╯${C_RESET}"
  fi
  say
  line "$next"
  progress ready "$url"
  if (( ! DNS_OK )); then
    dim "Ссылка заработает, когда DNS обновится: сертификаты придут сами."
  elif (( ! ${HTTPS_OK:-0} )); then
    dim "Сертификат ещё получается: подожди пару минут."
  fi
  say
}

# ---------------------------------------------------------------------------------------------- link

# `link`: the setup link again, for an owner who lost it or opened the address without it.
show_link() {
  (( EXISTING )) || die "Atrium здесь ещё не стоит"
  [[ -n $DOMAIN ]] || die "В $ENV_FILE нет DOMAIN"
  local needed code
  needed=$(curl -fsS --max-time 5 http://127.0.0.1:8000/api/setup 2>/dev/null) || die "Сервер не отвечает"
  if [[ $needed != *'"needed":true'* && $needed != *'"needed": true'* ]]; then
    line "Настройка уже закончена: https://app.$DOMAIN"
    return
  fi
  code=$(env_get "$ENV_FILE" INVITE_CODE)
  [[ -n $code ]] || die "В $ENV_FILE нет INVITE_CODE"
  printf '%s\n' "https://app.$DOMAIN/?setup=$code"
}

# ---------------------------------------------------------------------------------------------- restore

BACKUPS=/root/atrium-backups/daily

# `restore`: the data of a nightly backup back in place (a channel's history lost, a server that broke). What was there
# is kept first as pre-restore-<time>, so a wrong choice can be undone with the same command.
restore_all() {
  (( EUID == 0 )) || die "Нужен root: sudo sh install.sh restore"
  (( EXISTING )) || die "Atrium здесь ещё не стоит: сначала установи, потом restore"
  local data=$ATRIUM_DIR/deploy/data names=() name pick="${ATRIUM_RESTORE:-}" size
  [[ -d $BACKUPS ]] || die "Бэкапов нет: $BACKUPS"
  # Newest first; only folders that hold a database count.
  while IFS= read -r name; do
    [[ $name != .* && -f $BACKUPS/$name/hangout.db ]] && names+=("$name")
  done < <(find "$BACKUPS" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -r)
  (( ${#names[@]} )) || die "В $BACKUPS нет ни одной копии"

  if [[ ${ATRIUM_YES:-} == 1 ]]; then
    [[ -n $pick ]] || die "Без вопросов: ATRIUM_YES=1 ATRIUM_RESTORE=<копия> sh install.sh restore. Копии: ${names[*]}"
  else
    (( TTY )) || die "Нет терминала. Без вопросов: ATRIUM_YES=1 ATRIUM_RESTORE=<копия> sh install.sh restore"
  fi
  if [[ -z $pick ]]; then
    say
    title "Какую копию вернуть?"
    local labels=()
    for name in "${names[@]}"; do
      size=$(du -sh "$BACKUPS/$name" 2>/dev/null | cut -f1)
      labels+=("$(pad "$name" 30)$size")
    done
    ESC_MEANS=выход
    choose "${labels[@]}" || exit 0
    pick=${names[CHOICE]}
    say
    dim "Нынешние данные сохранятся копией pre-restore-… в той же папке."
    say
    choose "Отмена" "Вернуть $pick" || exit 0
    if (( CHOICE != 1 )); then dim "Ничего не изменено."; exit 0; fi
    say
  fi
  # A name from the list only: no paths.
  [[ $pick != */* && $pick != .* && -f $BACKUPS/$pick/hangout.db ]] || die "Нет такой копии: $pick"

  cd "$ATRIUM_DIR/deploy"
  local saved
  saved=pre-restore-$(date +%F_%H%M%S)
  docker compose stop app >>"$LOG" 2>&1 || die "Не остановить приложение. Смотри лог."
  ok "Приложение остановлено"

  # With the app stopped, the files are whole: the current data are copied as they are (pictures hard-linked).
  mkdir -p "$BACKUPS/$saved/media"
  cp -a "$data"/hangout.db* "$BACKUPS/$saved/" 2>>"$LOG" || true
  local dir
  for dir in avatars uploads; do
    [[ -d $data/$dir ]] && { cp -al "$data/$dir" "$BACKUPS/$saved/media/" 2>>"$LOG" || cp -a "$data/$dir" "$BACKUPS/$saved/media/"; }
  done
  chmod -R go-rwx "$BACKUPS/$saved"
  ok "Нынешние данные: $saved"

  rm -f "$data"/hangout.db "$data"/hangout.db-wal "$data"/hangout.db-shm
  cp -a "$BACKUPS/$pick/hangout.db" "$data/hangout.db"
  for dir in avatars uploads; do
    if [[ -d $BACKUPS/$pick/media/$dir ]]; then
      mkdir -p "$data/$dir"
      rsync -a --delete "$BACKUPS/$pick/media/$dir/" "$data/$dir/"
    else
      rm -rf "${data:?}/$dir"
    fi
  done
  chown -R 10001:10001 "$data"
  chmod 700 "$data"
  ok "Данные из $pick"

  docker compose up -d app >>"$LOG" 2>&1 || die "Не запустить приложение. Данные до возврата: $BACKUPS/$saved"
  local i
  for i in $(seq 1 90); do
    curl -fs --max-time 3 -o /dev/null http://127.0.0.1:8000/api/setup && break
    (( i == 90 )) && die "Приложение не отвечает. Данные до возврата: $BACKUPS/$saved (sh install.sh restore)"
    sleep 1
  done
  ok "Приложение отвечает"
  say
  line "Готово: данные из $pick."
  say
}

# ---------------------------------------------------------------------------------------------- uninstall

# `uninstall`: Atrium off this server, back to what it was before the installer (Docker and ufw stay).
uninstall_all() {
  (( EUID == 0 )) || die "Нужен root: sudo sh install.sh uninstall"
  [[ $ATRIUM_DIR == /?* && $ATRIUM_DIR != *..* ]] || die "ATRIUM_DIR: нужен полный путь, например /opt/atrium"
  case ${ATRIUM_DIR%/} in
    /bin | /boot | /dev | /etc | /home | /lib | /lib64 | /mnt | /opt | /proc | /root | /run | /sbin | /srv | /sys | /tmp | /usr | /var)
      die "ATRIUM_DIR: $ATRIUM_DIR — системная папка, не Atrium" ;;
  esac
  # The folder is deleted whole, so it must be Atrium's: it has the compose file the installer puts there.
  [[ ! -e $ATRIUM_DIR || -f $ATRIUM_DIR/deploy/docker-compose.yml ]] || die "В $ATRIUM_DIR нет Atrium: ничего не трогаю"

  [[ ${ATRIUM_YES:-} == 1 ]] || (( TTY )) || die "Нет терминала. Без вопросов: ATRIUM_YES=1 sh install.sh uninstall"

  say
  title "Удалить Atrium с этого сервера?"
  bullet "Контейнеры и образы Atrium"
  bullet "Папка $ATRIUM_DIR: настройки, переписка, файлы"
  bullet "Бэкапы в /root/atrium-backups и ночной таймер"
  bullet "Установщик в /root и его лог"
  bullet "Вход по паролю: как было до установки"
  say
  dim "Docker и файрвол останутся. Вернуть удалённое нельзя, бэкапы тоже."
  say
  if [[ ${ATRIUM_YES:-} != 1 ]]; then
    ESC_MEANS=выход
    choose "Отмена" "Удалить Atrium" || exit 0
    if (( CHOICE != 1 )); then dim "Ничего не удалено."; exit 0; fi
    say
  fi

  # The stack first, while its folder and .env are still there.
  if [[ -f $ATRIUM_DIR/deploy/docker-compose.yml ]] && command -v docker >/dev/null; then
    (cd "$ATRIUM_DIR/deploy" && docker compose down --rmi all --volumes --remove-orphans) >>"$LOG" 2>&1 ||
      die "Не остановить контейнеры. Смотри лог и запусти снова."
    ok "Контейнеры и образы"
  fi
  if [[ -d /run/systemd/system ]]; then
    systemctl disable --now atrium-backup.timer >/dev/null 2>&1 || true
    systemctl stop atrium-backup.service >/dev/null 2>&1 || true
  fi
  rm -f /etc/systemd/system/atrium-backup.service /etc/systemd/system/atrium-backup.timer
  if [[ -d /run/systemd/system ]]; then
    systemctl daemon-reload >/dev/null 2>&1 || true
    systemctl reset-failed atrium-backup.service >/dev/null 2>&1 || true
  fi
  ok "Ночной бэкап"

  # The log goes with the rest: from here nothing may write it again.
  local log_file=$LOG
  LOG=/dev/null
  rm -rf -- "$ATRIUM_DIR" /root/atrium-backups
  rm -f -- /root/atrium-install.sh "$log_file"
  ok "Файлы и бэкапы"

  # SSH as before: our key-only file goes, and the desktop app's key with it.
  rm -f /etc/ssh/sshd_config.d/00-atrium-key-only.conf
  if [[ -f /root/.ssh/authorized_keys ]]; then sed -i '/[[:space:]]atrium-app[[:space:]]*$/d' /root/.ssh/authorized_keys; fi
  if command -v sshd >/dev/null && sshd -t 2>/dev/null; then
    systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
  fi
  ok "Вход по SSH"
  say
  line "Atrium удалён."
  say
}

# ---------------------------------------------------------------------------------------------- main

usage() {
  cat <<EOF
Atrium $RELEASE_VERSION — установка на этот сервер.
  sh install.sh            мастер установки (повторный запуск — обновление)
  sh install.sh update     обновить без вопросов
  sh install.sh link       ссылка для первой настройки ещё раз (если настройка не закончена)
  sh install.sh restore    вернуть данные из ночной копии (ATRIUM_YES=1 ATRIUM_RESTORE=<копия> — без вопросов)
  sh install.sh uninstall  снять Atrium с сервера: контейнеры, данные, бэкапы (ATRIUM_YES=1 — без вопроса)
  DOMAIN=chat.example.com ATRIUM_YES=1 sh install.sh   без вопросов
EOF
}

# The release to install: this installer's own, or a local/mirrored one given with its checksum.
pick_release() {
  REGISTRY=${ATRIUM_REGISTRY:-$RELEASE_REGISTRY}
  APP_DIGEST=${ATRIUM_APP_DIGEST-$RELEASE_APP_DIGEST}
  CADDY_DIGEST=${ATRIUM_CADDY_DIGEST-$RELEASE_CADDY_DIGEST}
  TARBALL_MIRRORS=()
  if [[ -n ${ATRIUM_TARBALL:-} ]]; then
    [[ -n ${ATRIUM_TARBALL_SHA256:-} ]] || die "ATRIUM_TARBALL без ATRIUM_TARBALL_SHA256"
    TARBALL_SRC=$ATRIUM_TARBALL TARBALL_SHA256=$ATRIUM_TARBALL_SHA256
    RELEASE_VERSION=${ATRIUM_VERSION:-$RELEASE_VERSION}
  else
    [[ -n $RELEASE_SHA256 ]] ||
      die "Это не релизная сборка установщика: возьми его с https://github.com/$RELEASE_REPO/releases/latest/download/install.sh"
    TARBALL_SRC=https://github.com/$RELEASE_REPO/releases/download/v$RELEASE_VERSION/atrium-$RELEASE_VERSION.tar.gz
    TARBALL_SHA256=$RELEASE_SHA256
    # When GitHub can't be reached: the same file from the npm mirror, through two CDNs.
    TARBALL_MIRRORS=(
      "https://cdn.jsdelivr.net/npm/$RELEASE_NPM@$RELEASE_VERSION/atrium-$RELEASE_VERSION.tar.gz"
      "https://unpkg.com/$RELEASE_NPM@$RELEASE_VERSION/atrium-$RELEASE_VERSION.tar.gz"
    )
  fi
}

# No questions: ATRIUM_YES=1, or `update`.
run_quiet() {
  if (( TTY )); then print_logo; else say "Atrium $RELEASE_VERSION"; fi
  [[ -n ${DOMAIN:-} ]] || die "Нужен домен: DOMAIN=chat.example.com ATRIUM_YES=1 sh install.sh"
  DOMAIN=$(normalize_domain "$DOMAIN")
  valid_domain "$DOMAIN" || die "Не похоже на домен: $DOMAIN"
  valid_name "$SERVER_NAME" || die "Имя сервера: до 40 символов, без кавычек, \\, \$ и \`"
  [[ -n ${ATRIUM_SERVER_NAME_SET:-} ]] && NAME_SET=1
  progress run check
  progress sub "Определяем внешний IP"
  SERVER_IP=$(detect_ip)
  add_app_key
  run_checks
  print_checks
  if (( CHECK_FATAL )); then
    progress fail check "$(first_bad_check)"
    die "Сервер не готов."
  fi
  progress "done" check
  # From the desktop app the address is waited for later, right before the start (install_all).
  check_dns
  if (( ! DNS_OK )) && [[ ${ATRIUM_PROGRESS:-} != 1 ]]; then
    say
    warn "DNS ещё не готов:"
    print_dns
  fi
  install_all
  lock_app_key
  screen_done
}

wizard() {
  WIZARD=1
  local step=welcome rc
  while :; do
    rc=0
    case $step in
      welcome)
        screen_welcome || rc=$?
        if (( rc == 2 )); then
          # Update: the wizard's answers are already in .env.
          header 1
          title "Проверка сервера"
          spin "Проверяем сервер" detect_ip_to_file || true
          SERVER_IP=$(cat "$ATRIUM_TMP/ip" 2>/dev/null || true)
          run_checks
          (( CHECK_FATAL )) && { print_checks; die "Сервер не готов."; }
          spin "Проверяем DNS" check_dns_to_file || true
          # shellcheck source=/dev/null
          . "$ATRIUM_TMP/dns"
          step=install
        else
          step=checks
        fi
        ;;
      checks)
        screen_checks || rc=$?
        case $rc in 0) step=domain ;; 3) SERVER_IP='' ;; *) step=welcome ;; esac
        ;;
      domain) if screen_domain; then step=summary; else step=checks; fi ;;
      summary) if screen_summary; then step=install; else step=domain; fi ;;
      install)
        header 4
        title "Установка"
        install_all
        lock_app_key
        screen_done
        return
        ;;
    esac
  done
}

main() {
  case ${1:-} in
    '' | install) MODE=install ;;
    update) MODE=update ;;
    uninstall) MODE=uninstall ;;
    link) MODE="link" ;;
    restore) MODE=restore ;;
    -h | --help | help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
  [[ -n ${SERVER_NAME:-} ]] && ATRIUM_SERVER_NAME_SET=1
  # One installer at a time: two would share the log and both run docker compose. The lock goes with this process
  # (fd 9). No /run to write to means no root, which the server check reports anyway.
  if command -v flock >/dev/null && { exec 9>>"$LOCK"; } 2>/dev/null && ! flock -n 9; then
    # The log is the other run's.
    DIED=1 LOG=/dev/null
    bad "Установщик уже запущен на этом сервере"
    exit 1
  fi
  if ! { : >>"$LOG"; } 2>/dev/null; then LOG=$ATRIUM_TMP/install.log; fi
  chmod 600 "$LOG" 2>/dev/null || true
  log "Atrium installer $RELEASE_VERSION, mode $MODE"
  if [[ $MODE == link ]]; then
    detect_install
    show_link
    return
  fi
  if [[ $MODE == restore ]]; then
    detect_install
    restore_all
    return
  fi
  if [[ $MODE == uninstall ]]; then
    detect_install
    uninstall_all
    return
  fi
  pick_release
  detect_install
  DNS_OK=0 DOCKER_OK=0 SSH_PLAN=none NAME_SET=0

  if [[ $MODE == update ]]; then
    (( EXISTING )) || die "Atrium здесь ещё не стоит: запусти без update"
    DNS_OK=1
    run_quiet
  elif [[ ${ATRIUM_YES:-} == 1 ]]; then
    run_quiet
  elif (( ! TTY )); then
    die "Нет терминала. Без вопросов: DOMAIN=chat.example.com ATRIUM_YES=1 sh install.sh"
  else
    (( TTY )) && printf '  %sГотовим установщик…%s' "$C_DIM" "$C_RESET"
    get_gum || GUM=''
    printf '\r\e[2K'
    wizard
  fi
}

main "$@"
ATRIUM_INSTALLER

command -v bash >/dev/null 2>&1 || { echo "Atrium: нужен bash" >&2; exit 1; }
# The terminal, if there is one: under `curl | sh` our stdin is the script, not the person.
status=0
if (: </dev/tty) 2>/dev/null; then
  bash "$ATRIUM_TMP/install.bash" "$@" </dev/tty || status=$?
else
  bash "$ATRIUM_TMP/install.bash" "$@" </dev/null || status=$?
fi
exit "$status"
