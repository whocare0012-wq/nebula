<p align="center">
  <img src="assets/nebula-icon.svg" width="112" height="112" alt="T3 Nebula logo" />
</p>

<h1 align="center">T3 Nebula</h1>

<p align="center">
  <strong>A Windows-first community edition of T3 Code — the open-source desktop workspace for coding agents.</strong><br />
  Multi-Agent Control · Multi-Account Quota Insights · CNY/USD Cost Analytics · Bilingual EN / ZH UI
</p>

<p align="center">
  <a href="README.zh-CN.md"><strong>简体中文</strong></a> ·
  <a href="#features">Features</a> ·
  <a href="#download">Download &amp; Install</a> ·
  <a href="#providers">Providers</a> ·
  <a href="#build">Build from Source</a> ·
  <a href="#privacy">Privacy &amp; Updates</a> ·
  <a href="#credits">Credits</a>
</p>

<p align="center">
  <a href="https://github.com/whocare0012-wq/t3-nebula/releases">
    <img src="https://img.shields.io/github/v/release/whocare0012-wq/t3-nebula?label=Release&color=7b5cff" alt="Latest Release" />
  </a>
  <img src="https://img.shields.io/badge/Windows-x64-0078d4" alt="Windows x64" />
  <img src="https://img.shields.io/badge/UI-English%20%7C%20%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-6e56cf" alt="English and Simplified Chinese UI" />
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/License-MIT-30d158" alt="MIT License" />
  </a>
</p>

---

**T3 Nebula** is an open-source desktop workspace that orchestrates the coding agents already installed and authenticated on your machine — including **Codex**, **Claude Code**, **Antigravity**, **Cursor**, **OpenCode**, **DeepSeek Harness**, and any **ACP (Agent Client Protocol)** agent — inside one fast, unified interface.

Built upon upstream [**T3 Code**](https://github.com/pingdotgg/t3code) and the [**T3 Stardust**](https://github.com/zds-xiaoxin/xiaoxin-t3code) interface refinements, T3 Nebula focuses on first-class Windows desktop support, multi-account quota visibility, multi-currency cost analytics, and privacy-first defaults.

The interface automatically follows your system language, with complete **English** and **Simplified Chinese** support.

<a id="features"></a>

## Features

### Unified Multi-Agent Workspace

- **Bring your own subscriptions.** T3 Nebula does not resell tokens or require an intermediary account — it drives the agent CLIs and runtimes you are already signed in to.
- **Built-in Git & worktree workflow.** Isolate threads in dedicated Git worktrees, inspect diffs inline, restore checkpoints, and commit, push, or open pull requests directly from the app.
- **Multi-device ready.** Run the server locally or on a remote host and connect over LAN, Tailscale, or T3 Connect.

### Composer V9 & Reasoning Effort Controls

- **Provider-grouped model picker.** Multiple accounts under the same provider share a single tab with an inline account switcher showing each account's remaining quota. The picker remembers your last-used account per provider and deduplicates models under **All**.
- **V18 Starship reasoning-effort slider.** Smooth, sprite-cached multi-stage slider with idle auto-sleep. Additional slider themes are available in [`stardust-kit/`](stardust-kit/README.md).
- **Live turn metrics & session popovers.** Monitor round count, turn status, elapsed time, and real-time output speed (`tok/s`) directly beneath the composer, with quick popovers for **Session Overview** and **Tokens & Cache**.

### Multi-Account & Real-Time Quota Tracking

- **Isolated Codex ChatGPT accounts.** Connect multiple ChatGPT accounts under **Settings → Providers → Add ChatGPT account**. Each managed account authenticates through Codex's native sign-in flow inside its own isolated Codex home directory — leaving your `~/.codex` CLI login untouched — with full usage-limit tracking and Fast service tier support.
- **Context-aware topbar quota capsule.** Automatically follows the active thread's account (temporarily showing an unpinned account in place of the same provider's pinned slot until the thread closes). On Antigravity, the capsule and picker display the quota pool drawn by the active model (Gemini by default, and the shared pool for Claude and GPT models).

### Usage, Cost & Relay Analytics

- **Multi-tab usage workbench.** Inspect spending, token consumption, rate limits, burn-down forecasts, prior-period comparisons, and disk usage from a single dashboard.
- **USD / CNY currency switching.** Display costs in US dollars or Chinese yuan with a configurable, persisted exchange rate and currency-aligned chart axes.
- **Sub2API relay quota support.** If Claude Code connects through a Sub2API relay, add it under **Settings → Providers → Add hub → Sub2API** to view 5-hour and weekly account limits as well as per-key spend and request totals directly in the Usage view.

### Productivity & Review Tools

- **Task step cards.** Collapses verbose shell activity into structured, human-readable timelines with duration and output counts while keeping raw commands expandable.
- **Preview pin annotations.** Drop element-level pins inside the built-in browser preview, filter by pending/resolved status, and attach cropped screenshots directly to prompts.
- **Artifact wall.** Browse generated files, documents, and images per thread or project and open them directly in **File Explorer** on Windows.

### Native Windows Polish

- **Privilegeless workspace & account linking.** Task folders and isolated Codex homes use directory junctions and hard links on Windows, requiring neither Administrator privileges nor Windows Developer Mode.
- **Seamless CLI discovery.** Automatically locates Codex desktop-bundled CLIs, launches globally npm-installed ACP agents by name (resolving `.cmd` wrappers directly without spawning a shell), and keeps DeepSeek Harness status probes out of your session history.
- **Platform-aware UI.** macOS-only controls (such as the macOS disk cleanup center and Cursor Keychain toggle) are hidden on Windows while preserving disk usage visibility.

<a id="download"></a>

## Download & Install

Prebuilt Windows installers are published on the [GitHub Releases](https://github.com/whocare0012-wq/t3-nebula/releases) page.

1. Download the latest `T3-Nebula-<version>-x64.exe` installer from [Releases](https://github.com/whocare0012-wq/t3-nebula/releases).
2. Run the installer. Because community installers are not code-signed, Windows SmartScreen may ask for confirmation — click **More info**, then **Run anyway**.
3. Launch **T3 Nebula** and enable at least one provider under **Settings → Providers**.

> [!NOTE]
> **Shared data directory:** T3 Nebula shares T3 Code's application ID and local data directory (`~/.t3`), so existing projects and thread histories carry over automatically. Because of this shared ID, T3 Nebula and official T3 Code cannot be installed side by side.

<a id="providers"></a>

## Supported Providers

Open **Settings → Providers** to enable and configure your coding agents:

| Provider                                                        | Setup                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Codex**                                                       | No manual install required. Connect one or more ChatGPT accounts in **Settings → Providers** (managed runtime installs automatically), or use an existing `codex login` or Codex desktop installation.                                                                                                                                                                                                                                               |
| **Claude Code**                                                 | Install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`. Optional Sub2API relay quota tracking can be configured under **Settings → Providers → Add hub → Sub2API**.                                                                                                                                                                                                                                               |
| **Antigravity**                                                 | Enable in **Settings → Providers**, install its managed runtime (~1.25 GB free disk space required), and sign in with Google.                                                                                                                                                                                                                                                                                                                        |
| **Cursor / OpenCode / Grok Build / Kiro / Pi / Muse Code / fx** | Install and authenticate the corresponding CLI on your machine. See the [Provider Setup Guide](docs/user/install.md#providers) for exact commands.                                                                                                                                                                                                                                                                                                   |
| **DeepSeek Harness**                                            | Add a **Local ACP command**. For the npm CLI, set the executable to `dsh` with arguments `--profile` and `acp`. For the desktop app, point to `DeepSeek Harness.exe`, pass `--expose-internals`, `resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js`, `--profile`, and `acp`, and set `ELECTRON_RUN_AS_NODE=1`. _(The official ACP bridge does not report token counts, so token, cost, and speed metrics remain empty.)_ |
| **Other ACP agents**                                            | Open **Settings → Providers → Add provider → Show more** to install from the ACP Registry or register any local ACP command.                                                                                                                                                                                                                                                                                                                         |

<a id="build"></a>

## Build from Source

### Prerequisites

- **Node.js** `26.13.1` (Node.js 26)
- [**Vite+**](https://viteplus.dev) (`vp`)
- **Rust** (`rustup`) and **Visual Studio 2022 Build Tools** with the **Desktop development with C++** workload (required to compile the native resource monitor)

### Development

```powershell
git clone https://github.com/whocare0012-wq/t3-nebula.git
cd t3-nebula
vp i
vp run dev
```

Open the `pairingUrl` printed in the terminal to access the web interface, or run `vp run dev:desktop` to start the Electron desktop app directly.

### Package Windows Installer (x64 NSIS)

```powershell
vp run dist:desktop:win:x64
```

The generated installer is written to `release/T3-Nebula-<version>-x64.exe`.

### Documentation & Testing

- Full user and developer documentation: [docs/README.md](docs/README.md)
- Development runbook: [docs/operations/00_development.md](docs/operations/00_development.md)
- Windows test baseline: `vp run test:windows` (runs package tests while filtering known upstream POSIX-only test assumptions on Windows)

<a id="privacy"></a>

## Privacy & Updates

- **Telemetry off by default.** Upstream T3 Code anonymous usage reporting stays disabled until you explicitly enable it under **Settings → About**.
- **No third-party fork tracking.** All third-party active-user counting and external fork update endpoints have been removed.
- **Local credentials.** Provider tokens and relay API keys remain on your local server and are only sent to their respective configured endpoints.
- **Independent update channel.** The official T3 Code auto-updater is disabled so upstream builds will never overwrite this installation. Installed builds check this repository's [Releases](https://github.com/whocare0012-wq/t3-nebula/releases) and notify you in-app when a new version is available.

<a id="credits"></a>

## Credits

T3 Nebula builds upon the work of the following open-source projects:

| Project                                                                                       | Contribution                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [**pingdotgg/t3code**](https://github.com/pingdotgg/t3code)                                   | Core architecture, server runtime, provider adapters, orchestration engine, and checkpoints. The original upstream README is preserved in [README.upstream.md](README.upstream.md).                                                                                                                               |
| [**zds-xiaoxin/xiaoxin-t3code**](https://github.com/zds-xiaoxin/xiaoxin-t3code) (T3 Stardust) | Composer V9, V18 Starship reasoning-effort slider & [`stardust-kit/`](stardust-kit/README.md), session/token popovers, topbar quota capsule, multi-account quota rings & burn-down forecasts, four-tab usage workbench, task step cards, preview pin annotations, artifact wall, and custom Chinese localization. |
| [**Leobai03/t3code-quota-ui**](https://github.com/Leobai03/t3code-quota-ui)                   | Inspiration for the USD / CNY cost currency toggle.                                                                                                                                                                                                                                                               |

T3 Nebula is an independent community-maintained project and is not affiliated with T3 Tools Inc. or the T3 Stardust maintainers.

## License

Released under the [MIT License](LICENSE), consistent with upstream T3 Code. Copyright for original works remains with their respective authors.
