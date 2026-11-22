#!/usr/bin/env bash
# Rebuild the embedded WebAssembly HTTP server.
#
# Requires the Samsung Emscripten SDK (the fork with the Tizen Sockets
# Extension) and its activation. Point EMSDK_BASE at the extracted
# emscripten-release-bundle/emsdk directory.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EMSDK_BASE="${EMSDK_BASE:-}"
if [ -z "$EMSDK_BASE" ]; then
  echo "Set EMSDK_BASE=/path/to/emscripten-release-bundle/emsdk" >&2
  exit 1
fi

EMCC="$EMSDK_BASE/fastcomp/emscripten/emcc"
if [ ! -f "$EMCC" ]; then
  echo "Samsung emcc not found at $EMCC" >&2
  exit 1
fi

cd "$ROOT/localsrv"
arch -x86_64 /usr/bin/python3 "$EMCC" \
  -o server.html \
  -Os \
  -s ENVIRONMENT_MAY_BE_TIZEN \
  --proxy-to-worker \
  --preload-file ../local-ui@/ui \
  --shell-file shell.html \
  server.c

arch -x86_64 /usr/bin/python3 "$ROOT/tools/patch-localsrv.py"

echo "Rebuilt localsrv/server.{html,js,wasm,data}"
