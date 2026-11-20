#!/usr/bin/env python3
"""Embed config.json as a local script so provisioning also works when a
Tizen widget refuses fetch() on file:// URLs."""
import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
source = root / "config.json"
target = Path(sys.argv[1]) if len(sys.argv) > 1 else root / "js" / "seed.js"

config = json.loads(source.read_text(encoding="utf-8"))
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(
    "/* Generated from config.json by tools/make-seed.py. Do not edit. */\n"
    "window.AURORA_SEED = "
    + json.dumps(config, indent=2, ensure_ascii=False)
    + ";\n",
    encoding="utf-8",
)
print(target)
