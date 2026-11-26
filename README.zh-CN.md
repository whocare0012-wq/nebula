<p align="center">
  <img src="assets/nebula-icon.svg" width="112" height="112" alt="星云（Nebula）图标" />
</p>

<h1 align="center">星云 · Nebula</h1>

<p align="center">
  <strong>以 Windows 体验为核心的开源编程智能体桌面工作台。</strong><br />
  多智能体统一管理 · 多账号实时额度洞察 · 人民币/美元用量分析 · 彻底零遥测 · DPAPI 密钥加密
</p>

<p align="center">
  <a href="README.md"><strong>English</strong></a> ·
  <a href="#highlights">核心亮点</a> ·
  <a href="#features">完整特性</a> ·
  <a href="#download">下载与安装</a> ·
  <a href="#providers">支持的智能体</a> ·
  <a href="#privacy">隐私与安全</a> ·
  <a href="#build">从源码构建</a> ·
  <a href="#credits">致谢</a>
</p>

<p align="center">
  <a href="https://github.com/whocare0012-wq/nebula/releases">
    <img src="https://img.shields.io/github/v/release/whocare0012-wq/nebula?label=%E6%9C%80%E6%96%B0%E7%89%88%E6%9C%AC&color=7b5cff" alt="最新版本" />
  </a>
  <img src="https://img.shields.io/badge/Windows-x64-0078d4" alt="Windows x64" />
  <img src="https://img.shields.io/badge/UI-English%20%7C%20%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-6e56cf" alt="中英文界面" />
  <img src="https://img.shields.io/badge/%E9%81%A5%E6%B5%8B-%E9%9B%B6%E4%B8%8A%E6%8A%A5-0ea5a4" alt="零遥测" />
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/License-MIT-30d158" alt="MIT 开源协议" />
  </a>
</p>

---

**星云（Nebula）** 是一款本地优先的开源编程智能体桌面工作台，可在同一个简洁高效的图形界面中统一调度你本机已安装并登录的各类编程智能体，包括 **Codex**、**Claude Code**、**Antigravity**、**Cursor**、**OpenCode**、**DeepSeek Harness** 以及任意 **ACP（Agent Client Protocol）** 智能体。

本项目基于 MIT 协议开源项目 [**T3 Code**](https://github.com/pingdotgg/t3code) 与 [**星尘（Stardust）**](https://github.com/zds-xiaoxin/stardust) 的界面交互体验打造，面向 Windows 开发者重点强化了原生系统兼容、多账号额度管理、多币种费用统计、彻底零遥测以及本地密钥加密。

界面语言自动跟随系统设置，完整支持 **简体中文** 与 **English**。

> [!IMPORTANT]
> **非官方社区分支声明**：星云（Nebula）是基于 MIT 协议开源项目 [pingdotgg/t3code](https://github.com/pingdotgg/t3code) 维护的独立社区分支。“T3”与“T3 Code”归其原作者所有，本项目与 T3 Tools Inc. 及 [星尘（Stardust）](https://github.com/zds-xiaoxin/stardust) 维护者均无任何隶属或背书关系。使用中遇到的问题请反馈至本仓库，勿提交给上游项目。

<a id="highlights"></a>

## 核心亮点一览

| 维度             | 星云（Nebula）提供的能力                                                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **统一多智能体** | 复用已有订阅，统一调度 Codex、Claude Code、Antigravity、Cursor、OpenCode、DeepSeek Harness 及 ACP 智能体，内置 Git Worktree 工作流 |
| **多账号与额度** | Codex 与 Antigravity 独立账户目录隔离、按服务商分组的模型选择器、跟随当前对话的顶栏额度胶囊                                        |
| **用量与中转站** | 四标签用量工作台（费用 / 令牌 / 限额 / 磁盘空间）、美元/人民币切换与自定义汇率、燃尽预测、Sub2API 中转站额度与消费追踪             |
| **交互与审查**   | Composer V9、V18 星舰推理滑块、实时 `tok/s` 速率、任务步骤卡、内置预览图钉批注与产物墙                                             |
| **Windows 原生** | 目录联接与硬链接（免开发者模式/管理员权限）、自动发现 Codex 桌面版与全局 npm ACP 命令、隐藏仅限 macOS 的入口                       |
| **隐私与安全**   | 彻底移除遥测（无重新开启开关）、未编译 T3 Connect、Windows DPAPI 本地密钥加密、独立 GitHub Releases 更新通道                       |

<a id="features"></a>

## 完整特性

### 统一多智能体与 Git 工作流

- **复用已有订阅**：不转售 Token，也不要求注册额外中转账号，直接驱动你本机已登录的智能体 CLI 与受管运行时。
- **内置 Git 与 Worktree 隔离**：为不同对话创建独立 Git Worktree，在应用内直接查看 Diff、回滚检查点，并完成提交、推送与创建 PR。
- **本地与远程协作**：支持将服务端运行在本机或远程主机，通过局域网、Tailscale 或远程配对链接跨设备访问。

### 多账号隔离与实时额度洞察

- **独立的 Codex 多账号管理**：在 **设置 → 服务商 → 添加 ChatGPT 账户** 中可接入多个 ChatGPT 账号。每个托管账号均通过 Codex 原生 OAuth 流程认证，并保存在各自独立的 Codex 主目录中，不会影响 `~/.codex` 中原有 Codex CLI 的登录状态；完整支持额度查看、Fast 服务档位、「更换账号」时重新发起登录，以及外部登录变动免重启识别。
- **独立的 Antigravity 账户环境与模型额度池匹配**：每个 Antigravity 实例使用独立的 `GEMINI_HOME` 与隔离凭证环境，避免账号间串号；额度胶囊与模型选择器会根据当前运行的模型自动对应相应额度池（默认展示 Gemini 额度，Claude 与 GPT 模型展示两者共用额度）。
- **按服务商分组的模型选择器**：同一服务商下的多个账号合并在同一个标签页中，标签下方提供带剩余额度提示的内联账号切换栏；自动记忆各服务商上次使用的账号，并在 **全部** 视图中对模型去重展示。
- **跟随当前对话的顶栏额度胶囊**：顶部额度胶囊会自动跟随当前打开对话所使用的账号；当对话使用了未固定在顶栏的账号时，会临时替换同服务商固定槽位展示，关闭对话后自动恢复。

### 用量、多币种费用与中转站分析

- **四标签用量工作台**：在一个页面中集中查看 **费用 / 令牌 / 限额 / 磁盘空间**，提供趋势曲线、多账号限额圆环、燃尽预测与前一时段对比。
- **美元 / 人民币币种切换**：支持在 USD 与 CNY 之间自由切换费用显示，汇率可自定义并持久化保存，图表坐标轴同步按所选币种取整。
- **Sub2API 中转站额度监控**：若 Claude Code 通过 Sub2API 中转站接入，可在 **设置 → 服务商 → 添加 Hub → Sub2API** 添加配置，直接在用量页面查看背后 Claude 账号的 5 小时与每周额度，以及当前密钥的余额、消费与请求数统计。
- **实时回合指标与会话浮层**：回合进行中在输入框下方实时显示轮次、状态、耗时与每秒输出速率（`tok/s`），点击可展开 **会话概览** 与 **令牌与缓存** 统计浮层；对不上报 Token 统计的智能体会给出明确提示。

### Composer V9 与可视化审查工具

- **V18 星舰推理强度滑块**：采用离屏精灵贴图缓存与闲置自动休眠机制，交互流畅且低开销；更多滑块主题可在 [`stardust-kit/`](stardust-kit/README.md) 中体验。
- **任务步骤卡**：将冗长的终端活动折叠为结构化的步骤时间线，清晰展示耗时与产出数，并支持随时展开查看原始命令。
- **内置预览图钉批注**：在内置浏览器预览中直接点击页面元素添加图钉标注，按「待改 / 已改」筛选，发送给智能体时自动附带局部截图。
- **产物墙**：集中浏览当前对话与项目生成的文件、文档与图片，在 Windows 上支持一键在 **文件资源管理器** 中定位。

### Windows 平台原生工程优化

- **免管理员权限与开发者模式**：Windows 下的任务目录与 Codex 独立主目录改用目录联接（Junction）与文件硬链接实现，无需开启「开发者模式」或管理员权限；删除目录时不会误删共享文件，且会保留 Codex 新改写的共享配置（如 `config.toml`）。
- **开箱即用的本地 CLI 发现与启动**：自动识别 Codex 桌面版自带 CLI；支持直接按命令名启动通过 `npm install -g` 安装的本地 ACP 智能体（直接解析 `.cmd` 包装脚本而不经过 shell）；识别 DeepSeek Harness 桌面版 CLI，且状态检测不会在历史记录中残留空会话。
- **Windows 清理中心**：**用量 → 清理与整理** 只扫描白名单内的 Windows 位置：npm / pnpm / Yarn / pip / uv / NuGet / Cargo / Bun / Go / Electron 下载缓存，Chrome / Edge / Brave / Firefox 浏览器缓存，各应用自动更新残留的安装包，「下载」文件夹里的安装包，以及崩溃转储。可重建的缓存直接删除；安装包和崩溃转储移入**回收站**。结果按类型分组，可以勾选多项或整组一次清理，每项执行前仍会单独检查。正被程序占用的内容会跳过。pnpm store、Playwright 浏览器等共享依赖，以及 `%TEMP%` 和系统缓存只展示、不清理。归档到外置磁盘仍只支持 macOS。
- **任务栏集成**：有代理在工作时，任务栏按钮显示滚动的进度条；星云在后台时，会话完成或需要你处理会让任务栏按钮闪烁（需开启桌面通知）；右键任务栏按钮的跳转列表里有 **新建会话**（星云未运行时也能直接新建）。
- **托盘与开机自启**：在设置里开启 **关闭窗口后在托盘继续运行** 后，关闭窗口时星云会隐藏到通知区域，代理继续工作、通知照常送达，需要退出时在托盘图标菜单里选择「退出星云」。**开机自动启动** 会在登录 Windows 时打开星云；同时开启托盘模式时直接在托盘启动。
- **用星云打开**：在资源管理器里右键文件夹（或文件夹内的空白处），选择 **用星云打开**，就会把它作为项目打开并新建会话。Windows 11 上在 **显示更多选项** 里。
- **云母背景**：在 Windows 11 22H2 及以上版本，侧边栏和窗口边缘会透出桌面的云母色调。可在 设置 → 外观 → **云母背景** 关闭。
- **贴合 Windows 的界面细节**：隐藏其余仅适用于 macOS 服务端的功能入口（如 Cursor 钥匙串开关）；右侧面板和终端的标签像其他 Windows 应用一样，在标签右端关闭；新建会话目录选择提示正确显示 `Alt` 而非 `⌥`。

<a id="download"></a>

## 下载与安装

预编译的 Windows x64 安装包发布在 [GitHub Releases](https://github.com/whocare0012-wq/nebula/releases) 页面：

1. 前往 [Releases](https://github.com/whocare0012-wq/nebula/releases) 下载最新版本的 Windows x64 安装包（`Nebula-<版本号>-x64.exe`；v1.0.7 及更早版本为 `T3-Nebula-<版本号>-x64.exe`）。
2. 运行安装程序。由于社区构建包未做付费代码签名，Windows SmartScreen 可能会弹出安全提示，点击 **更多信息** → **仍要运行** 即可。
3. 启动 **星云（Nebula）** 后，前往 **设置 → 服务商** 启用并配置至少一个智能体即可开始使用。

> [!NOTE]
> **独立的应用 ID 与数据目录（v1.0.9 起）**：星云（Nebula）改用自己的应用 ID（`com.nebula.desktop`）、数据目录（`~/.nebula`）和安装目录（`%LOCALAPPDATA%\Programs\nebula`），可以与上游 T3 Code 并存安装。从 v1.0.8 及更早版本升级时，安装程序会先移除旧版星云的安装登记（数据保留）；首次启动时，星云会把 `~/.t3` 搬到 `~/.nebula`、把 `%APPDATA%\t3code-v2` 搬到 `%APPDATA%\nebula`，WSL 后端也会在 WSL 内做同样的搬迁。若 T3 Code 或后台 `t3` 服务仍占用旧目录，星云本次会继续使用旧目录，下次启动再试，因此首次启动前请先关闭 T3 Code。搬迁后上游 T3 Code 将从空数据开始。设置了 `T3CODE_HOME` 时不会搬迁。升级后请重新将星云固定到任务栏一次。

> [!WARNING]
> **升级到 v1.0.8 及以上版本后请勿降级**：从 v1.0.8 起，星云保存的本地密钥改用 Windows DPAPI 加密（已有明文密钥会在首次读取时自动加密迁移）。旧版无法读取加密后的密钥，降级会导致需要重新填写服务商凭证与中转站 API Key。v1.0.9 之前的版本读取的是 `~/.t3` 而不是 `~/.nebula`，降级后也看不到已有数据。

<a id="providers"></a>

## 支持的智能体

打开 **设置 → 服务商** 即可启用与管理各家编程智能体：

| 服务商                                                          | 配置方式                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Codex**                                                       | 无需手动安装。在 **设置 → 服务商** 中直接登录一个或多个 ChatGPT 账号即可自动部署受管运行时；也兼容已通过 `codex login` 登录的环境或 Codex 桌面版。                                                                                                                                                                                                                                                        |
| **Claude Code**                                                 | 安装 [Claude Code](https://claude.com/product/claude-code) 后运行 `claude auth login` 登录。如需查看 Sub2API 中转站额度与消费，可在 **设置 → 服务商 → 添加 Hub → Sub2API** 中添加。                                                                                                                                                                                                                       |
| **Antigravity**                                                 | 在 **设置 → 服务商** 中启用，按提示安装托管运行时（需约 1.25 GB 可用磁盘空间）并使用 Google 账号登录。                                                                                                                                                                                                                                                                                                    |
| **Cursor / OpenCode / Grok Build / Kiro / Pi / Muse Code / fx** | 在本机安装对应 CLI 并完成登录后启用，详细命令可查阅 [服务商配置指南](docs/user/install.md#providers)。                                                                                                                                                                                                                                                                                                    |
| **DeepSeek Harness**                                            | 添加为 **本地 ACP 命令**。使用 npm CLI 时，可执行文件填 `dsh`，参数填 `--profile` 与 `acp`；使用桌面版时，可执行文件填 `DeepSeek Harness.exe`，参数依次填 `--expose-internals`、`resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js`、`--profile`、`acp`，并设置环境变量 `ELECTRON_RUN_AS_NODE=1`。_（官方 ACP 接口暂不上报 Token 统计，因此用量、费用与输出速度会显示为空。）_ |
| **其他 ACP 智能体**                                             | 在 **设置 → 服务商 → 添加服务商 → 显示更多** 中从 ACP 注册表安装，或直接添加任意本地 ACP 命令。                                                                                                                                                                                                                                                                                                           |

<a id="privacy"></a>

## 隐私、安全与更新

除了你主动调用的模型服务商与功能外，星云默认不向任何外部收集个人数据：

- **彻底零遥测**：服务端已将发往上游 T3 Code 的使用统计与智能体反馈上报替换为空实现，**没有任何设置可以重新开启**；同步移除了「设置 → 关于」中的遥测开关与上游隐私政策链接、欢迎页的统计提示，以及「实验室」中的智能体反馈上报工具。
- **无上游中转、无第三方分支统计**：经上游服务器中转的 T3 Connect 未编译进本发行版；第三方社区分支的活跃用户计数上报与外部更新检查端点也已全部移除。
- **联网边界清晰**：仅在你主动使用对应功能时联网，包括调用各家模型服务、你配置的中转站或 Git 托管平台、检查本仓库 GitHub Releases 更新，以及仅当你手动配置了地址时才会启用的 OpenTelemetry 导出。
- **独立更新通道**：已禁用上游官方自动更新，避免被官方版本覆盖。安装后的应用会检查本仓库的 [Releases](https://github.com/whocare0012-wq/nebula/releases)，有新版本时在应用内提示更新。

### Windows 本地凭证保护机制

| 存储位置                                                                                      | 保护方式                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **星云自身密钥库**<br />（`~/.nebula/userdata/secrets/`，含服务商凭证、中转站 Key、签名密钥） | 在 64 位 Windows 上使用 **Windows DPAPI** 加密存储，绑定当前机器与当前 Windows 账户。旧版明文密钥首次读取时自动加密；复制或备份出去的文件在其他电脑或账户下无法解密，会被安全丢弃。 |
| **智能体官方 CLI 登录文件**<br />（如 Codex 的 `auth.json`、Antigravity 的 OAuth 令牌）       | 由各家官方 CLI 自身读写，需保持其原有格式以便 CLI 正常工作；各账号隔离存放在各自独立目录中，受 Windows 本机账户权限保护（仅当前用户、管理员与 SYSTEM 可访问）。                     |

<a id="build"></a>

## 从源码构建

### 环境要求

- **Node.js** `26.13.1`（Node.js 26）
- [**Vite+**](https://viteplus.dev)（`vp` 命令）
- **Rust**（`rustup`）与 **Visual Studio 2022 生成工具**（需勾选「使用 C++ 的桌面开发」工作负载，用于编译原生资源监视器）

### 开发模式运行

```powershell
git clone https://github.com/whocare0012-wq/nebula.git
cd nebula
vp i
vp run dev
```

打开终端输出的 `pairingUrl` 链接即可访问 Web 界面；如需直接启动 Electron 桌面端，可运行 `vp run dev:desktop`。

### 打包 Windows 安装程序（x64 NSIS）

```powershell
vp run dist:desktop:win:x64
```

打包完成后，安装程序会生成在 `release/Nebula-<版本号>-x64.exe`。

### 文档与测试

- 完整使用与开发文档：[docs/README.md](docs/README.md)
- 开发指南：[docs/operations/00_development.md](docs/operations/00_development.md)
- Windows 测试基线：`vp run test:windows apps/server apps/web apps/desktop scripts`（运行各包测试并自动过滤上游仅适用于 POSIX 环境的已知测试项）

<a id="credits"></a>

## 致谢

星云（Nebula）的构建离不开以下开源项目的贡献：

| 项目                                                                                   | 继承与参考内容                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [**pingdotgg/t3code**](https://github.com/pingdotgg/t3code)                            | 核心应用架构、服务端运行时、各服务商适配、编排引擎与检查点机制。上游官方 README 保留于 [README.upstream.md](README.upstream.md)。                                                                         |
| [**zds-xiaoxin/stardust**](https://github.com/zds-xiaoxin/stardust)（星尘 · Stardust） | Composer V9、V18 星舰推理强度滑块及 [`stardust-kit/`](stardust-kit/README.md)、会话与令牌浮层、顶栏额度胶囊、多账号额度环与燃尽预测、四标签用量工作台、任务步骤卡、预览图钉批注、产物墙及定制功能中文化。 |
| [**Leobai03/t3code-quota-ui**](https://github.com/Leobai03/t3code-quota-ui)            | 美元 / 人民币费用币种切换的设计思路来源。                                                                                                                                                                 |

“T3”与“T3 Code”归其原作者所有。星云（Nebula）为独立的开源社区维护项目，与 T3 Tools Inc. 及星尘（Stardust）维护者均无隶属或背书关系。

## 开源协议

本项目沿用上游 T3 Code 的 [MIT 协议](LICENSE) 发布，原始组件的版权归原作者所有。
