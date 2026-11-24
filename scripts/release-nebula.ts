// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - a synchronous release checklist.
// Releases Nebula (the Windows fork) in one command: picks the next version, builds the NSIS
// installer, pushes the branch and publishes a GitHub release that the in-app updater reads.
//
//   node scripts/release-nebula.ts [--bump patch|minor|major | --version X.Y.Z]
//                                  [--notes <file>] [--skip-build] [--dry-run]
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

export const REPOSITORY = "whocare0012-wq/nebula";
const REMOTE = "nebula";
const ARCH = "x64";

type Bump = "patch" | "minor" | "major";
type Version = readonly [number, number, number];

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

export function parseVersion(text: string): Version | undefined {
  const match = VERSION_PATTERN.exec(text.trim().replace(/^v/, ""));
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

export const formatVersion = (version: Version) => version.join(".");

export function compareVersions(left: Version, right: Version): number {
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

export function bumpVersion(version: Version, bump: Bump): Version {
  if (bump === "major") return [version[0] + 1, 0, 0];
  if (bump === "minor") return [version[0], version[1] + 1, 0];
  return [version[0], version[1], version[2] + 1];
}

/** The newest `vX.Y.Z` tag in `git ls-remote --tags` output, with the commit it points at. */
export function latestReleaseTag(
  lsRemote: string,
): { readonly version: Version; readonly commit: string } | undefined {
  let latest: { version: Version; commit: string } | undefined;
  for (const line of lsRemote.split("\n")) {
    const [commit, ref] = line.trim().split(/\s+/);
    const tag = ref?.replace(/^refs\/tags\//, "");
    if (!commit || !tag || tag.endsWith("^{}")) continue;
    const version = parseVersion(tag);
    if (version && (!latest || compareVersions(version, latest.version) > 0)) {
      latest = { version, commit };
    }
  }
  return latest;
}

const UPSTREAM_MERGE =
  /^Merge (?:upstream\b|(?:remote-tracking )?branch '(?:origin|upstream)\/main')/i;

/**
 * Bilingual notes drafted from the first-parent history since the last release: fork commits are
 * listed by subject, upstream merges are summarized with how many commits they brought in.
 */
export function draftReleaseNotes(
  commits: ReadonlyArray<{ readonly subject: string; readonly mergedCount?: number }>,
): string {
  const own = commits.filter((commit) => !UPSTREAM_MERGE.test(commit.subject));
  const upstream = commits
    .filter((commit) => UPSTREAM_MERGE.test(commit.subject))
    .reduce((sum, commit) => sum + (commit.mergedCount ?? 0), 0);
  const english = own.map((commit) => `- ${commit.subject}`);
  const chinese = own.map((commit) => `- ${commit.subject}`);
  if (upstream > 0) {
    english.push(`- Merged ${upstream} upstream T3 Code commits.`);
    chinese.push(`- 合并上游 T3 Code 的 ${upstream} 个提交。`);
  }
  if (english.length === 0) {
    english.push("- Maintenance release.");
    chinese.push("- 维护版本。");
  }
  return ["Changes:", "", ...english, "", "---", "", "更新内容：", "", ...chinese, ""].join("\n");
}

function run(
  command: string,
  args: ReadonlyArray<string>,
  options: NodeChildProcess.SpawnSyncOptions = {},
) {
  const result = NodeChildProcess.spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = typeof result.stderr === "string" ? result.stderr.trim() : "";
    throw new Error(`${command} ${args.join(" ")} failed (exit ${result.status}). ${detail}`);
  }
  return typeof result.stdout === "string" ? result.stdout : "";
}

const git = (...args: ReadonlyArray<string>) => run("git", args).trim();

function readFlags(argv: ReadonlyArray<string>) {
  const flags = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index++) {
    const name = argv[index]!;
    if (!name.startsWith("--")) throw new Error(`Unexpected argument: ${name}`);
    const value = argv[index + 1];
    if (value !== undefined && !value.startsWith("--")) {
      flags.set(name.slice(2), value);
      index++;
    } else {
      flags.set(name.slice(2), true);
    }
  }
  const known = new Set(["bump", "version", "notes", "skip-build", "dry-run"]);
  for (const name of flags.keys()) if (!known.has(name)) throw new Error(`Unknown flag: --${name}`);
  return flags;
}

function main() {
  const flags = readFlags(process.argv.slice(2));
  const dryRun = flags.has("dry-run");
  const gh = process.env.GH ?? "gh";

  if (git("status", "--porcelain") !== "") throw new Error("The worktree has uncommitted changes.");
  git("fetch", REMOTE, "main", "--tags");
  const head = git("rev-parse", "HEAD");
  const remoteMain = git("rev-parse", `${REMOTE}/main`);
  const fastForward = NodeChildProcess.spawnSync("git", [
    "merge-base",
    "--is-ancestor",
    remoteMain,
    head,
  ]);
  if (fastForward.status !== 0) {
    throw new Error(`${REMOTE}/main has commits that HEAD lacks; merge them first.`);
  }

  const latest = latestReleaseTag(run("git", ["ls-remote", "--tags", REMOTE]));
  const requested = flags.get("version");
  const bump = flags.get("bump") ?? "patch";
  if (bump !== "patch" && bump !== "minor" && bump !== "major") {
    throw new Error("--bump must be patch, minor or major.");
  }
  const version =
    typeof requested === "string"
      ? parseVersion(requested)
      : bumpVersion(latest?.version ?? [0, 0, 0], bump);
  if (!version) throw new Error(`Not a version: ${String(requested)}`);
  if (latest && compareVersions(version, latest.version) <= 0) {
    throw new Error(
      `${formatVersion(version)} is not newer than v${formatVersion(latest.version)}.`,
    );
  }
  const versionText = formatVersion(version);
  const tag = `v${versionText}`;

  const notesFlag = flags.get("notes");
  let notes: string;
  if (typeof notesFlag === "string") {
    notes = NodeFS.readFileSync(notesFlag, "utf8");
  } else {
    const range = latest ? `${latest.commit}..HEAD` : "HEAD";
    const lines = git("log", "--first-parent", "--format=%H%x09%P%x09%s", range);
    const commits = lines
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [sha, parents, ...subject] = line.split("\t");
        const merged = parents?.split(" ")[1];
        return {
          subject: subject.join("\t"),
          ...(merged
            ? { mergedCount: Number(git("rev-list", "--count", `${sha}^1..${merged}`)) }
            : {}),
        };
      })
      .toReversed();
    notes = draftReleaseNotes(commits);
  }

  const releaseDir = NodePath.resolve("release");
  const artifacts = [
    `Nebula-${versionText}-${ARCH}.exe`,
    `Nebula-${versionText}-${ARCH}.exe.blockmap`,
    "latest.yml",
  ].map((name) => NodePath.join(releaseDir, name));
  const notesFile = NodePath.join(releaseDir, `release-notes-${versionText}.md`);

  console.log(`Releasing Nebula ${tag} from ${head.slice(0, 10)} to ${REPOSITORY}.`);
  console.log(`\n${notes}`);
  if (dryRun) {
    console.log("Dry run: nothing was built, pushed or published.");
    return;
  }

  if (!flags.has("skip-build")) {
    run(
      "node",
      [
        "scripts/build-desktop-artifact.ts",
        "--platform",
        "win",
        "--target",
        "nsis",
        "--arch",
        ARCH,
        "--build-version",
        versionText,
      ],
      { stdio: "inherit", env: { ...process.env, T3CODE_DESKTOP_UPDATE_REPOSITORY: REPOSITORY } },
    );
  }
  const missing = artifacts.filter((artifact) => !NodeFS.existsSync(artifact));
  if (missing.length > 0) throw new Error(`Missing build output: ${missing.join(", ")}`);
  if (!NodeFS.readFileSync(artifacts[2]!, "utf8").includes(`version: ${versionText}`)) {
    throw new Error(`release/latest.yml does not describe ${versionText}.`);
  }
  NodeFS.writeFileSync(notesFile, notes);

  run("git", ["push", REMOTE, "HEAD:main"], { stdio: "inherit" });
  run(
    gh,
    [
      "release",
      "create",
      tag,
      ...artifacts,
      "--repo",
      REPOSITORY,
      "--target",
      head,
      "--title",
      `Nebula ${versionText}`,
      "--notes-file",
      notesFile,
    ],
    { stdio: "inherit" },
  );
  console.log(`Published https://github.com/${REPOSITORY}/releases/tag/${tag}`);
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
