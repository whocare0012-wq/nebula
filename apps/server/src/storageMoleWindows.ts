// @effect-diagnostics nodeBuiltinImport:off - bounded read-only listing of known Windows cache folders.
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import type { CleanupTarget } from "./storageMole.ts";

export type WindowsCleanupRoots = {
  home: string;
  localAppData: string;
  downloads: string;
  temp: string;
  windowsDir: string;
};

// realpath gives the casing the scanner compares against; a missing root stays as configured.
const canonical = (p: string) => {
  try {
    return NodeFS.realpathSync.native(p);
  } catch {
    return p;
  }
};

export const windowsCleanupRoots = (input: {
  home: string;
  temp: string;
  env: NodeJS.ProcessEnv;
}): WindowsCleanupRoots => {
  const home = canonical(input.home);
  return {
    home,
    localAppData: canonical(input.env.LOCALAPPDATA || NodePath.join(home, "AppData", "Local")),
    downloads: canonical(NodePath.join(home, "Downloads")),
    temp: canonical(input.temp),
    windowsDir: canonical(input.env.SystemRoot || input.env.windir || "C:\\Windows"),
  };
};

const namesAt = async (p: string) => {
  try {
    return (await NodeFSP.readdir(p)).toSorted().slice(0, 240);
  } catch {
    return [];
  }
};

const BROWSERS = [
  ["Google\\Chrome\\User Data", "Chrome"],
  ["Microsoft\\Edge\\User Data", "Edge"],
  ["BraveSoftware\\Brave-Browser\\User Data", "Brave"],
] as const;

export async function windowsCleanupTargets(roots: WindowsCleanupRoots): Promise<CleanupTarget[]> {
  const targets: CleanupTarget[] = [];
  const add = (
    p: string,
    category: string,
    rebuildable: boolean,
    locked = false,
    reason = "可重建缓存；执行前检查占用和内容变化",
    risk: CleanupTarget["risk"] = rebuildable ? "safe" : "caution",
  ) => {
    const target: CleanupTarget = { path: p, category, rebuildable, locked, reason, risk };
    targets.push(target);
    return target;
  };
  const local = roots.localAppData;
  for (const [base, relative, name] of [
    [local, "npm-cache\\_cacache", "npm 下载缓存"],
    [local, "pnpm-cache", "pnpm 元数据缓存"],
    [local, "Yarn\\Cache", "Yarn 下载缓存"],
    [local, "pip\\Cache", "pip 下载缓存"],
    [local, "uv\\cache", "uv 下载缓存"],
    [local, "NuGet\\v3-cache", "NuGet HTTP 缓存"],
    [local, "go-build", "Go 构建缓存"],
    [local, "electron\\Cache", "Electron 下载缓存"],
    [local, "electron-builder\\Cache", "electron-builder 下载缓存"],
    [roots.home, ".cargo\\registry\\cache", "Cargo 下载缓存"],
    [roots.home, ".bun\\install\\cache", "Bun 下载缓存"],
  ] as const)
    add(NodePath.join(base, relative), "developer-cache", true).name = name;
  // electron-updater keeps the last downloaded installer; apps download it again when needed.
  for (const name of await namesAt(local))
    if (/^[\w.@-]+-updater$/i.test(name))
      add(
        NodePath.join(local, name),
        "installers",
        true,
        false,
        "应用自动更新下载的安装包；删除后需要时会重新下载",
      ).name = `${name.slice(0, -"-updater".length)} 更新安装包`;
  // Content-addressed stores back live hard links; never delete them by age.
  for (const [base, relative, name] of [
    [local, "pnpm\\store", "pnpm 共享存储"],
    [roots.home, ".nuget\\packages", "NuGet 包"],
    [roots.home, ".gradle\\caches", "Gradle 缓存"],
    [local, "ms-playwright", "Playwright 浏览器"],
    [roots.home, ".cache\\huggingface", "Hugging Face 模型"],
  ] as const)
    add(
      NodePath.join(base, relative),
      "developer-cache",
      false,
      true,
      "共享依赖或运行依赖：仅展示，不自动移除",
    ).name = name;
  for (const [relative, browser] of BROWSERS) {
    const userData = NodePath.join(local, relative);
    for (const profile of await namesAt(userData))
      if (/^(?:Default|Profile \d+)$/.test(profile))
        for (const cache of ["Cache", "Code Cache"])
          add(
            NodePath.join(userData, profile, cache),
            "browser-cache",
            true,
            false,
            "仅浏览器缓存；浏览器运行时文件被占用会跳过，登录资料不纳入扫描",
          ).name = `${browser} 浏览器缓存（${profile}${cache === "Cache" ? "" : " · 代码缓存"}）`;
  }
  const firefox = NodePath.join(local, "Mozilla\\Firefox\\Profiles");
  for (const profile of await namesAt(firefox))
    add(
      NodePath.join(firefox, profile, "cache2"),
      "browser-cache",
      true,
      false,
      "仅浏览器缓存；浏览器运行时文件被占用会跳过，登录资料不纳入扫描",
    ).name = `Firefox 浏览器缓存（${profile}）`;
  add(
    NodePath.join(local, "CrashDumps"),
    "logs",
    false,
    false,
    "程序崩溃转储；移入回收站，不直接删除",
  ).name = "崩溃转储";
  add(
    roots.temp,
    "system-cache",
    false,
    true,
    "临时文件请用 Windows 设置 › 系统 › 存储 清理",
  ).name = "Windows 临时文件";
  add(
    NodePath.join(roots.windowsDir, "SoftwareDistribution\\Download"),
    "system-cache",
    false,
    true,
    "系统缓存受保护；不提权、不清理",
  ).name = "Windows 更新缓存";
  // Other downloads are the user's own files; only installers are offered, and only to the Recycle Bin.
  const downloads = await NodeFSP.readdir(roots.downloads).catch((): string[] => []);
  for (const name of downloads
    .filter((n) => /\.(?:exe|msi|msix|msixbundle|appx|appxbundle|iso)$/i.test(n))
    .toSorted()
    .slice(0, 120))
    add(
      NodePath.join(roots.downloads, name),
      "installers",
      false,
      false,
      "安装包需手动确认；仅移入回收站",
    );
  const priority = (target: CleanupTarget) =>
    ["developer-cache", "installers", "browser-cache", "logs"].indexOf(target.category);
  return targets.toSorted(
    (a, b) => (priority(a) < 0 ? 99 : priority(a)) - (priority(b) < 0 ? 99 : priority(b)),
  );
}
