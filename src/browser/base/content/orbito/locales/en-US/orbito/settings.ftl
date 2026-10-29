# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

## Settings page

orbito-settings-title = Orbito Settings
orbito-settings-heading = Orbito settings
orbito-settings-library-hint = Past documents and Threads are in the <a data-l10n-name="open-library">library</a>.
orbito-settings-panes =
    .aria-label = Settings
orbito-settings-general = General
# The rail's group of the Assistant's panes.
orbito-settings-assistant = Assistant

## Shared

orbito-settings-cancel = Cancel
orbito-settings-save = Save
orbito-settings-delete = Delete
orbito-settings-edit = Edit
orbito-settings-on = On
orbito-settings-name = Name

## Appearance

orbito-settings-appearance = Appearance
orbito-settings-theme = Theme
orbito-settings-theme-hint = Follow the system, or pick light or dark.
orbito-settings-accent = Accent color
orbito-settings-accent-hint = Tints the window frame and every highlight.
orbito-settings-no-firefox-themes =
    Firefox themes are not used: add-ons cannot install themes or change
    the browser's colors.
orbito-appearance-theme-system = System
orbito-appearance-theme-light = Light
orbito-appearance-theme-dark = Dark
orbito-appearance-accent-violet = Violet
orbito-appearance-accent-blue = Blue
orbito-appearance-accent-green = Green
orbito-appearance-accent-coral = Coral
orbito-appearance-accent-graphite = Graphite

## Layout

orbito-settings-layout = Layout
orbito-settings-sidebar-collapsed = Hide the Sidebar
# $shortcut is the keyboard shortcut, e.g. "⌘S".
orbito-settings-sidebar-collapsed-hint =
    It shows while the pointer is on the window's left edge. { $shortcut }
    also switches it.
orbito-settings-assistant-auto-open = Open the Assistant panel
orbito-settings-assistant-auto-open-hint = Opens the panel on the right with every new window.

## Account

orbito-settings-account = Account
orbito-settings-sync = Sync with a Mozilla account
orbito-settings-sync-hint =
    Keeps bookmarks, history, passwords and open tabs the same on
    your other devices.
orbito-settings-sync-disabled = Sync is turned off in this browser.
orbito-settings-sync-login-failed = Sign in again to keep syncing as { $email }.
orbito-settings-sync-not-verified = Confirm your account from the email sent to { $email }.
orbito-settings-sync-off = Signed in as { $email }. Sync is off.
orbito-settings-sync-syncing = Signed in as { $email }. Syncing…
# $date is when Sync last ran, as a date and time.
orbito-settings-sync-last-synced = Signed in as { $email }. Last synced { $date }.
orbito-settings-sync-not-synced = Signed in as { $email }. Not synced yet.
orbito-settings-not-signed-in = Not signed in.
orbito-settings-sign-in = Sign in
orbito-settings-sign-in-again = Sign in again
orbito-settings-sign-out = Sign out
orbito-settings-manage-account = Manage account
orbito-settings-confirm-account = Confirm account
orbito-settings-turn-on-sync = Turn on sync
orbito-settings-choose-what-to-sync = Choose what to sync
orbito-settings-sync-now = Sync now

## Backends

orbito-settings-backends = Backends
orbito-settings-chatgpt-hint =
    Use your ChatGPT Plus or Pro subscription with the ChatGPT backend.
    You sign in on OpenAI's page; Orbito never sees your password.
orbito-settings-chatgpt-login = Sign in with ChatGPT
orbito-settings-chatgpt-signing-in = Waiting for you to sign in in the new tab…
orbito-settings-chatgpt-signed-in-as = Signed in as { $email }.
orbito-settings-chatgpt-signed-in = Signed in.
orbito-settings-chatgpt-needs-login = Sign in again: the login expired or was revoked.
orbito-settings-claude-hint =
    Orbito runs Claude Code, Anthropic's CLI, with an Anthropic API key, your Claude subscription or a cloud provider.
    Claude Code is subject to Anthropic's terms, and Anthropic may change how a subscription can be used with it.
    Claude Code signs in for Orbito only, in your browser; your own Claude Code login is not used.
orbito-settings-claude-auth =
    .aria-label = How to use Claude
orbito-settings-claude-api-key = API key
orbito-settings-claude-account = Claude account
orbito-settings-claude-cloud = Cloud provider
orbito-settings-claude-cloud-provider = Provider
orbito-settings-claude-cloud-region = Region
orbito-settings-claude-cloud-profile = AWS profile
orbito-settings-claude-cloud-project = Project ID
orbito-settings-claude-cloud-resource = Resource name
orbito-settings-claude-cloud-key = API key (optional)
orbito-settings-claude-cloud-bedrock-hint =
    Without an Amazon Bedrock API key, Claude Code uses your AWS credentials on this computer, from ~/.aws
    (sign in with aws sso login or aws configure in a terminal). The region may be left empty when the profile sets one.
orbito-settings-claude-cloud-vertex-hint =
    Claude Code uses your Google Cloud application default credentials on this computer
    (sign in with gcloud auth application-default login in a terminal). Without a region, it uses us-east5.
orbito-settings-claude-cloud-foundry-hint =
    The resource is its name alone, not a URL. Without an API key, Claude Code signs in with the Azure CLI (az login),
    which it may not find when Orbito is not started from a terminal; the API key works either way.
orbito-settings-claude-cloud-set-up = Choose a provider, fill in its settings and save.
# $provider is the cloud provider's name, e.g. "Amazon Bedrock".
orbito-settings-claude-cloud-ready = Claude is used through { $provider }.
orbito-settings-claude-uses-key = The key is set in the assistant panel's settings.
orbito-settings-claude-choose = Choose how to use Claude.
orbito-settings-claude-login = Sign in with Claude
orbito-settings-claude-signing-in = Waiting for you to sign in in your browser…
orbito-settings-claude-signed-in-as = Signed in as { $email }.
orbito-settings-claude-signed-in = Signed in.

## Spaces

orbito-settings-spaces = Spaces
orbito-settings-spaces-hint =
    Each Space's name, the backend and model its new Threads start with,
    and what is kept for it only. Left empty, a Space uses the backend and
    model picked in the Assistant panel. A Thread keeps its backend once it
    has started.
orbito-settings-space-backend-default = Same as everywhere
orbito-settings-space-name = Name
orbito-settings-space-memories = Memories for this Space only
orbito-settings-space-skills = Skills for this Space only
orbito-settings-space-none = None
orbito-settings-space-remove = Delete Space

## Memory

orbito-settings-memory = Memory
orbito-settings-memory-hint =
    Facts you asked the assistant to remember. They go into every new
    Thread; private windows never use them.
orbito-settings-memory-enabled = Use memories
orbito-settings-memory-enabled-hint = Read them in Threads and save new ones when you ask
orbito-settings-memory-space = Space it is kept for
orbito-settings-memory-all-spaces = All Spaces
orbito-settings-memory-space-gone = Removed Space
orbito-settings-memories-empty = No memories yet.
orbito-settings-memories-clear-question = Delete all memories? This cannot be undone.
orbito-settings-memories-clear-confirm = Delete all
orbito-settings-memories-clear-start = Delete all memories
# $saved and $used are dates and times.
orbito-settings-memory-meta-used = Saved { $saved }, last used { $used }
orbito-settings-memory-meta-unused = Saved { $saved }, not used yet
# Followed by the address of the page the memory was saved from.
orbito-settings-memory-source = From

## Skills

orbito-settings-skills = Skills
orbito-settings-skills-hint =
    Instructions you call with /name in the panel or the address bar;
    the assistant may also pick one that fits. Built-in skills cannot be
    changed, but a copy of one can, and it then replaces the built-in.
orbito-settings-skill-new = New skill
orbito-settings-skill-from-demo = Create from a demo
orbito-settings-skill-new-from-thread = New skill from a Thread
# $name is the skill's name.
orbito-settings-skill-copy-title = Copy of /{ $name }
orbito-settings-skill-edit-title = Edit /{ $name }
orbito-settings-skill-builtin = Built-in
orbito-settings-skill-yours = Yours
orbito-settings-skill-from-demo-kind = Made from a demo
orbito-settings-skill-rerecord = Record again
orbito-settings-skill-copy = Copy
orbito-settings-skill-space = Used in
orbito-settings-skill-all-spaces = All Spaces
orbito-settings-skill-space-gone = Removed Space
orbito-settings-description = Description
orbito-settings-skill-description-input =
    .placeholder = When the assistant should use it
orbito-settings-tools = Tools
orbito-settings-skill-tools-hint =
    The tools the instructions use, separated by commas. Only shown
    here: the assistant may still use any tool.
orbito-settings-output = Output
orbito-settings-output-chat = Chat
orbito-settings-output-document = Document
orbito-settings-skill-instructions = Instructions

## Scheduled tasks

orbito-settings-tasks = Scheduled tasks
orbito-settings-tasks-hint =
    Questions the assistant answers on its own, without a window. Each
    answer is saved as a document, and a notification says when it is
    ready. Tasks use tools that change nothing, and only the other
    tools you allow them.
orbito-settings-tasks-empty = No tasks yet.
orbito-settings-task-morning-brief = Morning brief
orbito-settings-task-new = New task
# $name is the task's name.
orbito-settings-task-edit-title = Edit { $name }
orbito-settings-task-name-input =
    .placeholder = Review requests
orbito-settings-skill = Skill
orbito-settings-task-no-skill = None: ask the question
orbito-settings-question = Question
orbito-settings-task-prompt-placeholder = What the assistant is asked each time
orbito-settings-task-prompt-skill-placeholder = Words after the skill's name, if any
orbito-settings-task-direct-warning = It has steps you enter yourself, so its runs stop there
orbito-settings-task-inputs = The skill's inputs
orbito-settings-task-inputs-hint = Each run fills them in with these values.
orbito-settings-repeat = Repeat
orbito-settings-repeat-hourly = Every hour
orbito-settings-repeat-daily = Every day
orbito-settings-repeat-weekly = Every week
orbito-settings-minute = Minute
orbito-settings-day = Day
orbito-settings-weekday-monday = Monday
orbito-settings-weekday-tuesday = Tuesday
orbito-settings-weekday-wednesday = Wednesday
orbito-settings-weekday-thursday = Thursday
orbito-settings-weekday-friday = Friday
orbito-settings-weekday-saturday = Saturday
orbito-settings-weekday-sunday = Sunday
orbito-settings-time = Time
orbito-settings-task-space = Space
orbito-settings-task-all-spaces = All Spaces
orbito-settings-task-space-gone = Removed Space
orbito-settings-task-backend-space = The Space's default
orbito-settings-backend = Backend
orbito-settings-model = Model
orbito-settings-task-model-input =
    .placeholder = The backend's current model
orbito-settings-allowed-tools = Allowed tools
orbito-settings-allowed-tools-hint = Tools that change something, which the task may use without asking.
orbito-settings-no-such-tools = No such tools.
orbito-settings-task-running = Running…
# $date is a date and time.
orbito-settings-task-next-run = Next run { $date }
orbito-settings-task-off = Off
# $date is a date and time; $status is the run's status.
orbito-settings-task-last-run =
    last run { $date }: { $status ->
        [ok] done
        [failed] failed
        [skipped] skipped
       *[other] { $status }
    }
# $state is the task's state (e.g. "Next run …"), $lastRun how its last run went.
orbito-settings-task-meta = { $state }, { $lastRun }
# $tokens is the token counts, e.g. "1,200 in, 80 out tokens".
orbito-settings-task-tokens = Used so far: { $tokens }
# $input and $output are counts of tokens.
orbito-settings-tokens = { $input } in, { $output } out tokens
orbito-settings-task-runs = Runs
orbito-settings-task-run-now = Run now
orbito-settings-runs-empty = No runs yet.
orbito-settings-run-status =
    { $status ->
        [running] Running…
        [ok] Done
        [failed] Failed
        [skipped] Skipped
       *[other] { $status }
    }
orbito-settings-run-open-result = Open the result

## MCP servers

orbito-settings-mcp = MCP servers
orbito-settings-mcp-hint =
    Tools from these servers are offered to every backend. The assistant
    asks before it runs one.
orbito-settings-mcp-empty = No servers yet.
orbito-settings-mcp-add = Add a server
orbito-settings-mcp-name-input =
    .placeholder = Calendar
orbito-settings-url = URL
orbito-settings-authentication = Authentication
orbito-settings-auth-none = None
orbito-settings-auth-header = Header
orbito-settings-auth-oauth = OAuth login
orbito-settings-header-name = Header
orbito-settings-header-value = Value
orbito-settings-header-hint = The value is stored in the browser's password manager.
orbito-settings-oauth-hint =
    Servers that need a login usually register Orbito by themselves.
    If yours cannot, enter the client ID (and secret) you were given.
orbito-settings-client-id = Client ID
orbito-settings-client-secret = Client secret
orbito-settings-optional-input =
    .placeholder = Optional
orbito-settings-mcp-add-submit = Add server
orbito-settings-mcp-status =
    { $status ->
        [connected] Connected
        [connecting] Connecting…
        [error] Failed
        [disabled] Off
        [needs_login] Login needed
        [logging_in] Logging in…
       *[other] { $status }
    }
orbito-settings-mcp-tools =
    { $count ->
        [one] { $count } tool
       *[other] { $count } tools
    }
orbito-settings-mcp-tool-read-only = (runs without asking)
orbito-settings-mcp-trust-read-only = Trust read-only hints
orbito-settings-mcp-trust-read-only-hint = Run tools the server marks read-only without asking
orbito-settings-mcp-remove = Remove
orbito-settings-mcp-reconnect = Reconnect
orbito-settings-mcp-cancel-login = Cancel login
orbito-settings-mcp-log-in = Log in
orbito-settings-mcp-log-out = Log out
orbito-settings-unchanged = Unchanged
orbito-settings-client-id-registered = Registered by the server

## Updates

orbito-settings-updates = Updates
# $version: Orbito's version, like 0.1.0
orbito-settings-update-version = Orbito { $version }
orbito-settings-update-check = Check for updates
orbito-settings-update-checking = Checking for updates…
orbito-settings-update-none = Orbito is up to date.
# $version: the update's version
orbito-settings-update-available = Orbito { $version } is out.
orbito-settings-update-install = Update and restart
# $percent: how much is downloaded, from 0 to 100
orbito-settings-update-downloading = Downloading the update, { $percent }%
orbito-settings-update-staging = Getting the update ready…
orbito-settings-update-ready = The update is ready. Restart to apply it.
orbito-settings-update-restart = Restart
# $version: the update's version
orbito-settings-update-manual = Orbito { $version } is out. Download it from the release page to install it.
orbito-settings-update-open-release = Open the release page
orbito-settings-update-check-failed = Couldn't check for updates.
orbito-settings-update-download-failed = Couldn't download the update.
orbito-settings-update-other-instance = Another copy of Orbito is updating.
orbito-settings-update-unsupported = This build doesn't update itself.

## Advanced

orbito-settings-advanced = Advanced
orbito-settings-firefox-settings = Firefox settings
orbito-settings-firefox-settings-hint =
    Search engines, the downloads folder, privacy and other details
    are in Firefox's settings.
orbito-settings-open-firefox-settings = Open Firefox settings

## Browsing recall

orbito-settings-recall = Browsing recall
orbito-settings-recall-hint =
    The text of the pages you read, kept on this computer so that the
    assistant can find what you saw before. Private windows, pages with a
    password field and the domains below are never kept.
orbito-settings-recall-enabled = Remember the pages I read
orbito-settings-recall-retention = Keep pages for
orbito-settings-recall-retention-hint = Counted from their last visit.
# Variables:
#   $days (Number): how many days pages are kept
orbito-settings-recall-days = { $days } days
orbito-settings-recall-forever = Forever
orbito-settings-recall-domains = Never remember
orbito-settings-recall-domains-hint =
    Pages on these domains and their subdomains. Adding one forgets what
    was kept from it.
orbito-settings-recall-domain-input =
    .aria-label = Domain to never remember
orbito-settings-recall-domain-add = Add
orbito-settings-recall-domain-error = Type a domain, like example.com.
orbito-settings-recall-domain-remove = Remove
# Variables:
#   $domain (String): the domain the button removes
orbito-settings-recall-domain-remove-label = Remove { $domain }
# Variables:
#   $pages (Number): how many pages are remembered
#   $size (String): the space they take, e.g. "1.5 MB"
orbito-settings-recall-stats =
    { $pages ->
        [one] { $pages } page remembered, { $size }.
       *[other] { $pages } pages remembered, { $size }.
    }
orbito-settings-recall-open-timeline = Open timeline

## Delete all agent data

orbito-settings-delete-data = Delete all agent data
orbito-settings-delete-data-hint =
    Remembered pages, Threads, memories, documents and the runs of
    scheduled tasks. Settings, skills and the tasks themselves stay.
orbito-settings-delete-data-question = Delete all agent data? This cannot be undone.
orbito-settings-delete-data-confirm = Delete everything
orbito-settings-delete-data-start = Delete all agent data
