#!/bin/sh
# Gomex installer, for a fresh VPS (Ubuntu or Debian), as root:
#   curl -fsSL https://github.com/networkfreedom/gomex/releases/latest/download/install.sh | sh   # the wizard
#   curl -fsSL …/install.sh | sh -s update                                 # update, no questions
#   curl -fsSL …/install.sh | DOMAIN=chat.example.com GOMEX_YES=1 sh       # no questions at all
# Each installer takes its own release's tarball from that GitHub Release, checked against the SHA-256 pinned
# below. The npm package @gomex.llc/install mirrors both files, so the same works without GitHub:
#   curl -fsSL https://cdn.jsdelivr.net/npm/@gomex.llc/install@latest/install.sh | sh
# Re-running is an update: .env (all the secrets) and the data stay.
# More knobs, all optional: SERVER_NAME, TURN_HOST, GOMEX_DIR (/opt/gomex), GOMEX_NO_GUM=1 (plain prompts),
# GOMEX_FIREWALL=0 and GOMEX_SSH=0 (leave ufw / sshd alone), GOMEX_TARBALL + GOMEX_TARBALL_SHA256 (a local or
# mirrored release), GOMEX_REGISTRY + GOMEX_APP_DIGEST + GOMEX_CADDY_DIGEST (another image registry).
#
# This POSIX part only gets the program below onto bash with the terminal on stdin. Under `curl | sh` stdin is the
# script itself, so no prompt could ever read an answer: the bash program is saved to a temporary file and run
# from there. (It sits in a heredoc so sh never parses it; `deploy/release.sh lint` checks it with shellcheck.)
set -eu
umask 077
GOMEX_TMP=$(mktemp -d "${TMPDIR:-/tmp}/gomex.XXXXXX")
export GOMEX_TMP
trap 'rm -rf "$GOMEX_TMP"' EXIT
# Ctrl+C reaches the bash program too; wait for it to clean up and only then remove the folder.
trap ':' INT TERM HUP
cat > "$GOMEX_TMP/install.bash" <<'GOMEX_INSTALLER'
#!/usr/bin/env bash
# The Gomex installer itself; the POSIX wrapper above starts it. Screens: welcome → server check → domain →
# summary → install → link (the server's name is given in the browser setup). Pretty prompts with gum
# (charmbracelet), fetched for this run only and checked against a pinned SHA-256; without gum or without a
# terminal the same steps run on plain `read` prompts.
set -Eeuo pipefail
shopt -s inherit_errexit 2>/dev/null || true
# "&" in a ${s//x/y} replacement means the match in bash 5.2; the templates must never do that.
shopt -u patsub_replacement 2>/dev/null || true
umask 022

# == The release this installer puts on the server. deploy/release.sh rewrites these lines.
RELEASE_VERSION=0.0.0
RELEASE_SHA256=
RELEASE_REPO=networkfreedom/gomex
# The npm package that mirrors each release's install.sh and tarball (deploy/release.sh publishes it).
RELEASE_NPM=@gomex.llc/install
RELEASE_REGISTRY=ghcr.io/networkfreedom
RELEASE_APP_DIGEST=
RELEASE_CADDY_DIGEST=

# == gum, for this run only.
GUM_VERSION=0.17.0
GUM_SHA256_x86_64=69ee169bd6387331928864e94d47ed01ef649fbfe875baed1bbf27b5377a6fdb
GUM_SHA256_arm64=b0b9ed95cbf7c8b7073f17b9591811f5c001e33c7cfd066ca83ce8a07c576f9c

ACCENT_HEX='#ff3b3b'
# Neutral names for the TURN relay's subdomain: "turn." is an easy thing to find and block, and a random pick
# keeps installs from sharing that fingerprint.
TURN_NAMES=(media static cdn files assets img edge content res storage dl s3)

GOMEX_TMP=${GOMEX_TMP:-$(mktemp -d "${TMPDIR:-/tmp}/gomex.XXXXXX")}
LOG=/var/log/gomex-install.log
LOCK=/run/gomex-install.lock
GUM=
BG_PID=

# ---------------------------------------------------------------------------------------------- terminal

TTY=0
[[ -t 0 && -t 1 ]] && TTY=1
C_ACCENT='' C_BOLD='' C_DIM='' C_GREEN='' C_YELLOW='' C_RED='' C_RESET=''
if (( TTY )) && [[ -z ${NO_COLOR:-} && ${TERM:-dumb} != dumb ]]; then
  if [[ ${COLORTERM:-} == *truecolor* || ${COLORTERM:-} == *24bit* ]]; then
    C_ACCENT=$'\e[38;2;255;59;59m'
  else
    C_ACCENT=$'\e[38;5;203m'
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
  [[ $GOMEX_TMP == */gomex.* ]] && rm -rf -- "$GOMEX_TMP"
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
    DEBIAN_FRONTEND=noninteractive apt-get update -q
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
  tmp=$(mktemp "$file.XXXXXX")
  K=$2 V=$3 awk 'index($0, ENVIRON["K"] "=") == 1 { if (!done) print ENVIRON["K"] "=" ENVIRON["V"]; done = 1; next }
    { print } END { if (!done) print ENVIRON["K"] "=" ENVIRON["V"] }' "$file" >"$tmp"
  chmod 600 "$tmp"
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
  GOMEX_DIR=${GOMEX_DIR:-/opt/gomex}
  ENV_FILE=$GOMEX_DIR/deploy/.env
  EXISTING=0
  if [[ -f $ENV_FILE ]]; then
    EXISTING=1
    OLD_DOMAIN=$(env_get "$ENV_FILE" DOMAIN)
    OLD_VERSION=$(env_get "$ENV_FILE" GOMEX_VERSION)
    DOMAIN=${DOMAIN:-$OLD_DOMAIN}
    SERVER_NAME=${SERVER_NAME:-$(env_get "$ENV_FILE" SERVER_NAME)}
    TURN_HOST=${TURN_HOST:-$(env_get "$ENV_FILE" TURN_HOST)}
    # Installs from before TURN_HOST existed keep their turn.DOMAIN: its DNS record is already there.
    TURN_HOST=${TURN_HOST:-turn}
  fi
  SERVER_NAME=${SERVER_NAME:-Gomex}
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
# Cloudflare's proxy ("orange cloud") ranges: calls can't go through it, and it's throttled in Russia.
cloudflare_ip() {
  [[ $1 =~ ^(104\.(1[6-9]|2[0-9]|3[01])|172\.(6[4-9]|7[01])|188\.114\.(9[6-9]|10[0-9]|11[01])|162\.158|141\.101|108\.162|190\.93|198\.41|173\.245|103\.2[1-2]|103\.31)\. ]]
}

check_add() {
  CHECK_LINES+=("$1|$2")
  [[ $1 == bad ]] && CHECK_FATAL=1
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
    check_add ok "Порты 80 и 443: уже Gomex"
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
  if [[ ${GOMEX_SSH:-1} == 0 ]]; then
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

# DNS_ROWS: "host|now" per name that must point here; DNS_OK=1 when all do.
check_dns() {
  local host got status want_ips
  want_ips="${SERVER_IP:-} $(local_ips)"
  DNS_ROWS=() DNS_OK=1
  for host in "$DOMAIN" "app.$DOMAIN" "$TURN_HOST.$DOMAIN"; do
    got=$(resolve4 "$host")
    got=${got% }
    if [[ -z $got ]]; then
      status="${C_RED}✗${C_RESET} нет записи"
      DNS_OK=0
    elif [[ -n ${SERVER_IP:-} && " $want_ips " == *" ${got%% *} "* && $got != *" "* ]]; then
      status="${C_GREEN}✓${C_RESET}"
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
  (( TTY )) && [[ ${GOMEX_NO_GUM:-} != 1 && ${TERM:-dumb} != dumb ]] || return 1
  local arch sum name
  case $(uname -m) in
    x86_64 | amd64) arch=x86_64 sum=$GUM_SHA256_x86_64 ;;
    aarch64 | arm64) arch=arm64 sum=$GUM_SHA256_arm64 ;;
    *) return 1 ;;
  esac
  name=gum_${GUM_VERSION}_Linux_$arch
  fetch "https://github.com/charmbracelet/gum/releases/download/v$GUM_VERSION/$name.tar.gz" "$GOMEX_TMP/gum.tgz" 30 || return 1
  sha256_ok "$GOMEX_TMP/gum.tgz" "$sum" || { log "gum: SHA-256 mismatch"; return 1; }
  tar -xzf "$GOMEX_TMP/gum.tgz" -C "$GOMEX_TMP" "$name/gum" 2>/dev/null || return 1
  "$GOMEX_TMP/$name/gum" --version >/dev/null 2>&1 || return 1
  GUM=$GOMEX_TMP/$name/gum
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

# The ANSI-art logo, 58 columns, in the basic 16 colours (red and bright red, a light background at the top for
# the highlight, red below), so it looks the same in every colour terminal. Printed with printf %b, which turns
# each \033 into an escape.
LOGO_ANSI=$(cat <<'EOF'
    \033[0;37m▄▄\033[0;91;47m░░░░\033[0;37m▄▄▄\033[0m     \033[0;37m▄▄▄▄▄\033[0m  \033[0;91;47m░░\033[0;37m▄▄\033[0m     \033[0;37m▐\033[0;91;47m░\033[0;37m▄\033[0m   \033[0;91;47m░░░░\033[0;37m▄▄▄\033[0;91;47m░░\033[0;37m▄\033[0m    \033[0;37m▄\033[0;91;47m░░\033[0;37m▀
  \033[0;37m▄\033[0;91;47m▒▒▒▒▒▒▒▒▒▒\033[0;37m▀\033[0m  \033[0;37m▄\033[0;91;47m▒▒▒▒▒▒▒\033[0;91m▄\033[0;37m▐\033[0;91;47m▒▒▒▒\033[0m    \033[0;91;47m▒▒▒▒\033[0m  \033[0;91;47m▒▒▒▒▒▒▒\033[0m \033[0;91;47m▒▒\033[0;37m▌\033[0m  \033[0;37m▐\033[0;91;47m▒▒\033[0;37m▌\033[0m
 \033[0;91m▐\033[0;91;47m▓▓▓▓\033[0;91m▀\033[0m  \033[0;91m▀\033[0;91;47m▓\033[0;91m▀\033[0m   \033[0;91;47m▓▓▓\033[0;91m▀\033[0m   \033[0;91m▀\033[0;91;47m▓▓\033[0m \033[0;91;47m▓▓▓▓▓\033[0m  \033[0;91m▐\033[0;91;47m▓▓▓▓\033[0;91m▌\033[0m \033[0;91;47m▓▓\033[0m \033[0;91m▀▀\033[0;91;47m▓▓\033[0m \033[0;91m▐\033[0;91;47m▓▓\033[0m \033[0;91m▄\033[0;91;47m▓▓\033[0;91m▀\033[0m
 \033[0;91m████\033[0m         \033[0;91m▐█\033[0;91;41m█\033[0m      \033[0;91m▐\033[0;91;41m█\033[0m \033[0;91m▐\033[0;91;41m████\033[0;91m▌▄██▌█\033[0;91;41m██\033[0;91m▐\033[0;91;41m███\033[0;91m▄\033[0m  \033[0;91m▄\033[0m  \033[0;91m▀\033[0;91;41m█\033[0;91m███▀\033[0m
\033[0;91m▐\033[0;91;41m▓▓▓\033[0;91m▌\033[0m \033[0;91m▄\033[0;91;41m▓▓▓▓▓\033[0;91m▄\033[0m \033[0;91m▐\033[0;91;41m▓\033[0;91m▌\033[0m      \033[0;91;41m▓▓\033[0m \033[0;91;41m▓▓▓\033[0;91m▀\033[0;91;41m▓▓▓▓\033[0;91m▀\033[0m \033[0;91;41m▓▓\033[0;91m▌\033[0m \033[0;91;41m▓▓\033[0;91m▀\033[0m \033[0;91m▄\033[0;91;41m▓▓\033[0m  \033[0;91;41m▓▓▓\033[0;91m▀\033[0;91;41m▓▓\033[0;91m▄\033[0m
\033[0;91m▐\033[0;91;41m▒▒▒▒\033[0;31m▄▀▀▀▀\033[0;91;41m▒▒▒\033[0;31m▌\033[0m \033[0;91;41m▒▒\033[0;31m▄\033[0m   \033[0;31m▄\033[0;91;41m▒▒\033[0m \033[0;31m▐\033[0;91;41m▒▒▒\033[0m \033[0;31m▐\033[0;91;41m▒\033[0;31m▀\033[0m  \033[0;31m▐\033[0;91;41m▒▒\033[0m  \033[0;91;41m▒▒\033[0;31m▄\033[0;91;41m▒▒\033[0;31m▀\033[0m  \033[0;31m▐\033[0;91;41m▒▒\033[0;31m▌\033[0m \033[0;91;41m▒▒▒\033[0;31m▌\033[0m
 \033[0;91;41m░░░░░░░░░░░░\033[0m   \033[0;31m▀\033[0;91;41m░░░░░\033[0;31m▀\033[0m   \033[0;31m▀\033[0;91;41m░░\033[0m     \033[0;31m▐\033[0;91;41m░░\033[0;31m▌\033[0m  \033[0;91;41m░░░\033[0;31m▀\033[0m    \033[0;31m█\033[0;91;41m░░\033[0m  \033[0;31m▐\033[0;91;41m░░\033[0;31m█\033[0m
  \033[0;31m▀\033[0;91;41m        \033[0;31m▀\033[0m                \033[0;31m▀\033[0m     \033[0;31m▀█▀\033[0m   \033[0;31m█▀\033[0m      \033[0;31m▀\033[0;91;41m \033[0;31m▀\033[0m   \033[0;31m▀\033[0;91;41m  \033[0;31m▀
EOF
)

# One colour, for NO_COLOR: the ANSI one is shading and backgrounds, a smudge without colour.
LOGO=$(cat <<'EOF'
   ▄██████▄
 ▄██▀    ▀██▄                                                 ™
 ██▀       ▀   ▄██▀▀▀██▄  ████████▄████▄   ▄██▀▀█▄   ██▄  ██▀
 ██    ██████  ██     ██  ███   ██▀   ██  ██▀    ██   ▀████▀
 ██▄      ███  ██     ██  ███   ██    ██  ███▀▀▀▀▀▀    ███▄
 ▀██▄▄   ▄███  ██▄   ▄██  ███   ██    ██  ▀██   ▄██  ▄██▀▀██
   ▀▀████▀ ▀▀   ▀▀████▀   ▀█▀   ██    ██   ▀▀████▀  ██▀   ▀██
EOF
)

print_logo() {
  say
  if [[ -n $C_RESET ]] && (( COLS >= 60 )); then
    while IFS= read -r l; do printf ' %b\e[0m\n' "$l"; done <<<"$LOGO_ANSI"
  elif (( COLS >= 66 )); then
    while IFS= read -r l; do say " ${C_ACCENT}${l}${C_RESET}"; done <<<"$LOGO"
  else
    line "${C_ACCENT}${C_BOLD}G O M E X${C_RESET}"
  fi
  say
}

STEPS=(Проверка Домен Итог Установка)
# header N: the brand line and where we are, N = 1..4.
header() {
  local i out=''
  clear_screen
  say
  line "${C_ACCENT}${C_BOLD}Gomex${C_RESET} ${C_DIM}$RELEASE_VERSION${C_RESET}"
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
  dim "Gomex $RELEASE_VERSION · установка на этот сервер"
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
    SERVER_IP=$(cat "$GOMEX_TMP/ip" 2>/dev/null || true)
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
detect_ip_to_file() { detect_ip >"$GOMEX_TMP/ip"; }

screen_domain() {
  local err=''
  while :; do
    header 2
    title "Домен"
    dim "Адрес, по которому друзья откроют Gomex. Например: chat.example.com"
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
    . "$GOMEX_TMP/dns"
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
check_dns_to_file() { check_dns; declare -p DNS_ROWS DNS_OK | sed 's/^declare /declare -g /' >"$GOMEX_TMP/dns"; }

plan_lines() {
  if (( DOCKER_OK )); then ok "Docker уже есть"; else bullet "Docker"; fi
  if [[ ${GOMEX_FIREWALL:-1} != 0 ]]; then bullet "Файрвол: 22, 80, 443, 7881, 50000–60000"; fi
  case $SSH_PLAN in
    keys) bullet "SSH только по ключу" ;;
    nokey) warn "SSH: пароль остаётся, ключа нет" ;;
  esac
  [[ -d /run/systemd/system ]] && bullet "Ночные бэкапы"
  bullet "Gomex $RELEASE_VERSION в $GOMEX_DIR"
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

step_docker() {
  command -v curl >/dev/null || apt_install curl ca-certificates
  if ! command -v docker >/dev/null; then
    fetch https://get.docker.com "$GOMEX_TMP/get-docker.sh" 60
    # Without systemd it starts dockerd itself, which must not inherit the lock (main) and hold it for good.
    sh "$GOMEX_TMP/get-docker.sh" 9>&-
  fi
  systemctl enable --now docker 2>/dev/null || true
  docker compose version >/dev/null 2>&1 || apt_install docker-compose-plugin || apt_install docker-compose-v2
  docker compose version
}

# Web, TURN over TLS and UDP on 443, LiveKit's TCP fallback and media ports;
# SSH rate-limited ("limit": the 6th new connection within 30 s is refused) on whatever port sshd listens on.
step_firewall() {
  command -v ufw >/dev/null || apt_install ufw
  ufw default deny incoming
  ufw default allow outgoing
  local rule port ports
  for rule in 80/tcp 443/tcp 443/udp 7881/tcp 50000:60000/udp; do ufw allow "$rule"; done
  mkdir -p /run/sshd
  ports=$(sshd -T 2>/dev/null | awk '$1 == "port" { print $2 }' || true)
  for port in ${ports:-22}; do
    ufw limit "$port/tcp"
    ufw delete allow "$port/tcp" >/dev/null 2>&1 || true
    ufw delete allow "$port" >/dev/null 2>&1 || true
  done
  ufw delete allow OpenSSH >/dev/null 2>&1 || true
  ufw --force enable
}

# Key-only login. Only reached when authorized_keys holds a key (run_checks), so nobody gets locked out.
# Its own file in sshd_config.d: no other file's settings get overwritten.
step_ssh() {
  local conf=/etc/ssh/sshd_config.d/00-gomex-key-only.conf
  mkdir -p /run/sshd
  printf '%s\n' '# Written by the Gomex installer: log in with an SSH key only.' \
    'PasswordAuthentication no' 'KbdInteractiveAuthentication no' 'PermitRootLogin prohibit-password' >"$conf"
  if ! sshd -t; then
    rm -f "$conf"
    return 1
  fi
  systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
}

step_files() {
  local tgz=$GOMEX_TMP/gomex.tar.gz stage=$GOMEX_TMP/release f src got=0
  if [[ -f $TARBALL_SRC ]]; then
    cp "$TARBALL_SRC" "$tgz"
    sha256_ok "$tgz" "$TARBALL_SHA256" && got=1
  else
    # The first source that gives the pinned bytes; a mirror can't slip anything else in.
    for src in "$TARBALL_SRC" ${TARBALL_MIRRORS[@]+"${TARBALL_MIRRORS[@]}"}; do
      echo "Tarball from $src"
      if fetch "$src" "$tgz" 300 && sha256_ok "$tgz" "$TARBALL_SHA256"; then got=1; break; fi
      echo "Not usable: $src"
    done
  fi
  (( got )) || { echo "No source gave the release's tarball with SHA-256 $TARBALL_SHA256"; return 1; }
  mkdir -p "$stage"
  tar -xzf "$tgz" -C "$stage" --strip-components=1 --no-same-owner
  for f in deploy/docker-compose.yml deploy/Caddyfile deploy/backup.sh deploy/livekit.yaml.tmpl; do
    [[ -f $stage/$f ]] || { echo "Release has no $f"; return 1; }
  done
  mkdir -p "$GOMEX_DIR/deploy" "$GOMEX_DIR/landing"
  # Caddy reads the Caddyfile once: an update that changes it needs Caddy recreated (step_up).
  if [[ -f $GOMEX_DIR/deploy/Caddyfile ]] && ! cmp -s "$stage/deploy/Caddyfile" "$GOMEX_DIR/deploy/Caddyfile"; then
    touch "$GOMEX_TMP/caddyfile-changed"
  fi
  install -m 644 "$stage/deploy/docker-compose.yml" "$stage/deploy/Caddyfile" "$stage/deploy/livekit.yaml.tmpl" "$GOMEX_DIR/deploy/"
  install -m 755 "$stage/deploy/backup.sh" "$GOMEX_DIR/deploy/"
  return 0
}

# replace_dir SRC DIR: DIR ends up with exactly SRC's files, so none a release drops linger. DIR itself stays: Caddy's
# bind mount holds on to that folder, and a new one renamed in at the same path would stay invisible to it.
replace_dir() {
  mkdir -p "$2"
  find "$2" -mindepth 1 -delete
  cp -R "$1/." "$2/"
  chmod -R a+rX "$2"
}

# A random CSS class name.
css_name() {
  local letters=abcdefghijklmnopqrstuvwxyz r
  r=$(rand 6)
  printf '%s%s' "${letters:RANDOM % 26:1}" "${r,,}"
}

# landing_colors HUE DARK: "bg fg line accent ink" (#rrggbb each) for a dark (1) or light (0) page in that hue.
# ink is black or white, whichever reads better on the accent.
landing_colors() {
  awk -v h="$1" -v dark="$2" '
    function mn(a, b) { return a < b ? a : b }
    function mx(a, b) { return a > b ? a : b }
    function ch(n, s, l,   k) { k = (n + h / 30) % 12; return l - s * mn(l, 1 - l) * mx(-1, mn(mn(k - 3, 9 - k), 1)) }
    function hex(s, l) {
      R = ch(0, s / 100, l / 100); G = ch(8, s / 100, l / 100); B = ch(4, s / 100, l / 100)
      return sprintf("#%02x%02x%02x", R * 255 + .5, G * 255 + .5, B * 255 + .5)
    }
    function lin(c) { return c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ^ 2.4 }
    BEGIN {
      if (dark) { bg = hex(18, 7); fg = hex(20, 94); line = hex(14, 20); accent = hex(70, 62) }
      else { bg = hex(35, 96); fg = hex(30, 12); line = hex(20, 84); accent = hex(75, 40) }
      y = .2126 * lin(R) + .7152 * lin(G) + .0722 * lin(B)
      print bg, fg, line, accent, ((y + .05) / .05 > 1.05 / (y + .05) ? "#000000" : "#ffffff")
    }'
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

# write_landing SEED: a seed install's cover page, the server's name and a way into the app. It shares nothing with
# other installs (no Gomex brand, no common files, no scripts): one HTML file whose colours, layout, type, wording
# and icon come from SEED (LANDING_SEED in .env, so an update keeps the look) and class names that are random.
write_landing() {
  local n=$1 hue dark layout font weight track radius label shape name
  local bg fg line accent ink icon w t b layout_css dir=$GOMEX_TMP/landing
  hue=$((n % 360)) n=$((n / 360))
  dark=$((n % 2)) n=$((n / 2))
  layout=$((n % 3)) n=$((n / 3))
  font=$((n % 4)) n=$((n / 4))
  radius=$((n % 3)) n=$((n / 3))
  label=$((n % 3)) n=$((n / 3))
  shape=$((n % 3))
  read -r bg fg line accent ink < <(landing_colors "$hue" "$dark")
  [[ $ink == '#'* ]] || return 1

  case $font in
    0) font='system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' weight=700 track=-0.03em ;;
    1) font='Georgia, "Times New Roman", serif' weight=400 track=-0.01em ;;
    2) font='"Helvetica Neue", Helvetica, Arial, sans-serif' weight=800 track=-0.04em ;;
    *) font='ui-monospace, "SF Mono", Menlo, Consolas, monospace' weight=500 track=0 ;;
  esac
  case $radius in 0) radius=999px ;; 1) radius=12px ;; *) radius=3px ;; esac
  case $label in 0) label=Войти ;; 1) label=Открыть ;; *) label=Вход ;; esac
  icon="fill='%23${accent#\#}'"
  case $shape in
    0) icon="%3Ccircle cx='8' cy='8' r='8' $icon/%3E" ;;
    1) icon="%3Crect width='16' height='16' rx='4' $icon/%3E" ;;
    *) icon="%3Cpath d='M8 0 16 8 8 16 0 8z' $icon/%3E" ;;
  esac

  # The name people gave the server in the browser setup; the domain while it's still the default one.
  name=$(app_server_name)
  [[ -n $name && ${name,,} != gomex ]] || name=$DOMAIN
  name=${name//&/&amp;} name=${name//</&lt;} name=${name//>/&gt;} name=${name//\"/&quot;} name=${name//\'/&#39;}

  w=$(css_name) t=$(css_name) b=$(css_name)
  case $layout in
    0) layout_css="body { align-items: center; justify-content: center; padding: 24px; }
.$w { text-align: center; }
.$t { font-size: clamp(40px, 10vw, 104px); }
.$b { margin-top: 36px; }" ;;
    1) layout_css="body { align-items: flex-end; padding: max(24px, 6vw); }
.$w { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 24px 40px; }
.$t { font-size: clamp(44px, 12vw, 144px); }" ;;
    *) layout_css="body { align-items: center; justify-content: center; padding: 16px; }
.$w { width: 100%; max-width: 400px; padding: 40px 32px; border: 1px solid $line; border-radius: 20px; }
.$t { font-size: 32px; }
.$b { display: block; margin-top: 28px; text-align: center; }" ;;
  esac

  rm -rf "$dir"
  mkdir -p "$dir"
  cat >"$dir/index.html" <<EOF
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="$bg">
<title>$name</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E$icon%3C/svg%3E">
<style>
* { box-sizing: border-box; }
html, body { margin: 0; }
body { display: flex; min-height: 100vh; min-height: 100dvh; background: $bg; color: $fg; font-family: $font; -webkit-font-smoothing: antialiased; }
.$t { margin: 0; font-weight: $weight; letter-spacing: $track; line-height: 1.05; overflow-wrap: anywhere; }
.$b { display: inline-block; padding: 14px 28px; border-radius: $radius; background: $accent; color: $ink; font: 600 17px/1.2 system-ui, sans-serif; text-decoration: none; }
.$b:hover { opacity: 0.88; }
.$b:focus-visible { outline: 2px solid $fg; outline-offset: 3px; }
$layout_css
</style>
</head>
<body>
<main class="$w">
<h1 class="$t">$name</h1>
<a class="$b" href="https://app.$DOMAIN">$label</a>
</main>
</body>
</html>
EOF
  replace_dir "$dir" "$GOMEX_DIR/landing/site"
}

step_config() {
  cd "$GOMEX_DIR/deploy"
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
    )
  fi
  chmod 600 .env
  env_set .env DOMAIN "$DOMAIN"
  env_set .env TURN_HOST "$TURN_HOST"
  [[ ${NAME_SET:-0} == 1 ]] && env_set .env SERVER_NAME "'$SERVER_NAME'"
  # Which images run: this release's, pinned by digest.
  env_set .env GOMEX_REGISTRY "$REGISTRY"
  env_set .env GOMEX_VERSION "$RELEASE_VERSION"
  env_set .env GOMEX_APP_DIGEST "$APP_DIGEST"
  env_set .env GOMEX_CADDY_DIGEST "$CADDY_DIGEST"

  # LiveKit's config comes from .env, so its keys always match the app's.
  local s key
  s=$(<livekit.yaml.tmpl)
  for key in DOMAIN TURN_HOST LIVEKIT_API_KEY LIVEKIT_API_SECRET; do
    s=${s//"{{$key}}"/$(env_get .env "$key")}
  done
  [[ $s != *'{{'* ]] || { echo "livekit.yaml.tmpl: unknown placeholder"; return 1; }
  if [[ -f livekit.yaml ]] && [[ $(<livekit.yaml) != "$s" ]]; then touch "$GOMEX_TMP/livekit-changed"; fi
  (umask 077 && printf '%s\n' "$s" >livekit.yaml)

  mkdir -p data caddy-data caddy-config
  # The app runs as uid 10001 in its container; only it may touch the data.
  chown -R 10001:10001 data
  chmod 700 data

  # The cover page's look; step_up writes the page.
  if [[ ! $(env_get .env LANDING_SEED) =~ ^[0-9]{1,10}$ ]]; then
    env_set .env LANDING_SEED "$(((RANDOM << 15) | RANDOM))"
  fi
}

# Nightly backup at 04:30 server time, a systemd timer (a fresh server may have no cron). Log: journalctl -u gomex-backup
step_backups() {
  cat >/etc/systemd/system/gomex-backup.service <<EOF
[Unit]
Description=Gomex nightly backup

[Service]
Type=oneshot
ExecStart=$GOMEX_DIR/deploy/backup.sh
EOF
  cat >/etc/systemd/system/gomex-backup.timer <<'EOF'
[Unit]
Description=Gomex nightly backup at 04:30

[Timer]
OnCalendar=*-*-* 04:30:00
Persistent=true

[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable --now gomex-backup.timer
}

step_pull() {
  cd "$GOMEX_DIR/deploy"
  docker compose pull --quiet
}

step_up() {
  cd "$GOMEX_DIR/deploy"
  docker compose up -d --remove-orphans
  # Bind-mounted single files: an update swaps in new files the running containers never see.
  [[ -f $GOMEX_TMP/caddyfile-changed ]] && docker compose up -d --force-recreate --no-deps caddy
  # Restarting LiveKit drops calls in progress, so only when its config changed.
  [[ -f $GOMEX_TMP/livekit-changed ]] && docker compose up -d --force-recreate --no-deps livekit
  local i
  for i in $(seq 1 90); do
    curl -fsS --max-time 3 -o /dev/null http://127.0.0.1:8000/api/setup && break
    (( i == 90 )) && { docker compose ps; docker compose logs --tail 30 app; return 1; }
    sleep 1
  done
  # Once the app answers: the cover page carries the name it has.
  write_landing "$(env_get .env LANDING_SEED)"
  # Images of earlier releases.
  docker image prune -f
}

step_https() {
  local i
  for i in $(seq 1 30); do
    curl -fsS --max-time 5 -o /dev/null --resolve "app.$DOMAIN:443:127.0.0.1" "https://app.$DOMAIN/api/setup" && return 0
    sleep 3
  done
  return 1
}

# run TITLE FUNCTION [soft]: one line per step, ✓ with the time it took or ✗ with the log's tail.
run() {
  local title=$1 fn=$2 soft=${3:-} start rc=0 took=''
  log "== $title"
  start=$SECONDS
  if (( TTY )); then
    spin "$title" "$fn" || rc=$?
  else
    line "… $title"
    "$fn" >>"$LOG" 2>&1 || rc=$?
  fi
  (( SECONDS - start >= 3 )) && took=" ${C_DIM}$((SECONDS - start)) с${C_RESET}"
  if (( rc == 0 )); then
    ok "$title$took"
    return 0
  fi
  if [[ -n $soft ]]; then
    warn "$soft"
    return 1
  fi
  bad "$title"
  say
  tail -n 12 "$LOG" | sed "s/^/    ${C_DIM}/; s/\$/${C_RESET}/"
  die "Не получилось. Исправь и запусти установку снова — данные не пропадут."
}

install_all() {
  [[ -n ${WIZARD:-} ]] || say
  if (( DOCKER_OK )); then ok "Docker уже есть"; else run "Docker" step_docker; fi
  if [[ ${GOMEX_FIREWALL:-1} != 0 ]]; then run "Файрвол" step_firewall; fi
  case $SSH_PLAN in
    keys) run "SSH только по ключу" step_ssh ;;
    nokey) warn "SSH: пароль остаётся, ключа нет" ;;
    noinclude) warn "SSH: не трогаем, старый sshd без sshd_config.d" ;;
  esac
  run "Файлы Gomex $RELEASE_VERSION" step_files
  run "Настройки и ключи" step_config
  if [[ -d /run/systemd/system ]]; then run "Ночные бэкапы" step_backups; fi
  run "Скачиваем образы" step_pull
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
    next="Gomex $RELEASE_VERSION работает."
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
  if (( ! DNS_OK )); then
    dim "Ссылка заработает, когда DNS обновится: сертификаты придут сами."
  elif (( ! ${HTTPS_OK:-0} )); then
    dim "Сертификат ещё получается: подожди пару минут."
  fi
  say
}

# ---------------------------------------------------------------------------------------------- main

usage() {
  cat <<EOF
Gomex $RELEASE_VERSION — установка на этот сервер.
  sh install.sh            мастер установки (повторный запуск — обновление)
  sh install.sh update     обновить без вопросов
  DOMAIN=chat.example.com GOMEX_YES=1 sh install.sh   без вопросов
EOF
}

# The release to install: this installer's own, or a local/mirrored one given with its checksum.
pick_release() {
  REGISTRY=${GOMEX_REGISTRY:-$RELEASE_REGISTRY}
  APP_DIGEST=${GOMEX_APP_DIGEST-$RELEASE_APP_DIGEST}
  CADDY_DIGEST=${GOMEX_CADDY_DIGEST-$RELEASE_CADDY_DIGEST}
  TARBALL_MIRRORS=()
  if [[ -n ${GOMEX_TARBALL:-} ]]; then
    [[ -n ${GOMEX_TARBALL_SHA256:-} ]] || die "GOMEX_TARBALL без GOMEX_TARBALL_SHA256"
    TARBALL_SRC=$GOMEX_TARBALL TARBALL_SHA256=$GOMEX_TARBALL_SHA256
    RELEASE_VERSION=${GOMEX_VERSION:-$RELEASE_VERSION}
  else
    [[ -n $RELEASE_SHA256 ]] ||
      die "Это не релизная сборка установщика: возьми его с https://github.com/$RELEASE_REPO/releases/latest/download/install.sh"
    TARBALL_SRC=https://github.com/$RELEASE_REPO/releases/download/v$RELEASE_VERSION/gomex-$RELEASE_VERSION.tar.gz
    TARBALL_SHA256=$RELEASE_SHA256
    # When GitHub can't be reached: the same file from the npm mirror, through two CDNs.
    TARBALL_MIRRORS=(
      "https://cdn.jsdelivr.net/npm/$RELEASE_NPM@$RELEASE_VERSION/gomex-$RELEASE_VERSION.tar.gz"
      "https://unpkg.com/$RELEASE_NPM@$RELEASE_VERSION/gomex-$RELEASE_VERSION.tar.gz"
    )
  fi
}

# No questions: GOMEX_YES=1, or `update`.
run_quiet() {
  if (( TTY )); then print_logo; else say "Gomex $RELEASE_VERSION"; fi
  [[ -n ${DOMAIN:-} ]] || die "Нужен домен: DOMAIN=chat.example.com GOMEX_YES=1 sh install.sh"
  DOMAIN=$(normalize_domain "$DOMAIN")
  valid_domain "$DOMAIN" || die "Не похоже на домен: $DOMAIN"
  valid_name "$SERVER_NAME" || die "Имя сервера: до 40 символов, без кавычек, \\, \$ и \`"
  [[ -n ${GOMEX_SERVER_NAME_SET:-} ]] && NAME_SET=1
  SERVER_IP=$(detect_ip)
  run_checks
  print_checks
  (( CHECK_FATAL )) && die "Сервер не готов."
  check_dns
  if (( ! DNS_OK )); then
    say
    warn "DNS ещё не готов:"
    print_dns
  fi
  install_all
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
          SERVER_IP=$(cat "$GOMEX_TMP/ip" 2>/dev/null || true)
          run_checks
          (( CHECK_FATAL )) && { print_checks; die "Сервер не готов."; }
          spin "Проверяем DNS" check_dns_to_file || true
          # shellcheck source=/dev/null
          . "$GOMEX_TMP/dns"
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
    -h | --help | help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
  [[ -n ${SERVER_NAME:-} ]] && GOMEX_SERVER_NAME_SET=1
  # One installer at a time: two would share the log and both run docker compose. The lock goes with this process
  # (fd 9). No /run to write to means no root, which the server check reports anyway.
  if command -v flock >/dev/null && { exec 9>>"$LOCK"; } 2>/dev/null && ! flock -n 9; then
    # The log is the other run's.
    DIED=1 LOG=/dev/null
    bad "Установщик уже запущен на этом сервере"
    exit 1
  fi
  if ! { : >>"$LOG"; } 2>/dev/null; then LOG=$GOMEX_TMP/install.log; fi
  chmod 600 "$LOG" 2>/dev/null || true
  log "Gomex installer $RELEASE_VERSION, mode $MODE"
  pick_release
  detect_install
  DNS_OK=0 DOCKER_OK=0 SSH_PLAN=none NAME_SET=0

  if [[ $MODE == update ]]; then
    (( EXISTING )) || die "Gomex здесь ещё не стоит: запусти без update"
    DNS_OK=1
    run_quiet
  elif [[ ${GOMEX_YES:-} == 1 ]]; then
    run_quiet
  elif (( ! TTY )); then
    die "Нет терминала. Без вопросов: DOMAIN=chat.example.com GOMEX_YES=1 sh install.sh"
  else
    (( TTY )) && printf '  %sГотовим установщик…%s' "$C_DIM" "$C_RESET"
    get_gum || GUM=''
    printf '\r\e[2K'
    wizard
  fi
}

main "$@"
GOMEX_INSTALLER

command -v bash >/dev/null 2>&1 || { echo "Gomex: нужен bash" >&2; exit 1; }
# The terminal, if there is one: under `curl | sh` our stdin is the script, not the person.
status=0
if (: </dev/tty) 2>/dev/null; then
  bash "$GOMEX_TMP/install.bash" "$@" </dev/tty || status=$?
else
  bash "$GOMEX_TMP/install.bash" "$@" </dev/null || status=$?
fi
exit "$status"
