<p align="center">
  <img src="assets/nebula-icon.svg" width="112" height="112" alt="T3 星云图标" />
</p>

<h1 align="center">T3 Nebula · 星云</h1>

<p align="center">
  <strong>以 Windows 体验为核心的 T3 Code 开源社区发行版 — 统一调度本地编程智能体的桌面工作台。</strong><br />
  多智能体统一管理 · 多账号实时额度洞察 · 人民币/美元用量分析 · 完整中英文双语界面
</p>

<p align="center">
  <a href="README.md"><strong>English</strong></a> ·
  <a href="#features">核心特性</a> ·
  <a href="#download">下载与安装</a> ·
  <a href="#providers">支持的智能体</a> ·
  <a href="#build">从源码构建</a> ·
  <a href="#privacy">隐私与更新</a> ·
  <a href="#credits">致谢</a>
</p>

<p align="center">
  <a href="https://github.com/whocare0012-wq/t3-nebula/releases">
    <img src="https://img.shields.io/github/v/release/whocare0012-wq/t3-nebula?label=%E6%9C%80%E6%96%B0%E7%89%88%E6%9C%AC&color=7b5cff" alt="最新版本" />
  </a>
  <img src="https://img.shields.io/badge/Windows-x64-0078d4" alt="Windows x64" />
  <img src="https://img.shields.io/badge/UI-English%20%7C%20%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-6e56cf" alt="中英文界面" />
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/License-MIT-30d158" alt="MIT 开源协议" />
  </a>
</p>

---

**T3 星云（T3 Nebula）** 是一款开源编程智能体桌面工作台，可在同一个简洁高效的图形界面中统一驱动你本机已安装并登录的各类编程智能体，包括 **Codex**、**Claude Code**、**Antigravity**、**Cursor**、**OpenCode**、**DeepSeek Harness** 以及任意 **ACP（Agent Client Protocol）** 智能体。

本项目基于上游 [**T3 Code**](https://github.com/pingdotgg/t3code) 与 [**T3 星尘版（Stardust）**](https://github.com/zds-xiaoxin/xiaoxin-t3code) 的界面体验打造，重点增强了 Windows 平台的原生兼容性、多账号额度管理、多币种费用统计以及默认隐私保护。

界面语言自动跟随系统设置，完整支持 **简体中文** 与 **English**。

<a id="features"></a>

## 核心特性

### 统一多智能体工作台

- **复用已有订阅**：不转售 Token，也不需要额外中转账户，直接驱动你本机已登录的智能体 CLI 与运行时。
- **内置 Git 与 Worktree 工作流**：支持为不同对话创建独立 Git Worktree，直接在应用内查看 Diff、回滚检查点，以及执行提交、推送和创建 PR。
- **跨设备远程协作**：支持将服务端部署在本地或远程主机，通过局域网、Tailscale 或 T3 Connect 连接访问。

### Composer V9 与推理强度交互

- **按服务商分组的模型选择器**：同一服务商下的多个账号合并在同一个标签页中，标签下方提供带剩余额度提示的账号切换栏；自动记忆各服务商上次使用的账号，并在 **全部** 视图中对模型去重展示。
- **V18 星舰推理强度滑块**：采用离屏精灵贴图缓存与闲置自动休眠机制，交互流畅且低开销；更多滑块主题可在 [`stardust-kit/`](stardust-kit/README.md) 中体验。
- **实时输出统计与弹簧浮层**：回合进行中在输入框下方实时显示轮次、状态、耗时与每秒输出速率（`tok/s`），点击可展开 **会话概览** 与 **令牌与缓存** 统计浮层。

### 多账号托管与实时额度洞察

- **独立的 Codex 多账号管理**：在 **设置 → 服务商 → 添加 ChatGPT 账户** 中可同时接入多个 ChatGPT 账号。每个托管账号均通过 Codex 原生登录流程认证，并将凭证保存在各自独立的 Codex 主目录中，不会影响 `~/.codex` 中原有 Codex CLI 的登录状态，同时完整支持额度查看与 Fast 服务档位。
- **跟随当前对话的顶栏额度胶囊**：顶部额度胶囊会自动跟随当前打开对话所使用的账号；当对话使用了未固定在顶栏的账号时，会临时替换同服务商固定槽位展示，关闭对话后恢复。对于 Antigravity，额度胶囊与模型选择器会根据当前运行的模型自动对应相应额度池（默认展示 Gemini 额度，Claude 与 GPT 模型展示两者共用额度）。

### 用量、费用与中转站分析

- **多标签用量工作台**：集成了 **费用 / 令牌 / 限额 / 磁盘空间** 视图，提供趋势曲线、额度圆环、燃尽预测与前一时段对比。
- **美元 / 人民币币种切换**：支持在美元（USD）和人民币（CNY）之间自由切换费用显示，汇率可自定义并持久化保存，图表坐标轴同步按所选币种取整。
- **Sub2API 中转站额度监控**：若 Claude Code 通过 Sub2API 中转站接入，可在 **设置 → 服务商 → 添加 Hub → Sub2API** 添加配置，直接在用量页面查看背后 Claude 账号的 5 小时与每周额度，以及当前密钥的余额、消费与请求数统计。

### 效率与审查工具

- **任务步骤卡**：将冗长的终端输出折叠为清晰易读的步骤时间线，展示耗时与产出数，并支持随时展开查看原始命令。
- **内置预览图钉批注**：在内置浏览器预览中直接点击页面元素添加图钉标注，按「待改 / 已改」筛选，发送给智能体时自动附带局部截图。
- **产物墙**：集中浏览当前对话与项目生成的文件、文档与图片，在 Windows 上支持直接定位到 **文件资源管理器**。

### Windows 平台原生优化

- **免管理员权限的目录链接**：Windows 下的任务目录与 Codex 独立主目录采用目录联接（Junction）与硬链接实现，无需开启「开发者模式」或管理员权限即可正常使用。
- **更顺畅的本地 CLI 发现与启动**：自动识别 Codex 桌面版自带 CLI；支持直接按命令名启动通过 `npm install -g` 安装的本地 ACP 智能体（自动解析 `.cmd` 包装脚本且不经过 shell）；识别 DeepSeek Harness 桌面版 CLI，状态检测不会在历史记录中残留空会话。
- **贴合系统的界面呈现**：自动隐藏仅适用于 macOS 服务端的功能入口（如 macOS 磁盘清理中心与 Cursor 钥匙串开关），同时保留磁盘占用统计视图。

<a id="download"></a>

## 下载与安装

预编译的 Windows 安装包发布在 [GitHub Releases](https://github.com/whocare0012-wq/t3-nebula/releases) 页面：

1. 前往 [Releases](https://github.com/whocare0012-wq/t3-nebula/releases) 下载最新版本的 `T3-Nebula-<版本号>-x64.exe`。
2. 运行安装程序。由于社区构建包未进行代码签名，Windows SmartScreen 可能会弹出安全提示，点击 **更多信息** → **仍要运行** 即可。
3. 启动 **T3 星云** 后，前往 **设置 → 服务商** 启用并配置至少一个智能体即可开始使用。

> [!NOTE]
> **共用数据目录说明**：T3 星云沿用 T3 Code 的应用 ID 与本地数据目录（`~/.t3`），原有的项目和对话历史会自动保留。但因此无法与官方 T3 Code 在同一台机器上并存安装。

<a id="providers"></a>

## 支持的智能体

打开 **设置 → 服务商** 即可启用与管理各家编程智能体：

| 服务商                                                          | 配置方式                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Codex**                                                       | 无需手动安装。在 **设置 → 服务商** 中直接登录一个或多个 ChatGPT 账号即可自动部署受管运行时；也兼容已通过 `codex login` 登录的环境或 Codex 桌面版。                                                                                                                                                                                                                                                        |
| **Claude Code**                                                 | 安装 [Claude Code](https://claude.com/product/claude-code) 后运行 `claude auth login` 登录。如需查看 Sub2API 中转站额度，可在 **设置 → 服务商 → 添加 Hub → Sub2API** 中添加。                                                                                                                                                                                                                             |
| **Antigravity**                                                 | 在 **设置 → 服务商** 中启用，按提示安装托管运行时（需约 1.25 GB 可用磁盘空间）并使用 Google 账号登录。                                                                                                                                                                                                                                                                                                    |
| **Cursor / OpenCode / Grok Build / Kiro / Pi / Muse Code / fx** | 在本机安装对应 CLI 并完成登录后启用，详细命令可查阅 [服务商配置指南](docs/user/install.md#providers)。                                                                                                                                                                                                                                                                                                    |
| **DeepSeek Harness**                                            | 添加为 **本地 ACP 命令**。使用 npm CLI 时，可执行文件填 `dsh`，参数填 `--profile` 与 `acp`；使用桌面版时，可执行文件填 `DeepSeek Harness.exe`，参数依次填 `--expose-internals`、`resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js`、`--profile`、`acp`，并设置环境变量 `ELECTRON_RUN_AS_NODE=1`。_（官方 ACP 接口暂不上报 Token 统计，因此用量、费用与输出速度会显示为空。）_ |
| **其他 ACP 智能体**                                             | 在 **设置 → 服务商 → 添加服务商 → 显示更多** 中从 ACP 注册表安装，或直接添加任意本地 ACP 命令。                                                                                                                                                                                                                                                                                                           |

<a id="build"></a>

## 从源码构建

### 环境要求

- **Node.js** `26.13.1`（Node.js 26）
- [**Vite+**](https://viteplus.dev)（`vp` 命令）
- **Rust**（`rustup`）与 **Visual Studio 2022 生成工具**（需勾选「使用 C++ 的桌面开发」工作负载，用于编译原生资源监视器）

### 开发模式运行

```powershell
git clone https://github.com/whocare0012-wq/t3-nebula.git
cd t3-nebula
vp i
vp run dev
```

打开终端输出的 `pairingUrl` 链接即可访问 Web 界面；如需直接启动 Electron 桌面端，可运行 `vp run dev:desktop`。

### 打包 Windows 安装程序（x64 NSIS）

```powershell
vp run dist:desktop:win:x64
```

打包完成后，安装程序会生成在 `release/T3-Nebula-<版本号>-x64.exe`。

### 文档与测试

- 完整使用与开发文档：[docs/README.md](docs/README.md)
- 开发指南：[docs/operations/00_development.md](docs/operations/00_development.md)
- Windows 测试基线：`vp run test:windows`（运行各包测试并自动过滤上游仅适用于 POSIX 环境的已知测试项）

<a id="privacy"></a>

## 隐私与更新

- **匿名统计默认关闭**：发往上游 T3 Code 的匿名使用统计默认处于关闭状态，仅在 **设置 → 关于** 中由你手动开启后才会生效。
- **零第三方分支遥测**：已移除第三方社区分支的活跃统计上报以及外部社区更新检查。
- **凭证仅本地保存**：各类服务商令牌与中转站 API Key 仅存储在本地服务端，只发往你配置的目标服务商或中转站。
- **独立更新通道**：已禁用上游官方自动更新，避免官方版本覆盖本发行版。安装后的应用会检查本仓库的 [Releases](https://github.com/whocare0012-wq/t3-nebula/releases)，有新版本时在应用内提示更新。

<a id="credits"></a>

## 致谢

T3 星云的构建离不开以下开源项目的贡献：

| 项目                                                                                         | 继承与参考内容                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [**pingdotgg/t3code**](https://github.com/pingdotgg/t3code)                                  | 核心应用架构、服务端运行时、各服务商适配、编排引擎与检查点机制。上游官方 README 保留于 [README.upstream.md](README.upstream.md)。                                                                         |
| [**zds-xiaoxin/xiaoxin-t3code**](https://github.com/zds-xiaoxin/xiaoxin-t3code)（T3 星尘版） | Composer V9、V18 星舰推理强度滑块及 [`stardust-kit/`](stardust-kit/README.md)、会话与令牌浮层、顶栏额度胶囊、多账号额度环与燃尽预测、四标签用量工作台、任务步骤卡、预览图钉批注、产物墙及定制功能中文化。 |
| [**Leobai03/t3code-quota-ui**](https://github.com/Leobai03/t3code-quota-ui)                  | 美元 / 人民币费用币种切换的设计思路来源。                                                                                                                                                                 |

T3 星云为独立的开源社区维护项目，与 T3 Tools Inc. 及 T3 星尘版维护者均无隶属关系。

## 开源协议

本项目沿用上游 T3 Code 的 [MIT 协议](LICENSE) 发布，原始组件的版权归原作者所有。
