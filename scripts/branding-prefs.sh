#!/usr/bin/env bash
# Overwrite the branding prefs surfer generates with configs/prefs/firefox-branding.js,
# and lay configs/branding-overlay/<brand>/ over the generated branding. surfer only
# copies top-level and content/ files from configs/branding, so subfolders (msix/,
# stubinstaller/) would otherwise keep the Firefox artwork.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
for dir in "$ROOT"/configs/branding/*/; do
  brand="$(basename "$dir")"
  dest="$ROOT/engine/browser/branding/$brand/pref/firefox-branding.js"
  [ -d "$(dirname "$dest")" ] && cp "$ROOT/configs/prefs/firefox-branding.js" "$dest"
  overlay="$ROOT/configs/branding-overlay/$brand"
  [ -d "$overlay" ] && cp -R "$overlay/." "$ROOT/engine/browser/branding/$brand/"
done
