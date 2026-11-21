import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasStandaloneHelpFlag, main } from "../src/cli.js";
import { attachNote } from "../src/notes/notes.js";

describe("Universal CLI --help handling", () => {
  let tempDir: string;
  let originalCwd: string;
  let originalExitCode: typeof process.exitCode;

  beforeEach(() => {
    originalCwd = process.cwd();
    originalExitCode = process.exitCode;
    tempDir = mkdtempSync(join(tmpdir(), "lognexus-cli-help-"));
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.exitCode = originalExitCode;
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

  it("exits cleanly with code 0 on doctor --help without running diagnostics", async () => {
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

    const code = await main(["doctor", "--help"]);

    expect(code).toBe(0);
    expect(exitSpy).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
    expect(logs.join("\n")).toContain("Usage:");
    expect(logs.join("\n")).toContain("doctor [--mcp]");
    expect(logs.join("\n")).not.toContain("Running diagnostics");
  });

  it("fails with process.exitCode = 1 when unknown option is passed to doctor", async () => {
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

    await main(["doctor", "--unknown-flag"]);

    expect(process.exitCode).toBe(1);
    expect(exitSpy).not.toHaveBeenCalled();
    expect(errors.join("\n")).toContain("[ERROR] Unknown doctor option: --unknown-flag");
    expect(logs.join("\n")).toContain("Usage:");
    expect(logs.join("\n")).not.toContain("Running diagnostics");
  });

  it("completes cleanly on doctor --mcp", async () => {
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

    const code = await main(["doctor", "--mcp"]);

    expect(code).toBe(0);
    expect(exitSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(originalExitCode);
    expect(errors).toEqual([]);
    expect(logs.join("\n")).toContain("Running diagnostics...\n");
    expect(logs.join("\n")).toContain("Diagnostic complete.\n");
    expect(logs.join("\n")).toContain("MCP Client Configs");
  });

  it("sets process.exitCode = 1 on doctor --mcp when a diagnostic check fails", async () => {
    const logDir = join(tempDir, ".lognexus");
    mkdirSync(logDir);
    writeFileSync(join(logDir, "policy.json"), "{ invalid-json", "utf8");

    const logs: string[] = [];
    const errors: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
      logs.push(parts.map(String).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
      errors.push(parts.map(String).join(" "));
    });

    await main(["doctor", "--mcp"]);

    expect(process.exitCode).toBe(1);
    expect(logs.join("\n")).toContain("[FAIL] LogNexus Rules:");
  });

  it("preserves exit behavior (does not set exitCode) on doctor without --mcp even when a check fails", async () => {
    const logDir = join(tempDir, ".lognexus");
    mkdirSync(logDir);
    writeFileSync(join(logDir, "policy.json"), "{ invalid-json", "utf8");

    const logs: string[] = [];
    const errors: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
      logs.push(parts.map(String).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
      errors.push(parts.map(String).join(" "));
    });

    await main(["doctor"]);

    expect(process.exitCode).toBe(originalExitCode);
    expect(logs.join("\n")).toContain("[FAIL] LogNexus Rules:");
  });

  it("exits cleanly with code 0 on note export --help without running git", async () => {
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

    const code = await main(["note", "export", "--help"]);

    expect(code).toBe(0);
    expect(exitSpy).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
    expect(logs.join("\n")).toContain("Usage:");
    expect(logs.join("\n")).toContain("export [--since <ref>]");
  });

  it("fails with process.exitCode = 1 on note export --unknown", async () => {
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

    await main(["note", "export", "--unknown"]);

    expect(process.exitCode).toBe(1);
    expect(exitSpy).not.toHaveBeenCalled();
    expect(errors.join("\n")).toContain("[ERROR] Unknown note export option: --unknown");
    expect(logs.join("\n")).toContain("Usage:");
  });

  it("outputs pure parseable JSONL to stdout without banner text on note export", async () => {
    execSync("git init", { cwd: tempDir, stdio: "ignore" });
    execSync('git config user.name "Test Runner"', { cwd: tempDir, stdio: "ignore" });
    execSync('git config user.email "test@example.com"', { cwd: tempDir, stdio: "ignore" });
    writeFileSync(join(tempDir, "sample.txt"), "sample data", "utf8");
    execSync("git add sample.txt", { cwd: tempDir, stdio: "ignore" });
    execSync('git commit -m "feat(#82/T1): add sample"', { cwd: tempDir, stdio: "ignore" });

    attachNote(
      JSON.stringify({ issue: { id: 82, title: "Export" }, subtask: { id: "T1" } }),
      "HEAD",
      { cwd: tempDir },
    );

    const logs: string[] = [];
    const stdoutChunks: string[] = [];
    const errors: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
      logs.push(parts.map(String).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
      errors.push(parts.map(String).join(" "));
    });
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      stdoutChunks.push(String(chunk));
      return true;
    });

    const code = await main(["note", "export"]);

    expect(code).toBe(0);
    expect(errors).toEqual([]);
    expect(logs).toEqual([]);
    const fullStdout = stdoutChunks.join("");
    expect(fullStdout).not.toContain("LogNexus CLI");
    expect(fullStdout).not.toContain("Usage:");
    const lines = fullStdout.trim().split("\n");
    expect(lines.length).toBe(1);
    const parsed = JSON.parse(lines[0]) as { subject: string; note: { subtask: { id: string } } };
    expect(parsed.subject).toContain("feat(#82/T1): add sample");
    expect(parsed.note.subtask.id).toBe("T1");
  });

  it("writes .jsonl file cleanly on note export -o .lognexus/notes-archive.jsonl", async () => {
    execSync("git init", { cwd: tempDir, stdio: "ignore" });
    execSync('git config user.name "Test Runner"', { cwd: tempDir, stdio: "ignore" });
    execSync('git config user.email "test@example.com"', { cwd: tempDir, stdio: "ignore" });
    writeFileSync(join(tempDir, "sample.txt"), "sample data", "utf8");
    execSync("git add sample.txt", { cwd: tempDir, stdio: "ignore" });
    execSync('git commit -m "feat(#82/T1): add sample"', { cwd: tempDir, stdio: "ignore" });

    attachNote(
      JSON.stringify({ issue: { id: 82, title: "Export" }, subtask: { id: "T1" } }),
      "HEAD",
      { cwd: tempDir },
    );

    const logs: string[] = [];
    const errors: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
      logs.push(parts.map(String).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
      errors.push(parts.map(String).join(" "));
    });

    const code = await main(["note", "export", "-o", ".lognexus/notes-archive.jsonl"]);

    expect(code).toBe(0);
    expect(errors).toEqual([]);
    expect(logs.join("\n")).toContain(
      "[OK] Exported 1 Git Note(s) to .lognexus/notes-archive.jsonl",
    );

    const exportedFile = join(tempDir, ".lognexus", "notes-archive.jsonl");
    expect(existsSync(exportedFile)).toBe(true);
    const content = readFileSync(exportedFile, "utf8");
    const lines = content.trim().split("\n");
    expect(lines.length).toBe(1);
    const parsed = JSON.parse(lines[0]) as { subject: string };
    expect(parsed.subject).toContain("feat(#82/T1): add sample");
  });
});
