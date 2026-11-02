<div align="center">

# Orbito

**A calm, focused web browser, built on Firefox.**

Vertical tabs, Spaces for each part of your life, one bar for everything you type,
and a history you can search by what pages said.

[**Download**](../../releases/latest) · [Features](#features) · [Privacy](#privacy) · [Build from source](#build-from-source)

English · [한국어](README.ko.md)

</div>

---

## Why Orbito

- **Tabs that stay out of the way.** Firefox's tab strip and toolbars give way to a quiet sidebar, so the page
  gets the whole window.
- **Spaces keep contexts apart.** Work, side projects and reading each get their own tabs, pinned sites and
  history.
- **One bar for everything.** Addresses and searches go in the same Command bar.
- **Find what you read.** Look up "that article from last week" by what it said, not its title. The index and
  the search model stay on your device.
- **The Firefox engine underneath.** Web standards, extensions and security come from Gecko, Firefox's engine.

## Download

Get the latest version from [**Releases**](../../releases/latest).

| Platform | File |
| --- | --- |
| macOS (Apple silicon) | `Orbito-<version>-macos-aarch64.dmg` |
| Windows (x86_64) | `Orbito-<version>-windows-x86_64-setup.exe` (installer) |
| Windows (x86_64, portable) | `Orbito-<version>-windows-x86_64.zip` |
| Linux (x86_64) | `Orbito-<version>-linux-x86_64.tar.xz` |

- **macOS**: signed with a Developer ID and notarized by Apple. Open the dmg and drag Orbito to Applications.
- **Windows**: the packages are not signed yet, so SmartScreen may warn on first launch. The installer adds a
  Start menu shortcut, an uninstall entry and a service that applies updates without an admin prompt. The zip
  runs from the extracted folder and needs write access to it to update.
- **Linux**: run `orbito` in the extracted `orbito/` folder. Like the zip, updating needs write access to that folder.

No account is needed to download or use Orbito. It checks for new releases, downloads them in the background
and applies them on the next restart. You can also check from the Updates section in Settings.

## Features

### A vertical, quiet shell

- **Sidebar**: full height on the left. **Pins** (icons shared by every Space) at the top, the Space's
  **Dock** (its pinned tabs) below, then your tabs, and the Space switcher at the bottom.
- **Top bar**: a slim strip above the page with site info, the URL, extensions and Reader View.
- **Command bar**: ⌘T / ⌘L. Addresses and searches go in one box.

### Spaces

Group tabs and the Dock by what you're working on. Switching Spaces swaps them in the sidebar, so each context
picks up where you left it.

### Browsing memory

Pages you stay on for 10 seconds or scroll through are indexed **on this device only**. Keyword search plus
semantic search finds pages by what they said, even when you've forgotten the title.

- Use it from "From memory" suggestions in the address bar or a day-by-day timeline.
- The semantic search model (EmbeddingGemma 300M) ships with the app, so it works offline from the first launch.
- Private windows, pages with password fields and sensitive sites such as banking and email are never remembered.

### Optional: Assistant panel

Orbito includes an optional assistant panel on the right (macOS ⌥⌘A, Windows Ctrl+Shift+Space). It stays
inactive until you connect your own AI provider in Settings. Browsing works the same either way.

Once set up, you can ask about the tab you're on, and let it open and read pages for you with your approval.
Tabs it opens are grouped in the sidebar, and you choose whether to keep or close them when it's done.
You can also record a task once with **Show Orbito** and have the assistant repeat it.

## Privacy

- **Browsing memory stays local.** Building and searching it sends nothing off your device; only pressing
  "Summarize" on the timeline calls your AI provider. Change the sensitive-site list, retention (30 days to
  forever), pause or erase everything in Settings.
- **The assistant is opt-in.** No AI provider is contacted until you set one up. When you ask a question, only
  the text of the tabs you picked as context is sent, and tabs on sites you excluded are left out.
- **Telemetry is off.** Orbito builds turn off Firefox's telemetry reporting and health report.

## AI providers (optional)

Choose one in Settings (`about:orbito-settings`) if you want to use the assistant. Bring your own account or API key.

| Provider | Sign-in | Where requests go |
| --- | --- | --- |
| Claude | Claude account, Anthropic API key, or a cloud provider (Amazon Bedrock, Google Cloud Vertex AI, Microsoft Foundry) | Anthropic's API or the chosen cloud provider, through the bundled Claude Code CLI |
| ChatGPT | Sign in with ChatGPT | OpenAI, sent with `store: false` so conversations aren't stored on the server |
| OpenAI-compatible | API key and endpoint | The Chat Completions server you specify (local servers work too) |

- The Claude provider's CLI keeps its own config folder inside your Orbito profile, separate from `~/.claude` on
  your computer. Its built-in tools (Bash, files and so on) are off; it uses only Orbito's browser tools.

## Build from source

Each release pushes that version's source to this repository as a single commit. Like
[Zen](https://github.com/zen-browser/desktop), Orbito uses [surfer](https://github.com/zen-browser/surfer) to
lay its patches and sources over the Firefox source.

```sh
pnpm install
pnpm run init      # fetch the Firefox source → apply patches → install build tools
pnpm build         # the first build takes a while (30 min to 1 h+ on M1/M2)
pnpm start
```

- Before building, `pnpm build` downloads the Claude Code CLI (`scripts/agent-runtime.py`, about 270 MB per
  target) and the semantic search model (`scripts/recall-model.py`, about 220 MB) into `dist/`, verified
  against pinned hashes.
- If you only changed UI (JS/CSS), `pnpm build:ui` rebuilds quickly.
- On Windows, run in a [MozillaBuild](https://wiki.mozilla.org/MozillaBuild) shell and set
  `git config core.autocrlf false` first (CRLF checkouts break the patches).

| Path | Contents |
| --- | --- |
| `surfer.json` | Base Firefox version, app name, branding |
| `configs/` | mozconfig, branding images |
| `src/` | Orbito sources laid over `engine/` (the fetched Firefox source) |
| `src/**/*.patch` | Patches to Firefox files |
| `src/browser/base/content/orbito/` | Shell, assistant panel, browsing memory, settings page |
| `src/browser/app/profile/orbito.js` | Orbito's default prefs |

## License

### Orbito

The source in this repository is licensed under the [Mozilla Public License 2.0](LICENSE) (MPL-2.0).

### Firefox (Gecko)

Orbito is built from the Mozilla Firefox source. That source isn't in this repository; `pnpm run init` fetches
it. Most of it is MPL-2.0, and some files carry other open source licenses stated in each file. See
`about:license` in the app for the full list.

Firefox and Mozilla are trademarks of the Mozilla Foundation. Orbito is not affiliated with, endorsed by or
supported by Mozilla.

### Bundled components

These two ship in the packages but are not MPL-2.0; each follows its own terms. They aren't in this repository
and are downloaded from their original sources at build time.

| Component | Owner | Terms |
| --- | --- | --- |
| Claude Code CLI (`orbito-agent/`) | Anthropic PBC | Anthropic's [Legal Agreements](https://code.claude.com/docs/en/legal-and-compliance). The unmodified original binary is bundled |
| EmbeddingGemma 300M (`browser/orbito-models/`) | Google | [Gemma Terms of Use](https://ai.google.dev/gemma/terms) and [Prohibited Use Policy](https://ai.google.dev/gemma/prohibited_use_policy) |

- The Claude Code CLI is owned by Anthropic (© Anthropic PBC, All rights reserved). Orbito bundles it under those terms.
  - The binary is not modified, and its built-in sign-in methods (Claude account, API key, cloud providers) are
    not blocked or removed.
  - Users sign in with their own API key, subscription or cloud credentials. Orbito does not pay for, resell or
    broker usage.
  - Account sign-in is done by the CLI through Anthropic's own flow; Orbito never reads or stores account tokens.
- Anthropic may change what a Claude account (subscription) can be used for without notice, and it may be
  blocked or billed separately at any time. For ongoing use, an API key or cloud provider is recommended.
- EmbeddingGemma is [onnx-community's ONNX conversion](https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX),
  modified by Orbito (weights embedded in the model file, one output turned into a sentence vector). The
  `NOTICE` next to the model records its source and the changes.
- Using the ChatGPT or OpenAI-compatible providers is subject to those services' terms.
