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

# Dev builds (no ORBITO_RELEASE) are "Orbito DEV" with their own bundle ID, so
# macOS keeps them apart from an installed release (Dock, permissions, open-with).
# These are confvars: only the branding's configure.sh can set them, not mozconfig.
if [ -z "${ORBITO_RELEASE:-}" ]; then
  branding="$ROOT/engine/browser/branding/release"
  sed -i.bak -e 's/^MOZ_APP_DISPLAYNAME="Orbito"$/MOZ_APP_DISPLAYNAME="Orbito DEV"/' \
    -e 's/^MOZ_MACBUNDLE_ID="orbito"$/MOZ_MACBUNDLE_ID="orbito-dev"/' "$branding/configure.sh"
  sed -i.bak -E -e 's/^(-brand-short(er)?-name) = Orbito$/\1 = Orbito DEV/' \
    -e 's/^-brand-full-name = Orbito Browser$/-brand-full-name = Orbito DEV/' \
    "$branding/locales/en-US/brand.ftl"
  sed -i.bak -E -e 's/^(brandShort(er)?Name)=Orbito$/\1=Orbito DEV/' \
    -e 's/^brandFullName=Orbito Browser$/brandFullName=Orbito DEV/' \
    "$branding/locales/en-US/brand.properties"
  sed -i.bak -E -e 's/^(<!ENTITY +brandShort(er)?Name +)"Orbito">$/\1"Orbito DEV">/' \
    -e 's/^(<!ENTITY +brandFullName +)"Orbito Browser">$/\1"Orbito DEV">/' \
    "$branding/locales/en-US/brand.dtd"
  rm -f "$branding"/configure.sh.bak "$branding"/locales/en-US/brand.{ftl,properties,dtd}.bak
fi
