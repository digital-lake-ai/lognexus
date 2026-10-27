import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeAtomicCommit, parseCommitArgs } from "../src/commit.js";
import { getNote } from "../src/notes/notes.js";
import { loadState, setSubtask } from "../src/state/manager.js";

describe("Atomic Commit Engine (lognexus commit)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lognexus-commit-test-"));
    execSync("git init", { cwd: tempDir, stdio: "ignore" });
    execSync('git config user.name "Test Runner"', { cwd: tempDir, stdio: "ignore" });
    execSync('git config user.email "test@example.com"', { cwd: tempDir, stdio: "ignore" });
    execSync('git config commit.gpgsign "false"', { cwd: tempDir, stdio: "ignore" });

    writeFileSync(join(tempDir, "initial.txt"), "hello", "utf8");
    execSync("git add initial.txt", { cwd: tempDir, stdio: "ignore" });
    execSync('git commit -m "chore: initial commit"', { cwd: tempDir, stdio: "ignore" });
    execSync("git checkout -b issue/15-test-branch", { cwd: tempDir, stdio: "ignore" });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("successfully commits and attaches Git Note in a single atomic operation", () => {
    setSubtask("T1", "Add feature", undefined, tempDir);
    writeFileSync(join(tempDir, "feature.ts"), "export const ok = true;", "utf8");
    execSync("git add feature.ts", { cwd: tempDir, stdio: "ignore" });

    const result = executeAtomicCommit({
      message: "feat(#15/T1): implement atomic commit engine",
      author: "gemini/flash (antigravity)",
      reviewer: "gemini/pro (lead-architect)",
      finishTask: true,
      targetDir: tempDir,
    });

    expect(result.sha).toHaveLength(40);
    expect(result.shortSha).toHaveLength(7);
    expect(result.subtaskCompleted).toBe("T1");
    expect(result.noteAttached).toBe(true);

    // Verify commit trailers in git log
    const log = execSync("git log -1 --format=%B HEAD", { cwd: tempDir, encoding: "utf8" });
    expect(log).toContain("Authored-by: gemini/flash (antigravity)");
    expect(log).toContain("Reviewed-by: gemini/pro (lead-architect)");

    // Verify subtask status is retained as completed in state
    const state = loadState(tempDir);
    expect(state.currentSubtask?.id).toBe("T1");
    expect(state.currentSubtask?.status).toBe("completed");
    expect(state.completedSubtasks).toContain("T1");

    // Verify Git Note is attached
    const note = getNote("HEAD", { cwd: tempDir });
    expect(note).not.toBeNull();
    const parsed = JSON.parse(note as string);
    expect(parsed.subtask.id).toBe("T1");
    expect(parsed.subtask.status).toBe("completed");
  });

  it("rejects commit when author and reviewer violate review-gate separation (self-approval)", () => {
    writeFileSync(join(tempDir, "feature.ts"), "code", "utf8");
    execSync("git add feature.ts", { cwd: tempDir, stdio: "ignore" });

    expect(() => {
      executeAtomicCommit({
        message: "feat(#15/T1): bad self-approval commit",
        author: "gemini/flash (agent)",
        reviewer: "gemini/flash (agent)",
        targetDir: tempDir,
      });
    }).toThrow(/Review-gate separation violation/);
  });

  it("enforces subtask contract allowedFiles and forbiddenFiles", () => {
    setSubtask(
      "T2",
      "Restricted task",
      {
        allowedFiles: ["src/allowed.ts"],
        forbiddenFiles: ["package.json"],
        decisionBudget: "none",
      },
      tempDir,
    );

    // Case A: Touching forbidden file
    writeFileSync(join(tempDir, "package.json"), "{}", "utf8");
    execSync("git add package.json", { cwd: tempDir, stdio: "ignore" });

    expect(() => {
      executeAtomicCommit({
        message: "feat(#15/T2): illegal edit to package.json",
        author: "gemini/flash",
        targetDir: tempDir,
      });
    }).toThrow(/touch forbidden set: package.json/);

    // Reset staged
    execSync("git reset", { cwd: tempDir, stdio: "ignore" });

    // Case B: Touching outside allowed set
    writeFileSync(join(tempDir, "other.ts"), "const x = 1;", "utf8");
    execSync("git add other.ts", { cwd: tempDir, stdio: "ignore" });

    expect(() => {
      executeAtomicCommit({
        message: "feat(#15/T2): touching outside file",
        author: "gemini/flash",
        targetDir: tempDir,
      });
    }).toThrow(/outside the allowed set: other.ts/);

    // Reset staged
    execSync("git reset", { cwd: tempDir, stdio: "ignore" });

    // Case C: Touching strictly allowed file
    mkdirSync(join(tempDir, "src"), { recursive: true });
    writeFileSync(join(tempDir, "src/allowed.ts"), "export const ok = 1;", "utf8");
    execSync("git add src/allowed.ts", { cwd: tempDir, stdio: "ignore" });

    const result = executeAtomicCommit({
      message: "feat(#15/T2): valid edit to allowed file",
      author: "gemini/flash",
      targetDir: tempDir,
    });
    expect(result.noteAttached).toBe(true);
  });

  it("executes atomic commit using -F / --file message file", () => {
    writeFileSync(join(tempDir, "file_input.txt"), "hello world", "utf8");
    execSync("git add file_input.txt", { cwd: tempDir, stdio: "ignore" });

    const msgFile = join(tempDir, "commit_msg.txt");
    writeFileSync(msgFile, "feat(#15/T1): commit via file input\n\nDetailed context line.", "utf8");

    const parsed = parseCommitArgs(["-F", msgFile, "--author", "gemini/flash"]);
    expect(parsed.message).toBeDefined();
    const result = executeAtomicCommit({
      message: parsed.message || "",
      author: parsed.author,
      targetDir: tempDir,
    });

    expect(result.subject).toBe("feat(#15/T1): commit via file input");
    expect(result.noteAttached).toBe(true);

    const log = execSync("git log -1 --format=%B HEAD", { cwd: tempDir, encoding: "utf8" });
    expect(log).toContain("Detailed context line.");
    expect(log).toContain("Authored-by: gemini/flash");
  });

  it("rejects direct commits on protected branch 'main' with clear governance violation", () => {
    execSync("git checkout -B main", { cwd: tempDir, stdio: "ignore" });
    writeFileSync(join(tempDir, "direct.txt"), "forbidden", "utf8");
    execSync("git add direct.txt", { cwd: tempDir, stdio: "ignore" });

    expect(() => {
      executeAtomicCommit({
        message: "feat(#15/T1): direct commit attempt on main",
        author: "gemini/flash",
        targetDir: tempDir,
      });
    }).toThrow(
      /Governance violation: Direct commits on protected branch 'main' are strictly forbidden/,
    );
  });

  it("rejects direct commits on protected branch 'master' with clear governance violation", () => {
    execSync("git checkout -B master", { cwd: tempDir, stdio: "ignore" });
    writeFileSync(join(tempDir, "direct.txt"), "forbidden", "utf8");
    execSync("git add direct.txt", { cwd: tempDir, stdio: "ignore" });

    expect(() => {
      executeAtomicCommit({
        message: "feat(#15/T1): direct commit attempt on master",
        author: "gemini/flash",
        targetDir: tempDir,
      });
    }).toThrow(
      /Governance violation: Direct commits on protected branch 'master' are strictly forbidden/,
    );
  });

  it("automatically permits the first foundational commit on an unborn branch (0 commits bootstrap)", () => {
    const freshDir = mkdtempSync(join(tmpdir(), "unborn-test-"));
    try {
      execSync("git init", { cwd: freshDir, stdio: "ignore" });
      execSync('git config user.name "Test Runner"', { cwd: freshDir, stdio: "ignore" });
      execSync('git config user.email "test@example.com"', { cwd: freshDir, stdio: "ignore" });
      execSync('git config commit.gpgsign "false"', { cwd: freshDir, stdio: "ignore" });
      writeFileSync(join(freshDir, "init.txt"), "first", "utf8");
      execSync("git add init.txt", { cwd: freshDir, stdio: "ignore" });

      const result = executeAtomicCommit({
        message: "chore: foundational commit on unborn branch",
        author: "gemini/flash",
        targetDir: freshDir,
      });

      expect(result.noteAttached).toBe(true);
      expect(result.subject).toBe("chore: foundational commit on unborn branch");
    } finally {
      rmSync(freshDir, { recursive: true, force: true });
    }
  });

  it("permits direct commits on protected branches when _internalTestAllowMain is explicitly enabled", () => {
    execSync("git checkout -B main", { cwd: tempDir, stdio: "ignore" });
    writeFileSync(join(tempDir, "direct.txt"), "allowed with override", "utf8");
    execSync("git add direct.txt", { cwd: tempDir, stdio: "ignore" });

    const result = executeAtomicCommit({
      message: "chore: bootstrap commit on main",
      author: "gemini/flash",
      _internalTestAllowMain: true,
      targetDir: tempDir,
    });

    expect(result.noteAttached).toBe(true);
    expect(result.subject).toBe("chore: bootstrap commit on main");
  });
});

describe("Commit Arguments Parser (parseCommitArgs & shell resilience)", () => {
  it("parses conventional single-string arguments cleanly", () => {
    const parsed = parseCommitArgs([
      "-m",
      "feat(#15/T1): standard commit message",
      "--author",
      "gemini/flash",
      "--reviewer",
      "gemini/pro",
      "--finish-task",
      "--allow-empty",
    ]);

    expect(parsed.message).toBe("feat(#15/T1): standard commit message");
    expect(parsed.author).toBe("gemini/flash");
    expect(parsed.reviewer).toBe("gemini/pro");
    expect(parsed.finishTask).toBe(true);
    expect(parsed.allowEmpty).toBe(true);
  });

  it("reassembles quote-stripped positional words split by Windows shells (cmd.exe quote-stripping)", () => {
    // Windows cmd.exe /c strips quotes on special characters like parenthesis: feat(#15/T1):
    // resulting in individual positional args in process.argv
    const rawTokens = [
      "-m",
      "feat(#15/T1):",
      "implementar",
      "rig",
      "humanoide",
      "universal",
      "--author",
      "deepseek/chat",
      "(kimi-code)",
      "--reviewer",
      "gemini/pro",
      "(lead-architect)",
    ];

    const parsed = parseCommitArgs(rawTokens);
    expect(parsed.message).toBe("feat(#15/T1): implementar rig humanoide universal");
    expect(parsed.author).toBe("deepseek/chat (kimi-code)");
    expect(parsed.reviewer).toBe("gemini/pro (lead-architect)");
  });

  it("supports reading commit message from file using -F and --file", () => {
    const msgFile = join(tmpdir(), `lognexus-msg-test-${Date.now()}-${Math.random()}.txt`);
    const multiLineMessage =
      "feat(#15/T1): multiline commit from file\n\nDetailed context line 1.\nDetailed context line 2.";
    writeFileSync(msgFile, multiLineMessage, "utf8");

    try {
      const parsedShort = parseCommitArgs(["-F", msgFile, "--finish-task"]);
      expect(parsedShort.message).toBe(multiLineMessage);
      expect(parsedShort.finishTask).toBe(true);

      const parsedLong = parseCommitArgs(["--file", msgFile]);
      expect(parsedLong.message).toBe(multiLineMessage);
    } finally {
      rmSync(msgFile, { force: true });
    }
  });

  it("throws a descriptive error when -F target file does not exist", () => {
    expect(() => {
      parseCommitArgs(["-F", "non_existent_commit_file_xyz.txt"]);
    }).toThrow(/Commit message file not found/);
  });

  it("throws a descriptive error when -F is provided without a path", () => {
    expect(() => {
      parseCommitArgs(["-F"]);
    }).toThrow(/Flag -F \/ --file requires a file path argument/);
  });

  it("parses --tier and --escalated routing flags", () => {
    const parsed = parseCommitArgs([
      "-m",
      "feat(#15/T1): routing flags",
      "--author",
      "gemini/pro (antigravity)",
      "--tier",
      "tier-1",
      "--escalated",
    ]);

    expect(parsed.tier).toBe("tier-1");
    expect(parsed.escalated).toBe(true);
  });

  it("normalizes --tier values to lowercase and defaults escalated to false", () => {
    const parsed = parseCommitArgs(["-m", "feat(#15/T1): routing flags", "--tier", "TIER-2"]);

    expect(parsed.tier).toBe("tier-2");
    expect(parsed.escalated).toBe(false);
  });

  it("throws a descriptive error when --tier is provided without a value or with an invalid one", () => {
    expect(() => {
      parseCommitArgs(["-m", "feat(#15/T1): routing flags", "--tier"]);
    }).toThrow(/Flag --tier requires a value/);

    expect(() => {
      parseCommitArgs(["-m", "feat(#15/T1): routing flags", "--tier", "tier-9"]);
    }).toThrow(/Invalid --tier value 'tier-9'/);
  });
});

describe("Commit tier routing (inference, escalation and audit trail)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lognexus-tier-test-"));
    execSync("git init", { cwd: tempDir, stdio: "ignore" });
    execSync('git config user.name "Test Runner"', { cwd: tempDir, stdio: "ignore" });
    execSync('git config user.email "test@example.com"', { cwd: tempDir, stdio: "ignore" });
    execSync('git config commit.gpgsign "false"', { cwd: tempDir, stdio: "ignore" });

    writeFileSync(join(tempDir, "initial.txt"), "hello", "utf8");
    execSync("git add initial.txt", { cwd: tempDir, stdio: "ignore" });
    execSync('git commit -m "chore: initial commit"', { cwd: tempDir, stdio: "ignore" });
    execSync("git checkout -b issue/15-test-branch", { cwd: tempDir, stdio: "ignore" });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function stageFeature(): void {
    setSubtask(
      "T1",
      "Tier routing",
      { allowedFiles: ["feature.ts"], forbiddenFiles: [], decisionBudget: "none" },
      tempDir,
    );
    writeFileSync(join(tempDir, "feature.ts"), "export const ok = true;", "utf8");
    execSync("git add feature.ts", { cwd: tempDir, stdio: "ignore" });
  }

  function readNote(): Record<string, unknown> {
    const note = getNote("HEAD", { cwd: tempDir });
    expect(note).not.toBeNull();
    return JSON.parse(note as string) as Record<string, unknown>;
  }

  it("infers the tier from the author when no --tier override is given", () => {
    stageFeature();

    executeAtomicCommit({
      message: "feat(#15/T1): author tier inference",
      author: "gemini/flash (antigravity)",
      targetDir: tempDir,
    });

    expect(readNote().tier).toBe("tier-2");
  });

  it("warns on stderr when a tier-1 author modifies implementation files without --escalated", () => {
    stageFeature();
    const stderrChunks: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      stderrChunks.push(String(chunk));
      return true;
    });

    try {
      executeAtomicCommit({
        message: "feat(#15/T1): tier-1 author on a contracted subtask",
        author: "gemini/pro (antigravity)",
        targetDir: tempDir,
      });
    } finally {
      spy.mockRestore();
    }

    const output = stderrChunks.join("");
    expect(output).toContain("tier-routing-violation");
    expect(output).toContain("gemini/pro (antigravity)");
    expect(output).toContain("--escalated");
    expect(readNote().escalated).toBeUndefined();
  });

  it("silences the warning and records the escalation when --escalated is set", () => {
    stageFeature();
    const stderrChunks: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      stderrChunks.push(String(chunk));
      return true;
    });

    try {
      executeAtomicCommit({
        message: "feat(#15/T1): acknowledged tier-1 escalation",
        author: "gemini/pro (antigravity)",
        escalated: true,
        targetDir: tempDir,
      });
    } finally {
      spy.mockRestore();
    }

    expect(stderrChunks.join("")).not.toContain("tier-routing-violation");
    const note = readNote();
    expect(note.tier).toBe("tier-1");
    expect(note.escalated).toBe(true);
  });

  it("does not warn tier-1 authors when only documentation is staged", () => {
    writeFileSync(join(tempDir, "NOTES.md"), "# docs", "utf8");
    execSync("git add NOTES.md", { cwd: tempDir, stdio: "ignore" });
    const stderrChunks: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      stderrChunks.push(String(chunk));
      return true;
    });

    try {
      executeAtomicCommit({
        message: "docs(#15/T1): document tier routing",
        author: "gemini/pro (antigravity)",
        targetDir: tempDir,
      });
    } finally {
      spy.mockRestore();
    }

    expect(stderrChunks.join("")).not.toContain("tier-routing-violation");
  });
});
