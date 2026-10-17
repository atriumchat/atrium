#!/usr/bin/env bash
# Publishes a server release, run on the Mac from a committed checkout:
#   deploy/release.sh 1.0.0     tag v1.0.0 → GitHub builds and pushes both images (.github/workflows/images.yml),
#                               then the tarball install.sh unpacks and install.sh pinned to it and to the image
#                               digests, both published as the assets of the GitHub Release v1.0.0. Installs take
#                               releases/latest/download/install.sh.
#                               The same two files go to npm as @gomex.llc/install@1.0.0 (the name is RELEASE_NPM in
#                               install.sh), a mirror for when GitHub can't be reached: jsDelivr and unpkg serve it, no
#                               server runs Node.
#   deploy/release.sh lint      bash -n and shellcheck on every deploy script, install.sh's bash part included
# Re-running a version that's already tagged picks up where it stopped. A version with a suffix (1.0.0-rc.1) is a
# pre-release: "latest" stays on the last full release. Needs git with "origin" on GitHub, gh and npm (both logged
# in; GOMEX_SKIP_NPM=1 releases without the npm mirror), curl and either shellcheck or Docker to run it.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INSTALLER=deploy/install.sh
# What a server gets besides the images: exactly what install.sh unpacks.
FILES=(deploy/docker-compose.yml deploy/Caddyfile deploy/backup.sh deploy/livekit.yaml.tmpl)
# What the images are built from: a release must not leave any of it uncommitted.
SOURCES=(Dockerfile .dockerignore server web deploy/caddy .github/workflows/images.yml "${FILES[@]}")
cd "$ROOT"

say() { printf '== %s\n' "$*"; }
die() { printf '%s\n' "$*" >&2; exit 1; }

# Runs shellcheck, or its Docker image when it isn't installed (paths relative to the repo, stdin passed through).
shellcheck_() {
  if command -v shellcheck >/dev/null; then
    shellcheck "$@"
  else
    docker run --rm -i -v "$ROOT:/mnt:ro" -w /mnt koalaman/shellcheck:stable "$@"
  fi
}
# install.sh's bash program sits in a heredoc, which shellcheck can't see into: check it on its own.
installer_body() {
  awk '/^cat > "\$GOMEX_TMP\/install.bash" <<.GOMEX_INSTALLER.$/ { f = 1; next } /^GOMEX_INSTALLER$/ { f = 0 } f' "$INSTALLER"
}
lint_installer() {
  sh -n "$INSTALLER"
  installer_body | bash -n
  shellcheck_ -s sh "$INSTALLER"
  installer_body | shellcheck_ -s bash -
}
lint_all() {
  local f failed=0
  for f in deploy/*.sh; do
    [[ $f == "$INSTALLER" ]] && continue
    bash -n "$f" || failed=1
    shellcheck_ "$f" || failed=1
  done
  lint_installer || failed=1
  (( failed == 0 )) && echo "All deploy scripts clean."
  return "$failed"
}

if [[ ${1:-} == lint ]]; then
  lint_all
  exit
fi

version=${1:-}
[[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]] || die "usage: deploy/release.sh 1.2.3   (or: deploy/release.sh lint)"
tag=v$version

# The npm mirror's package name lives in install.sh, which falls back to it. npm must be logged in before anything
# is tagged, so a release never stops half-way for it.
npm_package=$(sed -n 's/^RELEASE_NPM=//p' "$INSTALLER")
[[ -n $npm_package ]] || die "$INSTALLER: no RELEASE_NPM= line"
if [[ ${GOMEX_SKIP_NPM:-} != 1 ]]; then
  npm whoami >/dev/null 2>&1 || die "npm isn't logged in: npm login (or GOMEX_SKIP_NPM=1 to release without the npm mirror)."
fi

# == The GitHub repository (origin) gets the release; the images live in ghcr.io/<its owner>, lower case like the
# workflow writes it.
origin=$(git remote get-url origin 2>/dev/null) || die "No git remote \"origin\": the images are built on GitHub."
repo=$(sed -nE 's#^(https://|ssh://)?(git@)?github\.com[:/]([^/]+/[^/]+)/?$#\3#p' <<<"$origin")
repo=${repo%.git}
[[ $repo == */* ]] || die "origin is not on GitHub: $origin"
owner=$(tr '[:upper:]' '[:lower:]' <<<"${repo%%/*}")
registry=ghcr.io/$owner

# == The tag: the images and the tarball both come from it, so they're the same code.
if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
  say "$tag already exists ($(git rev-parse --short "$tag^{commit}")): continuing that release"
else
  dirty=$(git status --porcelain -- "${SOURCES[@]}")
  [[ -z $dirty ]] || die "Uncommitted changes that would miss the release:"$'\n'"$dirty"
  lint_installer || die "install.sh doesn't pass the checks above."
  say "Tagging $tag on $(git rev-parse --short HEAD)"
  git tag -a "$tag" -m "Gomex $version"
fi
git push origin "refs/tags/$tag"

# == Images: wait for the workflow run of this tag.
say "Waiting for the images (GitHub Actions)"
run_id=''
for _ in $(seq 1 30); do
  run_id=$(gh run list -R "$repo" --workflow images.yml --event push --json databaseId,headBranch \
    --jq ".[] | select(.headBranch == \"$tag\") | .databaseId" 2>/dev/null | head -n1) || true
  [[ -n $run_id ]] && break
  sleep 5
done
[[ -n $run_id ]] || die "No images run for $tag on GitHub. Is .github/workflows/images.yml pushed?"
gh run watch "$run_id" -R "$repo" --exit-status --interval 20 || die "The images run failed: gh run view $run_id -R $repo --log-failed"

# The digests as an anonymous client sees them: exactly what a fresh server will pull. A private package fails here.
digest_of() {
  local image=$1 token
  # Either request fails (401) while the package is private: no digest, and the message below says what to do.
  token=$(curl -fsS "https://ghcr.io/token?scope=repository:$owner/$image:pull" 2>/dev/null |
    sed -n 's/.*"token":"\([^"]*\)".*/\1/p') || true
  curl -fsSI -H "Authorization: Bearer $token" \
    -H 'Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json' \
    "https://ghcr.io/v2/$owner/$image/manifests/$version" 2>/dev/null |
    tr -d '\r' | sed -n 's/^[Dd]ocker-[Cc]ontent-[Dd]igest: //p' || true
}
app_digest=$(digest_of gomex-app)
caddy_digest=$(digest_of gomex-caddy)
if [[ ! $app_digest =~ ^sha256:[0-9a-f]{64}$ || ! $caddy_digest =~ ^sha256:[0-9a-f]{64}$ ]]; then
  # Package settings live under /orgs/ for an organization, /users/ for a person.
  kind=users
  [[ $(gh api "users/$owner" --jq .type 2>/dev/null) == Organization ]] && kind=orgs
  die "Servers can't pull the images anonymously. Make both packages public, once:
  https://github.com/$kind/$owner/packages/container/gomex-app/settings
  https://github.com/$kind/$owner/packages/container/gomex-caddy/settings
then run deploy/release.sh $version again."
fi
say "gomex-app@$app_digest"
say "gomex-caddy@$caddy_digest"

# == The tarball, straight from the tag (git archive: no stray local files, same bytes every time). deploy/downloads
# is only where the release's two files are put together (git ignores it).
out=$ROOT/deploy/downloads
mkdir -p "$out"
tarball=gomex-$version.tar.gz
git archive --format=tar.gz --prefix="gomex-$version/" -o "$out/$tarball" "$tag" -- "${FILES[@]}"
sha=$(shasum -a 256 "$out/$tarball" | awk '{print $1}')
say "$tarball $sha"

# == install.sh, pinned to all of it.
set_const() {
  local name=$1 value=$2 tmp
  [[ $(grep -c "^$name=" "$INSTALLER") == 1 ]] || die "$INSTALLER: expected one $name= line"
  tmp=$(mktemp)
  sed "s#^$name=.*#$name=$value#" "$INSTALLER" >"$tmp"
  cat "$tmp" >"$INSTALLER"
  rm -f "$tmp"
}
set_const RELEASE_VERSION "$version"
set_const RELEASE_SHA256 "$sha"
set_const RELEASE_REPO "$repo"
set_const RELEASE_REGISTRY "$registry"
set_const RELEASE_APP_DIGEST "$app_digest"
set_const RELEASE_CADDY_DIGEST "$caddy_digest"
lint_installer || die "install.sh doesn't pass the checks above."
cp "$INSTALLER" "$out/install.sh"
installer_sha=$(shasum -a 256 "$out/install.sh" | awk '{print $1}')

# == The GitHub Release: both files as its assets, their checksums and the image digests in its notes.
assets=https://github.com/$repo/releases/download/$tag
latest=https://github.com/$repo/releases/latest/download
prerelease=false
install_url=$latest/install.sh
if [[ $version == *-* ]]; then
  prerelease=true
  install_url=$assets/install.sh
fi
fence='```'
notes=$(cat <<EOF
Установка на свежий VPS (Ubuntu или Debian, root):

${fence}sh
curl -fsSL $install_url | sh
${fence}

Обновление:

${fence}sh
curl -fsSL $install_url | sh -s update
${fence}

SHA-256:

${fence}
$sha  $tarball
$installer_sha  install.sh
${fence}

Образы:

${fence}
$registry/gomex-app@$app_digest
$registry/gomex-caddy@$caddy_digest
${fence}
EOF
)
if gh release view "$tag" -R "$repo" >/dev/null 2>&1; then
  say "Updating the GitHub Release $tag"
  gh release upload "$tag" -R "$repo" --clobber "$out/$tarball" "$out/install.sh"
  gh release edit "$tag" -R "$repo" --title "Gomex $version" --notes "$notes" --prerelease="$prerelease" --draft=false >/dev/null
else
  say "Publishing the GitHub Release $tag"
  # gh keeps it a draft until both files are up: install.sh never points at a tarball that isn't there yet.
  gh release create "$tag" -R "$repo" --verify-tag --title "Gomex $version" --notes "$notes" \
    --prerelease="$prerelease" "$out/$tarball" "$out/install.sh" >/dev/null
fi

# == What the world now downloads.
[[ $(curl -fsSL "$assets/$tarball" | shasum -a 256 | awk '{print $1}') == "$sha" ]] || die "$assets/$tarball doesn't match"
curl -fsSL "$assets/install.sh" | cmp -s - "$INSTALLER" || die "$assets/install.sh doesn't match"
if [[ $prerelease == false ]]; then
  # "latest" can take a moment to move on to the new release.
  for i in $(seq 1 12); do
    curl -fsSL "$latest/install.sh" 2>/dev/null | cmp -s - "$INSTALLER" && break
    (( i < 12 )) || die "$latest/install.sh is not this release's install.sh"
    sleep 5
  done
fi

# == The npm mirror: the same two files as the npm package RELEASE_NPM names, at this version, which jsDelivr and
# unpkg serve. install.sh falls back to it when GitHub can't be reached, and checks the same SHA-256 there.
npm_cdn=https://cdn.jsdelivr.net/npm/$npm_package@$version
if [[ ${GOMEX_SKIP_NPM:-} == 1 ]]; then
  say "Skipping the npm mirror (GOMEX_SKIP_NPM=1)"
else
  if npm view "$npm_package@$version" version >/dev/null 2>&1; then
    say "npm already has $npm_package@$version"
  else
    pkg=$(mktemp -d)
    cp "$out/$tarball" "$out/install.sh" "$pkg/"
    cat >"$pkg/package.json" <<EOF
{
  "name": "$npm_package",
  "version": "$version",
  "description": "Gomex release files, not a Node package: curl -fsSL https://cdn.jsdelivr.net/npm/$npm_package@latest/install.sh | sh",
  "homepage": "https://github.com/$repo",
  "repository": { "type": "git", "url": "git+https://github.com/$repo.git" },
  "license": "UNLICENSED",
  "files": ["install.sh", "$tarball"]
}
EOF
    cat >"$pkg/README.md" <<EOF
# Gomex $version

Зеркало релиза Gomex: установщик и архив, который он распаковывает. Это не пакет для Node.

Установка на свежий VPS (Ubuntu или Debian, root):

${fence}sh
curl -fsSL https://cdn.jsdelivr.net/npm/$npm_package@$version/install.sh | sh
${fence}

Основной адрес и исходники: https://github.com/$repo
EOF
    # A pre-release mustn't become npm's "latest" either.
    npm_tag=latest
    [[ $prerelease == true ]] && npm_tag=next
    say "Publishing $npm_package@$version to npm (it may ask for your 2FA code)"
    (cd "$pkg" && npm publish --access public --tag "$npm_tag")
    rm -rf "$pkg"
  fi
  # npm takes a few minutes to make a new version public. jsDelivr remembers a "not found" for 10 minutes, so it's
  # asked only once npm has the version, and its cached answers are dropped (purge) before each try.
  for i in $(seq 1 60); do
    [[ $(npm view "$npm_package@$version" version 2>/dev/null) == "$version" ]] && break
    (( i < 60 )) || die "npm doesn't show $npm_package@$version yet: check it, then run deploy/release.sh $version again"
    sleep 10
  done
  for i in $(seq 1 12); do
    for path in "$npm_package@$version/$tarball" "$npm_package@$version/install.sh" "$npm_package@latest/install.sh"; do
      curl -fsS "https://purge.jsdelivr.net/npm/$path" >/dev/null 2>&1 || true
    done
    if [[ $(curl -fsSL "$npm_cdn/$tarball" 2>/dev/null | shasum -a 256 | awk '{print $1}') == "$sha" ]] &&
      curl -fsSL "$npm_cdn/install.sh" 2>/dev/null | cmp -s - "$INSTALLER"; then
      break
    fi
    (( i < 12 )) || die "$npm_cdn doesn't serve this release yet: check it, then run deploy/release.sh $version again"
    sleep 5
  done
fi

# The repo's install.sh is what's published.
git diff --quiet -- "$INSTALLER" || git commit -q -m "install.sh: Gomex $version" -- "$INSTALLER"
say "Published Gomex $version: curl -fsSL $install_url | sh"
[[ ${GOMEX_SKIP_NPM:-} == 1 ]] || say "Mirror: curl -fsSL $npm_cdn/install.sh | sh"
say "Push the commit when ready: git push origin HEAD"
