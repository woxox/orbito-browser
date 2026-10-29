# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

## Assistant panel

orbito-assistant-context-tab = This tab
orbito-assistant-context-tabs = All open tabs
orbito-assistant-context-none = None
orbito-assistant-effort-low = Low
orbito-assistant-effort-medium = Medium
orbito-assistant-effort-high = High
orbito-assistant-effort-max = Max
orbito-assistant-starter-summarize = Summarize this page
orbito-assistant-starter-takeaways = Key takeaways
orbito-assistant-starter-explain = Explain simply
# What a starter button asks, as if the user typed it.
orbito-assistant-starter-summarize-prompt = Summarize this page.
orbito-assistant-starter-takeaways-prompt = List the key takeaways from this page.
orbito-assistant-starter-explain-prompt = Explain what this page is about in simple terms.
orbito-assistant-draft-skill = Save this Thread as a skill
orbito-assistant-drafting-skill = Drafting a skill…
# $error is why it failed.
orbito-assistant-draft-skill-failed = Could not draft a skill: { $error }
# $name is what was typed after "/".
orbito-assistant-unknown-skill = There is no skill named /{ $name }. Type / to see the skills.
orbito-assistant-stopped-denied = Stopped: you denied a step.
orbito-assistant-signed-in = Signed in.
orbito-assistant-signed-in-as = Signed in as { $email }.
orbito-assistant-not-signed-in = Not signed in. Sign in on the settings page.
orbito-assistant-new-thread = New Thread
# In the session menu: starts one.
orbito-assistant-start-thread = New Thread
orbito-assistant-skill = Skill
orbito-assistant-skill-used = Skill used
orbito-assistant-sources = Sources
orbito-assistant-open = Open
orbito-assistant-open-settings = Open settings
orbito-assistant-open-settings-page = Open settings page
orbito-assistant-approval-needed = Approval needed
orbito-assistant-allow = Allow
orbito-assistant-deny = Deny
orbito-assistant-approval = Approval
orbito-assistant-approval-allowed = Allowed.
orbito-assistant-approval-denied = Denied.
orbito-assistant-approval-stopped = The task stopped without an answer.
orbito-assistant-approval-not-allowed = Not allowed.
orbito-assistant-approval-bypassed = Ran without asking: permissions are bypassed.
orbito-assistant-orbit-wrap-up = Orbit wrap-up
orbito-assistant-orbit-kept = Kept the result only.
orbito-assistant-orbit-released = Released the tabs as plain tabs.
orbito-assistant-orbit-closed = Closed the tabs.
orbito-assistant-orbit-gone = Moved on: its tabs are gone.
orbito-assistant-orbit-grouped = Kept them as a group.
orbito-assistant-orbit-stopped-title = The task stopped
orbito-assistant-orbit-done-title = The task is done
# $count is how many tabs the task opened (and read), done or stopped.
orbito-assistant-orbit-tabs =
    { $count ->
        [one] What should happen to the { $count } tab it read?
       *[other] What should happen to the { $count } tabs it read?
    }
orbito-assistant-orbit-close-tabs = Close tabs
orbito-assistant-orbit-keep-group = Keep as group
# $text is the memory.
orbito-assistant-memory-forgot = Forgot: { $text }
# $text is the memory.
orbito-assistant-memory-remembered = Remembered: { $text }
orbito-assistant-memory-undo = Undo
orbito-assistant-memories-used =
    { $count ->
        [one] Used { $count } memory
       *[other] Used { $count } memories
    }
orbito-assistant-memory-forgotten = Forgotten
orbito-assistant-thought-for = Thought for { $seconds }s
orbito-assistant-thinking = Thinking…
orbito-assistant-waiting = Waiting for the model…
orbito-assistant-empty = Ask anything about this page.
orbito-assistant-session-settings = Session settings
orbito-assistant-context = Context
orbito-assistant-permission = Permission mode
# $mode is the picked mode's name.
orbito-assistant-permission-button = Permission mode: { $mode }
orbito-assistant-permission-ask = Ask every time
orbito-assistant-permission-ask-description = Asks before scrolling, grouping tabs, opening tabs or acting on pages
orbito-assistant-permission-auto = Allow light actions
orbito-assistant-permission-auto-description = Scrolls and groups tabs right away; still asks before opening tabs, going to pages or acting on them
orbito-assistant-permission-bypass = Bypass permissions
orbito-assistant-permission-bypass-description = Runs everything without asking
orbito-assistant-backend-and-key = Backend and key…
# The Thread list: the header's button (with what another Thread does),
# the session menu's item and the list's name.
orbito-assistant-threads = Thread list
orbito-assistant-threads-busy = Thread list, another Thread is working
orbito-assistant-threads-waiting = Thread list, another Thread is waiting for approval
orbito-assistant-threads-heading = Thread
orbito-assistant-threads-back = Back to the Thread
orbito-assistant-threads-back-title = Back to the Thread (Esc)
orbito-assistant-threads-scope = Show Threads of
orbito-assistant-threads-this-space = This Space
orbito-assistant-threads-all-spaces = All Spaces
orbito-assistant-threads-library = See all in the Library
# The documents the Thread shown made: the header's button (with how many)
# and the list it opens in the Thread's place.
orbito-assistant-documents-button =
    { $count ->
        [one] Documents of this Thread, 1
       *[other] Documents of this Thread, { $count }
    }
orbito-assistant-documents-heading = Documents of this Thread
orbito-assistant-documents-none = No documents made in this Thread yet
# When a Thread was last asked something.
orbito-assistant-threads-just-now = Just now
orbito-assistant-threads-minutes-ago =
    { $count ->
        [one] 1 minute ago
       *[other] { $count } minutes ago
    }
orbito-assistant-threads-hours-ago =
    { $count ->
        [one] 1 hour ago
       *[other] { $count } hours ago
    }
orbito-assistant-threads-days-ago =
    { $count ->
        [one] 1 day ago
       *[other] { $count } days ago
    }
# How many documents a listed Thread made.
orbito-assistant-thread-documents =
    { $count ->
        [one] 1 document
       *[other] { $count } documents
    }
# What a listed Thread is, or is doing.
orbito-assistant-thread-scheduled = Scheduled task
orbito-assistant-thread-running = Working
orbito-assistant-thread-waiting = Waiting for approval
orbito-assistant-model-menu = Model and thinking depth
orbito-assistant-model = Model
orbito-assistant-backend = Backend
# Under the backends, when the Space has its own default backend.
orbito-assistant-backend-space = Changes this Space's default.
orbito-assistant-model-search = Search models
orbito-assistant-effort = Thinking depth
orbito-assistant-effort-note = Deeper answers take longer and use more tokens.
orbito-assistant-usage-system = System prompt
orbito-assistant-usage-tools = Tool definitions
# $context is what questions share, e.g. "This tab".
orbito-assistant-usage-tabs = Tab context · { $context }
orbito-assistant-usage-history = Thread
orbito-assistant-usage-label = Context usage: { $percent }% used
# $used and $total are token counts.
orbito-assistant-usage-title = { $percent }% of the context used · { $used } / { $total } tokens
orbito-assistant-subscription = Subscription
orbito-assistant-subscription-plan = Subscription · { $plan }
# $date is when the limit resets.
orbito-assistant-limit-resets = Resets { $date }
orbito-assistant-claude-limit-five-hour = 5-hour limit
orbito-assistant-claude-limit-seven-day = Weekly limit
orbito-assistant-claude-limit-seven-day-opus = Weekly Opus limit
orbito-assistant-claude-limit-seven-day-sonnet = Weekly Sonnet limit
# $name is the limit's name as the Claude Code CLI gives it.
orbito-assistant-claude-limit-other = Limit: { $name }
orbito-assistant-claude-plan-pro = Pro
orbito-assistant-claude-plan-max = Max
orbito-assistant-claude-plan-team = Team
orbito-assistant-claude-plan-enterprise = Enterprise
# $used and $total are token counts.
orbito-assistant-usage-context = Context · { $used } / { $total } tokens
orbito-assistant-usage-free = Free
orbito-assistant-usage-note = Estimated from what the next question sends.
orbito-assistant-settings-backend = Backend
orbito-assistant-settings-base = API base URL
orbito-assistant-settings-key-hint = The key is stored in the browser's password manager.
orbito-assistant-settings-auth = Sign in with
orbito-assistant-auth-choose = Choose…
orbito-assistant-auth-api-key = API key
orbito-assistant-auth-claude-account = Claude account
orbito-assistant-auth-cloud = Cloud provider
orbito-assistant-settings-claude-hint = Runs the Claude Code CLI that comes with Orbito, with your API key, your Claude account or a cloud provider.
orbito-assistant-settings-all = All settings
orbito-assistant-settings-cancel = Cancel
orbito-assistant-settings-save = Save
orbito-assistant-log = Thread
orbito-assistant-chip-dismiss = Dismiss
# $label is the suggestion's label.
orbito-assistant-chip-dismiss-label = Dismiss { $label }
orbito-assistant-skills = Skills
orbito-assistant-input-placeholder = Ask about this page...
orbito-assistant-input = Ask the assistant
# $effort is the thinking depth, e.g. "Medium".
orbito-assistant-model-button = Model and thinking depth: { $model }, { $effort }
orbito-assistant-model-button-title = Pick the model and thinking depth
orbito-assistant-stop = Stop response
orbito-assistant-send = Send
orbito-assistant-resize = Resize assistant panel
orbito-assistant-resize-title = Drag to resize, double-click to reset
orbito-assistant-plus = More actions

## Show Orbito: recording a demo in the Assistant panel. "Show Orbito" is
## the feature's name and stays as it is.

orbito-show = Show Orbito
orbito-show-description = Do it once and Orbito learns it as a skill
orbito-show-goal-label = What will you show?
orbito-show-goal-placeholder = Optional, e.g. Order my usual coffee
orbito-show-goal-hint = Orbito records what you do in this window's tabs, starting from the tab you are on.
orbito-show-start = Start
orbito-show-cancel = Cancel
orbito-show-watching = Orbito is watching
orbito-show-stop = Stop
# $shortcut is the keyboard shortcut, e.g. "⌘⇧.".
orbito-show-stop-title = Stop recording ({ $shortcut })
orbito-show-steps = Steps
# $count is how many actions the demo has so far.
orbito-show-recording =
    { $count ->
        [one] Recording · 1 action
       *[other] Recording · { $count } actions
    }
orbito-show-recorded = Demo recorded
orbito-show-recorded-count =
    { $count ->
        [one] 1 action recorded
       *[other] { $count } actions recorded
    }
orbito-show-stopped-timeout = Stopped after 30 minutes.
orbito-show-discard = Discard
orbito-show-agent-busy = Show Orbito can start once Orbito has finished its work in this window.
orbito-show-input-blocked = You can ask again once Show Orbito is done
orbito-show-converting = Turning the demo into a skill…
# $error says what went wrong.
orbito-show-review-failed = Could not turn the demo into a skill: { $error }
orbito-show-review-not-skill = The reply was not a skill ({ $error })
orbito-show-retry = Try again
orbito-show-review = Review the skill
# $name is the name of the skill the demo records again.
orbito-show-review-again = Review /{ $name }, recorded again
orbito-show-review-hint = Orbito made this skill of your demo. Check it before you save it.
orbito-show-review-name = Name
orbito-show-review-description = Description
orbito-show-review-inputs = Inputs
orbito-show-review-inputs-hint = An input is filled in each time the skill runs; a fixed value stays as in the demo.
orbito-show-review-as-input = As input
orbito-show-review-as-fixed = Fixed value
# $value is what was typed in the demo.
orbito-show-review-demo-value = In the demo: { $value }
orbito-show-review-fixed-value = Always: { $value }
# Under an input with personal information (an email, a name, ...) made a fixed value.
orbito-show-review-personal-warning = This value is saved in the skill file as it is, and sent to the model every time the skill runs.
orbito-show-review-steps-hint = Up and Down go between steps; Alt with them moves a step.
# $n is the step's number.
orbito-show-review-step = Step { $n }
orbito-show-review-step-up = Move step { $n } up
orbito-show-review-step-down = Move step { $n } down
orbito-show-review-step-delete = Delete step { $n }
orbito-show-review-user-enters = You enter this yourself
orbito-show-rerecord = Record again
orbito-show-save = Save
orbito-show-saving = Saving…
# $name is the skill's name.
orbito-show-saved = Saved /{ $name }

## Doing a skill made from a demo again

# $name is the skill's name.
orbito-assistant-skill-steps = Steps of /{ $name }
# $count is how many steps the skill has; $n is the step the agent is on.
orbito-assistant-skill-steps-count =
    { $count ->
        [one] 1 step
       *[other] { $count } steps
    }
orbito-assistant-skill-steps-at = Step { $n } of { $count }
orbito-assistant-skill-steps-failed = Stopped at step { $n }
orbito-assistant-skill-steps-done =
    { $count ->
        [one] 1 step done
       *[other] All { $count } steps done
    }
orbito-assistant-skill-steps-show = Show all steps
orbito-assistant-skill-steps-hide = Hide steps
# $what is what the agent could not find on the page.
orbito-assistant-skill-step-not-found = Not found: { $what }
orbito-assistant-skill-step-enter = Enter it yourself, then press Continue
# $n is the step's number.
orbito-assistant-skill-step-entered = Step { $n }, entered by you
orbito-assistant-skill-step-continue = Continue
orbito-assistant-skill-step-stop = Stop
orbito-assistant-skill-step-continued = You entered it and went on
orbito-assistant-skill-step-stopped = Stopped at a step you enter yourself.

## Suggestion chips

orbito-suggestions-summarize = Summarize
orbito-suggestions-translate = Translate
orbito-suggestions-compare = Compare

## Assistant backends and errors

orbito-assistant-backend-openai = OpenAI-compatible
orbito-assistant-backend-claude-settings = Claude (Claude Code)
orbito-assistant-backend-openai-settings = OpenAI-compatible API
orbito-assistant-backend-chatgpt-settings = ChatGPT (Sign in with ChatGPT)
orbito-assistant-key-anthropic = Anthropic API key
orbito-assistant-key-openai = OpenAI API key
# $key is the key's name, e.g. "Anthropic API key".
orbito-assistant-add-key = Add your { $key } in settings to start.
orbito-assistant-already-answering = This Thread is already answering a question.
orbito-assistant-no-skill = There is no skill named /{ $name }.
orbito-assistant-turns-dropped =
    { $count ->
        [one] The first turn was not sent to the model.
       *[other] The first { $count } turns were not sent to the model.
    }
orbito-assistant-stopped = Stopped.
orbito-assistant-stopped-tab-closed = Stopped: the tab was closed.
orbito-assistant-stopped-tool-calls = Stopped: the assistant kept making tool calls that could not run.
# $tools lists each tool with why, e.g. "search (bad schema)".
orbito-assistant-tools-not-offered = Some tools could not be offered to the model: { $tools }
orbito-assistant-thread-empty = The Thread is empty.
# $error is why the draft is not a skill.
orbito-assistant-draft-not-skill = The draft is not a skill: { $error }
orbito-assistant-skill-missing = The skill is no longer in the skills folder.
orbito-assistant-skill-exists = There is already a skill named { $name }.
# $name is the tool's name.
orbito-assistant-allow-tool = Allow { $name }?
orbito-assistant-task-running = The task is still running.
orbito-assistant-reply-writing = The reply is still being written.
orbito-assistant-reply-no-text = There is no text in this reply.
orbito-assistant-no-document = There is no such document.
orbito-assistant-private-thread = A private window can only open its own Threads.
orbito-assistant-private-no-document = A private window makes no documents.
orbito-assistant-no-thread = There is no such Thread.
# $status is the HTTP status; $detail is the server's message, maybe empty.
orbito-assistant-openai-error = OpenAI API error { $status }. { $detail }
orbito-assistant-chatgpt-login-rejected = ChatGPT did not accept the login. Sign in again in settings.
# $status is the HTTP status; $detail is the server's message, maybe empty.
orbito-assistant-chatgpt-error-status = ChatGPT error { $status }. { $detail }
orbito-assistant-chatgpt-incomplete = ChatGPT stopped before finishing.
# $reason is ChatGPT's reason, e.g. "max_output_tokens".
orbito-assistant-chatgpt-incomplete-reason = ChatGPT stopped before finishing ({ $reason }).
# $error is ChatGPT's message, or orbito-assistant-chatgpt-response-failed.
orbito-assistant-chatgpt-error = ChatGPT error: { $error }.
orbito-assistant-chatgpt-response-failed = the response failed
orbito-assistant-chatgpt-ended-early = The ChatGPT response ended before it was complete.
# $scopes are the permissions that were not granted.
orbito-assistant-chatgpt-scope-missing = Your ChatGPT account did not allow Orbito to use it directly ({ $scopes } was not granted). Your plan or workspace may not support this.
orbito-assistant-chatgpt-login-expired = Your ChatGPT login has expired. Sign in again in settings.
orbito-assistant-chatgpt-sign-in = Sign in with ChatGPT in settings to use the ChatGPT backend.
# $path is where the Claude Code CLI was looked for.
orbito-assistant-claude-missing = The Claude Code CLI was not found at { $path }. Set orbito.agent.claude to its path.
# $path is the Claude Code CLI; $error is why it did not run.
orbito-assistant-claude-failed = Could not run the Claude Code CLI at { $path }: { $error }
# $code is the exit code; $output is the end of what the CLI wrote to stderr.
orbito-assistant-claude-exited = The Claude Code CLI stopped without an answer (exit code { $code }). { $output }
orbito-assistant-claude-key-rejected = Anthropic did not accept your API key. Check it in settings.
orbito-assistant-claude-outdated = Anthropic no longer accepts the Claude Code in this version of Orbito. Update Orbito to keep using Claude.
orbito-assistant-claude-login-rejected = Your Claude account is not signed in, or the login expired. Sign in again on the settings page.
orbito-assistant-claude-cloud-rejected = The cloud provider did not accept your credentials. Sign in to it again, or check its settings on the settings page.
orbito-assistant-claude-cloud-set-up = Choose a cloud provider and fill in its settings on the settings page to use Claude through it.
# $provider is the cloud provider's name, e.g. "Amazon Bedrock".
orbito-assistant-claude-cloud-ready = Through { $provider }.
orbito-assistant-claude-choose-auth = Choose in settings how to use Claude: with an API key, your Claude account or a cloud provider.
orbito-assistant-claude-sign-in = Sign in with your Claude account on the settings page to use Claude.
orbito-assistant-claude-login-failed = The sign-in did not finish. If no browser opened, or it asked for a code to paste, sign in from a terminal with this command:
orbito-assistant-login-cancelled = The login was cancelled.
orbito-assistant-login-needs-window = Open a normal browser window to log in.
# $error is the login server's message.
orbito-assistant-login-failed = The login failed: { $error }
orbito-assistant-mcp-needs-name = Give the server a name.
orbito-assistant-mcp-invalid-url = That is not a valid URL.
orbito-assistant-mcp-http-only = Only http and https servers are supported.
orbito-assistant-mcp-no-server = There is no such server.
# $error is why the connection was lost.
orbito-assistant-mcp-connection-lost = The connection was lost: { $error }
orbito-assistant-mcp-logged-out = Logged out.
# $name is the MCP tool's name.
orbito-assistant-mcp-tool-bad-schema = { $name } was left out: its input schema is not an object.
# $name is the MCP tool's name; $error is why it was left out.
orbito-assistant-mcp-tool-left-out = { $name } was left out: { $error }
orbito-assistant-mcp-no-login-server = The server did not say where to log in (no protected resource metadata).
# $issuer is the login server's address.
orbito-assistant-mcp-login-metadata = Could not read the login server's metadata ({ $issuer }).
orbito-assistant-mcp-needs-client = This server's login does not register apps by itself. Enter a client ID for Orbito in the server's settings.
orbito-assistant-mcp-register-failed = Could not register Orbito with the login server.
# $reason is the login server's message.
orbito-assistant-mcp-register-failed-reason = Could not register Orbito with the login server: { $reason }

## Assistant tool steps and approvals

orbito-assistant-tool-forgetting = Forgetting
orbito-assistant-tool-remembering = Remembering
# $title is the tab's title.
orbito-assistant-tool-reading-tab = Reading “{ $title }”
orbito-assistant-tool-reading-a-tab = Reading a tab
# Shown on the tab being read, next to its title.
orbito-assistant-tool-reading-page = Reading the page
# $count is how many more tabs there are, after the titles listed.
orbito-assistant-tool-more-tabs = { $count } more
orbito-assistant-tool-grouping-into = Grouping tabs into “{ $name }”
orbito-assistant-tool-grouping = Grouping tabs
# $titles lists the tabs' titles, e.g. "“A”, “B”, 3 more".
orbito-assistant-tool-group-approval = Group { $titles } into “{ $name }”?
orbito-assistant-tool-ungrouping = Ungrouping tabs
# $titles lists the tabs' titles; $count is how many tabs there are.
orbito-assistant-tool-ungroup-approval =
    { $count ->
        [one] Take { $titles } out of its group?
       *[other] Take { $titles } out of their groups?
    }
orbito-assistant-tool-looking-tabs = Looking at your tabs
orbito-assistant-tool-going-back = Going back
orbito-assistant-tool-going-forward = Going forward
orbito-assistant-tool-reloading = Reloading
orbito-assistant-tool-going-to = Going to { $host }
orbito-assistant-tool-going-to-page = Going to a page
orbito-assistant-tool-go-to-approval = Go to { $url }?
orbito-assistant-tool-back-approval = Go back on { $host }?
orbito-assistant-tool-forward-approval = Go forward on { $host }?
orbito-assistant-tool-reload-approval = Reload { $host }?
orbito-assistant-tool-opening = Opening { $host }
orbito-assistant-tool-opening-tab = Opening a tab
orbito-assistant-tool-open-tab-approval = Open a new tab?
orbito-assistant-tool-switching-tab = Switching tabs
orbito-assistant-tool-closing-tab = Closing a tab
# $title is the tab's title.
orbito-assistant-tool-select-tab-approval = Switch to “{ $title }”?
# $title is the tab's title.
orbito-assistant-tool-close-tab-approval = Close “{ $title }”?
orbito-assistant-tool-reading-document = Reading a document
orbito-assistant-tool-searching-memories = Searching your memories for “{ $query }”
orbito-assistant-tool-searching-documents = Searching documents for “{ $query }”
orbito-assistant-tool-screenshot = Taking a screenshot
orbito-assistant-tool-running-script = Running a script on the page
orbito-assistant-tool-searching-history = Searching your history for “{ $query }”
orbito-assistant-tool-looking-history = Looking at your history
orbito-assistant-tool-searching-browsing = Searching pages you read for “{ $query }”
orbito-assistant-tool-searching-bookmarks = Searching your bookmarks for “{ $query }”
orbito-assistant-tool-using-skill = Using the skill /{ $name }
orbito-assistant-tool-updating-document = Updating a document
# $title is the document's title.
orbito-assistant-tool-writing = Writing “{ $title }”
orbito-assistant-tool-writing-document = Writing a document
# $target is the element, e.g. "“Sign in”".
orbito-assistant-tool-clicking = Clicking { $target }
# $target is the field, e.g. "“Search”".
orbito-assistant-tool-typing = Typing into { $target }
# $values lists the options, e.g. "“Red”, “Blue”".
orbito-assistant-tool-selecting = Selecting { $values }
orbito-assistant-tool-scrolling =
    { $direction ->
        [up] Scrolling up
        [down] Scrolling down
        [left] Scrolling left
        [right] Scrolling right
       *[other] Scrolling { $direction }
    }
orbito-assistant-tool-pressing = Pressing { $key }

# Short names of the steps the user approves, shown in bold on an
# approval once it is answered.
# $host is the site, e.g. example.com.
orbito-assistant-tool-open-site-action = Open { $host }
orbito-assistant-tool-go-to-action = Go to a page
orbito-assistant-tool-back-action = Go back
orbito-assistant-tool-forward-action = Go forward
orbito-assistant-tool-reload-action = Reload
orbito-assistant-tool-click-action = Click
orbito-assistant-tool-type-action = Type text
orbito-assistant-tool-select-action = Select an option
orbito-assistant-tool-scroll-action = Scroll
orbito-assistant-tool-press-key-action = Press a key
orbito-assistant-tool-group-action = Group tabs
orbito-assistant-tool-ungroup-action = Ungroup tabs
orbito-assistant-tool-select-tab-action = Switch tabs
orbito-assistant-tool-close-tab-action = Close a tab
orbito-assistant-tool-remember-action = Save a memory
orbito-assistant-tool-forget-action = Delete a memory
orbito-assistant-tool-run-script-action = Run a script

## Scheduled tasks

orbito-tasks-morning-brief = Morning brief
orbito-tasks-needs-name = The task needs a name.
orbito-tasks-name-too-long = A name is at most { $max } characters.
orbito-tasks-needs-prompt = The task needs a question or a skill.
orbito-tasks-no-skill = There is no skill named { $name }.
# $name is the name of a skill's input.
orbito-tasks-needs-input = Fill in the skill's input { $name }.
orbito-tasks-choose-backend = Choose a backend.
# $tool is the tool's name.
orbito-tasks-not-allowable = A task cannot be allowed { $tool }.
orbito-tasks-deleted = The task was deleted.
orbito-tasks-limit-reached = The limit of { $max } task runs a day was reached.
orbito-tasks-run-stopped = The run was stopped.
# $tools lists the tools' names.
orbito-tasks-not-allowed = Not allowed for this task: { $tools }.
# $name is the task's name.
orbito-tasks-done = { $name } done
# $name is the task's name; $error is why it failed.
orbito-tasks-failed = { $name } failed: { $error }
orbito-tasks-open-result = Click to open the result.
orbito-tasks-see-runs = Click to see the task's runs.

## Task schedules

orbito-schedule-choose-kind = Choose every hour, every day or every week.
orbito-schedule-minute-range = The minute must be a whole number from { $min } to { $max }.
orbito-schedule-hour-range = The hour must be a whole number from { $min } to { $max }.
orbito-schedule-day-range = The day must be a whole number from { $min } to { $max }.
# $minute is two digits, e.g. "05".
orbito-schedule-hourly = Every hour at :{ $minute }
# $time is e.g. "08:00".
orbito-schedule-daily = Every day at { $time }
# $weekday is 0 (Sunday) to 6 (Saturday); $time is e.g. "08:00".
orbito-schedule-weekly =
    { $weekday ->
        [0] Every Sunday at { $time }
        [1] Every Monday at { $time }
        [2] Every Tuesday at { $time }
        [3] Every Wednesday at { $time }
        [4] Every Thursday at { $time }
        [5] Every Friday at { $time }
       *[6] Every Saturday at { $time }
    }
