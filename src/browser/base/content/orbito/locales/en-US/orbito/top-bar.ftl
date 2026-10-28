# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

## Downloads panel

orbito-downloads-title = Downloads
orbito-downloads-show-all = Show all downloads
# $current and $total are sizes, e.g. "1.5 MB".
orbito-downloads-transfer = { $current } of { $total }
orbito-downloads-starting = Starting…
orbito-downloads-progress = { $transfer } · { $percent }%
orbito-downloads-paused = Paused · { $transfer }
orbito-downloads-done = Done
orbito-downloads-done-size = { $size } · Done
orbito-downloads-deleted = File deleted
orbito-downloads-missing = File moved or missing
orbito-downloads-failed = Failed
orbito-downloads-canceled = Canceled
orbito-downloads-dirty = Blocked: may be harmful
orbito-downloads-blocked = Blocked
orbito-downloads-open = Open
orbito-downloads-show = Show in folder
orbito-downloads-resume = Resume
orbito-downloads-retry = Retry
orbito-downloads-review = Review
orbito-downloads-cancel = Cancel
orbito-downloads-row-label = { $name }, { $status }
orbito-downloads-row-label-action = { $name }, { $status }, { $action }
orbito-downloads-action-label = { $action }: { $name }

## Top bar

# $label is a button's name, $key its keyboard shortcut, e.g. "⌘R".
orbito-top-bar-with-key = { $label } ({ $key })
orbito-top-bar-show-sidebar = Show Sidebar
orbito-top-bar-back = Back
orbito-top-bar-forward = Forward
# $label is "Back" or "Forward", $key its keyboard shortcut.
orbito-top-bar-history-tooltip = { $label } ({ $key }) · Hold or right-click for history
orbito-top-bar-reload = Reload
orbito-top-bar-stop = Stop
orbito-top-bar-site-info = Site information
orbito-top-bar-site-info-waiting =
    { $count ->
        [one] Site information, { $count } permission request waiting
       *[other] Site information, { $count } permission requests waiting
    }
orbito-top-bar-address = Address
orbito-top-bar-address-placeholder = Enter an address or ask
orbito-top-bar-private = Private
orbito-top-bar-reader-view = Reader view
orbito-top-bar-close-reader-view = Close reader view
orbito-top-bar-extensions = Extensions
orbito-top-bar-extensions-waiting =
    { $count ->
        [one] Extensions, { $count } request waiting
       *[other] Extensions, { $count } requests waiting
    }
orbito-top-bar-downloads-progress = Downloads, { $percent }% done
orbito-top-bar-downloads-finished = Downloads, finished
orbito-top-bar-downloads-attention = Downloads, needs attention
orbito-top-bar-ask = Ask
# $status is one of the orbito-top-bar-ask-status-* messages.
orbito-top-bar-ask-label = Ask: { $status }
orbito-top-bar-ask-status-running = Working
orbito-top-bar-ask-status-confirm = Waiting for your approval
orbito-top-bar-ask-status-decide = Waiting for your decision
orbito-top-bar-assistant-panel = Assistant panel

## Site information panel

orbito-site-info-title = Site information
orbito-site-info-new-tab = New tab
orbito-site-info-secure = Connection is secure
orbito-site-info-cert-overridden = You added a security exception for this site
orbito-site-info-not-secure = Connection is not secure
orbito-site-info-mixed-content = Parts of this page are not secure
orbito-site-info-cert-error = Certificate is not trusted
orbito-site-info-https-only-error = Secure connection is not available
orbito-site-info-net-error = The page could not load
orbito-site-info-associated = Loaded by a secure page
orbito-site-info-chrome = Orbito page
orbito-site-info-extension = Extension page
orbito-site-info-file = Stored on this computer
orbito-site-info-local = Connected to this computer
orbito-site-info-waiting = Waiting for your answer
orbito-site-info-answer = Answer
orbito-site-info-permissions = Permissions for this site
orbito-site-info-permission-camera = Camera
orbito-site-info-permission-microphone = Microphone
orbito-site-info-permission-geo = Location
orbito-site-info-permission-desktop-notification = Notifications
orbito-site-info-permission-screen = Screen sharing
orbito-site-info-permission-speaker = Speakers
orbito-site-info-permission-popup = Pop-ups and redirects
orbito-site-info-permission-autoplay-media = Autoplay
orbito-site-info-permission-cookie = Cookies
orbito-site-info-permission-install = Add-on installs
orbito-site-info-permission-persistent-storage = Persistent storage
orbito-site-info-permission-persist-data-on-shutdown = Keep data on shutdown
orbito-site-info-permission-xr = Virtual reality
orbito-site-info-permission-midi = MIDI devices
orbito-site-info-permission-midi-sysex = MIDI devices with SysEx
orbito-site-info-permission-serial = Serial ports
orbito-site-info-permission-shortcuts = Keyboard shortcuts
orbito-site-info-permission-canvas = Canvas data
orbito-site-info-permission-focus-tab-by-prompt = Switch to this tab
orbito-site-info-permission-local-network = Local network
orbito-site-info-permission-loopback-network = Apps on this device
orbito-site-info-request-camera-microphone = Camera and microphone
orbito-site-info-request-storage-access = Cookies on other sites
orbito-site-info-state-allow = Allow
orbito-site-info-state-block = Block
orbito-site-info-state-block-audio = Block audio
orbito-site-info-state-block-all = Block audio and video
orbito-site-info-state-allow-session = Allow for session
orbito-site-info-state-ask = Ask
# $name is a permission, $state its state, e.g. "Camera: Allow".
orbito-site-info-permission-label = { $name }: { $state }
# For a permission given to this tab only, until it is closed.
orbito-site-info-permission-label-temporary = { $name }: { $state }, for now
orbito-site-info-change = Change
orbito-site-info-temporary = Until you close this tab
orbito-site-info-reload = Reload
orbito-site-info-reload-needed = Changes apply after a reload
orbito-site-info-connection-details = Connection details
orbito-site-info-remove-exception = Remove security exception
orbito-site-info-tracking-protection = Tracking protection
orbito-site-info-tracking-off = Off for this site
orbito-site-info-tracking-standard = Standard
orbito-site-info-tracking-strict = Strict
orbito-site-info-tracking-custom = Custom
# $category is one of the orbito-site-info-tracking-* settings, e.g. "Standard".
orbito-site-info-tracking-blocked =
    { $count ->
        [one] { $category } · { $count } tracker blocked
       *[other] { $category } · { $count } trackers blocked
    }
orbito-site-info-clear-data = Clear cookies and site data

## Extensions panel

orbito-extensions-title = Extensions
orbito-extensions-waiting = Waiting for your answer
orbito-extensions-answer = Answer
orbito-extensions-private-empty = No extensions run in private windows
orbito-extensions-private-empty-sub = Allow one in its details in the extensions manager.
orbito-extensions-empty = No extensions yet
orbito-extensions-empty-sub = Extensions you add show here.
orbito-extensions-open-panel = Open panel
orbito-extensions-close-panel = Close panel
# $action is "Open panel" or "Close panel", $name the extension's name.
orbito-extensions-side-panel-label = { $action }: { $name }
orbito-extensions-details = Details
orbito-extensions-manage = Manage extensions

## Command bar

orbito-command-bar-opens-new-tab = Opens in a new tab
orbito-command-bar-opens-this-tab = Opens in this tab
# Over the empty input, after ⌘T.
orbito-command-bar-placeholder-new = Search, enter an address, or ask
# Over the emptied input, after ⌘L.
orbito-command-bar-placeholder-current = Edit the address or ask
# The chip saying which tab Enter loads in.
orbito-command-bar-mode-new = New tab
orbito-command-bar-mode-current = This tab
# The Escape key's chip.
orbito-command-bar-key-esc = esc
# What a key does, after its key chips: ↑ ↓, ↵ and esc.
orbito-command-bar-key-select = Select
orbito-command-bar-key-open = Open
orbito-command-bar-key-close = Close
# The hint at the end of a result row: what Enter does with it.
orbito-command-bar-hint-go = Go
orbito-command-bar-hint-search = Search
orbito-command-bar-hint-ask = Ask
orbito-command-bar-hint-switch-tab = Switch to tab
orbito-command-bar-hint-open = Open
orbito-command-bar-hint-command = Command
# The label above the open tabs among the results.
orbito-command-bar-section-tabs = Open tabs
orbito-commands-settings = Open settings
orbito-commands-history = Show history
orbito-commands-history-description = Timeline
orbito-commands-show = Show Orbito
orbito-commands-show-description = Teach Orbito a skill by doing it
orbito-urlbar-memory = From memory
orbito-urlbar-ask = Ask Orbito
