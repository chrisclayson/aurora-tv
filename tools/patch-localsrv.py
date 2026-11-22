#!/usr/bin/env python3
"""Make the embedded on-TV server safe for the TV's single WebAssembly worker.

The Samsung host-bindings socket path blocks the whole worker in recv(). A
browser preconnect or a half-open client connection therefore stopped every
later request on port 8099 until the app was restarted. Force the SOCKFS path
and give recv() a short readiness poll: if a client does not send anything, the
server sees EOF, closes that connection and goes back to accept().

The C server itself also supports rotating its auth token (POST /api/auth/local)
so Settings can switch between the normal token and the six-character import
code without restarting this worker. Restarting the worker would leak the
listening socket on Tizen, which is what took port 8099 down.

Run after `localsrv/build.sh`; it is idempotent.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SERVER = ROOT / "localsrv" / "server.js"

STUBS = (
    "(function(){var names=['__wasm_accept','__wasm_bind','__wasm_close','__wasm_connect',"
    "'__wasm_getpeername','__wasm_getsockname','__wasm_getsockopt','__wasm_listen',"
    "'__wasm_poll','__wasm_recv','__wasm_recvfrom','__wasm_recvmsg','__wasm_select',"
    "'__wasm_send','__wasm_sendmsg','__wasm_sendto','__wasm_setsockopt','__wasm_shutdown',"
    "'__wasm_socket'];for(var i=0;i<names.length;i++){if(typeof self[names[i]]==='undefined')"
    "self[names[i]]=function(){return -52;};}})();\n"
)

PRELUDE = r"""(function(){try{var sm=self.tizentvwasm&&self.tizentvwasm.SocketsManager;if(!sm||sm.__auroraTimedRecv)return;var r=sm.recv;if(typeof r!=="function")return;sm.recv=function(fd,data,flags){try{var P=self.tizentvwasm.PollFlags;var pfd=new self.tizentvwasm.PollFd(fd,P.POLLIN|P.POLLRDNORM|P.POLLPRI);sm.poll([pfd],750);if(pfd.revents!==undefined&&!(pfd.revents&(P.POLLIN|P.POLLRDNORM|P.POLLPRI)))return 0;}catch(e){}return r.call(sm,fd,data,flags);};sm.__auroraTimedRecv=1;}catch(e){}})();
"""


def main() -> int:
    if not SERVER.exists():
        print(f"Missing {SERVER}", file=sys.stderr)
        return 1

    source = SERVER.read_text()
    updated = re.sub(r"USE_HOST_BINDINGS\s*=\s*true", "USE_HOST_BINDINGS=false", source, count=1)
    if not updated.startswith(STUBS):
        updated = STUBS + updated
    if PRELUDE not in updated:
        updated = updated.replace(STUBS, STUBS + PRELUDE, 1)
    if updated != source:
        SERVER.write_text(updated)
        print("patched localsrv/server.js for SOCKFS + timed recv")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
