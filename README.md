<p align="center">
  <img src="assets/nebula-icon.svg" width="112" height="112" alt="Nebula logo" />
</p>

<h1 align="center">Nebula</h1>

<p align="center">
  <strong>A Windows-first open-source desktop workspace for coding agents.</strong><br />
  Multi-Agent Control · Multi-Account Quotas · CNY/USD Cost Analytics · Zero Telemetry · DPAPI Secret Encryption
</p>

<p align="center">
  <a href="README.zh-CN.md"><strong>简体中文</strong></a> ·
  <a href="#highlights">Highlights</a> ·
  <a href="#features">Features</a> ·
  <a href="#download">Download &amp; Install</a> ·
  <a href="#providers">Providers</a> ·
  <a href="#privacy">Privacy &amp; Security</a> ·
  <a href="#build">Build from Source</a> ·
  <a href="#credits">Credits</a>
</p>

<p align="center">
  <a href="https://github.com/whocare0012-wq/nebula/releases">
    <img src="https://img.shields.io/github/v/release/whocare0012-wq/nebula?label=Release&color=7b5cff" alt="Latest Release" />
  </a>
  <img src="https://img.shields.io/badge/Windows-x64-0078d4" alt="Windows x64" />
  <img src="https://img.shields.io/badge/UI-English%20%7C%20%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-6e56cf" alt="English and Simplified Chinese UI" />
  <img src="https://img.shields.io/badge/Telemetry-None-0ea5a4" alt="Zero Telemetry" />
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/License-MIT-30d158" alt="MIT License" />
  </a>
</p>

---

**Nebula** (星云) is a local-first, open-source desktop workspace that orchestrates the coding agents already installed and authenticated on your machine — including **Codex**, **Claude Code**, **Antigravity**, **Cursor**, **OpenCode**, **DeepSeek Harness**, and any **ACP (Agent Client Protocol)** agent — inside one unified interface.

Built on the MIT-licensed [**T3 Code**](https://github.com/pingdotgg/t3code) codebase and interface refinements from [**Stardust**](https://github.com/zds-xiaoxin/stardust), Nebula is engineered for Windows developers who want multi-account quota visibility, multi-currency cost analytics, zero telemetry, and locally encrypted credentials out of the box.

The interface automatically follows your system language, with complete **English** and **Simplified Chinese** support.

> [!IMPORTANT]
> **Unofficial community fork.** Nebula is an independent fork of the MIT-licensed [pingdotgg/t3code](https://github.com/pingdotgg/t3code) project. "T3" and "T3 Code" belong to their original authors; Nebula is not affiliated with or endorsed by T3 Tools Inc. or the [Stardust](https://github.com/zds-xiaoxin/stardust) maintainers. Please report issues to this repository rather than upstream.

<a id="highlights"></a>

## Highlights at a Glance

| Area                       | What Nebula Delivers                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Multi-Agent Workspace**  | Bring your own subscriptions across Codex, Claude Code, Antigravity, Cursor, OpenCode, DeepSeek Harness, and ACP agents — with Git worktrees and diffs |
| **Multi-Account & Quotas** | Isolated Codex & Antigravity account homes, provider-grouped model picker, and a topbar quota capsule that follows the active thread                   |
| **Cost & Relay Analytics** | Four-tab usage workbench (Cost / Tokens / Limits / Disk), USD ↔ CNY switching with custom exchange rate, burn forecasts, and Sub2API relay monitoring  |
| **Composer & Review UX**   | Composer V9, V18 Starship reasoning-effort slider, live `tok/s` metrics, collapsible task step cards, preview pin annotations, and artifact wall       |
| **Native Windows Polish**  | Privilegeless directory junctions/hard links (no Developer Mode needed), Codex desktop & global npm ACP discovery, and clean Windows-native UI         |
| **Privacy & Security**     | Zero telemetry (no-op server, no toggle to re-enable), T3 Connect excluded, Windows DPAPI secret encryption, and independent GitHub Releases updates   |

<a id="features"></a>

## Features

### Unified Multi-Agent & Git Workflow

- **Bring your own subscriptions.** Nebula never resells tokens or requires an intermediary account — it drives the agent CLIs and managed runtimes already signed in on your machine.
- **Built-in Git & worktree isolation.** Run parallel threads in dedicated Git worktrees, review inline diffs, roll back checkpoints, and commit, push, or open pull requests directly in-app.
- **Local or remote access.** Connect to a local or remote Nebula server over LAN, Tailscale, or remote pairing links.

### Multi-Account Isolation & Live Quota Tracking

- **Isolated Codex ChatGPT accounts.** Connect multiple ChatGPT accounts under **Settings → Providers → Add ChatGPT account**. Every managed account uses Codex's native OAuth flow inside its own isolated Codex home — leaving your `~/.codex` CLI login untouched — with full quota tracking, Fast service tier support, fresh sign-in when switching accounts, and automatic detection of external login changes.
- **Isolated Antigravity accounts & model-matched quota pools.** Each Antigravity instance runs with its own isolated `GEMINI_HOME` and clean credential environment to prevent cross-account bleed. The quota capsule and model picker automatically track the pool drawn by the running model (Gemini by default; the shared pool for Claude and GPT models).
- **Provider-grouped model picker.** Accounts under the same provider share a single tab with an inline account bar displaying remaining quotas. The picker remembers your last-used account per provider and deduplicates models under **All**.
- **Context-aware topbar quota capsule.** Automatically follows the active thread's account — temporarily replacing the same provider's pinned slot if the thread runs on an unpinned account, and restoring it when the thread closes.

### Usage, Multi-Currency Cost & Relay Analytics

- **Four-tab usage workbench.** Inspect **Cost**, **Tokens**, **Limits**, and **Disk** in one dashboard with trend curves, multi-account limit rings, burn-down forecasts, and prior-period comparisons.
- **USD / CNY currency switching.** Toggle spending between US dollars and Chinese yuan with a custom, persisted exchange rate and currency-aligned chart axes.
- **Sub2API relay quota & spend tracking.** If Claude Code connects through a Sub2API relay, add it under **Settings → Providers → Add hub → Sub2API** to view upstream 5-hour and weekly Claude account limits alongside your key's balance, spend, and request totals.
- **Live turn metrics & session popovers.** Track round count, status, elapsed time, and real-time output speed (`tok/s`) right under the composer, with expandable **Session Overview** and **Tokens & Cache** popovers (and clear messaging when an agent does not report tokens or cost).

### Composer V9 & Visual Review Tools

- **V18 Starship reasoning-effort slider.** Sprite-cached multi-stage animation with idle auto-sleep; explore additional slider themes in [`stardust-kit/`](stardust-kit/README.md).
- **Task step cards.** Collapses verbose terminal output into structured timelines with durations and output counts while keeping raw commands one click away.
- **Preview pin annotations.** Drop element-level pins inside the built-in browser preview, filter by pending or resolved status, and attach cropped screenshots directly to prompts.
- **Artifact wall.** Browse generated files, documents, and images per thread or project and reveal them directly in **File Explorer** on Windows.

### Native Windows Engineering

- **No Administrator privileges or Developer Mode required.** Task folders and isolated Codex homes use Windows directory junctions and file hard links instead of symlinks, preserving shared files on cleanup and keeping newer rewritten shared configs (such as `config.toml`).
- **Seamless local CLI discovery.** Auto-detects the CLI bundled with the Codex desktop app, launches globally `npm install -g` ACP agents by command name (directly resolving `.cmd` wrappers without spawning a shell), and supports DeepSeek Harness desktop CLIs without leaving empty probe sessions in history.
- **Platform-aware interface.** Automatically hides macOS-only server controls (such as the macOS disk cleanup center and Cursor Keychain toggle) while keeping the Disk usage view, and shows `Alt` instead of `⌥` for folder selection shortcuts.

<a id="download"></a>

## Download & Install

Prebuilt Windows x64 installers are published on the [GitHub Releases](https://github.com/whocare0012-wq/nebula/releases) page:

1. Download the latest installer (`Nebula-<version>-x64.exe`; v1.0.7 and earlier used `T3-Nebula-<version>-x64.exe`) from [Releases](https://github.com/whocare0012-wq/nebula/releases).
2. Run the installer. Because community installers are not code-signed, Windows SmartScreen may ask for confirmation — click **More info**, then **Run anyway**.
3. Launch **Nebula** and enable at least one provider under **Settings → Providers**.

> [!NOTE]
> **Own app ID and data directory (since v1.0.9):** Nebula now uses its own application ID (`com.nebula.desktop`), data directory (`~/.nebula`), and install folder (`%LOCALAPPDATA%\Programs\nebula`), so it can be installed side by side with upstream T3 Code. When you upgrade from v1.0.8 or earlier, the installer removes the old Nebula registration (keeping your data), and on first launch Nebula moves `~/.t3` to `~/.nebula` and `%APPDATA%\t3code-v2` to `%APPDATA%\nebula`. The WSL backend does the same inside WSL. If T3 Code or a background `t3` service still has the old folder open, Nebula keeps using it for that launch and retries next time, so close T3 Code before the first launch. Upstream T3 Code will start with empty data afterwards. Setting `T3CODE_HOME` skips the move. Re-pin Nebula to the taskbar once after upgrading.

> [!WARNING]
> **Do not downgrade after upgrading to v1.0.8 or later:** Starting in v1.0.8, Nebula encrypts its stored secrets with Windows DPAPI (migrating existing plaintext secrets automatically on first read). Earlier versions cannot read encrypted secrets, so downgrading will require re-entering provider credentials and relay API keys. Versions before v1.0.9 also read `~/.t3`, not `~/.nebula`, so they would not see your data.

<a id="providers"></a>

## Supported Providers

Configure and manage coding agents under **Settings → Providers**:

| Provider                                                        | Setup                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Codex**                                                       | No manual install required. Sign in to one or more ChatGPT accounts in **Settings → Providers** (managed runtime installs automatically), or use an existing `codex login` or Codex desktop installation.                                                                                                                                                                                                                                            |
| **Claude Code**                                                 | Install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`. Optional Sub2API relay quota & spend tracking can be configured under **Settings → Providers → Add hub → Sub2API**.                                                                                                                                                                                                                                       |
| **Antigravity**                                                 | Enable in **Settings → Providers**, install its managed runtime (~1.25 GB free disk space required), and sign in with Google.                                                                                                                                                                                                                                                                                                                        |
| **Cursor / OpenCode / Grok Build / Kiro / Pi / Muse Code / fx** | Install and authenticate the corresponding CLI on your machine. See the [Provider Setup Guide](docs/user/install.md#providers) for exact commands.                                                                                                                                                                                                                                                                                                   |
| **DeepSeek Harness**                                            | Add a **Local ACP command**. For the npm CLI, set the executable to `dsh` with arguments `--profile` and `acp`. For the desktop app, point to `DeepSeek Harness.exe`, pass `--expose-internals`, `resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js`, `--profile`, and `acp`, and set `ELECTRON_RUN_AS_NODE=1`. _(The official ACP bridge does not report token counts, so token, cost, and speed metrics remain empty.)_ |
| **Other ACP agents**                                            | Open **Settings → Providers → Add provider → Show more** to install from the ACP Registry or register any local ACP command.                                                                                                                                                                                                                                                                                                                         |

<a id="privacy"></a>

## Privacy, Security & Updates

Nebula is designed to stay strictly local except for the model services and tools you explicitly use:

- **Zero telemetry.** Usage analytics and agent feedback reports to upstream T3 Code are hard-disabled via a no-op server implementation — no setting can turn them back on. The telemetry consent switch, upstream privacy-policy link, welcome telemetry notice, and Labs agent feedback tool are all removed.
- **No upstream relay or third-party fork tracking.** T3 Connect (which relays through upstream servers) is not compiled into this build. All third-party community fork active-user counting and external update check endpoints have been removed.
- **Transparent network traffic.** Outbound requests only go to the model providers, relays, Git hosts, and features you actively use (plus this repository's GitHub Releases for update checks, and OpenTelemetry only if you configure an export endpoint yourself).
- **Independent update channel.** The upstream official auto-updater is disabled so upstream releases can never overwrite Nebula. Installed builds check [`whocare0012-wq/nebula` Releases](https://github.com/whocare0012-wq/nebula/releases) and notify you in-app when a new version is available.

### How Credentials Are Stored on Windows

| Store                                                                                                      | Protection Model                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Nebula secret store**<br />(`~/.nebula/userdata/secrets/` — provider credentials, relay keys, sign keys) | Encrypted with **Windows DPAPI** (64-bit Windows), bound to your current Windows account on this machine. Legacy plaintext secrets are automatically sealed on first read; copied or backed-up files cannot be decrypted on another account or PC. |
| **External CLI login files**<br />(e.g., Codex `auth.json`, Antigravity OAuth tokens)                      | Kept in the format required by each official agent CLI so the CLI itself can read and refresh them, isolated inside per-account directories and protected by standard Windows account permissions (current user, Administrators, and SYSTEM).      |

<a id="build"></a>

## Build from Source

### Prerequisites

- **Node.js** `26.13.1` (Node.js 26)
- [**Vite+**](https://viteplus.dev) (`vp`)
- **Rust** (`rustup`) and **Visual Studio 2022 Build Tools** with the **Desktop development with C++** workload (required to compile the native resource monitor)

### Run in Development

```powershell
git clone https://github.com/whocare0012-wq/nebula.git
cd nebula
vp i
vp run dev
```

Open the `pairingUrl` printed in the terminal for the web app, or run `vp run dev:desktop` to launch the Electron desktop app directly.

### Package Windows Installer (x64 NSIS)

```powershell
vp run dist:desktop:win:x64
```

The installer is written to `release/Nebula-<version>-x64.exe`.

### Documentation & Testing

- Full user and developer documentation: [docs/README.md](docs/README.md)
- Development runbook: [docs/operations/00_development.md](docs/operations/00_development.md)
- Windows test baseline: `vp run test:windows apps/server apps/web apps/desktop scripts` (runs package tests while filtering known upstream POSIX-only test assumptions on Windows)

<a id="credits"></a>

## Credits

Nebula builds upon the work of the following open-source projects:

| Project                                                                        | Contribution                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [**pingdotgg/t3code**](https://github.com/pingdotgg/t3code)                    | Core application architecture, server runtime, provider adapters, orchestration engine, and checkpoints. The original upstream README is preserved in [README.upstream.md](README.upstream.md).                                                                                                                   |
| [**zds-xiaoxin/stardust**](https://github.com/zds-xiaoxin/stardust) (Stardust) | Composer V9, V18 Starship reasoning-effort slider & [`stardust-kit/`](stardust-kit/README.md), session/token popovers, topbar quota capsule, multi-account quota rings & burn-down forecasts, four-tab usage workbench, task step cards, preview pin annotations, artifact wall, and custom Chinese localization. |
| [**Leobai03/t3code-quota-ui**](https://github.com/Leobai03/t3code-quota-ui)    | Inspiration for the USD / CNY cost currency toggle.                                                                                                                                                                                                                                                               |

"T3" and "T3 Code" belong to their original authors. Nebula is an independent community-maintained project and is not affiliated with or endorsed by T3 Tools Inc. or the Stardust maintainers.

## License

Released under the [MIT License](LICENSE), consistent with upstream T3 Code. Copyright for original works remains with their respective authors.
