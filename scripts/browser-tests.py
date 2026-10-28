#!/usr/bin/env python3
"""Runs both browser test suites over several apps at once.

    cd engine && ./mach python ../scripts/browser-tests.py [-j N] [suite ...]

N is the number of apps in all (default: one for every two CPUs, at least
four; more fight over the CPU); a suite is agent or shell.
The suites share the apps by how long their tests took last time, and each
app takes the next test of its suite, in the suite's order (some tests count
on it), when it is done with one, as the suite's script given those test
names would run them.
"""

import importlib.util
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
# How long each test took last time, to share the apps between the suites.
TIMES = Path(tempfile.gettempdir()) / "orbito-browser-test-times.json"
RESULT = re.compile(r"(ok|not ok) - (\w+)(?: # ([\d.]+)s)?$")
# What Marionette says once the app has quit or crashed.
DEAD = re.compile(r"Please start a session|Process has been unexpectedly closed")


def names(script):
    spec = importlib.util.spec_from_file_location(script.stem.replace("-", "_"), script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return [t.__name__ for t in module.TESTS]


class App:
    """One app running a suite's script, fed the suite's tests one by one."""

    def __init__(self, label, script, queue, lock, times):
        self.label, self.queue, self.lock, self.times = label, queue, lock, times
        self.lines = []
        self.process = subprocess.Popen(
            [sys.executable, str(script), "-"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            encoding="utf-8", errors="replace", env=dict(os.environ, PYTHONUTF8="1"),
        )
        self.next()
        # Read as it comes: an app whose output nobody reads stops when the
        # pipe is full.
        self.reader = threading.Thread(target=self.read)
        self.reader.start()

    def next(self, stop=False):
        with self.lock:
            name = self.queue.pop(0) if self.queue and not stop else None
        try:
            if name:
                self.process.stdin.write(name + "\n")
                self.process.stdin.flush()
            else:
                self.process.stdin.close()
        except OSError:
            pass  # The script is gone; read() reports what it said.

    def read(self):
        failed = False
        for line in self.process.stdout:
            line = line.rstrip("\n")
            self.lines.append(line)
            result = RESULT.match(line)
            if result:
                if result[3]:
                    self.times[result[2]] = float(result[3])
                failed = result[1] == "not ok"
                if not failed:
                    self.next()
            elif failed:
                # After a failure, its reason: once the app is gone, the
                # other apps run the tests left.
                failed = False
                self.next(stop=DEAD.search(line))
        self.process.wait()


def main():
    args = sys.argv[1:]
    jobs = max(4, (os.cpu_count() or 8) // 2)
    if "-j" in args:
        at = args.index("-j")
        jobs = int(args[at + 1])
        del args[at : at + 2]
    suites = args or ["agent", "shell"]
    try:
        last = json.loads(TIMES.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        last = {}
    times = dict(last)
    start = time.time()
    tests = {suite: names(ROOT / f"{suite}-browser-test.py") for suite in suites}
    # A test not timed yet counts as an average one.
    took = lambda name: last.get(name, 2.0)
    work = {suite: sum(map(took, tests[suite])) for suite in suites}
    shares = {suite: max(1, round(jobs * work[suite] / sum(work.values()))) for suite in suites}
    lock = threading.Lock()
    apps = []
    queues = []
    for suite in suites:
        queue = list(tests[suite])
        queues.append(queue)
        for n in range(min(shares[suite], len(queue))):
            apps.append(App(f"{suite} {n + 1}/{shares[suite]}", ROOT / f"{suite}-browser-test.py", queue, lock, times))
    failed = 0
    for app in apps:
        app.reader.join()
        lines = app.lines
        results = [line for line in lines if RESULT.match(line)]
        failures = [line for line in results if line.startswith("not ok - ")]
        print(f"# {app.label}: {len(results) - len(failures)} ok, {len(failures)} not ok", flush=True)
        for i, line in enumerate(lines):
            if line.startswith("not ok - "):
                print(line, *lines[i + 1 : i + 2], sep="\n", flush=True)
        if app.process.returncode and not failures:
            # The app or the script failed outside a test.
            print("\n".join(lines)[-3000:], flush=True)
        failed += bool(app.process.returncode)
    left = sum(map(len, queues))
    if left:
        # Every app of a suite stopped before its tests did.
        print(f"# {left} tests not run", flush=True)
        failed += 1
    try:
        TIMES.write_text(json.dumps(times, indent=0, sort_keys=True), encoding="utf-8")
    except OSError:
        pass
    print(f"# {time.time() - start:.0f}s", flush=True)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
