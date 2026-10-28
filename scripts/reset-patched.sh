#!/usr/bin/env bash
# Restore the engine files src/**/*.patch change, so a changed patch applies
# on the original file instead of on the one an earlier import patched.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[ -d "$ROOT/engine/.git" ] || exit 0
find "$ROOT/src" -name '*.patch' -exec sed -n 's|^+++ b/||p' {} + |
  sort -u | xargs git -C "$ROOT/engine" checkout --
