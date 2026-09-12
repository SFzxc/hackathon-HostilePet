#!/usr/bin/env bash
#
# Build HostilePet and copy the packaged .app into /Applications (or --target DIR).
#
#   bash scripts/install-app.sh                  # build, install to /Applications, .env inside the bundle
#   bash scripts/install-app.sh --env beside     # key stays at /Applications/.env instead
#   bash scripts/install-app.sh --no-build       # install the bundle already in release/
#   bash scripts/install-app.sh --open           # launch it when the copy is done
#
# Why the .env needs a decision at all: a bundle launched from Finder inherits no shell
# environment, so the app reads the file itself at startup (src/main/env-file.ts, ADR 0010).
# Candidates, in precedence order — the first file to define a variable wins:
#
#   1. <app>/Contents/.env            dev layout only; never written by this script
#   2. four hops above the executable /Applications/.env when installed there  (--env beside)
#   3. <app>/Contents/Resources/.env  inside the bundle                        (--env bundled)
#
# Editing a bundle after electron-builder signed it breaks the resource seal
# (`codesign --verify` → "a sealed resource is missing or invalid"), so --env bundled re-signs
# ad-hoc once the file is in place. That keeps the seal valid; the build is still unsigned and
# unnotarized, and the key is a secret inside a bundle — do not hand the .app to anyone.

set -euo pipefail

ORIGINAL_ARGS=("$@")          # echoed back in the "rerun with sudo" hint

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"          # apps/desktop — the pnpm workspace
APP_PKG_DIR="$DESKTOP_ROOT/apps/desktop"              # the Electron package
ENV_FILE="$DESKTOP_ROOT/.env"                         # apps/desktop/.env, git-ignored

APP_NAME="HostilePet"
TARGET_DIR="/Applications"
ENV_MODE="bundled"      # bundled | beside | keychain | none
DO_BUILD=1
DO_OPEN=0

say()  { printf '\033[1;34m›\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'
  cat <<'EOF'

Options:
  --env MODE     bundled (default)  copy apps/desktop/.env to <app>/Contents/Resources/.env and re-sign
                 beside             copy it next to the bundle (/Applications/.env) — hot-editable, no re-sign
                 keychain           copy nothing; the app falls back to the hostilepet.openai Keychain item
                 none               copy nothing; the pet simply has no model and stays silent
  --target DIR   install into DIR instead of /Applications
  --no-build     skip `pnpm package` and install the bundle already under release/
  --open         launch the installed app when done
  -h, --help     this text
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --env)       [ $# -ge 2 ] || die "--env needs a value"; ENV_MODE="$2"; shift 2 ;;
    --env=*)     ENV_MODE="${1#*=}"; shift ;;
    --target)    [ $# -ge 2 ] || die "--target needs a value"; TARGET_DIR="$2"; shift 2 ;;
    --target=*)  TARGET_DIR="${1#*=}"; shift ;;
    --no-build)  DO_BUILD=0; shift ;;
    --open)      DO_OPEN=1; shift ;;
    --)          shift ;;   # `pnpm install:mac -- --env beside` hands the separator through; ignore it
    -h|--help)   usage; exit 0 ;;
    *)           usage >&2; die "unknown argument: $1" ;;
  esac
done

case "$ENV_MODE" in
  bundled|beside|keychain|none) ;;
  *) die "--env must be one of: bundled, beside, keychain, none (got '$ENV_MODE')" ;;
esac

TARGET_APP="$TARGET_DIR/$APP_NAME.app"
RESOURCES_ENV="$TARGET_APP/Contents/Resources/.env"
BESIDE_ENV="$TARGET_DIR/.env"

command -v pnpm >/dev/null 2>&1 || die "pnpm not on PATH"
[ -d "$APP_PKG_DIR" ] || die "missing package directory: $APP_PKG_DIR"
[ -d "$TARGET_DIR" ] || die "target directory does not exist: $TARGET_DIR"

NEEDS_ENV=0
if [ "$ENV_MODE" = "bundled" ] || [ "$ENV_MODE" = "beside" ]; then NEEDS_ENV=1; fi
if [ "$NEEDS_ENV" = "1" ]; then
  [ -f "$ENV_FILE" ] || die "no $ENV_FILE — create it (HOSTILEPET_PROVIDER=openai, HOSTILEPET_OPENAI_API_KEY=…),
    put the key in the Keychain instead and use --env keychain, or use --env none for a silent pet"
fi

# ---------------------------------------------------------------- build
if [ "$DO_BUILD" = "1" ]; then
  say "building: pnpm package (electron-vite build + electron-builder --mac --dir)"
  ( cd "$DESKTOP_ROOT" && pnpm package )
  ok "build finished"
else
  say "skipping the build (--no-build)"
fi

# The output directory is mac-arm64 on Apple Silicon, mac on Intel; take the newest match so a
# stale directory from another architecture cannot win.
SRC_APP=""
for candidate in "$APP_PKG_DIR"/release/mac*/"$APP_NAME.app"; do
  [ -d "$candidate" ] || continue
  if [ -z "$SRC_APP" ] || [ "$candidate" -nt "$SRC_APP" ]; then SRC_APP="$candidate"; fi
done
[ -n "$SRC_APP" ] || die "no packaged app under $APP_PKG_DIR/release/mac*/ — run without --no-build first"
say "bundle: $SRC_APP"

# ---------------------------------------------------------------- stop the running copy
# Matched by full path, so an unrelated build running from release/ is left alone.
if pgrep -f "$TARGET_APP/Contents/MacOS/$APP_NAME" >/dev/null 2>&1; then
  say "quitting the running $APP_NAME"
  osascript -e "quit app \"$APP_NAME\"" >/dev/null 2>&1 || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    pgrep -f "$TARGET_APP/Contents/MacOS/$APP_NAME" >/dev/null 2>&1 || break
    sleep 0.5
  done
  pkill -f "$TARGET_APP/Contents/MacOS/$APP_NAME" >/dev/null 2>&1 || true
  sleep 0.5
  ok "stopped"
else
  say "no running copy at $TARGET_APP"
fi

# ---------------------------------------------------------------- copy
if [ -e "$TARGET_APP" ]; then
  say "replacing $TARGET_APP"
  rm -rf "$TARGET_APP" 2>/dev/null || die "cannot remove $TARGET_APP — rerun with: sudo bash scripts/install-app.sh ${ORIGINAL_ARGS[*]:-}"
fi
# ditto, not cp -R: it keeps the symlinks inside Contents/Frameworks and the embedded signatures.
ditto "$SRC_APP" "$TARGET_APP" || die "ditto failed — rerun with: sudo bash scripts/install-app.sh ${ORIGINAL_ARGS[*]:-}"
ok "copied to $TARGET_APP"

# ---------------------------------------------------------------- .env placement
case "$ENV_MODE" in
  bundled)
    cp "$ENV_FILE" "$RESOURCES_ENV"
    if [ -f "$BESIDE_ENV" ]; then
      warn "$BESIDE_ENV exists and is read BEFORE the bundled copy — remove it or use --env beside to keep one source"
    fi
    IDENT="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$TARGET_APP/Contents/Info.plist" 2>/dev/null || echo 'dev.hostilepet.desktop')"
    say "re-signing ad-hoc (the injected file broke the seal)"
    codesign --force --sign - --identifier "$IDENT" "$TARGET_APP" >/dev/null 2>&1 || die "codesign failed"
    ok "env bundled at Contents/Resources/.env, signature resealed"
    ;;
  beside)
    cp "$ENV_FILE" "$BESIDE_ENV"
    [ -f "$RESOURCES_ENV" ] && warn "a bundled $RESOURCES_ENV also exists; $BESIDE_ENV still wins"
    ok "env beside the bundle at $BESIDE_ENV (edit it and relaunch — no rebuild)"
    ;;
  keychain)
    [ -f "$BESIDE_ENV" ] && warn "$BESIDE_ENV exists and shadows the Keychain — remove it to use hostilepet.openai"
    say "no .env copied; the app falls back to the Keychain item hostilepet.openai"
    ;;
  none)
    say "no .env copied and no Keychain fallback expected: the pet will show a face and say nothing (ADR 0011)"
    ;;
esac

# A locally built app carries no quarantine flag; strip it anyway when the bundle was downloaded.
xattr -dr com.apple.quarantine "$TARGET_APP" >/dev/null 2>&1 || true

# ---------------------------------------------------------------- report
VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$TARGET_APP/Contents/Info.plist" 2>/dev/null || echo '?')"
ARCH="$(lipo -archs "$TARGET_APP/Contents/MacOS/$APP_NAME" 2>/dev/null || echo '?')"
printf '\n'
ok "installed $APP_NAME $VERSION ($ARCH) at $TARGET_APP"
if codesign --verify "$TARGET_APP" >/dev/null 2>&1; then
  ok "code signature: valid on disk (ad-hoc, not notarized)"
else
  warn "code signature: INVALID — app still launches locally, but the seal is broken"
fi
case "$ENV_MODE" in
  bundled) say "model key: $TARGET_APP/Contents/Resources/.env  (rebuild required after editing it)" ;;
  beside)  say "model key: $BESIDE_ENV  (relaunch picks up edits)" ;;
  keychain) say "model key: login Keychain, service hostilepet.openai" ;;
  none)    say "model key: none — the pet has no words" ;;
esac

if [ "$DO_OPEN" = "1" ]; then
  say "launching"
  open "$TARGET_APP"
fi
