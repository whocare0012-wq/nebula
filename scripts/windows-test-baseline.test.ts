import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { compareWithBaseline, failedTests } from "./windows-test-baseline.ts";

describe("windows-test-baseline", () => {
  it("names failed tests by repo-relative file and compares them with the known list", () => {
    const root = NodePath.resolve("/repo");
    const failed = failedTests(
      {
        testResults: [
          {
            name: NodePath.join(root, "apps", "server", "src", "a.test.ts"),
            assertionResults: [
              { fullName: "a > symlinks", status: "failed" },
              { fullName: "a > works", status: "passed" },
            ],
          },
          {
            name: NodePath.join(root, "apps", "server", "src", "b.test.ts"),
            assertionResults: [{ fullName: "b > new bug", status: "failed" }],
          },
        ],
      },
      root,
    );
    expect(failed).toEqual([
      "apps/server/src/a.test.ts > a > symlinks",
      "apps/server/src/b.test.ts > b > new bug",
    ]);

    const result = compareWithBaseline(
      failed,
      [
        "apps/server/src/a.test.ts > a > symlinks",
        "apps/server/src/c.test.ts > c > fixed upstream",
        "apps/web/src/d.test.ts > d > not run here",
      ],
      ["apps/server"],
    );
    expect(result.unexpected).toEqual(["apps/server/src/b.test.ts > b > new bug"]);
    expect(result.nowPassing).toEqual(["apps/server/src/c.test.ts > c > fixed upstream"]);
  });
});
