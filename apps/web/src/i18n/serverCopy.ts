import { readUiLocale, uiText } from "./index";

const serverMessages = new Map([
  ["存储管理记录目录不能含软链接", "The storage records folder can’t be a symbolic link."],
  ["ACL读取不完整，不能归档释放", "ACL could not be read completely. The source is retained."],
  ["ACL转写失败", "Couldn’t encode the ACL."],
  ["扩展属性清单读取失败", "Couldn’t list extended attributes."],
  ["扩展属性变化，请重新检查", "Extended attributes changed. Check again."],
  [
    "扩展属性无法完整读取或超过单项16MiB；原件保留",
    "Extended attributes are unreadable or exceed 16 MiB per attribute. The original is retained.",
  ],
  ["扩展属性读取期间变化", "Extended attributes changed during the read."],
  [
    "压缩元数据不能安全自动重写，请人工恢复，归档保留",
    "Compressed metadata requires manual recovery. The archive is retained.",
  ],
  ["扩展属性恢复失败", "Couldn’t restore extended attributes."],
  ["ACL恢复解析失败", "Couldn’t parse the ACL for recovery."],
  ["ACL恢复失败", "Couldn’t restore the ACL."],
  ["本次操作达到时限，已停止后续写入", "The operation timed out. Further writes stopped."],
  ["所属服务端已退出，已停止后续写入", "The owning server exited. Further writes stopped."],
  ["路径已存在或变化，未覆盖", "The path already exists or changed. Nothing was overwritten."],
  [
    "路径已变化或含软链接；请重新检查",
    "The path changed or contains a symbolic link. Check again.",
  ],
  ["不在可管理目录内", "Outside the managed folders."],
  ["源目录不存在", "Source folder does not exist."],
  ["源是嵌套挂载或跨卷对象，禁止处理", "The source is a nested mount or on a different volume."],
  [
    "源目录含嵌套挂载或跨卷对象，禁止归档释放",
    "The source includes a nested mount or another volume. It can’t be archived and released.",
  ],
  [
    "包含不支持的特殊文件，未生成整理计划",
    "The selection includes unsupported files. No plan was created.",
  ],
  [
    "元数据超过单次64MiB预算，请按较小子任务整理",
    "Metadata exceeds the 64 MiB limit. Use a smaller selection.",
  ],
  [
    "恢复引用与运行状态尚待核验；可先归档副本",
    "Recovery references and activity need verification. You can archive a copy.",
  ],
  [
    "已有审查记录；计划和执行仍会复核内容、引用与占用",
    "Review records exist. The plan and cleanup still verify content, references, and access.",
  ],
  [
    "生成目录仍需核对源码、共享依赖与任务占用；不会按名称自动删除",
    "Verify generated folders, shared dependencies, and task activity before cleaning up.",
  ],
  [
    "可再生成目录；归档前核对环境，释放仍需引用审查",
    "Rebuildable folder. Verify the environment before archiving and check references before freeing space.",
  ],
  ["日志保留规则可在维护设置调整", "Change log retention in Maintenance settings."],
  ["聊天与交付资料，普通清理保留", "Conversations and deliverables are protected during cleanup."],
  ["对话历史，普通清理保留", "Conversation history is protected during cleanup."],
  [
    "其他 AI 工具缓存；先核对所属软件，本工具不直接删除",
    "Cache from another AI tool. Verify which tool owns it before cleaning up.",
  ],
  ["T3 浏览器缓存；运行中的缓存保留", "T3 browser cache. In-use cache is protected."],
  [
    "应用备份或回滚包；未核对当前安装引用前保留",
    "App backup or rollback. Verify references from the current installation first.",
  ],
  [
    "已登记归档；恢复入口位于归档与记录",
    "Registered archive. Restore it from Archives and cleanup history.",
  ],
  ["归档索引格式错误", "Invalid archive index."],
  ["对象已变化，请重新检查", "The item changed. Check again."],
  [
    "排队时的服务端已退出，不自动重新执行；请核对中断状态",
    "The server that queued this operation exited. Review the interrupted operation.",
  ],
  [
    "操作进程已退出或身份不明，请先核对源、暂存与回执；不会自动重试释放",
    "The worker stopped or is unknown. Check the source, staging folder, and receipt before proceeding.",
  ],
  [
    "没有完整且匹配的恢复引用审查记录，禁止释放；可选择只归档",
    "A complete recovery reference review is required to free space. You can archive a copy.",
  ],
  ["缺少引用审查证据", "Missing evidence of a reference review."],
  [
    "包含系统压缩数据，暂不支持安全释放；原件保留",
    "System-compressed data can’t be safely removed. The original is retained.",
  ],
  [
    "无法按当前权限恢复所有权，原件保留",
    "Current permissions can’t restore ownership. The original is retained.",
  ],
  [
    "包含只读或限制删除的目录，禁止自动释放",
    "Read-only or deletion-restricted folders can’t be cleaned automatically.",
  ],
  ["引用审查证据已变化", "Reference review evidence changed."],
  [
    "目录仍被占用或占用检查不完整，不能释放",
    "The folder is in use or its usage check is incomplete. It was kept.",
  ],
  [
    "目标卷已离线或被替换；原件保留",
    "The destination volume disconnected or was replaced. The original is retained.",
  ],
  [
    "目标卷UUID已变化或不可写，已停止，原件保留",
    "The destination volume ID changed or the volume isn’t writable. The original is retained.",
  ],
  ["目标卷身份不匹配", "Destination volume identity mismatch."],
  ["目标空间不足，未开始写入", "The destination lacks space. No data was written."],
  ["已取消；未释放的源文件保留", "Canceled. Unreleased source files were kept."],
  [
    "退役项已变化或目标存在，已停止",
    "The item changed or the destination exists. The operation stopped.",
  ],
  ["退役项被替换，未删除新对象", "The item was replaced. Its replacement was kept."],
  ["目录inode变化，未继续释放", "The folder inode changed. Cleanup stopped."],
  [
    "退役目录出现新增/消失项，未继续释放",
    "Items appeared or disappeared in the staging folder. Cleanup stopped.",
  ],
  ["退役项inode变化，未继续释放", "The staged item’s inode changed. Cleanup stopped."],
  ["文件在打开时被替换", "The file was replaced while it was opening."],
  ["退役文件内容变化，未删除", "The staged file changed. It was kept."],
  ["退役链接变化", "A staged symbolic link changed."],
  ["退役项类型不支持", "Unsupported staged item type."],
  ["退役上级目录inode变化", "The staging parent folder’s inode changed."],
  [
    "保全目录inode变化，未删除替换目录",
    "The retained folder’s inode changed. Its replacement was kept.",
  ],
  ["源文件已变化，请重新生成计划", "The source file changed. Create a new plan."],
  [
    "含外部链接，尚不能安全恢复，禁止释放",
    "External links prevent safe recovery. The source is retained.",
  ],
  ["目标目录包含软链接", "Destination contains a symbolic link."],
  ["归档清单不匹配", "Archive manifest mismatch."],
  ["归档元数据校验失败", "Archive metadata verification failed."],
  ["归档文件类型/大小不匹配", "Archive file type or size mismatch."],
  ["归档内容校验失败", "Archive contents failed verification."],
  ["链接校验失败", "Link verification failed."],
  ["目录校验失败", "Folder verification failed."],
  ["归档权限校验失败", "Archive permissions failed verification."],
  ["归档缺少文件", "The archive is missing files."],
  [
    "归档期间源发生变化；原件保留",
    "The source changed during archiving. The original is retained.",
  ],
  ["释放前源变化，原件保留", "The source changed before cleanup. The original is retained."],
  ["源身份发生变化，未释放", "Source identity changed. The source is retained."],
  ["退役目录仍被占用，未释放", "The staging folder is still in use. It was kept."],
  ["退役目录复核失败", "The staging folder failed verification."],
  ["无效操作ID", "Invalid operation ID."],
  ["该条目不支持解压恢复", "This item can’t be restored by extraction."],
  ["恢复目标已经存在，绝不覆盖", "The restore destination already exists. It was kept."],
  ["外盘离线或归档校验失败", "The external volume is offline or archive verification failed."],
  ["恢复根目录不可为软链接", "The restore root can’t be a symbolic link."],
  ["不安全的归档路径", "Unsafe archive path."],
  ["恢复不支持特殊文件", "Restore doesn’t support special files."],
  ["归档含不安全的硬链接", "The archive contains unsafe hard links."],
  [
    "归档含外部链接，请在隔离环境人工恢复",
    "The archive contains external links. Restore them manually in an isolated environment.",
  ],
  ["包含系统压缩元数据，暂不支持自动恢复", "System-compressed metadata requires manual recovery."],
  ["原生归档恢复未完成", "Native archive recovery didn’t finish."],
  [
    "归档链接会改变恢复路径，已停止",
    "An archive link would change the restore path. Recovery stopped.",
  ],
  ["硬链接目标不安全或不在已恢复清单", "The hard link target is unsafe or hasn’t been restored."],
  [
    "恢复后的数据内容复核失败，归档保留",
    "Recovered data failed verification. The archive is retained.",
  ],
  ["恢复链接复核失败", "Recovered links failed verification."],
  ["恢复所有权或时间复核失败", "Recovered ownership or timestamps failed verification."],
  ["恢复ACL复核失败", "Recovered ACL failed verification."],
  ["恢复扩展属性复核失败", "Recovered extended attributes failed verification."],
  ["日志目录不可用，未清理", "Log folder unavailable. No logs were removed."],
  ["日志路径变化，请重新检查", "The log path changed. Check again."],
  ["日志内容或身份变化，未继续清理", "Log contents or identity changed. Cleanup stopped."],
  ["日志内容变化，未继续清理", "Log contents changed. Cleanup stopped."],
  [
    "日志被占用或检查不完整，未清理",
    "Logs are in use or verification is incomplete. They were kept.",
  ],
  ["没有超过30天且可处理的轮转日志", "No eligible rotated logs older than 30 days."],
  [
    "日志元数据超出本次预算，原件保留",
    "Log metadata exceeds this operation’s limit. The originals are retained.",
  ],
  [
    "日志元数据无法安全恢复，原件保留",
    "Log metadata can’t be safely restored. The originals are retained.",
  ],
  [
    "仅处理清单内超过30天的轮转日志。先保留压缩归档，校验后删除原日志；归档可恢复到新目录。",
    "Only listed rotated logs older than 30 days are included. T3 verifies a compressed archive before removing originals. Restore the archive to a new folder.",
  ],
  ["日志根目录已变化", "The log root changed."],
  ["日志归档路径异常，原件保留", "The log archive path is invalid. The originals are retained."],
  ["日志归档根目录不能含软链接", "The log archive root can’t contain symbolic links."],
  ["日志归档清单不一致", "Log archive manifest mismatch."],
  ["日志归档内容校验失败", "Log archive contents failed verification."],
  ["日志父目录变化，未继续清理", "The log parent folder changed. Cleanup stopped."],
  ["日志发生变化，未删除", "A log changed. It was kept."],
  ["内置磁盘", "Internal disk"],
  [
    "磁盘低于40GiB或自定保护线，未继续写入/释放",
    "Free space fell below the 40 GiB or custom reserve. The operation stopped.",
  ],
  ["缺少最新白名单扫描授权", "A fresh scan of approved locations is required."],
  ["白名单路径变化", "An approved path changed."],
  ["对象不在清理白名单", "This item is outside approved cleanup locations."],
  [
    "最新两份或当前回滚链锚点加锁",
    "The newest two versions and the current rollback checkpoint are locked.",
  ],
  ["最新两份冷备加锁", "The two latest cold backups are locked."],
  ["冷备路径异常", "Invalid cold backup path."],
  ["冷备回执路径异常", "Invalid cold backup receipt path."],
  [
    "最新冷备缺少匹配的完整校验与恢复回执，旧备份保留",
    "The latest cold backup needs matching verification and restore receipts. Older backups are retained.",
  ],
  [
    "最新冷备不能完整读取校验，旧备份保留",
    "The newest cold backup couldn’t be verified. Older backups are retained.",
  ],
  ["源码或恢复资料受保护", "Source code or recovery data is protected."],
  [
    "缺少完整安装替代证据，保留",
    "Installation replacement evidence is incomplete. The item is retained.",
  ],
  ["替代证据已变化，保留", "Replacement evidence changed. The item is retained."],
  ["不支持的暂存对象", "Unsupported staging item."],
  ["未证明已被更新安装替代", "A newer installation hasn’t been verified as a replacement."],
  ["候选版本未被替代", "This candidate hasn’t been replaced."],
  ["当前回滚链所在代受保护", "The version on the current rollback chain is protected."],
  ["候选封装与清单不匹配", "The candidate package doesn’t match the manifest."],
  ["当前安装与替代回执不匹配", "The current installation doesn’t match the replacement receipt."],
  ["不属于当前用户，禁止提权清理", "Another user owns this item. Elevated cleanup is blocked."],
  ["不支持该文件类型", "Unsupported file type."],
  [
    "文件被占用或检查不完整，未清理",
    "The file is in use or its usage check is incomplete. It was kept.",
  ],
  ["本次清单过大，请人工审查", "This list is too large. Review it manually."],
  [
    "可重建目录含链接或他人文件，保留",
    "This rebuildable folder contains links or files owned by another user. It was kept.",
  ],
  [
    "仅白名单内可重建内容会永久删除；执行前再次检查路径、内容、占用和所有卷保护线。",
    "Only rebuildable items in approved locations are permanently deleted. T3 checks paths, contents, usage, and volume reserves again before cleanup.",
  ],
  [
    "移入同卷废纸篓，不立即释放空间。T3不自动清空；至少保留7天，期间可从记录恢复。手动清空系统废纸篓会使恢复失效。",
    "Moves items to Trash on the same volume. Space stays occupied. T3 keeps the files for at least 7 days and provides recovery from history. Emptying system Trash makes recovery unavailable.",
  ],
  [
    "同卷废纸篓不可用；原件保留，不回退永久删除",
    "Trash on this volume is unavailable. The original is retained.",
  ],
  ["对象或去向变化，请重新预览", "The item or destination changed. Preview again."],
  [
    "计划后内容或路径变化，原件保留",
    "The contents or path changed after planning. The original is retained.",
  ],
  ["退役对象变化", "The staging item changed."],
  ["废纸篓路径变化", "The Trash path changed."],
  ["上级目录变化", "The parent folder changed."],
  ["退役文件发生变化", "The staged file changed."],
  ["原进程仍在运行", "The original worker is still running."],
  ["恢复路径变化", "The restore path changed."],
  ["原路径有新内容，绝不覆盖", "New content at the original path was kept."],
  ["保全项不完整，锁定等待人工检查", "The retained item is incomplete. Manual review is required."],
  ["已恢复原路径，未继续清理", "The original path was restored. Cleanup stopped."],
  [
    "可用空间与预览相差超过1%，请返回预览重新确认",
    "Free space changed by over 1%. Return to the preview and confirm again.",
  ],
  [
    "对象或去向变化，请返回预览重新确认",
    "The item or destination changed. Return to the preview and confirm again.",
  ],
  [
    "路径身份变化，请返回预览重新确认",
    "The path identity changed. Return to the preview and confirm again.",
  ],
  [
    "文件内容或大小与预览不同，请返回预览重新确认",
    "File contents or size changed. Return to the preview and confirm again.",
  ],
  [
    "旧日志直接删除已停用；请扫描日志并预览移入废纸篓",
    "Scan for older logs and preview moving them to Trash.",
  ],
  ["请选择仍在线的外置卷", "Select a connected external volume."],
  [
    "不可重建资料仅支持归档副本；不能直接释放",
    "Keep the original and create an archive copy for files that can’t be rebuilt.",
  ],
  [
    "本机系统来源/访问标记保留在归档记录中，不重写至新文件；数据、权限与ACL会校验恢复。",
    "System provenance and access tags are kept in the archive. T3 verifies restored data, permissions, and ACLs.",
  ],
  ["恢复目标卷已离线", "The restore destination is offline."],
  [
    "HFS+目标卷的修改时间仅精确到秒；原始纳秒时间保留在归档，内容、所有权和权限仍完整校验。",
    "HFS+ stores timestamps to the nearest second. The archive keeps nanosecond precision. Data, ownership, and permissions are still verified.",
  ],
  ["操作不存在", "Operation not found."],
  ["原进程仍在运行，不能恢复原路径", "The original worker is still running. Restore is blocked."],
  ["该操作无需恢复退役路径", "The operation doesn’t require path recovery."],
  [
    "保全路径的上级目录发生变化，未移动",
    "The parent of the retained folder changed. No files moved.",
  ],
  ["原路径范围不正确", "The original path is outside the allowed area."],
  ["保全目录身份不正确", "Retained folder identity mismatch."],
  [
    "原路径已有新内容，未覆盖；保全目录仍保留",
    "New content at the original path was kept. The retained folder is still available.",
  ],
  [
    "保全目录不完整，已锁定；请从已验证归档恢复到新目录",
    "The retained folder is incomplete and locked. Restore the verified archive to a new folder.",
  ],
  ["保全目录仍被占用，未移动", "The retained folder is still in use. No files moved."],
  [
    "已恢复原路径，未继续释放；外盘归档保留",
    "The original path was restored. The external archive is retained.",
  ],
  ["计划不存在", "Plan not found."],
  ["计划过期，请重新检查", "The plan expired. Check again."],
  ["旧日志计划已失效，请重新扫描", "This old log plan has expired. Scan again."],
  ["不可重建资料禁止直接释放", "Files that can’t be rebuilt must be kept."],
  ["不支持的操作", "Unsupported operation."],
  [
    "原会话仍有准备、排队、运行或等待中的任务，暂不能归档。",
    "The original conversation has active work and can’t be archived yet.",
  ],
  [
    "原会话仍有待处理审批或输入请求，暂不能归档。",
    "Resolve pending approvals or questions before archiving the original conversation.",
  ],
  [
    "原会话仍有活跃的直接子 Agent，暂不能归档。",
    "The original conversation still has active subagents.",
  ],
  [
    "原会话绑定了已启用的定时任务，请先到定时任务管理中处理。",
    "Disable its scheduled task before archiving the original conversation.",
  ],
  [
    "无法核实原会话的运行状态和定时任务，未执行归档，请重试。",
    "Couldn’t verify activity or scheduled tasks. The conversation wasn’t archived.",
  ],
  ["本地搜索进程已停止", "The local search worker stopped."],
  ["本地搜索暂不可用", "Local search is unavailable."],
  ["本地搜索已停止", "Local search stopped."],
  ["本地搜索失败", "Local search failed."],
  ["本地搜索索引暂不可用，请稍后重试。", "The local search index is unavailable. Try again later."],
  ["无法读取保护设置", "Couldn’t read storage protection settings."],
  [
    "当前归档操作需要 macOS 的 Python 3；不会执行清理",
    "This archive operation requires macOS Python 3. Cleanup did not run.",
  ],
  ["归档操作未完成", "Archiving didn’t finish."],
  ["归档进程未返回有效结果", "The archive worker returned an invalid result."],
  ["无法读取磁盘保护设置", "Couldn’t read disk protection settings."],
  ["白名单扫描失败", "Couldn’t scan approved locations."],
  ["清理白名单复核失败", "Couldn’t verify approved cleanup locations."],
  [
    "对象已改变、加锁或扫描不完整；请重新扫描",
    "The item changed, was locked, or wasn’t scanned completely. Scan again.",
  ],
  ["磁盘已离线，未保存保护线", "The disk went offline. The reserve wasn’t saved."],
  ["保存磁盘设置失败", "Couldn’t save disk settings."],
  ["保护线检查失败", "Couldn’t check the space reserve."],
  ["路径含链接", "Path includes a link."],
  ["扫描达到预算，保留原件", "Scan limit reached. The original is retained."],
  [
    "包含链接、跨卷或特殊文件，保留原件",
    "Links, volumes, or special files are present. Originals are retained.",
  ],
  ["非当前用户所有，保留原件", "Another user owns this item. It was kept."],
  ["目录过大，保留原件", "Folder exceeds the size limit. It was kept."],
  [
    "可重建缓存；执行前检查占用和内容变化",
    "Rebuildable cache. T3 checks that it is unchanged and unused before cleanup.",
  ],
  ["npm 下载缓存", "npm download cache"],
  ["pip 下载缓存", "pip download cache"],
  ["pip 下载缓存（Library）", "pip download cache (Library)"],
  ["Homebrew 下载缓存", "Homebrew download cache"],
  ["Yarn 下载缓存", "Yarn download cache"],
  [
    "共享依赖、模拟器或废纸篓：仅展示，不自动移除",
    "Shared dependencies, simulators, or Trash are shown for reference.",
  ],
  ["Chrome 浏览器缓存", "Chrome cache"],
  ["Safari 浏览器缓存", "Safari cache"],
  ["Firefox 浏览器缓存", "Firefox cache"],
  [
    "仅浏览器缓存；运行或占用时拒绝，登录资料不纳入扫描",
    "Browser cache only. In-use data and sign-in files are excluded.",
  ],
  [
    "模型及浏览器运行依赖，需核对正在使用的任务",
    "Model and browser dependencies. Review tasks that are using them.",
  ],
  ["未知软件缓存，未加入可清理白名单", "This app cache isn’t in an approved cleanup location."],
  ["系统缓存受保护；不提权、不清理", "System caches are protected."],
  ["旧诊断日志移入废纸篓，不直接删除", "Older diagnostic logs move to Trash."],
  ["安装包需手动确认；仅移入废纸篓", "Review installers before moving them to Trash."],
  ["下载资料仅分析，不根据大小或日期自动清理", "Downloads are measured only."],
  [
    "保留最新两份及当前回滚链锚点",
    "Keeps the latest two versions and the current rollback checkpoint.",
  ],
  ["超出最近两份回滚保留数；移入废纸篓", "Outside the two-version reserve. Moves to Trash."],
  ["当前安装版本", "Current installed version"],
  ["最近两份冷备加锁", "The two latest cold backups are locked."],
  [
    "预览及执行时完整读取校验最新两份冷备后，旧备份仅进废纸篓",
    "T3 verifies both current cold backups before moving older ones to Trash.",
  ],
  ["冷备校验回执；与归档一同保留", "Cold backup verification receipt. Kept with the archive."],
  [
    "候选签名/封装清单及安装回执匹配；已有更新已验收版本，保留当前回滚链后逐项确认",
    "The signature, package manifest, and replacement receipt match. Review individually and keep the current rollback chain.",
  ],
  [
    "缺少已被取代且无引用的完整证据，保留",
    "Replacement or reference evidence is incomplete. This item is retained.",
  ],
  [
    "缺少完整的安装替代与引用证据，保留",
    "Installation replacement or reference evidence is incomplete. This item is retained.",
  ],
  [
    "可重建产物；缺少任务引用审查，暂不开放释放",
    "Rebuildable item. Review task references before freeing it.",
  ],
  ["无法完整扫描", "Scan incomplete."],
  ["没有可信卷容量，拒绝执行", "Disk capacity is unavailable. The operation stopped."],
  [
    "应用自动更新下载的安装包；删除后需要时会重新下载",
    "Installer saved by an app’s auto-updater. The app downloads it again when needed.",
  ],
  [
    "共享依赖或运行依赖：仅展示，不自动移除",
    "Shared or runtime dependency. Listed only, never removed automatically.",
  ],
  [
    "仅浏览器缓存；浏览器运行时文件被占用会跳过，登录资料不纳入扫描",
    "Browser cache only. Skipped while the browser has files open; sign-in data is never scanned.",
  ],
  ["程序崩溃转储；移入回收站，不直接删除", "Crash dumps. They move to the Recycle Bin."],
  [
    "临时文件请用 Windows 设置 › 系统 › 存储 清理",
    "Clean temporary files in Windows Settings › System › Storage.",
  ],
  ["安装包需手动确认；仅移入回收站", "Review installers before moving them to the Recycle Bin."],
  [
    "移入回收站，不立即释放空间。星云不会清空回收站；需要找回时在回收站中右键“还原”。",
    "Moves items to the Recycle Bin. Space stays occupied. Nebula never empties it; to recover an item, right-click it in the Recycle Bin and choose Restore.",
  ],
  [
    "文件被占用（可能有程序正在使用），未清理",
    "A file is in use by another program. Nothing was cleaned.",
  ],
  ["未能移入回收站，原件保留", "Couldn’t move it to the Recycle Bin. The original is retained."],
  [
    "已移入回收站；需要找回时请打开回收站，右键“还原”",
    "Moved to the Recycle Bin. To recover it, right-click it in the Recycle Bin and choose Restore.",
  ],
  ["操作中断前未移动原件", "The operation stopped before the original was moved."],
  [
    "Windows 暂不支持归档到外置磁盘；可重建缓存和安装包可以直接清理",
    "Archiving to an external disk isn’t available on Windows. Rebuildable caches and installers can be cleaned directly.",
  ],
  ["星云浏览器缓存；运行中的缓存保留", "Nebula browser cache. Kept while in use."],
  ["崩溃转储", "Crash dumps"],
  ["pnpm 共享存储", "pnpm shared store"],
  ["NuGet 包", "NuGet packages"],
  ["Gradle 缓存", "Gradle caches"],
  ["Playwright 浏览器", "Playwright browsers"],
  ["Hugging Face 模型", "Hugging Face models"],
  ["Windows 临时文件", "Windows temporary files"],
  ["Windows 更新缓存", "Windows Update cache"],
  ["pnpm 元数据缓存", "pnpm metadata cache"],
  ["uv 下载缓存", "uv download cache"],
  ["NuGet HTTP 缓存", "NuGet HTTP cache"],
  ["Go 构建缓存", "Go build cache"],
  ["Electron 下载缓存", "Electron download cache"],
  ["electron-builder 下载缓存", "electron-builder download cache"],
  ["Cargo 下载缓存", "Cargo download cache"],
  ["Bun 下载缓存", "Bun download cache"],
  ["回收站", "Recycle Bin"],
  ["每页最多100条批注", "Up to 100 annotations per page"],
  [
    "批注存储已达到32MiB，请先整理",
    "Annotation storage reached 32 MiB. Remove some annotations first.",
  ],
  ["批注会话已关闭", "This annotation session has closed."],
  ["批注页面不匹配", "The annotations belong to a different page."],
  ["批注截图范围无效", "Invalid annotation screenshot area."],
  ["不支持的批注操作", "Unsupported annotation action."],
]);

// Older servers and persisted operations carry the original Chinese copy.
export function serverCopy(message: string): string {
  if (readUiLocale() === "zh-CN") return message;
  const exact = serverMessages.get(message);
  if (exact) return uiText(exact);
  const changed = "；7天内有改动，需手动确认";
  if (message.endsWith(changed)) {
    return uiText("{reason}. Modified in the last 7 days. Review required.", {
      reason: serverCopy(message.slice(0, -changed.length)).replace(/\.$/, ""),
    });
  }
  const staging = "；暂存仍需检查";
  if (message.endsWith(staging)) {
    return uiText("{reason}. Staging still needs inspection.", {
      reason: serverCopy(message.slice(0, -staging.length)).replace(/\.$/, ""),
    });
  }
  const retained = "源路径已被重新创建；未覆盖新目录，原件保全于 ";
  if (message.startsWith(retained)) {
    return uiText(
      "The source path was recreated. The new folder was kept. Original retained at {path}",
      {
        path: message.slice(retained.length),
      },
    );
  }
  const unfinished = "删除未完成；剩余内容保留在 ";
  if (message.startsWith(unfinished))
    return uiText("Deletion didn’t finish. The rest is kept at {path}", {
      path: message.slice(unfinished.length),
    });
  const drive = /^本地磁盘 \((.+)\)$/u.exec(message);
  if (drive) return uiText("Local Disk ({drive})", { drive: drive[1] });
  const updater = /^(.+) 更新安装包$/u.exec(message);
  if (updater) return uiText("{app} update installer", { app: updater[1] });
  const browser = /^(\S+) 浏览器缓存（(.+?)( · 代码缓存)?）$/u.exec(message);
  if (browser)
    return uiText(browser[3] ? "{browser} code cache ({profile})" : "{browser} cache ({profile})", {
      browser: browser[1],
      profile: browser[2],
    });
  const reserve = /^(.*) 执行后会低于保护线，拒绝执行$/u.exec(message);
  if (reserve)
    return uiText("{path} would fall below its free-space reserve. The operation stopped.", {
      path: reserve[1],
    });
  const fallback = /^(.+) 额度已用完或触发限流，已自动切到 (.+)$/u.exec(message);
  if (fallback)
    return uiText("{provider} reached its quota or rate limit. Switched to {fallback}.", {
      provider: fallback[1],
      fallback: fallback[2],
    });
  return message;
}
