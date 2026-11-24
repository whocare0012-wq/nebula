<p align="center">
  <img src="assets/nebula-icon.svg" width="112" height="112" alt="T3 星云图标：环绕明亮核心的旋涡星系" />
</p>

<h1 align="center">T3 星云 · Nebula</h1>

<p align="center">
  <strong>以 Windows 为主的 T3 Code 社区版，开源的编程智能体图形界面。</strong><br />
  官方 T3 Code + T3 星尘版的全部功能 + 一些自己的改进。
</p>

<p align="center">
  <a href="README.md"><strong>English</strong></a> ·
  <a href="#credits">引用的项目</a> ·
  <a href="#whats-new">新增功能</a> ·
  <a href="#build">在 Windows 上构建</a> ·
  <a href="#providers">服务商</a> ·
  <a href="#notes">注意事项</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Windows-x64-0078d4" alt="Windows x64" />
  <img src="https://img.shields.io/badge/UI-English%20%7C%20%E4%B8%AD%E6%96%87-7b5cff" alt="中英文界面" />
  <img src="https://img.shields.io/badge/License-MIT-30d158" alt="MIT 许可证" />
</p>

---

T3 星云是一个个人分支：在一个桌面应用里使用你已有的各家智能体订阅，包括 Codex、Claude、Antigravity、
Cursor、OpenCode、DeepSeek Harness 以及其他 ACP 智能体。它以 **T3 星尘版**为基础（一个深度定制、
带完整中文界面和用量分析的 T3 Code），合并了最新的**官方 T3 Code**，并补上了在 Windows 上构建和日常
使用所需的改动。

界面语言跟随系统，英文和简体中文都完整支持。

<a id="credits"></a>

## 引用的项目

T3 星云建立在以下三个项目之上，相关功能的功劳归原作者所有。

| 项目                                                                                         | T3 星云从中继承的内容                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [**pingdotgg/t3code**](https://github.com/pingdotgg/t3code)                                  | 整体基础：应用、服务端、各服务商接入、编排与检查点。已合并到 2026 年 11 月下旬的版本。官方 README 保留在 [README.upstream.md](README.upstream.md)。                                          |
| [**zds-xiaoxin/xiaoxin-t3code**](https://github.com/zds-xiaoxin/xiaoxin-t3code)（T3 星尘版） | 本分支的直接基础：所有定制功能的中文界面、Composer V9 模型胶囊、星舰推理强度滑块、会话与令牌浮层、顶栏额度胶囊、多账号额度环与燃尽预测、四标签用量工作台、任务步骤卡、预览图钉标注和产物墙。 |
| [**Leobai03/t3code-quota-ui**](https://github.com/Leobai03/t3code-quota-ui)                  | 费用币种切换的思路来源。它的其他额度功能（顶栏额度胶囊、模型选择器额度徽章、燃尽预测）星尘版已经有了，所以只移植了人民币 / 美元切换。                                                        |

T3 星云是独立的社区项目，与 T3 Tools 及 T3 星尘版的维护者均无关联。

<a id="whats-new"></a>

## T3 星云的新增功能

相比 T3 星尘版，T3 星云新增或改动了以下内容：

| 方面                        | 改动                                                                                                                                                                                                                         |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **合并上游**                | 把最新的官方 T3 Code 合并进星尘版，冲突逐一手动解决。                                                                                                                                                                        |
| **费用币种**                | 用量页面的费用可以按美元或人民币显示。汇率可以修改并会被记住，图表坐标轴也按所选币种取整。                                                                                                                                   |
| **实时输出速度**            | 回合进行中，输入框下方的统计条除了轮次、状态和已用时间，还会显示当前的每秒 token 输出速度。                                                                                                                                  |
| **Windows 上的 npm 智能体** | 用 `npm install -g` 安装的本地 ACP 命令可以直接填名字使用。T3 星云会读取 npm 生成的 `.cmd` 包装文件，直接启动它背后的程序，依然不经过 shell。                                                                                |
| **DeepSeek Harness**        | 能识别桌面版自带的 CLI，状态检测不会再往你的 DeepSeek 历史里留下空会话。                                                                                                                                                     |
| **隐私默认值**              | 发给上游 T3 Code 项目的匿名使用数据默认关闭，需要时在「设置 → 关于」里打开，欢迎页也会这样提示。已移除星尘版的匿名使用统计（发往 xiaoxin666.cn）和针对星尘版仓库的社区更新检查。官方自动更新已禁用，官方版本不会覆盖本版本。 |
| **Windows 打包**            | 能打出可用的 NSIS 安装包。安装包文件数上限为服务端字节码缓存留出了空间，Windows 的 `.ico` 图标也换成了本应用的图标。                                                                                                         |
| **名称与图标**              | 应用改名为 T3 星云（英文 T3 Nebula），新图标是一个旋涡星系，源文件在 [assets/nebula-icon.svg](assets/nebula-icon.svg)。                                                                                                      |
| **Sub2API 额度**            | 如果 Claude Code 走的是你自己搭的 Sub2API 中转站，在 **设置 → 服务商 → 添加 Hub → Sub2API** 填入中转站地址和管理员 API Key，用量页就会显示中转站背后 Claude 账号的 5 小时和每周额度。                                        |
| **Windows 细节**            | 只在 macOS 服务端有效的功能（磁盘清理中心、Cursor 钥匙串开关）在 Windows 上隐藏；产物墙里的「Finder」改为「文件资源管理器」；`vp run dev` 在 Windows 上默认优先用 IPv4 访问 `localhost`。                                    |
| **代码清理**                | 删除合并后不再使用的文件和导出，提交前检查重新可以全部通过。                                                                                                                                                                 |

<a id="build"></a>

## 在 Windows 上构建

预编译的安装包在 [Releases](https://github.com/whocare0012-wq/t3-nebula/releases) 页面。自己构建的方法如下：

**环境要求**

- Node.js 26（仓库指定 26.13.1）
- [Vite+](https://viteplus.dev)（`vp` 命令）
- Rust（`rustup`）和带 C++ 工作负载的 Visual Studio 2022 生成工具，用于编译原生资源监视器

**开发模式运行**

```powershell
vp i
vp run dev
```

打开终端里输出的 `pairingUrl` 链接即可。

**打包安装程序**

```powershell
node scripts/build-desktop-artifact.ts --platform win --target nsis --arch x64
```

安装包会生成在 `release/T3-Nebula-<版本号>-x64.exe`。安装包没有代码签名，Windows SmartScreen 会弹出提示，
点「更多信息」再点「仍要运行」即可。

**发布新版本**

带上更新源和比上一版更高的版本号构建，再上传安装包、blockmap 和 `latest.yml`：

```powershell
$env:T3CODE_DESKTOP_UPDATE_REPOSITORY = "whocare0012-wq/t3-nebula"
node scripts/build-desktop-artifact.ts --platform win --target nsis --arch x64 --build-version 1.0.1
gh release create v1.0.1 release/T3-Nebula-1.0.1-x64.exe release/T3-Nebula-1.0.1-x64.exe.blockmap release/latest.yml --title "T3 Nebula 1.0.1"
```

<a id="providers"></a>

## 服务商

| 服务商               | 配置方法                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Codex**            | 不用手动安装。在 **设置 → 服务商** 里用 ChatGPT 连接，T3 星云会自动安装 Codex。已经用 `codex login` 登录过的也能直接用。                                                                                                                                                                                                                                                                             |
| **Antigravity**      | 不用手动安装。在 **设置 → 服务商** 里启用，在那里安装运行时，再用 Google 账号登录。需要约 1.25 GB 可用空间。                                                                                                                                                                                                                                                                                         |
| **Claude**           | 需要自己安装 Claude Code，并运行 `claude auth login` 登录。                                                                                                                                                                                                                                                                                                                                          |
| **DeepSeek Harness** | 添加一个 **本地 ACP 命令**。用 npm 装的 CLI：可执行文件填 `dsh`，参数填 `--profile` 和 `acp`。用桌面版：可执行文件填 `DeepSeek Harness.exe`，参数依次填 `--expose-internals`、桌面版目录下的 `resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js`、`--profile`、`acp`，并添加环境变量 `ELECTRON_RUN_AS_NODE=1`。官方 ACP 接口不上报 token 数，所以费用和速度对它显示为空。 |
| **其他 ACP 智能体**  | 在 **设置 → 服务商 → 添加服务商 → 显示更多** 里可以搜索 ACP 注册表，或添加任意本地 ACP 命令。                                                                                                                                                                                                                                                                                                        |

<a id="notes"></a>

## 注意事项

- **共用数据。** T3 星云沿用 T3 Code 的应用 ID 和数据目录（`~/.t3`），原有的项目和对话会直接带过来，
  但不能和官方 T3 Code 同时安装。
- **更新。** 安装后的应用会检查本仓库的 [Releases](https://github.com/whocare0012-wq/t3-nebula/releases)，
  有新版本时在应用内提示。
- **仅限 macOS 的功能。** 星尘版的磁盘清理中心和 Cursor 钥匙串开关只在 macOS 服务端上有效，Windows 上会隐藏，用量页仍会显示磁盘占用。
- **Windows 上的测试。** 部分官方和星尘版原有的测试在 Windows 上会失败（符号链接权限、路径假设等），
  去掉本分支的改动后同样失败。

## 许可证

[MIT](LICENSE)，与官方 T3 Code 相同。原作品的版权归原作者所有。
