import { assert, describe, it } from "@effect/vitest";

import { migrateLegacyDesktopBaseDir } from "./DesktopStatePaths.ts";

const join = (...segments: string[]) => segments.join("/");

const migrate = (existing: ReadonlyArray<string>, rename: (from: string, to: string) => void) =>
  migrateLegacyDesktopBaseDir({
    homeDirectory: "/home/alice",
    joinPath: join,
    exists: (path) => existing.includes(path),
    rename,
  });

describe("migrateLegacyDesktopBaseDir", () => {
  it("moves the shared T3 home once", () => {
    const renames: Array<string> = [];
    const result = migrate(["/home/alice/.t3", "/home/alice/.t3/userdata"], (from, to) => {
      renames.push(`${from} -> ${to}`);
    });
    assert.deepStrictEqual(result, {
      kind: "moved",
      from: "/home/alice/.t3",
      to: "/home/alice/.nebula",
    });
    assert.deepStrictEqual(renames, ["/home/alice/.t3 -> /home/alice/.nebula"]);
  });

  it("leaves both homes alone once Nebula has its own, or when there is nothing to move", () => {
    const fail = () => assert.fail("must not rename");
    assert.deepStrictEqual(
      migrate(["/home/alice/.nebula", "/home/alice/.t3", "/home/alice/.t3/userdata"], fail),
      { kind: "none" },
    );
    assert.deepStrictEqual(migrate(["/home/alice/.t3"], fail), { kind: "none" });
  });

  it("keeps using the shared home while another app has it open", () => {
    const busy = new Error("EPERM");
    const result = migrate(["/home/alice/.t3", "/home/alice/.t3/userdata"], () => {
      throw busy;
    });
    assert.deepStrictEqual(result, {
      kind: "kept-legacy",
      legacyBaseDir: "/home/alice/.t3",
      cause: busy,
    });
  });
});
