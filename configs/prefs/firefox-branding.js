/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Replaces the file surfer generates on `surfer import` (which points at zen-browser.app).
// Copied into engine/browser/branding/*/pref/ by scripts/branding-prefs.sh.

pref("startup.homepage_override_url", "");
pref("startup.homepage_welcome_url", "");
pref("startup.homepage_welcome_url.additional", "");

// Release builds check the public repository's latest release (build/moz.build).
pref("app.update.interval", 21600); // 6 hours
// Give the user x seconds to react before showing the big UI. default=192 hours
pref("app.update.promptWaitTime", 691200);
pref("app.update.url.manual", "https://github.com/woxox/orbito-browser/releases/latest");
pref("app.update.url.details", "https://github.com/woxox/orbito-browser/releases");
pref("app.releaseNotesURL", "");
pref("app.releaseNotesURL.aboutDialog", "");
pref("app.releaseNotesURL.prompt", "");

// Number of usages of the web console.
// If this is less than 5, then pasting code into the web console is disabled
pref("devtools.selfxss.count", 5);
