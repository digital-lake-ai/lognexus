import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initProject } from "../src/scaffold.js";

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
  });
});
