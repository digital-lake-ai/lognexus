import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasStandaloneHelpFlag, main } from "../src/cli.js";

describe("Universal CLI --help handling", () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tempDir = mkdtempSync(join(tmpdir(), "lognexus-cli-help-"));
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("detects standalone --help/-h while skipping values of value-taking flags and stopping at --", () => {
    expect(hasStandaloneHelpFlag(["init", "--help"])).toBe(true);
    expect(hasStandaloneHelpFlag(["commit", "-h"])).toBe(true);
    expect(hasStandaloneHelpFlag(["telemetry", "--help"])).toBe(true);
    expect(hasStandaloneHelpFlag(["state", "--help"])).toBe(true);
    expect(hasStandaloneHelpFlag(["note", "--help"])).toBe(true);
    expect(hasStandaloneHelpFlag(["commit", "-m", "fix --help", "--help"])).toBe(true);
    expect(hasStandaloneHelpFlag(["state", "set-task", "T1", "--title", "Add --help", "-h"])).toBe(
      true,
    );

    expect(hasStandaloneHelpFlag(["commit", "-m", "fix --help"])).toBe(false);
    expect(hasStandaloneHelpFlag(["commit", "-m", "--help"])).toBe(false);
    expect(hasStandaloneHelpFlag(["commit", "-F", "-h"])).toBe(false);
    expect(hasStandaloneHelpFlag(["state", "set-task", "T1", "--title", "--help"])).toBe(false);
    expect(hasStandaloneHelpFlag(["commit", "--", "--help"])).toBe(false);
    expect(hasStandaloneHelpFlag(["commit", "--message=--help"])).toBe(false);
  });

  it.each([
    ["init", "--help"],
    ["commit", "--help"],
    ["commit", "-h"],
    ["telemetry", "--help"],
    ["state", "--help"],
    ["note", "--help"],
    ["commit", "-m", "fix --help", "--help"],
  ])("prints usage and returns 0 with zero disk writes for %s", async (...args) => {
    const logs: string[] = [];
    const errors: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
      logs.push(parts.map(String).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
      errors.push(parts.map(String).join(" "));
    });
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("unexpected process.exit");
    }) as never);

    const code = await main(args);

    expect(code).toBe(0);
    expect(exitSpy).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
    expect(logs.join("\n")).toContain("Usage:");
    expect(logs.join("\n")).toContain("lognexus <command> [subcommand] [options]");
    expect(existsSync(join(tempDir, ".lognexus"))).toBe(false);
    expect(existsSync(join(tempDir, ".gitignore"))).toBe(false);
  });

  it("does not intercept commit -m 'fix --help' as a help invocation", async () => {
    const logs: string[] = [];
    const errors: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
      logs.push(parts.map(String).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
      errors.push(parts.map(String).join(" "));
    });
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`EXIT:${code ?? 0}`);
    }) as never);

    await expect(main(["commit", "-m", "fix --help"])).rejects.toThrow("EXIT:1");
    expect(logs.join("\n")).not.toContain("Usage:");
    expect(errors.join("\n")).toContain("Commit failed:");
  });
});
