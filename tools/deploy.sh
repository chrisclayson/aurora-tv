#!/usr/bin/env bash
# Build, install and launch Aurora on a TV that is already in developer mode.
set -euo pipefail

TV_IP="${1:-}"
if [ -z "$TV_IP" ]; then
  echo "usage: AURORA_CERT=<profile> $0 <tv-ip>" >&2
  echo "example: AURORA_CERT=aurora $0 <tv-ip>" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CERT="${AURORA_CERT:-aurora}"
TIZEN="${TIZEN:-$HOME/tizen-studio/tools/ide/bin/tizen}"
SDB="${SDB:-$HOME/tizen-studio/tools/sdb}"

if [ ! -x "$TIZEN" ]; then
  echo "Tizen CLI not found at $TIZEN" >&2
  echo "Set TIZEN=/path/to/tizen-studio/tools/ide/bin/tizen" >&2
  exit 1
fi
if [ ! -x "$SDB" ]; then
  echo "sdb not found at $SDB" >&2
  echo "Set SDB=/path/to/tizen-studio/tools/sdb" >&2
  exit 1
fi

echo "→ Connecting to $TV_IP:26101"
"$SDB" connect "$TV_IP:26101" || true

TARGET="$("$SDB" devices | awk 'NR > 1 && $2 == "device" { print (NF >= 3 && $3 != "" ? $3 : $1); exit }')"
if [ -z "$TARGET" ]; then
  echo "No authorised TV found. Enable Developer Mode and accept the prompt." >&2
  "$SDB" devices
  exit 1
fi

echo "→ Packaging with certificate profile '$CERT'"
WGT="$("$ROOT/tools/build.sh" "$CERT" | tail -1)"

if [ -z "$WGT" ] || [ ! -f "$WGT" ]; then
  echo "Packaging did not produce a .wgt file" >&2
  exit 1
fi

echo "→ Installing $(basename "$WGT") on $TARGET"
"$TIZEN" install -n "$WGT" -t "$TARGET"

if [ "${AURORA_SKIP_RUN:-0}" != "1" ]; then
  echo "→ Launching Aurora"
  "$TIZEN" run -p auroratv01.Aurora -t "$TARGET" || true
fi

echo "Done."
