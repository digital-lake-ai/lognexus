import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { auditBranch } from "../src/audit/audit.js";
import { attachCurrentStateToCommit } from "../src/notes/attach.js";

function git(args: string, targetDir: string): string {
  return execSync(`git ${args}`, { cwd: targetDir, encoding: "utf8" }).trim();
}

function commitFile(targetDir: string, fileName: string, content: string, message: string): string {
  writeFileSync(join(targetDir, fileName), content, "utf8");
  execSync(`git add ${fileName}`, { cwd: targetDir, stdio: "ignore" });
  const messageFile = join(tmpdir(), `lognexus-commit-msg-${Date.now()}-${Math.random()}.txt`);
  writeFileSync(messageFile, message, "utf8");
  try {
    git(`commit -F "${messageFile}"`, targetDir);
  } finally {
    rmSync(messageFile, { force: true });
  }
  return git("rev-parse HEAD", targetDir);
}

describe("Traceability audit", () => {
  let tempDir: string;
  let baseBranch: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lognexus-audit-test-"));
    execSync("git init", { cwd: tempDir, stdio: "ignore" });
    execSync('git config user.name "Test Runner"', { cwd: tempDir, stdio: "ignore" });
    execSync('git config user.email "test@example.com"', { cwd: tempDir, stdio: "ignore" });
    execSync('git config commit.gpgsign "false"', { cwd: tempDir, stdio: "ignore" });
    commitFile(tempDir, "file.txt", "hello world", "chore: initial commit");
    baseBranch = git("branch --show-current", tempDir) || "main";
    execSync("git checkout -b issue/9-timeline-audit", { cwd: tempDir, stdio: "ignore" });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("passes the audit for well-formed commits with Authored-by trailers and notes", () => {
    commitFile(
      tempDir,
      "feature.txt",
      "feature",
      "feat(#9/T1): implement journey timeline\n\nAuthored-by: deepseek/chat (kimi-code)\n",
    );
    attachCurrentStateToCommit("HEAD", { cwd: tempDir });

    const result = auditBranch(baseBranch, tempDir);

    expect(result.commitCount).toBe(1);
    expect(result.violations).toEqual([]);
    expect(result.summary).toEqual({ errors: 0, warnings: 0 });
    expect(result.passed).toBe(true);
  });

  it("reports an error when the Authored-by trailer is missing", () => {
    commitFile(tempDir, "feature.txt", "feature", "feat(#9/T1): implement journey timeline");

    const result = auditBranch(baseBranch, tempDir);
    const violation = result.violations.find((v) => v.rule === "authored-by-trailer");

    expect(violation).toBeDefined();
    expect(violation?.severity).toBe("error");
    expect(violation?.message).toContain("Authored-by");
    expect(violation?.shortSha).toHaveLength(7);
    expect(result.passed).toBe(false);
    expect(result.summary.errors).toBe(1);
  });

  it("reports an error when the author and reviewer are identical (self-approval)", () => {
    commitFile(
      tempDir,
      "feature.txt",
      "feature",
      "feat(#9/T1): implement journey timeline\n\nAuthored-by: deepseek/chat (kimi-code)\nReviewed-by: deepseek/chat (kimi-code)\n",
    );

    const result = auditBranch(baseBranch, tempDir);
    const violation = result.violations.find((v) => v.rule === "review-gate-separation");

    expect(violation).toBeDefined();
    expect(violation?.severity).toBe("error");
    expect(violation?.message).toContain("Self-approval");
    expect(result.passed).toBe(false);
  });

  it("accepts a reviewer from a different model family", () => {
    commitFile(
      tempDir,
      "feature.txt",
      "feature",
      "feat(#9/T1): implement journey timeline\n\nAuthored-by: deepseek/chat (kimi-code)\nReviewed-by: gemini/pro (gemini-cli)\n",
    );

    const result = auditBranch(baseBranch, tempDir);
    expect(result.violations.some((v) => v.rule === "review-gate-separation")).toBe(false);
  });

  it("emits warnings when Git Notes are missing", () => {
    commitFile(
      tempDir,
      "feature.txt",
      "feature",
      "feat(#9/T1): implement journey timeline\n\nAuthored-by: deepseek/chat (kimi-code)\n",
    );

    const result = auditBranch(baseBranch, tempDir);
    const violation = result.violations.find((v) => v.rule === "git-note-presence");

    expect(violation).toBeDefined();
    expect(violation?.severity).toBe("warn");
    expect(result.summary.warnings).toBe(1);
    expect(result.passed).toBe(true);
  });

  it("warns when the commit subject lacks a subtask tag", () => {
    commitFile(
      tempDir,
      "feature.txt",
      "feature",
      "feat(#9): implement journey timeline\n\nAuthored-by: deepseek/chat (kimi-code)\n",
    );
    attachCurrentStateToCommit("HEAD", { cwd: tempDir });

    const result = auditBranch(baseBranch, tempDir);
    const violation = result.violations.find((v) => v.rule === "commit-format");

    expect(violation).toBeDefined();
    expect(violation?.severity).toBe("warn");
    expect(violation?.message).toContain("T<n>");
  });

  it("accepts alphanumeric ticket prefixes (e.g. SLM-201/T1)", () => {
    commitFile(
      tempDir,
      "feature.txt",
      "feature",
      "feat(SLM-201/T1): implement dialog deindexer\n\nAuthored-by: gemini/flash (antigravity)\n",
    );
    attachCurrentStateToCommit("HEAD", { cwd: tempDir });

    const result = auditBranch(baseBranch, tempDir);
    expect(result.violations.some((v) => v.rule === "commit-format")).toBe(false);
    expect(result.passed).toBe(true);
  });

  it("fails audit when run directly on base branch with 0 commit range (base-branch-range error)", () => {
    execSync(`git checkout ${baseBranch}`, { cwd: tempDir, stdio: "ignore" });

    const result = auditBranch(baseBranch, tempDir);

    expect(result.commitCount).toBe(0);
    const violation = result.violations.find((v) => v.rule === "base-branch-range");
    expect(violation).toBeDefined();
    expect(violation?.severity).toBe("error");
    expect(result.passed).toBe(false);
  });

  it("returns a clean result on a feature branch when there is nothing ahead of the base branch", () => {
    execSync("git checkout -b feature/empty-branch", { cwd: tempDir, stdio: "ignore" });

    const result = auditBranch(baseBranch, tempDir);

    expect(result.commitCount).toBe(0);
    expect(result.violations).toEqual([]);
    expect(result.passed).toBe(true);
  });
});
