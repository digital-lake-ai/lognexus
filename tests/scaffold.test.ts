import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initProject, LOGNEXUS_GITIGNORE_ENTRIES } from "../src/scaffold.js";

describe("initProject", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lognexus-scaffold-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates .lognexus and routing.md when initializing in clean directory", () => {
    const res = initProject(tempDir);
    expect(res.created).toContain(".lognexus/");
    expect(res.created).toContain(".lognexus/routing.md");
    expect(res.skipped).toHaveLength(0);

    const routingPath = join(tempDir, ".lognexus", "routing.md");
    expect(existsSync(routingPath)).toBe(true);

    const content = readFileSync(routingPath, "utf8");
    expect(content).toContain("routing: confirm");
  });

  it("skips existing files if already initialized", () => {
    initProject(tempDir);
    const secondRun = initProject(tempDir);

    expect(secondRun.created).toHaveLength(0);
    expect(secondRun.skipped).toContain(".lognexus/");
    expect(secondRun.skipped).toContain(".lognexus/routing.md");
    expect(secondRun.skipped).toContain(".gitignore");
  });

  it("scaffolds a .gitignore that ignores the ephemeral .lognexus runtime files", () => {
    const res = initProject(tempDir);
    expect(res.created).toContain(".gitignore");

    const content = readFileSync(join(tempDir, ".gitignore"), "utf8");
    for (const entry of LOGNEXUS_GITIGNORE_ENTRIES) {
      expect(content).toContain(entry);
    }
  });

  it("appends only the missing entries to a pre-existing .gitignore", () => {
    writeFileSync(join(tempDir, ".gitignore"), "node_modules/\n.lognexus/state.json\n", "utf8");

    const res = initProject(tempDir);
    expect(res.created).toContain(".gitignore");

    const content = readFileSync(join(tempDir, ".gitignore"), "utf8");
    expect(content).toContain("node_modules/");
    expect(
      content.split(/\r?\n/).filter((line) => line.trim() === ".lognexus/state.json"),
    ).toHaveLength(1);
    expect(content).toContain(".lognexus/handoff.md");
  });

  it("documents native assistant autonomy and contract governance in routing.md", () => {
    initProject(tempDir);
    const content = readFileSync(join(tempDir, ".lognexus", "routing.md"), "utf8");

    expect(content).toContain("Native Assistant Autonomy & Contract Execution Governance");
    expect(content).toContain("assistant_autonomy:");
    expect(content).toContain("contract_governance:");
    expect(content).toContain("max_subtask_files: 6");
    expect(content).toContain("max_subtask_loc: 1200");
  });
});

describe("initProject token shield (--protect-tokens)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lognexus-token-shield-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("leaves the workspace untouched when the flag is absent", () => {
    const res = initProject(tempDir);

    expect(existsSync(join(tempDir, ".geminiignore"))).toBe(false);
    expect(existsSync(join(tempDir, ".aiexclude"))).toBe(false);
    expect(existsSync(join(tempDir, ".cursorignore"))).toBe(false);
    expect(existsSync(join(tempDir, ".claude", "settings.json"))).toBe(false);
    expect(res.created.every((f) => !f.includes("ignore") || f === ".gitignore")).toBe(true);
  });

  it("writes the universal core shield in a workspace without detected clients", () => {
    const res = initProject(tempDir, { protectTokens: true });

    expect(res.created).toContain(".geminiignore");
    expect(res.created).toContain(".aiexclude");
    expect(res.created).toContain(".cursorignore");
    expect(res.created).toContain(".claude/settings.json");

    for (const file of [".geminiignore", ".aiexclude", ".cursorignore"]) {
      const content = readFileSync(join(tempDir, file), "utf8");
      expect(content).toContain("package-lock.json");
      expect(content).toContain("node_modules/");
    }

    const settings = JSON.parse(
      readFileSync(join(tempDir, ".claude", "settings.json"), "utf8"),
    ) as {
      permissions: { deny: string[] };
    };
    expect(settings.permissions.deny).toContain("Read(./package-lock.json)");
    expect(settings.permissions.deny).toContain("Read(./node_modules/**)");
  });

  it("is idempotent on a second run", () => {
    initProject(tempDir, { protectTokens: true });
    const secondRun = initProject(tempDir, { protectTokens: true });

    expect(secondRun.created).toHaveLength(0);
    expect(secondRun.skipped).toContain(".geminiignore");
    expect(secondRun.skipped).toContain(".aiexclude");
    expect(secondRun.skipped).toContain(".cursorignore");
    expect(secondRun.skipped).toContain(".claude/settings.json");
  });

  it("targets the detected clients instead of the universal core", () => {
    writeFileSync(join(tempDir, "GEMINI.md"), "# rules\n", "utf8");
    mkdirSync(join(tempDir, ".roo"), { recursive: true });

    const res = initProject(tempDir, { protectTokens: true });

    expect(res.created).toContain(".geminiignore");
    expect(res.created).toContain(".aiexclude");
    expect(res.created).toContain(".rooignore");
    expect(existsSync(join(tempDir, ".cursorignore"))).toBe(false);
    expect(existsSync(join(tempDir, ".claude", "settings.json"))).toBe(false);
  });

  it("merges deny rules into existing Claude settings without dropping user config", () => {
    mkdirSync(join(tempDir, ".claude"), { recursive: true });
    writeFileSync(
      join(tempDir, ".claude", "settings.json"),
      JSON.stringify(
        {
          env: { FOO: "bar" },
          permissions: { allow: ["Bash(git status)"], deny: ["Read(./.env)"] },
        },
        null,
        2,
      ),
      "utf8",
    );

    initProject(tempDir, { protectTokens: true });

    const settings = JSON.parse(
      readFileSync(join(tempDir, ".claude", "settings.json"), "utf8"),
    ) as {
      env: Record<string, string>;
      permissions: { allow: string[]; deny: string[] };
    };
    expect(settings.env.FOO).toBe("bar");
    expect(settings.permissions.allow).toContain("Bash(git status)");
    expect(settings.permissions.deny).toContain("Read(./.env)");
    expect(settings.permissions.deny).toContain("Read(./package-lock.json)");
    expect(new Set(settings.permissions.deny).size).toBe(settings.permissions.deny.length);
  });
});
