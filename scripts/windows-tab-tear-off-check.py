#!/usr/bin/env python3
"""Drags Sidebar items out of the window with real Windows mouse input.

The Shell test runs headless and sends the drag's pointer events itself, so
it cannot tell whether Windows keeps sending them once the pointer leaves
the window, nor whether the chip's drag popup lets them through. This drives
the real mouse (SendInput) over a visible Orbito, so it moves the pointer
while it runs, and it needs no other Firefox or Orbito window open:

    cd engine && ./mach python ../scripts/windows-tab-tear-off-check.py [--hold SECONDS]

--hold keeps the pointer still outside the window before letting go, to look
at the chip. ORBITO_BIN overrides the app binary (default: the Windows
artifact build). It needs room on the screen right of a 1000 px window at
x 100 for another 700 px one.
"""

import argparse
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

parser = argparse.ArgumentParser()
parser.add_argument("--hold", type=float, default=0)
args = parser.parse_args()

WIN = """
const wins = () => [...Services.wm.getEnumerator("navigator:browser")];
const win = wins()[0];
"""
SETUP = WIN + """
for (let w of wins().slice(1)) w.close();
win.restore();
win.resizeTo(1000, 700);
win.moveTo(100, 100);
win.focus();
let shell = win.OrbitoShell;
for (let tab of [...win.gBrowser.tabs]) {
  if (tab.pinned) shell.pins.unpinTab(tab);
}
for (let tab of win.gBrowser.tabs.filter(t => t.label.startsWith("Torn"))) {
  win.gBrowser.removeTab(tab, { animate: false });
}
let open = async title => {
  let tab = win.gBrowser.addTrustedTab(
    "data:text/html,<title>" + title + "</title>" + title
  );
  win.gBrowser.selectedTab = tab;
  while (tab.linkedBrowser.contentTitle != title) {
    await new Promise(resolve => win.setTimeout(resolve, 50));
  }
  return tab;
};
// A Pin takes its name from the page, so it is made once that has loaded.
shell.pins.pinTab(await open("Torn Pin"), 0);
for (let title of ["Torn A", "Torn B", "Torn C"]) {
  await open(title);
}
"""
# The middle of an item's row in physical screen pixels, and the right and
# bottom of the window's visible frame.
WHERE = WIN + """
let [kind, label] = arguments;
let shell = win.OrbitoShell;
let tab = win.gBrowser.tabs.find(t => t.label == label);
let row = kind == "pin"
  ? [...win.document.getElementById("orbito-pins").buttons].find(b => b.tab == tab)
  : [...shell.sidebar.tabList.renderRoot.querySelectorAll(".tab")].find(r => r.tab == tab);
let r = row.getBoundingClientRect();
let scale = win.devicePixelRatio;
return {
  x: Math.round((win.mozInnerScreenX + r.left + r.width / 2) * scale),
  y: Math.round((win.mozInnerScreenY + r.top + r.height / 2) * scale),
  right: Math.round((win.mozInnerScreenX + win.innerWidth) * scale),
  bottom: Math.round((win.mozInnerScreenY + win.innerHeight) * scale),
  page: Math.round((win.mozInnerScreenX + win.innerWidth - 200) * scale),
};
"""
# Opens another window right of the first and returns the middle of its
# page in physical screen pixels.
BESIDE = WIN + """
let done = arguments[arguments.length - 1];
let other = win.OpenBrowserWindow();
(async () => {
  while (!other.gBrowserInit?.delayedStartupFinished || !other.OrbitoShell?.docks?.ready) {
    await new Promise(resolve => win.setTimeout(resolve, 50));
  }
  other.resizeTo(700, 700);
  other.moveTo(1150, 100);
  await new Promise(resolve => win.setTimeout(resolve, 500));
  win.focus();
  let r = other.gBrowser.selectedBrowser.getBoundingClientRect();
  let scale = other.devicePixelRatio;
  return [
    Math.round((other.mozInnerScreenX + r.left + r.width / 2) * scale),
    Math.round((other.mozInnerScreenY + r.top + r.height / 2) * scale),
  ];
})().then(done);
"""
STATE = WIN + """
let label = arguments[0];
return {
  windows: wins().length,
  here: win.gBrowser.tabs.filter(t => t.label == label).map(t => [t.pinned, !!t.linkedPanel]),
  there: wins().slice(1).map(w => ({
    selected: w.gBrowser.selectedTab.label,
    loaded: !!w.gBrowser.selectedTab.linkedPanel,
    copies: w.gBrowser.tabs.filter(t => t.label == label).length,
    at: [w.screenX, w.screenY],
  })),
};
"""
CHIP = WIN + """
let panel = win.document.getElementById("orbito-tear-off");
return panel?.state ?? "none";
"""


def drag(start, end, hold=0):
    """Presses at start, moves to end in steps and lets go there. Returns
    the chip's state just before letting go."""
    x, y = start
    user32.SetCursorPos(x - 20, y)
    time.sleep(0.1)
    user32.SetCursorPos(x, y)
    time.sleep(0.3)
    user32.mouse_event(LEFTDOWN, 0, 0, 0, 0)
    time.sleep(0.1)
    for i in range(1, 31):
        user32.SetCursorPos(int(x + (end[0] - x) * i / 30), int(y + (end[1] - y) * i / 30))
        time.sleep(0.02)
    time.sleep(0.4 + hold)
    chip = m.execute_script(CHIP)
    user32.mouse_event(LEFTUP, 0, 0, 0, 0)
    time.sleep(2)
    return chip


with socket.socket() as s:
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
m = Marionette(bin=BIN, port=port,
               gecko_log=os.path.join(tempfile.gettempdir(), f"gecko-{os.getpid()}.log"))
m.start_session()
m.set_context("chrome")
failed = 0


def check(ok, name, detail):
    global failed
    failed += not ok
    print(f"{'ok' if ok else 'not ok'} - {name} ({detail})")


try:
    for name, kind, label, out in [
        ("a tab dropped on the page stays in the window", "tab", "Torn B", False),
        ("a tab dragged out of the window opens in a new one", "tab", "Torn B", True),
        ("a Pin dragged out of the window opens in a new one", "pin", "Torn Pin", True),
        ("a tab dropped on another window moves into it", "tab", "Torn C", "into"),
    ]:
        m.execute_async_script(
            "let done = arguments[arguments.length - 1];"
            f"(async () => {{ {SETUP} }})().then(() => done(true));")
        beside = m.execute_async_script(BESIDE) if out == "into" else None
        user32.SetForegroundWindow(user32.FindWindowW("MozillaWindowClass", None))
        time.sleep(1.5)
        at = m.execute_script(WHERE, script_args=[kind, label])
        end = beside or ((at["right"] + 160, at["y"] + 40) if out else (at["page"], at["y"] + 40))
        chip = drag((at["x"], at["y"]), end, args.hold if out else 0)
        state = m.execute_script(STATE, script_args=[label])
        if not out:
            ok = (state["windows"] == 1 and chip != "open"
                  and state["here"] == [[False, True]])
        elif out == "into":
            there = state["there"]
            ok = (chip == "open" and state["windows"] == 2 and there
                  and there[0]["selected"] == label and there[0]["loaded"]
                  and there[0]["copies"] == 1 and not state["here"])
        else:
            there = state["there"]
            ok = (chip == "open" and state["windows"] == 2 and there
                  and there[0]["selected"] == label and there[0]["loaded"]
                  and there[0]["copies"] == 1)
            if kind == "pin":
                # The Pin stays here as an unloaded tab of its own.
                ok = ok and state["here"] == [[True, False]]
            else:
                ok = ok and not state["here"]
        check(ok, name, f"chip {chip}, {state}")
finally:
    m.quit(in_app=False)
    m.cleanup()
sys.exit(1 if failed else 0)
