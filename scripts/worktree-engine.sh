#!/usr/bin/env bash
# Give a git worktree its own engine/, so it builds and runs its own src/
# without touching the main checkout's. engine/, dist/, .surfer/ and
# node_modules/ are cloned from the main checkout with APFS clones (cp -c:
# copy-on-write, next to no disk), skipping full-build objdirs; then every
# symlink into the main checkout is pointed at this worktree, and the
# import re-run so this worktree's patches and new files apply.
#
# Afterwards build and run here as usual: pnpm build:artifact,
# pnpm start:artifact, cd engine && ./mach python ../scripts/...
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MAIN="$(cd "$(git -C "$ROOT" rev-parse --git-common-dir)/.." && pwd)"
if [ "$ROOT" = "$MAIN" ]; then
  echo "Run this in a worktree, not the main checkout." >&2
  exit 1
fi
[ -d "$MAIN/engine" ] || { echo "No engine/ in $MAIN." >&2; exit 1; }

if [ ! -d "$ROOT/engine" ]; then
  mkdir "$ROOT/engine"
  for entry in "$MAIN/engine"/.[!.]* "$MAIN/engine"/*; do
    [ -e "$entry" ] || continue
    case "$(basename "$entry")" in
      obj-artifact) ;;
      obj-*) continue ;;
    esac
    cp -cRP "$entry" "$ROOT/engine/"
  done
fi
for dir in dist .surfer node_modules; do
  [ -e "$ROOT/$dir" ] || [ ! -e "$MAIN/$dir" ] || cp -cRP "$MAIN/$dir" "$ROOT/$dir"
done

# Links to src/ (from the import) and to engine/ (from the objdir).
find "$ROOT/engine" -type l -print0 |
  while IFS= read -r -d '' link; do
    target="$(readlink "$link")"
    case "$target" in
      "$MAIN"/*) ln -sfn "$ROOT${target#"$MAIN"}" "$link" ;;
    esac
  done

# The objdir was configured for the main checkout's engine/.
rm -f "$ROOT/engine/obj-artifact/config.status"

cd "$ROOT"
pnpm run import
