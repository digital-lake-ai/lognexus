import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

  it("documents the context-window topology and delegation thresholds in routing.md", () => {
    initProject(tempDir);
    const content = readFileSync(join(tempDir, ".lognexus", "routing.md"), "utf8");

    expect(content).toContain("Context-Window Topology & Multi-File Delegation Thresholds");
    expect(content).toContain("max_direct_inspect_files: 4");
    expect(content).toContain("max_subtask_files: 6");
    expect(content).toContain("max_subtask_loc: 1200");
  });
});
