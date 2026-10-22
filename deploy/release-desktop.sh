#!/usr/bin/env bash
# Builds the desktop app (Mac with Apple Silicon, Mac with Intel, Windows) and publishes it in this project's GitHub
# Releases, run on a Mac from a committed, pushed checkout:
#   deploy/release-desktop.sh
# Raise "version" in desktop/package.json first — apps only update to a higher version.
#   desktop-vX.Y.Z   this version's installers under versioned names; update.json points at them, so a file never
#                    changes under an app that's downloading it.
#   desktop          always the newest: the fixed names the app's download buttons use (/download/Atrium-windows.exe
#                    on every server goes there) and update.json, which installed apps check every few hours.
# Both are pre-releases, so GitHub's "latest" stays on the server release that install.sh comes from.
#
# Updates are signed (Ed25519). The private key stays on this Mac, outside the repo:
#   ${ATRIUM_UPDATE_KEY:-~/.atrium/seed-update-signing-key.pem}
# Its public half, desktop/update-key.pem, is committed and built into the app, which installs nothing the key
# didn't sign — so neither a server, a "new server address" nor GitHub can push code to installed apps.
# Needs node, gh (logged in) and git with "origin" on GitHub.
set -euo pipefail
SIGNING_KEY=${ATRIUM_UPDATE_KEY:-$HOME/.atrium/seed-update-signing-key.pem}
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# The server a fresh install opens (main.js). Empty by default: the app asks for the address on first start.
DEFAULT_URL=${ATRIUM_DEFAULT_URL-}
cd "$ROOT"

say() { printf '== %s\n' "$*"; }
die() { printf '%s\n' "$*" >&2; exit 1; }

origin=$(git remote get-url origin 2>/dev/null) || die "No git remote \"origin\": the builds go to its GitHub Releases."
repo=$(sed -nE 's#^(https://|ssh://)?(git@)?github\.com[:/]([^/]+/[^/]+)/?$#\3#p' <<<"$origin")
repo=${repo%.git}
[[ $repo == */* ]] || die "origin is not on GitHub: $origin"
channel=desktop
manifest_url=https://github.com/$repo/releases/download/$channel/update.json

cd "$ROOT/desktop"
version=$(node -p "require('./package.json').version")
dist="$ROOT/desktop/dist"
PUBLIC_KEY="$ROOT/desktop/update-key.pem"
[[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "Version must look like 1.2.3, not \"$version\""
vtag=desktop-v$version

# == Signing key: made once, then checked against the public key the app is built with.
if [[ ! -f "$SIGNING_KEY" ]]; then
  if [[ -f "$PUBLIC_KEY" ]]; then
    echo "No signing key at $SIGNING_KEY, but desktop/update-key.pem exists." >&2
    echo "Restore the key from your backup. (A new key means apps already installed can't be updated —" >&2
    echo "only if that's accepted: delete desktop/update-key.pem and run again.)" >&2
    exit 1
  fi
  mkdir -p "$(dirname "$SIGNING_KEY")"
  chmod 700 "$(dirname "$SIGNING_KEY")"
  # Node rather than `openssl genpkey`: macOS's own /usr/bin/openssl is LibreSSL, which may lack Ed25519.
  # The result is the same PKCS#8 PEM file.
  (umask 077 && node -e '
    const crypto = require("node:crypto");
    const { privateKey } = crypto.generateKeyPairSync("ed25519");
    require("node:fs").writeFileSync(process.argv[1], privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600, flag: "wx" });
  ' "$SIGNING_KEY")
  chmod 600 "$SIGNING_KEY"
  cat >&2 <<EOF

!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
!!  New update signing key: $SIGNING_KEY
!!  BACK IT UP NOW (password manager / encrypted drive), and never put it in the repo or on a server.
!!  Lose it and every installed Atrium stops accepting updates — users would have to reinstall by hand.
!!  Commit and push desktop/update-key.pem (the public half), then run this again.
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

EOF
fi
# Writes desktop/update-key.pem if it's missing; aborts if it's there but belongs to another key.
# shellcheck disable=SC2016  # JavaScript, not shell: its template strings stay as they are
node -e '
  const crypto = require("node:crypto");
  const fs = require("node:fs");
  const [signingKey, publicFile] = process.argv.slice(1);
  const derived = crypto.createPublicKey(crypto.createPrivateKey(fs.readFileSync(signingKey, "utf8")));
  if (derived.asymmetricKeyType !== "ed25519") throw new Error(`${signingKey} is not an Ed25519 key`);
  const pem = derived.export({ type: "spki", format: "pem" });
  if (!fs.existsSync(publicFile)) {
    fs.writeFileSync(publicFile, pem);
    console.log(`Wrote ${publicFile}`);
  } else if (!crypto.createPublicKey(fs.readFileSync(publicFile, "utf8")).export({ type: "spki", format: "der" })
      .equals(derived.export({ type: "spki", format: "der" }))) {
    console.error(`${publicFile} does not match ${signingKey}: wrong key? Not releasing.`);
    process.exit(1);
  }
' "$SIGNING_KEY" "$PUBLIC_KEY"

# == The release is built from a commit that's on GitHub: its tags point there.
dirty=$(git -C "$ROOT" status --porcelain -- desktop deploy/release-desktop.sh)
[[ -z $dirty ]] || die "Commit and push these first, the release is built from a commit:"$'\n'"$dirty"
commit=$(git -C "$ROOT" rev-parse HEAD)
gh api "repos/$repo/commits/$commit" --silent 2>/dev/null || die "$commit isn't on GitHub yet: git push origin HEAD"

say "Building Atrium $version"
rm -rf "$dist"
META=(-c.extraMetadata.atriumDefaultUrl="$DEFAULT_URL" -c.extraMetadata.atriumUpdateUrl="$manifest_url")
npx electron-builder --mac dmg --arm64 "${META[@]}"
npx electron-builder --mac dmg --x64 "${META[@]}"
npx electron-builder --win nsis --x64 "${META[@]}"

# platform-arch key | built file | versioned name (desktop-vX.Y.Z) | fixed name (desktop).
builds=(
  "darwin-arm64|$dist/Atrium-$version-arm64.dmg|Atrium-$version-mac-apple-silicon.dmg|Atrium-mac-apple-silicon.dmg"
  "darwin-x64|$dist/Atrium-$version.dmg|Atrium-$version-mac-intel.dmg|Atrium-mac-intel.dmg"
  "win32-x64|$dist/Atrium Setup $version.exe|Atrium-$version-windows.exe|Atrium-windows.exe"
)
# The files as GitHub gets them: an asset is named after its file.
versioned="$dist/release/$vtag"
fixed="$dist/release/$channel"
mkdir -p "$versioned" "$fixed"
manifest_builds=()
for build in "${builds[@]}"; do
  IFS='|' read -r key file name fixed_name <<<"$build"
  [[ -f $file ]] || die "electron-builder made no $file"
  ln -f "$file" "$versioned/$name"
  ln -f "$file" "$fixed/$fixed_name"
  manifest_builds+=("$key|$versioned/$name|https://github.com/$repo/releases/download/$vtag/$name")
done

# The manifest, signed. `signed` holds the manifest as a string and `signature` signs that string's exact UTF-8
# bytes, so nothing depends on how JSON is re-serialised.
node -e '
  const fs = require("node:fs");
  const crypto = require("node:crypto");
  const [version, out, signingKey, publicFile, ...builds] = process.argv.slice(1);
  const files = {};
  for (const build of builds) {
    const [key, file, url] = build.split("|");
    const sha256 = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    files[key] = { url, sha256, size: fs.statSync(file).size };
  }
  const signed = JSON.stringify({ version, files });
  const signature = crypto.sign(null, Buffer.from(signed, "utf8"), crypto.createPrivateKey(fs.readFileSync(signingKey, "utf8")));
  // The same check the app makes, against the key it was built with.
  if (!crypto.verify(null, Buffer.from(signed, "utf8"), crypto.createPublicKey(fs.readFileSync(publicFile, "utf8")), signature)) {
    throw new Error("Signature does not verify with desktop/update-key.pem");
  }
  fs.writeFileSync(out, JSON.stringify({ signed, signature: signature.toString("base64") }, null, 2) + "\n");
' "$version" "$fixed/update.json" "$SIGNING_KEY" "$PUBLIC_KEY" "${manifest_builds[@]}"

sums=$(cd "$versioned" && shasum -a 256 ./* | sed 's# \./# #')
fence='```'
notes="Atrium для компьютера $version.

SHA-256:

${fence}
$sums
${fence}"

# == This version's release. gh keeps a new one a draft until every file is up.
if gh release view "$vtag" -R "$repo" >/dev/null 2>&1; then
  say "Updating the release $vtag"
  gh release upload "$vtag" -R "$repo" --clobber "$versioned"/*
  gh release edit "$vtag" -R "$repo" --title "Atrium для компьютера $version" --notes "$notes" \
    --prerelease --latest=false --draft=false >/dev/null
else
  say "Publishing the release $vtag"
  gh release create "$vtag" -R "$repo" --target "$commit" --title "Atrium для компьютера $version" --notes "$notes" \
    --prerelease --latest=false "$versioned"/* >/dev/null
fi

# == The release "desktop": the fixed names and update.json, swapped in one at a time and update.json last, so no
# app hears about the version before its files are up.
channel_notes="Atrium для компьютера: последняя версия, сейчас $version ($vtag). Установленные приложения обновляются сами."
if ! gh release view "$channel" -R "$repo" >/dev/null 2>&1; then
  say "Publishing the release $channel"
  gh release create "$channel" -R "$repo" --target "$commit" --title "Atrium для компьютера" --notes "$channel_notes" \
    --prerelease --latest=false "$fixed"/Atrium-* "$fixed/update.json" >/dev/null
else
  say "Updating the release $channel"
  release_id=$(gh api "repos/$repo/releases/tags/$channel" --jq .id)
  asset_id() {
    gh api "repos/$repo/releases/$release_id/assets" --paginate --jq ".[] | select(.name == \"$1\") | .id"
  }
  # The new file goes up under a temporary name; then the old one is deleted and the new one renamed, so the
  # fixed name is missing for a moment at most, never for the length of an upload.
  swap_asset() {
    local file=$1 name next old new
    name=$(basename "$file")
    next="$dist/release/next/$name.next"
    mkdir -p "$dist/release/next"
    ln -f "$file" "$next"
    gh release upload "$channel" -R "$repo" --clobber "$next"
    old=$(asset_id "$name")
    new=$(asset_id "$name.next")
    [[ -n $new ]] || die "GitHub has no $name.next after the upload"
    if [[ -n $old ]]; then gh api -X DELETE "repos/$repo/releases/assets/$old" --silent; fi
    gh api -X PATCH "repos/$repo/releases/assets/$new" -f name="$name" --silent
  }
  for file in "$fixed"/Atrium-*; do swap_asset "$file"; done
  swap_asset "$fixed/update.json"
  gh release edit "$channel" -R "$repo" --notes "$channel_notes" --prerelease --latest=false --draft=false >/dev/null
fi

# == What installed apps and download buttons now get.
for i in $(seq 1 12); do
  curl -fsSL "$manifest_url" 2>/dev/null | cmp -s - "$fixed/update.json" && break
  (( i < 12 )) || die "$manifest_url is not this release's update.json"
  sleep 5
done
for build in "${builds[@]}"; do
  IFS='|' read -r _ _ name fixed_name <<<"$build"
  for url in "https://github.com/$repo/releases/download/$vtag/$name" "https://github.com/$repo/releases/download/$channel/$fixed_name"; do
    size=$(curl -fsSIL "$url" | tr -d '\r' | awk 'tolower($1) == "content-length:" { n = $2 } END { print n }')
    [[ $size == "$(stat -f %z "$versioned/$name")" ]] || die "$url: $size bytes, not this build's"
  done
done

say "Published Atrium $version"
node -e 'const m = require(process.argv[1]); console.log(JSON.stringify(JSON.parse(m.signed), null, 2))' "$fixed/update.json"
