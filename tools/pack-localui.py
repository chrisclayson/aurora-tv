#!/usr/bin/env python3
"""Repack the on-TV configuration UI into the embedded server payload.

The WebAssembly server is built from `localsrv/server.c` with Samsung's
Emscripten fork, but the browser UI is plain files under `local-ui/`. Rebuilding
the wasm is unnecessary when only the UI changes: Emscripten stores preloaded
files as a concatenation of their bytes, described by a `loadPackage(...)` call
in `localsrv/server.js`. This script rebuilds that data file and updates the
offsets, so `tools/build.sh` can ship UI edits without the Emscripten SDK.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UI_DIR = ROOT / "local-ui"
SERVER_DIR = ROOT / "localsrv"
FILES = ["index.html", "styles.css", "app.js"]
PACKAGE_RE = re.compile(
    r"loadPackage\(\{\"files\":\[.*?\"package_uuid\":\"[^\"]*\"\}\)"
)


def main() -> int:
    pieces = []
    entries = []
    for name in FILES:
        source = UI_DIR / name
        if not source.exists():
            print(f"Missing {source}", file=sys.stderr)
            return 1
        data = source.read_bytes()
        start = sum(len(piece) for piece in pieces)
        pieces.append(data)
        entries.append(
            {
                "filename": "/ui/" + name,
                "start": start,
                "end": start + len(data),
                "audio": 0,
            }
        )

    blob = b"".join(pieces)
    server_js = SERVER_DIR / "server.js"
    if not server_js.exists():
        print(f"Missing {server_js}", file=sys.stderr)
        return 1
    js = server_js.read_text()

    match = PACKAGE_RE.search(js)
    if not match:
        print("Could not find the loadPackage() call in localsrv/server.js", file=sys.stderr)
        return 1

    uuid_match = re.search(r'"package_uuid":"([^"]*)"', match.group(0))
    package = {
        "files": entries,
        "remote_package_size": len(blob),
        "package_uuid": uuid_match.group(1) if uuid_match else "",
    }
    replacement = "loadPackage(" + json.dumps(package, separators=(",", ":")) + ")"
    server_js.write_text(js[: match.start()] + replacement + js[match.end() :])

    (SERVER_DIR / "server.data").write_bytes(blob)
    print(
        "Packed on-TV UI: "
        + ", ".join(f"{entry['filename']} ({entry['end'] - entry['start']} B)" for entry in entries)
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
