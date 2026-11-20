#!/usr/bin/env bash
# Stage only the files that belong in the TV widget and package them.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CERT="${1:-${AURORA_CERT:-aurora}}"
TIZEN="${TIZEN:-$HOME/tizen-studio/tools/ide/bin/tizen}"
STAGE="$ROOT/build/aurora"
OUT="$ROOT/build"

if [ ! -x "$TIZEN" ]; then
  echo "Tizen CLI not found at $TIZEN" >&2
  echo "Set TIZEN=/path/to/tizen-studio/tools/ide/bin/tizen" >&2
  exit 1
fi

rm -rf "$STAGE"
mkdir -p "$STAGE"

# Widget payload only. Keep the docs, screenshots and optional LAN server out.
cp "$ROOT/config.xml" "$STAGE/"
cp "$ROOT/config.json" "$STAGE/"
cp "$ROOT/index.html" "$STAGE/"
# The widget URL and app id stay the same across updates, so Tizen's web
# engine can serve cached JS. Stamp every build with a fresh query string.
BUILD_ID="$(date +%Y%m%d%H%M%S)"
perl -pi -e "s/\?v=[0-9A-Za-z._-]+/?v=$BUILD_ID/g" "$STAGE/index.html"
cp "$ROOT/icon.png" "$STAGE/"
cp -R "$ROOT/css" "$STAGE/css"
cp -R "$ROOT/js" "$STAGE/js"
python3 "$ROOT/tools/make-seed.py" "$STAGE/js/seed.js" >/dev/null

# Embedded WebAssembly configuration service (port 8099 on the TV).
# Only the browser UI changes regularly; repack it into the preloaded payload
# instead of requiring the Samsung Emscripten SDK for every build.
python3 "$ROOT/tools/pack-localui.py" >/dev/null
mkdir -p "$STAGE/localsrv"
cp "$ROOT/localsrv/server.html" "$STAGE/localsrv/"
cp "$ROOT/localsrv/server.js" "$STAGE/localsrv/"
cp "$ROOT/localsrv/server.wasm" "$STAGE/localsrv/"
cp "$ROOT/localsrv/server.data" "$STAGE/localsrv/"

PROFILE_ARGS=(-s "$CERT")
if ! "$TIZEN" security-profiles list 2>/dev/null | grep -q "$CERT"; then
  if [ "${AURORA_ALLOW_DEFAULT_CERT:-0}" = "1" ]; then
    echo "! Certificate profile '$CERT' not found; using Tizen's default emulator certificate."
    PROFILE_ARGS=()
  else
    echo "Certificate profile '$CERT' not found." >&2
    echo "Create it in Tizen Studio Certificate Manager, or run with AURORA_ALLOW_DEFAULT_CERT=1 for a local package." >&2
    exit 1
  fi
fi

echo "→ Packaging $(basename "$STAGE") with certificate profile '$CERT'"
"$TIZEN" package -t wgt "${PROFILE_ARGS[@]}" -o "$OUT" -- "$STAGE"

ls -t "$OUT"/*.wgt 2>/dev/null | head -1
