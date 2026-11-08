#!/usr/bin/env python3
"""Presses the Top bar's URL display with real Windows mouse input.

The Shell test runs headless, where there is no drag region: Windows sends
the URL display's press as draggableregionleftmousedown and then holds it in
its own loop, which the test can only imitate. This drives the real mouse
(SendInput) over a visible Orbito, so it moves the pointer while it runs,
and it needs no other Firefox or Orbito window open:

    cd engine && ./mach python ../scripts/windows-url-press-check.py

ORBITO_BIN overrides the app binary (default: the Windows artifact build).
"""

import ctypes
import os
import socket
import sys
import tempfile
import time
from pathlib import Path

from marionette_driver.marionette import Marionette

ROOT = Path(__file__).resolve().parent.parent
BIN = os.environ.get("ORBITO_BIN", str(ROOT / "engine/obj-artifact/dist/bin/orbito.exe"))
user32 = ctypes.windll.user32
user32.SetProcessDPIAware()
LEFTDOWN, LEFTUP = 0x0002, 0x0004

WIN = 'const win = Services.wm.getMostRecentWindow("navigator:browser");'
# The URL display's middle in physical screen pixels, the window's position
# and whether the Command bar is open.
STATE = WIN + """
let r = win.OrbitoShell.topBar.urlDisplay.getBoundingClientRect();
let scale = win.devicePixelRatio;
return {
  x: Math.round((win.mozInnerScreenX + r.left + r.width / 2) * scale),
  y: Math.round((win.mozInnerScreenY + r.top + r.height / 2) * scale),
  window: [win.screenX, win.screenY],
  open: win.OrbitoShell.commandBar.isOpen,
  maximized: win.windowState == win.STATE_MAXIMIZED,
};
"""
RESET = WIN + """
win.OrbitoShell.commandBar.close();
win.restore();
win.moveTo(100, 100);
win.focus();
"""

# How each press goes: (seconds held before the pointer moves, how far it
# moves in pixels, how many presses), and whether it is a click.
PRESSES = {
    "a short click": ((0.06, 0, 1), True),
    "a long click": ((0.6, 0, 1), True),
    "a wiggle within the drag threshold": ((0.3, 3, 1), True),
    "a drag": ((0.05, 40, 1), False),
    "a drag just past the drag threshold": ((0.05, 6, 1), False),
}


def press(x, y, hold, dx, count):
    # The pointer comes from the side, so that the URL display is hovered.
    user32.SetCursorPos(x - 20, y)
    time.sleep(0.1)
    user32.SetCursorPos(x, y)
    time.sleep(0.2)
    for _ in range(count):
        user32.mouse_event(LEFTDOWN, 0, 0, 0, 0)
        time.sleep(hold)
        if dx:
            user32.SetCursorPos(x + dx, y + dx // 2)
            time.sleep(0.3)
        user32.mouse_event(LEFTUP, 0, 0, 0, 0)
        time.sleep(0.1)
    time.sleep(0.8)


with socket.socket() as s:
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
m = Marionette(bin=BIN, port=port,
               gecko_log=os.path.join(tempfile.gettempdir(), f"gecko-{os.getpid()}.log"))
m.start_session()
m.set_context("chrome")
failed = 0
try:
    m.execute_script(WIN + """
    win.gBrowser.loadURI(Services.io.newURI("about:robots"), {
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
    });
    """)
    time.sleep(2)
    for name, ((hold, dx, count), click) in PRESSES.items():
        m.execute_script(RESET)
        user32.SetForegroundWindow(user32.FindWindowW("MozillaWindowClass", None))
        time.sleep(0.8)
        before = m.execute_script(STATE)
        press(before["x"], before["y"], hold, dx, count)
        after = m.execute_script(STATE)
        moved = after["window"] != before["window"]
        ok = after["open"] == click and moved != click and not after["maximized"]
        failed += not ok
        print(f"{'ok' if ok else 'not ok'} - {name} "
              f"(Command bar {'opened' if after['open'] else 'closed'}, "
              f"window {'moved' if moved else 'stayed'}"
              f"{', maximized' if after['maximized'] else ''})")
finally:
    m.quit(in_app=False)
    m.cleanup()
sys.exit(1 if failed else 0)
