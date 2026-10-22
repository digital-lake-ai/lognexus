import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executeAtomicCommit } from "../src/commit.js";
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
});
