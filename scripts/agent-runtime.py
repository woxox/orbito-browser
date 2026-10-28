#!/usr/bin/env python3
"""Stage the agent runtime that Orbito ships as orbito-agent/.

For each target this writes dist/agent-runtime/<target>/ with the Claude Code
CLI (claude, or claude.exe), taken unmodified from Anthropic's npm package for
the platform at CLAUDE_VERSION and checked against the integrity pinned here;
ClaudeCLI.sys.mjs runs it. browser/orbito-agent/moz.build installs the
directory for the target being built.

    scripts/agent-runtime.py                       # the host
    scripts/agent-runtime.py aarch64-apple-darwin  # or any of CLAUDE, or "all"

To move to another Claude Code release, change CLAUDE_VERSION and take each
package's integrity from the registry:

    npm view @anthropic-ai/claude-code-darwin-arm64@<version> dist.integrity
"""

import base64
import hashlib
import os
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
from pathlib import Path

CLAUDE_VERSION = "2.1.308"

# Target -> the npm package of the Claude Code CLI for it, and the
# package's dist.integrity in the registry.
CLAUDE = {
    "aarch64-apple-darwin": (
        "darwin-arm64",
        "sha512-fdIEbsrjlOiB8XLD3HWMi7fFGNrRzz7vPUmstgL/7qf4DLWzoWpgpCYaovrX8fp2wRsexiNok/9WZea938jJUw==",
    ),
    "x86_64-apple-darwin": (
        "darwin-x64",
        "sha512-GdddpKPDe/tvxdScf0P59eSqF7QQJbwZa21vsRIzEyZPLhE7Qc43YBx2jtGRZMNpFh+dnkRoZoo6b8a1bWQQyw==",
    ),
    "aarch64-unknown-linux-gnu": (
        "linux-arm64",
        "sha512-xtT2Cd7n+yZN9PiWbWHaZf9w25YflV+7VOX5IBPB/IWErKZFhsst2/Ay1tSgq/Mzp1vp56xwFRqPa6UAI9BZIw==",
    ),
    "x86_64-unknown-linux-gnu": (
        "linux-x64",
        "sha512-ffUryevpH7POStPJ/xpUI5R1ozYbH9o/Dbh/xPSmyVJehELnRMZmRnejdQmq0TejOW/SbNnJFhCGMgwIsOqFTQ==",
    ),
    "aarch64-pc-windows-msvc": (
        "win32-arm64",
        "sha512-GUSYZn0Rwz02SnYSO7USmoHOOOiEEOQsW8NbsDouwLurFLsaC+JTd9CKbmIAx/fMxUWmljqBPkyU6PDftxoh9g==",
    ),
    "x86_64-pc-windows-msvc": (
        "win32-x64",
        "sha512-OxskS6onyOdKqdvd9/33M5//ItBdAnoI/cjdp0PU47KDMDF5WWE82Slo0ISq8kpNr2wK0lXB5Z2Rv1weJR0znw==",
    ),
}

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "dist/agent-runtime"
DOWNLOADS = OUT / ".downloads"


def host_target():
    system = platform.system()
    machine = platform.machine().lower()
    arch = {"arm64": "aarch64", "aarch64": "aarch64", "x86_64": "x86_64", "amd64": "x86_64"}.get(machine)
    if system == "Darwin":
        target = f"{arch}-apple-darwin"
    elif system == "Linux":
        target = f"{arch}-unknown-linux-gnu"
    elif system == "Windows" or system.startswith(("MINGW", "MSYS", "CYGWIN")):
        target = f"{arch}-pc-windows-msvc"
    else:
        target = None
    if target not in CLAUDE:
        sys.exit(f"Unsupported host {system} {machine}; pass a target.")
    return target


def claude_exe(target):
    return "claude.exe" if "windows" in target else "claude"


def download(url):
    """Download url into DOWNLOADS once and return the path."""
    path = DOWNLOADS / re.sub(r"[^A-Za-z0-9._-]", "_", url.split("://", 1)[1])
    if not path.exists():
        print(f"Downloading {url}", file=sys.stderr)
        DOWNLOADS.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".part")
        with urllib.request.urlopen(url) as response, open(tmp, "wb") as f:
            shutil.copyfileobj(response, f)
        tmp.replace(path)
    return path


def file_digest(path, algorithm):
    h = hashlib.new(algorithm)
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h


def verified_npm(path, integrity, what):
    """Checks a downloaded npm tarball against its registry integrity."""
    algorithm, expected = integrity.split("-", 1)
    actual = base64.b64encode(file_digest(path, algorithm).digest()).decode()
    if actual != expected:
        path.unlink()
        sys.exit(f"Checksum mismatch for {what}; deleted {path}.")
    return path


def extract_claude(target, dest):
    """Copies the claude binary out of its npm package, byte for byte."""
    platform_name, integrity = CLAUDE[target]
    name = f"claude-code-{platform_name}"
    tarball = f"https://registry.npmjs.org/@anthropic-ai/{name}/-/{name}-{CLAUDE_VERSION}.tgz"
    path = verified_npm(download(tarball), integrity, tarball)
    exe = dest / claude_exe(target)
    with tarfile.open(path) as tar:
        member = tar.getmember(f"package/{claude_exe(target)}")
        if not member.isfile():
            sys.exit(f"Unexpected entry {member.name} in {tarball}.")
        with tar.extractfile(member) as source, open(exe, "wb") as f:
            shutil.copyfileobj(source, f)
    exe.chmod(0o755)
    return exe


def smoke_test_claude(dir, target):
    """Runs the staged claude as ClaudeCLI.sys.mjs would, for its version."""
    with tempfile.TemporaryDirectory(prefix="orbito-agent-") as home:
        result = subprocess.run(
            [dir / claude_exe(target), "--version"],
            env={
                "PATH": os.environ.get("PATH", ""),
                "HOME": home,
                "CLAUDE_CONFIG_DIR": home,
                "DISABLE_AUTOUPDATER": "1",
                "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
            },
            cwd=home,
            capture_output=True,
            timeout=60,
        )
    if not result.stdout.decode().startswith(CLAUDE_VERSION):
        sys.exit(f"The staged claude did not run:\n{result.stdout.decode()}{result.stderr.decode()}")


def stage_stamp():
    return f"claude {CLAUDE_VERSION}\n"


def stage(target):
    dest = OUT / target
    if (dest / ".stamp").exists() and (dest / ".stamp").read_text() == stage_stamp():
        print(f"{target}: up to date", file=sys.stderr)
        return
    tmp = OUT / f".{target}.tmp"
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    extract_claude(target, tmp)
    if target == host_target():
        smoke_test_claude(tmp, target)
    (tmp / ".stamp").write_text(stage_stamp())
    shutil.rmtree(dest, ignore_errors=True)
    tmp.rename(dest)
    print(f"{target}: staged {dest}", file=sys.stderr)


def main(args):
    if args == ["all"]:
        targets = list(CLAUDE)
    else:
        targets = args or [host_target()]
    for target in targets:
        if target not in CLAUDE:
            sys.exit(f"Unknown target {target}; one of: {', '.join(CLAUDE)}, all")
    for target in targets:
        stage(target)


if __name__ == "__main__":
    main(sys.argv[1:])
