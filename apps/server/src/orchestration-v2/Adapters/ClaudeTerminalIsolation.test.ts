// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { afterEach, describe, expect, it } from "@effect/vitest";
import { isolateClaudeTerminalOptions } from "./ClaudeTerminalIsolation.ts";
import { makeTerminalArgs } from "./ClaudeTerminalMessages.ts";

// Windows symlinks need elevation; a junction is the unprivileged folder link, and what pnpm makes there.
function linkDirectory(target: string, link: string) {
  if (HostProcess.Platform.defaultValue() !== "win32") return NodeFS.symlinkSync(target, link);
  NodeFS.symlinkSync(NodePath.resolve(NodePath.dirname(link), target), link, "junction");
}

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) NodeFS.rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-tui-isolation-test-"));
  roots.push(root);
  for (const dir of ["home/.claude", "workspace", "tmp"]) {
    NodeFS.mkdirSync(NodePath.join(root, dir), { recursive: true });
  }
  NodeFS.writeFileSync(NodePath.join(root, ".t3-claude-tui-sandbox"), "1\n");
  return {
    root,
    options: {
      cwd: NodePath.join(root, "workspace"),
      env: {
        CLAUDE_CONFIG_DIR: NodePath.join(root, "home/.claude"),
        PATH: "/usr/bin:/bin",
        T3CODE_THREAD_ID: "fixture-thread",
        CLAUDE_CODE_RESUME_INTERRUPTED_TURN: "1",
        CLAUDE_CODE_RESUME_REASON: "user_resume",
        HOME: NodeOS.homedir(),
        ANTHROPIC_API_KEY: "must-not-inherit",
        CLAUDE_CODE_OAUTH_TOKEN: "must-not-inherit",
        CLAUDE_CODE_ENTRYPOINT: "sdk-ts",
        BUN_OPTIONS: "--preload unrelated.js",
        HTTPS_PROXY: "http://127.0.0.1:7890",
        T3_CLAUDE_TUI_TEST_UPSTREAM: "http://127.0.0.1:12345",
        CLAUDE_CODE_MAX_OUTPUT_TOKENS: "512",
      },
    },
  };
}

describe("Claude terminal account isolation", () => {
  it("uses the selected account, preserves Keychain access, and accepts ordinary projects", () => {
    const { root, options } = fixture();
    const config = NodeFS.realpathSync(NodePath.join(root, "home/.claude"));
    const input = {
      ...options,
      cwd: NodeOS.homedir(),
      env: { ...options.env, CLAUDE_CONFIG_DIR: config },
    };
    for (const settings of [
      { fastMode: false },
      { fastMode: true },
      { ultracode: false },
      { ultracode: true },
    ]) {
      const configured = isolateClaudeTerminalOptions(undefined, { ...input, settings });
      expect(configured.settings).toMatchObject(settings);
    }
    const isolated = isolateClaudeTerminalOptions(undefined, input);
    expect(isolated.cwd).toBe(NodeFS.realpathSync(NodeOS.homedir()));
    expect(isolated.env?.CLAUDE_CONFIG_DIR).toBe(config);
    expect(isolated.env?.HOME).toBe(NodeFS.realpathSync(NodeOS.homedir()));
    expect(isolated.env?.XDG_CONFIG_HOME).toBe(NodePath.join(config, ".t3-terminal/home/.config"));
    expect(isolated.env?.T3CODE_THREAD_ID).toBe("fixture-thread");
    expect(isolated.env?.CLAUDE_CODE_RESUME_INTERRUPTED_TURN).toBe("1");
    expect(isolated.env?.CLAUDE_CODE_RESUME_REASON).toBe("user_resume");
    expect(isolated.env).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(isolated.env).not.toHaveProperty("CLAUDE_CODE_OAUTH_TOKEN");
    expect(isolated.env?.T3_CLAUDE_TUI_TEST_UPSTREAM).toBe(options.env.T3_CLAUDE_TUI_TEST_UPSTREAM);
    expect(isolated.env).not.toHaveProperty("CLAUDE_SECURESTORAGE_CONFIG_DIR");
    expect(isolateClaudeTerminalOptions(undefined, isolated)).toEqual(isolated);
    expect(input.env.HOME).toBe(NodeOS.homedir());
  });

  it("refuses default and aliased accounts before launching the daily TUI", () => {
    const { root, options } = fixture();
    expect(() => isolateClaudeTerminalOptions(undefined, { ...options, env: {} })).toThrow(
      "explicit separate",
    );
    expect(() =>
      isolateClaudeTerminalOptions(undefined, {
        ...options,
        env: { CLAUDE_CONFIG_DIR: NodeOS.homedir() },
      }),
    ).toThrow();
    const config = NodeFS.realpathSync(NodePath.join(root, "home/.claude"));
    linkDirectory(config, NodePath.join(root, "alias"));
    expect(() =>
      isolateClaudeTerminalOptions(undefined, {
        ...options,
        env: { CLAUDE_CONFIG_DIR: NodePath.join(root, "alias") },
      }),
    ).toThrow("path alias");
    linkDirectory(NodePath.join(root, "workspace"), NodePath.join(config, ".t3-terminal"));
    expect(() =>
      isolateClaudeTerminalOptions(undefined, { ...options, env: { CLAUDE_CONFIG_DIR: config } }),
    ).toThrow("symlink");
  });

  it("uses only the sandbox home, keeps routing, and drops inherited identity and credentials", () => {
    const { root, options } = fixture();
    const settings = { fastMode: false, ultracode: true };
    const isolated = isolateClaudeTerminalOptions(root, { ...options, settings });
    expect(isolated.settings).toMatchObject(settings);
    expect(isolated.env).toMatchObject({
      HOME: NodeFS.realpathSync(NodePath.join(root, "home")),
      T3CODE_THREAD_ID: "fixture-thread",
      CLAUDE_CONFIG_DIR: NodeFS.realpathSync(NodePath.join(root, "home/.claude")),
      HTTPS_PROXY: options.env.HTTPS_PROXY,
      T3_CLAUDE_TUI_TEST_UPSTREAM: "http://127.0.0.1:12345",
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: "512",
    });
    for (const key of [
      "ANTHROPIC_API_KEY",
      "CLAUDE_CODE_OAUTH_TOKEN",
      "CLAUDE_CODE_ENTRYPOINT",
      "BUN_OPTIONS",
    ]) {
      expect(isolated.env).not.toHaveProperty(key);
    }
    expect(isolated.settingSources).toEqual([]);
    expect(isolated.settings).toMatchObject({ disableDeepLinkRegistration: "disable" });
    expect(options.env.HOME).toBe(NodeOS.homedir());
  });

  it("rejects a missing marker, default account, real workspace, and symlinked account directory", () => {
    const { root, options } = fixture();
    expect(() =>
      isolateClaudeTerminalOptions(root, {
        ...options,
        env: { CLAUDE_CONFIG_DIR: NodePath.join(NodeOS.homedir(), ".claude") },
      }),
    ).toThrow();
    expect(() =>
      isolateClaudeTerminalOptions(root, { ...options, cwd: NodeOS.homedir() }),
    ).toThrow();
    const account = NodePath.join(root, "home/.claude");
    NodeFS.rmdirSync(account);
    linkDirectory(NodeOS.homedir(), account);
    expect(() => isolateClaudeTerminalOptions(root, options)).toThrow();
    NodeFS.unlinkSync(account);
    NodeFS.mkdirSync(account);
    NodeFS.unlinkSync(NodePath.join(root, ".t3-claude-tui-sandbox"));
    expect(() => isolateClaudeTerminalOptions(root, options)).toThrow();
  });

  it("rejects escape options instead of silently falling back to the SDK", () => {
    const { root, options } = fixture();
    for (const extra of [
      { extraArgs: { print: null } },
      { extraArgs: { settings: "/private/settings.json" } },
      { extraArgs: { "setting-sources": "user,project" } },
      { settings: { env: { HOME: NodeOS.homedir() } } },
      { settings: { env: { CLAUDE_CODE_ENTRYPOINT: "cli" } } },
      { settings: { hooks: { Stop: [] } } },
      { additionalDirectories: [NodeOS.homedir()] },
      { resumeSessionAt: "unsupported-rewind" },
      { mcpServers: { external: { command: "unsupported-stdio" } } },
      { env: { ...options.env, T3_CLAUDE_TUI_TEST_UPSTREAM: "https://example.com" } },
      { env: { ...options.env, T3_CLAUDE_TUI_TEST_UPSTREAM: "http://user:pass@127.0.0.1:12345" } },
    ])
      expect(() => isolateClaudeTerminalOptions(root, { ...options, ...extra })).toThrow();
  });
  it("accepts pnpm links confined to the selected account cache", () => {
    const { root, options } = fixture();
    const config = NodeFS.realpathSync(NodePath.join(root, "home/.claude"));
    const cache = NodePath.join(config, ".t3-terminal/home/.local/share/pnpm");
    const target = NodePath.join(cache, "store/v11/packages/exe/node_modules/exe");
    const link = NodePath.join(cache, "store/v11/links/pnpm/node_modules/exe");
    NodeFS.mkdirSync(target, { recursive: true });
    NodeFS.mkdirSync(NodePath.dirname(link), { recursive: true });
    linkDirectory(NodePath.relative(NodePath.dirname(link), target), link);
    const configured = isolateClaudeTerminalOptions(undefined, {
      ...options,
      env: { ...options.env, CLAUDE_CONFIG_DIR: config },
    });
    expect(configured.env?.CLAUDE_CONFIG_DIR).toBe(config);
    expect(isolateClaudeTerminalOptions(undefined, configured)).toEqual(configured);
  });

  it.each(["escape", "prefix-sibling", "dangling", "cycle", "cache-alias", "other-link"])(
    "rejects unsafe account cache layout: %s",
    (kind) => {
      const { root, options } = fixture();
      const config = NodeFS.realpathSync(NodePath.join(root, "home/.claude"));
      const home = NodePath.join(config, ".t3-terminal/home");
      const cache = NodePath.join(home, ".local/share/pnpm");
      NodeFS.mkdirSync(cache, { recursive: true });
      if (kind === "escape") linkDirectory(root, NodePath.join(cache, "escape"));
      if (kind === "prefix-sibling") {
        NodeFS.mkdirSync(`${cache}-other`);
        linkDirectory(`${cache}-other`, NodePath.join(cache, "escape"));
      }
      if (kind === "dangling") linkDirectory("missing", NodePath.join(cache, "broken"));
      if (kind === "cycle") linkDirectory(cache, NodePath.join(cache, "cycle"));
      if (kind === "cache-alias") {
        NodeFS.renameSync(cache, `${cache}-actual`);
        linkDirectory(`${cache}-actual`, cache);
      }
      if (kind === "other-link") linkDirectory(cache, NodePath.join(home, "other"));
      expect(() =>
        isolateClaudeTerminalOptions(undefined, {
          ...options,
          env: { ...options.env, CLAUDE_CONFIG_DIR: config },
        }),
      ).toThrow("Claude TUI prototype isolation:");
    },
  );
});

// Root cause of "no step capsule in T3 Claude sessions": the terminal launch runs `claude` with
// `--setting-sources ""` and a filtered environment, so neither the account's settings.json nor the
// instance environment carried CLAUDE_CODE_ENABLE_TODO_TOOLS, and Claude Code left TaskCreate,
// TaskUpdate and TaskList out for models it does not know.
describe("Claude terminal launch keeps the task-list tools", () => {
  const launch = (isolated: ReturnType<typeof isolateClaudeTerminalOptions>) => ({
    args: makeTerminalArgs(
      {
        ...isolated,
        sessionId: "11111111-1111-4111-8111-111111111111",
        model: "claude-sonnet-5-5",
      },
      { settingsPath: "/tmp/settings.json" },
    ),
    env: isolated.env ?? {},
  });

  it("turns the tools on for the selected account and the sandbox, and disables none", () => {
    const { root, options } = fixture();
    const config = NodeFS.realpathSync(NodePath.join(root, "home/.claude"));
    const account = isolateClaudeTerminalOptions(undefined, {
      ...options,
      env: { ...options.env, CLAUDE_CONFIG_DIR: config },
    });
    const sandbox = isolateClaudeTerminalOptions(root, options);
    for (const isolated of [account, sandbox]) {
      const { args, env } = launch(isolated);
      expect(env.CLAUDE_CODE_ENABLE_TODO_TOOLS).toBe("1");
      // The launch still ignores the account's settings.json, which is why the variable is set here.
      expect(args).toContain("--setting-sources");
      expect(args).not.toContain("--tools");
      expect(args.join(" ")).not.toMatch(
        /--disallowedTools|TaskCreate|TaskUpdate|TaskList|TodoWrite/,
      );
    }
  });

  it("keeps an explicit value and stays stable when isolated twice", () => {
    const { root, options } = fixture();
    const config = NodeFS.realpathSync(NodePath.join(root, "home/.claude"));
    const input = {
      ...options,
      env: { ...options.env, CLAUDE_CONFIG_DIR: config, CLAUDE_CODE_ENABLE_TODO_TOOLS: "0" },
    };
    const isolated = isolateClaudeTerminalOptions(undefined, input);
    expect(isolated.env?.CLAUDE_CODE_ENABLE_TODO_TOOLS).toBe("0");
    const defaulted = isolateClaudeTerminalOptions(undefined, {
      ...options,
      env: { ...options.env, CLAUDE_CONFIG_DIR: config },
    });
    expect(isolateClaudeTerminalOptions(undefined, defaulted)).toEqual(defaulted);
  });
});
