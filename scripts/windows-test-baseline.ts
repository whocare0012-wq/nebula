// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - a synchronous test-report wrapper.
// Many upstream tests assume macOS or Linux (POSIX paths, symlinks without privileges, /bin/sh).
// Rather than editing them, T3 Nebula keeps the list of tests known to fail on Windows and only
// reports failures outside it, so a real regression still stands out.
//
//   node scripts/windows-test-baseline.ts [--update] [--from <report.json>] <package dir>...
//
// Runs `vp test run` in each package with the JSON reporter, compares failed tests with
// scripts/windows-known-failures.json, and exits non-zero when a test fails that is not listed.
// --update rewrites the list for those packages from this run; --from reads an existing report.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

const ROOT = NodePath.resolve(import.meta.dirname, "..");
const BASELINE = NodePath.join(import.meta.dirname, "windows-known-failures.json");

interface VitestReport {
  readonly testResults: ReadonlyArray<{
    readonly name: string;
    readonly assertionResults: ReadonlyArray<{
      readonly fullName: string;
      readonly status: string;
    }>;
  }>;
}

/** `<repo-relative file> > <full test name>` for every failed test in a vitest JSON report. */
export function failedTests(report: VitestReport, root: string): ReadonlyArray<string> {
  return report.testResults
    .flatMap((file) => {
      const relative = NodePath.relative(root, file.name).split(NodePath.sep).join("/");
      return file.assertionResults
        .filter((test) => test.status === "failed")
        .map((test) => `${relative} > ${test.fullName}`);
    })
    .toSorted();
}

export function compareWithBaseline(
  failed: ReadonlyArray<string>,
  known: ReadonlyArray<string>,
  packages: ReadonlyArray<string>,
) {
  const inScope = (test: string) => packages.some((dir) => test.startsWith(`${dir}/`));
  const knownSet = new Set(known);
  const failedSet = new Set(failed);
  return {
    unexpected: failed.filter((test) => !knownSet.has(test)),
    nowPassing: known.filter((test) => inScope(test) && !failedSet.has(test)),
  };
}

function readBaseline(): ReadonlyArray<string> {
  return NodeFS.existsSync(BASELINE) ? JSON.parse(NodeFS.readFileSync(BASELINE, "utf8")) : [];
}

function runPackage(dir: string): VitestReport {
  const outputFile = NodePath.join(
    NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-win-tests-")),
    "report.json",
  );
  NodeChildProcess.spawnSync(
    "vp",
    ["test", "run", "--reporter=dot", "--reporter=json", `--outputFile.json=${outputFile}`],
    { cwd: NodePath.join(ROOT, dir), stdio: "inherit" },
  );
  if (!NodeFS.existsSync(outputFile)) throw new Error(`${dir}: vitest wrote no JSON report.`);
  return JSON.parse(NodeFS.readFileSync(outputFile, "utf8"));
}

function main() {
  const args = process.argv.slice(2);
  const update = args.includes("--update");
  const fromIndex = args.indexOf("--from");
  const from = fromIndex === -1 ? undefined : args[fromIndex + 1];
  const packages = args
    .filter((arg, index) => !arg.startsWith("--") && (fromIndex === -1 || index !== fromIndex + 1))
    .map((dir) => dir.replace(/\\/g, "/").replace(/\/$/, ""));
  if (packages.length === 0)
    throw new Error("Name at least one package directory, e.g. apps/server.");

  const reports = from
    ? [JSON.parse(NodeFS.readFileSync(from, "utf8")) as VitestReport]
    : packages.map(runPackage);
  const failed = reports.flatMap((report) => failedTests(report, ROOT));
  const known = readBaseline();

  if (update) {
    const kept = known.filter((test) => !packages.some((dir) => test.startsWith(`${dir}/`)));
    const next = [...new Set([...kept, ...failed])].toSorted();
    NodeFS.writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`Recorded ${failed.length} known Windows failures for ${packages.join(", ")}.`);
    return;
  }

  const { unexpected, nowPassing } = compareWithBaseline(failed, known, packages);
  if (nowPassing.length > 0) {
    console.log(`\n${nowPassing.length} known Windows failures now pass (run with --update):`);
    for (const test of nowPassing) console.log(`  ✓ ${test}`);
  }
  if (unexpected.length > 0) {
    console.log(`\n${unexpected.length} tests failed that are not known Windows failures:`);
    for (const test of unexpected) console.log(`  × ${test}`);
    process.exitCode = 1;
    return;
  }
  console.log(`\nNo unexpected failures (${failed.length} known Windows failures).`);
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
