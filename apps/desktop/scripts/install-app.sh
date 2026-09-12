#!/usr/bin/env bash
#
# Build HostilePet and copy the packaged .app into /Applications (or --target DIR).
#
#   bash scripts/install-app.sh                    # build, install, .env read from apps/desktop/.env
#   bash scripts/install-app.sh --key openai       # paste the model key, then build and install
#   bash scripts/install-app.sh --key elevenlabs   # paste the voice key
#   bash scripts/install-app.sh --key all          # paste both, one after the other
#   bash scripts/install-app.sh --env beside       # key lives at /Applications/.env instead
#   bash scripts/install-app.sh --no-build --open  # reinstall what is already built, then launch
#
# Keys are typed at a prompt, never passed as an argument: an argument lands in the shell
# history, and this file is a secret. The script writes them to apps/desktop/.env (mode 600)
# and never prints them back — only a masked prefix and a length, so you can tell two keys
# apart without either of them reaching a log.
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
ENV_TEMPLATE="$DESKTOP_ROOT/.env.example"             # documented template, copied when absent

APP_NAME="HostilePet"
TARGET_DIR="/Applications"
ENV_MODE="bundled"      # bundled | beside | keychain | none
KEY_TARGETS=""          # "" | openai | elevenlabs | all
DO_BUILD=1
DO_OPEN=0
KEYS_ONLY=0

say()  { printf '\033[1;34m›\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Build HostilePet and copy the packaged .app into /Applications (or --target DIR).

  bash scripts/install-app.sh                    build, install, .env read from apps/desktop/.env
  bash scripts/install-app.sh --key openai        paste the model key, then build and install
  bash scripts/install-app.sh --key elevenlabs    paste the voice key
  bash scripts/install-app.sh --key all           paste both, one after the other
  bash scripts/install-app.sh --env beside        key lives at /Applications/.env instead
  bash scripts/install-app.sh --no-build --open   reinstall what is already built, then launch

Options:
  --key WHICH    openai      paste HOSTILEPET_OPENAI_API_KEY; also sets HOSTILEPET_PROVIDER=openai
                 elevenlabs  paste ELEVENLAB_API_KEY, the voice key the pet speaks with
                 all         both, in that order; Enter at a prompt keeps the value already set
                 Values are read with echo off and never passed on the command line.
  --env MODE     bundled (default)  copy the env file to <app>/Contents/Resources/.env and re-sign
                 beside             copy it next to the bundle (/Applications/.env) — hot-editable
                 keychain           copy nothing; the model key comes from the Keychain instead
                 none               copy nothing; the pet has no model and stays silent (ADR 0011)
  --env-file F   read and write keys in F instead of apps/desktop/.env
  --keys-only    write the keys and stop — for `pnpm dev`, no build and no install
  --target DIR   install into DIR instead of /Applications
  --no-build     skip `pnpm package` and install the bundle already under release/
  --open         launch the installed app when done
  -h, --help     this text
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --key)        [ $# -ge 2 ] || die "--key needs a value: openai, elevenlabs or all"; KEY_TARGETS="$2"; shift 2 ;;
    --key=*)      KEY_TARGETS="${1#*=}"; shift ;;
    --env)        [ $# -ge 2 ] || die "--env needs a value"; ENV_MODE="$2"; shift 2 ;;
    --env=*)      ENV_MODE="${1#*=}"; shift ;;
    --env-file)   [ $# -ge 2 ] || die "--env-file needs a path"; ENV_FILE="$2"; shift 2 ;;
    --env-file=*) ENV_FILE="${1#*=}"; shift ;;
    --target)     [ $# -ge 2 ] || die "--target needs a value"; TARGET_DIR="$2"; shift 2 ;;
    --target=*)   TARGET_DIR="${1#*=}"; shift ;;
    --no-build)   DO_BUILD=0; shift ;;
    --keys-only)  KEYS_ONLY=1; shift ;;
    --open)       DO_OPEN=1; shift ;;
    --)           shift ;;   # `pnpm install:mac -- --env beside` hands the separator through; ignore it
    -h|--help)    usage; exit 0 ;;
    *)            usage >&2; die "unknown argument: $1" ;;
  esac
done

case "$ENV_MODE" in
  bundled|beside|keychain|none) ;;
  *) die "--env must be one of: bundled, beside, keychain, none (got '$ENV_MODE')" ;;
esac
case "$KEY_TARGETS" in
  ""|openai|elevenlabs|all) ;;
  *) die "--key must be one of: openai, elevenlabs, all (got '$KEY_TARGETS')" ;;
esac

TARGET_APP="$TARGET_DIR/$APP_NAME.app"
RESOURCES_ENV="$TARGET_APP/Contents/Resources/.env"
BESIDE_ENV="$TARGET_DIR/.env"

command -v pnpm >/dev/null 2>&1 || die "pnpm not on PATH"
[ -d "$APP_PKG_DIR" ] || die "missing package directory: $APP_PKG_DIR"
[ -d "$TARGET_DIR" ] || die "target directory does not exist: $TARGET_DIR"
[ -w "$TARGET_DIR" ] || warn "$TARGET_DIR is not writable — run the install with sudo"

# ---------------------------------------------------------------- .env helpers
# Every one of these keeps the value out of stdout: secrets reach the file, never the terminal.

env_value() {   # $1 file, $2 name → the value of the last active assignment, empty when unset
  [ -f "$1" ] || return 0
  { grep -E "^$2=" "$1" || true; } | tail -1 | cut -d= -f2-
}

has_var() {     # $1 file, $2 name → 0 when the variable is set to something non-empty
  [ -f "$1" ] || return 1
  grep -qE "^$2=." "$1"
}

mask_key() {    # $1 value → "sk-… (164 chars)"; enough to tell two keys apart, useless as a key
  local value="$1"
  if [ -z "$value" ]; then printf 'not set'; return 0; fi
  printf '%s… (%d chars)' "$(printf '%s' "$value" | cut -c1-3)" "${#value}"
}

clean_secret() {   # $1 raw paste → trimmed, unquoted, no CR: what a browser copy leaves behind
  local value="$1"
  value="$(printf '%s' "$value" | tr -d '\r')"
  value="${value#"${value%%[![:space:]]*}"}"     # left trim
  value="${value%"${value##*[![:space:]]}"}"     # right trim
  case "$value" in
    \"*\") value="${value#\"}"; value="${value%\"}" ;;
    \'*\') value="${value#\'}"; value="${value%\'}" ;;
  esac
  case "$value" in Bearer\ *) value="${value#Bearer }" ;; esac
  case "$value" in bearer\ *) value="${value#bearer }" ;; esac
  printf '%s' "$value"
}

set_env_var() {   # $1 file, $2 name, $3 value — rewrites in place, keeping comments and order
  local file="$1" name="$2" value="$3" tmp line found=0 inserted=0
  [ -f "$file" ] || : > "$file"
  tmp="$(mktemp "$file.XXXXXX")"
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      "$name="*)                     # replace the active assignment where it already sits
        printf '%s=%s\n' "$name" "$value" >> "$tmp"; found=1; continue ;;
    esac
    printf '%s\n' "$line" >> "$tmp"
    if [ "$found" = "0" ] && [ "$inserted" = "0" ]; then
      case "$line" in                # take the slot of the commented twin, so it stays in its section
        "#$name="*|"# $name="*) printf '%s=%s\n' "$name" "$value" >> "$tmp"; inserted=1 ;;
      esac
    fi
  done < "$file"
  if [ "$found" = "0" ] && [ "$inserted" = "0" ]; then printf '%s=%s\n' "$name" "$value" >> "$tmp"; fi
  cat "$tmp" > "$file"               # keep the inode and the file's own permissions
  rm -f "$tmp"
  chmod 600 "$file"
}

beside_env_check() {   # --env bundled only: /Applications/.env, when it exists, is read FIRST
  [ -e "$BESIDE_ENV" ] || return 0
  if [ "$BESIDE_ENV" -ef "$ENV_FILE" ]; then
    say "$BESIDE_ENV is the same file as $ENV_FILE (symlink) — it is read first, so the bundled copy is redundant but never stale"
  elif cmp -s "$BESIDE_ENV" "$ENV_FILE"; then
    warn "$BESIDE_ENV is a separate copy and is read FIRST: identical today, stale the next time $ENV_FILE changes"
    warn "  keep one source — delete it, or install with --env beside instead of --env bundled"
  else
    warn "$BESIDE_ENV is a STALE separate copy and is read FIRST — edits to $ENV_FILE never reach the app"
    warn "  make it current with --env beside, or delete it: rm '$BESIDE_ENV'"
  fi
}

read_secret() {   # $1 label, $2 current value → PASTED_KEY; non-zero when the user kept the current one
  local label="$1" current="$2"
  PASTED_KEY=""
  if [ -n "$current" ]; then
    printf '\033[1;34m›\033[0m %s is already set (%s) — paste a new value, or Enter to keep: ' "$label" "$(mask_key "$current")"
  else
    printf '\033[1;34m›\033[0m Paste the %s, then Enter (nothing is shown): ' "$label"
  fi
  if [ -t 0 ]; then
    IFS= read -r -s PASTED_KEY || true; printf '\n'
  else
    IFS= read -r PASTED_KEY || true; printf '\n'   # piped: printf '%s\n' "$KEY" | pnpm install:mac --key openai
  fi
  PASTED_KEY="$(clean_secret "$PASTED_KEY")"
  [ -n "$PASTED_KEY" ] || return 1
  return 0
}

ask_openai_key() {
  local current; current="$(env_value "$ENV_FILE" HOSTILEPET_OPENAI_API_KEY)"
  if ! read_secret "OpenAI API key" "$current"; then
    say "model key: kept ($(mask_key "$current"))"; return 0
  fi
  case "$PASTED_KEY" in sk-*) ;; *) warn "no sk-… prefix — storing it anyway, but check what you pasted" ;; esac
  if [ "${#PASTED_KEY}" -gt 256 ]; then warn "${#PASTED_KEY} characters is longer than any known key"; fi
  set_env_var "$ENV_FILE" HOSTILEPET_OPENAI_API_KEY "$PASTED_KEY"
  local stored="$(mask_key "$PASTED_KEY")"; PASTED_KEY=""
  local provider; provider="$(env_value "$ENV_FILE" HOSTILEPET_PROVIDER)"
  if [ -z "$provider" ]; then
    set_env_var "$ENV_FILE" HOSTILEPET_PROVIDER openai
    ok "model key stored ($stored) and HOSTILEPET_PROVIDER=openai — the pet will speak"
  elif [ "$provider" = "openai" ]; then
    ok "model key stored ($stored)"
  else
    warn "model key stored ($stored), but HOSTILEPET_PROVIDER=$provider — only 'openai' selects the model"
  fi
}

ask_elevenlabs_key() {
  local current; current="$(env_value "$ENV_FILE" ELEVENLAB_API_KEY)"
  if ! read_secret "ElevenLabs voice key" "$current"; then
    say "voice key: kept ($(mask_key "$current"))"; return 0
  fi
  case "$PASTED_KEY" in sk_*) ;; *) warn "no sk_… prefix — storing it anyway, but check what you pasted" ;; esac
  if [ "${#PASTED_KEY}" -gt 256 ]; then warn "${#PASTED_KEY} characters is longer than any known key"; fi
  set_env_var "$ENV_FILE" ELEVENLAB_API_KEY "$PASTED_KEY"
  local stored="$(mask_key "$PASTED_KEY")"; PASTED_KEY=""
  ok "voice key stored ($stored)"
}

if [ -n "$KEY_TARGETS" ]; then
  if [ ! -f "$ENV_FILE" ]; then
    [ -f "$ENV_TEMPLATE" ] || die "no $ENV_FILE and no $ENV_TEMPLATE to copy"
    cp "$ENV_TEMPLATE" "$ENV_FILE"; chmod 600 "$ENV_FILE"
    say "created $ENV_FILE from .env.example"
  fi
  [ -t 0 ] || say "stdin is not a terminal: reading the keys from it, one per line"
  case "$KEY_TARGETS" in
    openai)     ask_openai_key ;;
    elevenlabs) ask_elevenlabs_key ;;
    all)        ask_openai_key; ask_elevenlabs_key ;;
  esac
fi

if [ "$KEYS_ONLY" = "1" ]; then
  [ -n "$KEY_TARGETS" ] || die "--keys-only needs a key to write: --key openai, elevenlabs or all"
  [ -f "$ENV_FILE" ] || die "no $ENV_FILE — run again with --key all to create it"
  printf '\n'
  ok "keys written to $ENV_FILE (mode $(stat -f '%Lp' "$ENV_FILE" 2>/dev/null || echo '?'))"
  say "model key: $(mask_key "$(env_value "$ENV_FILE" HOSTILEPET_OPENAI_API_KEY)")"
  say "voice key: $(mask_key "$(env_value "$ENV_FILE" ELEVENLAB_API_KEY)")"
  say "pnpm dev reads this file at startup — restart it to pick the change up"
  say "the installed app needs its own copy: pnpm install:mac --env bundled   (or --env beside)"
  exit 0
fi

NEEDS_ENV=0
if [ "$ENV_MODE" = "bundled" ] || [ "$ENV_MODE" = "beside" ]; then NEEDS_ENV=1; fi
if [ "$NEEDS_ENV" = "1" ]; then
  [ -f "$ENV_FILE" ] || die "no $ENV_FILE — create it (HOSTILEPET_PROVIDER=openai, HOSTILEPET_OPENAI_API_KEY=…),
    run again with --key all to paste the keys here, put the model key in the Keychain and use
    --env keychain, or use --env none for a silent pet"
fi
# Reported before the build, not after the copy: a shadowing file is a decision, not a detail.
if [ "$ENV_MODE" = "bundled" ]; then beside_env_check; fi

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
    IDENT="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$TARGET_APP/Contents/Info.plist" 2>/dev/null || echo 'dev.hostilepet.desktop')"
    say "re-signing ad-hoc (the injected file broke the seal)"
    codesign --force --sign - --identifier "$IDENT" "$TARGET_APP" >/dev/null 2>&1 || die "codesign failed"
    ok "env bundled at Contents/Resources/.env, signature resealed"
    ;;
  beside)
    if [ "$BESIDE_ENV" -ef "$ENV_FILE" ]; then
      # cp refuses a destination that is the source's own inode ("are identical"), and a symlink
      # to the source needs no copy anyway: an edit already reaches the app on the next launch.
      say "$BESIDE_ENV is already $ENV_FILE (symlink) — nothing to copy, edits take effect on relaunch"
    else
      cp "$ENV_FILE" "$BESIDE_ENV" || die "could not write $BESIDE_ENV — rerun with: sudo bash scripts/install-app.sh ${ORIGINAL_ARGS[*]:-}"
      ok "env beside the bundle at $BESIDE_ENV (edit it and relaunch — no rebuild)"
    fi
    if [ -f "$RESOURCES_ENV" ]; then warn "the app also carries $RESOURCES_ENV — harmless, $BESIDE_ENV is read first"; fi
    ;;
  keychain)
    if has_var "$ENV_FILE" HOSTILEPET_OPENAI_API_KEY; then
      warn "$ENV_FILE still defines HOSTILEPET_OPENAI_API_KEY and it is not copied anywhere — remove that line to use the Keychain"
    fi
    say "no .env copied; the model key falls back to the login Keychain"
    printf '   store it with:  security add-generic-password -U -s hostilepet.openai -a "%s" -w\n' "$USER"
    ;;
  none)
    say "no .env copied and no Keychain fallback expected: the pet will show a face and say nothing (ADR 0011)"
    ;;
esac

# The voice key has no Keychain path: if it is set, the app only ever sees it through the file.
if has_var "$ENV_FILE" ELEVENLAB_API_KEY && [ "$NEEDS_ENV" = "0" ]; then
  warn "ELEVENLAB_API_KEY is set but --env $ENV_MODE copies nothing — the pet will be mute; use --env bundled or --env beside"
fi

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
  bundled)  APP_ENV="$RESOURCES_ENV"; APPTEXT="inside the bundle" ;;
  beside)   APP_ENV="$BESIDE_ENV";    APPTEXT="beside the bundle" ;;
  *)        APP_ENV="";               APPTEXT="" ;;
esac
if [ -n "$APP_ENV" ]; then
  mkey="$(env_value "$APP_ENV" HOSTILEPET_OPENAI_API_KEY)"; vkey="$(env_value "$APP_ENV" ELEVENLAB_API_KEY)"
  say "model key $APPTEXT: $(mask_key "$mkey")"
  say "voice key $APPTEXT: $(mask_key "$vkey")"
  if [ "$ENV_MODE" = "bundled" ] && [ -e "$BESIDE_ENV" ] && ! [ "$BESIDE_ENV" -ef "$ENV_FILE" ]; then
    warn "the app reads $BESIDE_ENV first — the keys above are the bundle's, not necessarily the ones in use"
  fi
  if [ -z "$mkey" ]; then
    warn "no model key reaches the app — run: pnpm install:mac --key openai   (silence is the expected state otherwise, ADR 0011)"
  elif [ "$(env_value "$APP_ENV" HOSTILEPET_PROVIDER)" != "openai" ]; then
    warn "HOSTILEPET_PROVIDER is not 'openai' — the key is there but the model is not selected"
  fi
  [ -n "$vkey" ] || say "no voice key: the pet shows its line as text only"
else
  case "$ENV_MODE" in
    keychain) say "model key: login Keychain, service hostilepet.openai" ;;
    none)     say "model key: none — the pet has no words" ;;
  esac
fi
printf '   keys live in %s (git-ignored, mode %s)\n' "$ENV_FILE" "$(stat -f '%Lp' "$ENV_FILE" 2>/dev/null || echo '?')"

if [ "$DO_OPEN" = "1" ]; then
  say "launching"
  open "$TARGET_APP"
fi
