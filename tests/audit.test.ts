import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  auditBranch,
  checkSelfApproval,
  extractTrailers,
  parseIdentity,
} from "../src/audit/audit.js";
import { attachCurrentStateToCommit } from "../src/notes/attach.js";
import { attachNote } from "../src/notes/notes.js";

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

  it("parses identities whose client qualifier contains spaces", () => {
    commitFile(
      tempDir,
      "feature.txt",
      "feature",
      "feat(#30/T1): standardize vs code identity\n\nAuthored-by: deepseek/VS Code (kimi-code)\nReviewed-by: google/gemini-3.8-flash-high (antigravity)\n",
    );

    const result = auditBranch(baseBranch, tempDir);
    expect(result.violations.some((v) => v.rule === "authored-by-presence")).toBe(false);
    expect(result.violations.some((v) => v.rule === "review-gate-separation")).toBe(false);
  });

  it("still flags self-approval when the spaced author reviews its own work", () => {
    commitFile(
      tempDir,
      "feature.txt",
      "feature",
      "feat(#30/T1): standardize vs code identity\n\nAuthored-by: deepseek/VS Code (kimi-code)\nReviewed-by: deepseek/VS Code (cursor)\n",
    );

    const result = auditBranch(baseBranch, tempDir);
    expect(result.violations.some((v) => v.rule === "review-gate-separation")).toBe(true);
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

  it("accepts alphanumeric subtask suffixes (e.g. #9/T0-v2) without a commit-format warning", () => {
    commitFile(
      tempDir,
      "feature.txt",
      "feature",
      "feat(#9/T0-v2): keep suffixed subtask ids\n\nAuthored-by: deepseek/chat (kimi-code)\n",
    );
    attachCurrentStateToCommit("HEAD", { cwd: tempDir });

    const result = auditBranch(baseBranch, tempDir);
    expect(result.violations.some((v) => v.rule === "commit-format")).toBe(false);
    expect(result.passed).toBe(true);
  });

  it("accepts ci and build commit types without a commit-format warning", () => {
    commitFile(
      tempDir,
      "workflow.txt",
      "workflow",
      "ci(#52/T1): add codeql workflow\n\nAuthored-by: deepseek/VS Code (kimi-code)\n",
    );
    const buildSha = commitFile(
      tempDir,
      "build.txt",
      "build",
      "build(#52/T1): emit release artifacts\n\nAuthored-by: deepseek/VS Code (kimi-code)\n",
    );
    attachCurrentStateToCommit(buildSha, { cwd: tempDir });

    const result = auditBranch(baseBranch, tempDir);
    const formatWarnings = result.violations.filter((v) => v.rule === "commit-format");
    expect(formatWarnings).toEqual([]);
    expect(result.commitCount).toBe(2);
    expect(result.passed).toBe(true);
  });

  it("warns when a tier-1 author changes implementation files on a contracted subtask", () => {
    commitFile(
      tempDir,
      "feature.ts",
      "export const ok = true;",
      "feat(#9/T1): implement journey timeline\n\nAuthored-by: gemini/pro (antigravity)\n",
    );
    attachNote(
      JSON.stringify({
        subtask: { id: "T1", contract: { allowedFiles: ["feature.ts"] } },
        tier: "tier-3",
      }),
      "HEAD",
      { cwd: tempDir },
    );

    const result = auditBranch(baseBranch, tempDir);
    const violation = result.violations.find((v) => v.rule === "tier-routing-violation");

    expect(violation).toBeDefined();
    expect(violation?.severity).toBe("warn");
    expect(violation?.message).toContain("gemini/pro (antigravity)");
    expect(violation?.message).toContain("feature.ts");
    expect(result.passed).toBe(true);
  });

  it("does not warn about tier routing when the escalation is acknowledged", () => {
    commitFile(
      tempDir,
      "feature.ts",
      "export const ok = true;",
      "feat(#9/T1): implement journey timeline [escalated]\n\nAuthored-by: gemini/pro (antigravity)\n",
    );
    attachNote(
      JSON.stringify({
        subtask: { id: "T1", contract: { allowedFiles: ["feature.ts"] } },
        tier: "tier-3",
      }),
      "HEAD",
      { cwd: tempDir },
    );

    const escalatedThroughSubject = auditBranch(baseBranch, tempDir);
    expect(
      escalatedThroughSubject.violations.some((v) => v.rule === "tier-routing-violation"),
    ).toBe(false);

    commitFile(
      tempDir,
      "feature.ts",
      "export const ok = false;",
      "feat(#9/T2): adjust journey timeline\n\nAuthored-by: gemini/pro (antigravity)\n",
    );
    attachNote(
      JSON.stringify({
        subtask: { id: "T2", contract: { allowedFiles: ["feature.ts"] } },
        tier: "tier-1",
        escalated: true,
      }),
      "HEAD",
      { cwd: tempDir },
    );

    const escalatedThroughPayload = auditBranch(baseBranch, tempDir);
    expect(
      escalatedThroughPayload.violations.some((v) => v.rule === "tier-routing-violation"),
    ).toBe(false);
  });

  it("does not warn about tier routing when a tier-1 author only touches documentation", () => {
    mkdirSync(join(tempDir, "docs"), { recursive: true });
    commitFile(
      tempDir,
      join("docs", "notes.md"),
      "# notes",
      "docs(#9/T1): document journey timeline\n\nAuthored-by: gemini/pro (antigravity)\n",
    );
    attachNote(
      JSON.stringify({
        subtask: { id: "T1", contract: { allowedFiles: [join("docs", "notes.md")] } },
        tier: "tier-3",
      }),
      "HEAD",
      { cwd: tempDir },
    );

    const result = auditBranch(baseBranch, tempDir);
    expect(result.violations.some((v) => v.rule === "tier-routing-violation")).toBe(false);
  });

  it("does not flag .lognexus bookkeeping files as outside the allowed set", () => {
    mkdirSync(join(tempDir, ".lognexus"), { recursive: true });
    commitFile(
      tempDir,
      ".lognexus/telemetry.md",
      "# local telemetry",
      "feat(#9/T1): implement journey timeline\n\nAuthored-by: deepseek/V3 (kimi-code)\n",
    );
    commitFile(
      tempDir,
      "feature.ts",
      "export const ok = true;",
      "feat(#9/T1): implement journey timeline\n\nAuthored-by: deepseek/V3 (kimi-code)\n",
    );
    attachNote(
      JSON.stringify({
        subtask: { id: "T1", contract: { allowedFiles: ["feature.ts"] } },
        tier: "tier-3",
      }),
      "HEAD",
      { cwd: tempDir },
    );

    const result = auditBranch(baseBranch, tempDir);
    expect(result.violations.some((v) => v.rule === "contract-files")).toBe(false);
    expect(result.passed).toBe(true);
  });

  it("still rejects real implementation files outside the allowed set", () => {
    commitFile(
      tempDir,
      "feature.ts",
      "export const ok = true;",
      "feat(#9/T1): implement journey timeline\n\nAuthored-by: deepseek/V3 (kimi-code)\n",
    );
    commitFile(
      tempDir,
      "leak.ts",
      "export const nope = true;",
      "feat(#9/T1): implement journey timeline\n\nAuthored-by: deepseek/V3 (kimi-code)\n",
    );
    attachNote(
      JSON.stringify({
        subtask: { id: "T1", contract: { allowedFiles: ["feature.ts"] } },
        tier: "tier-3",
      }),
      "HEAD",
      { cwd: tempDir },
    );

    const result = auditBranch(baseBranch, tempDir);
    const violation = result.violations.find((v) => v.rule === "contract-files");
    expect(violation).toBeDefined();
    expect(violation?.message).toContain("leak.ts");
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

describe("Identity and trailer parsing under adversarial input", () => {
  it("resolves the model family from a qualifier that contains spaces", () => {
    expect(parseIdentity("deepseek/VS Code (kimi-code)")).toEqual({
      full: "deepseek/vs code (kimi-code)",
      family: "deepseek/vs-code",
    });
  });

  it("falls back to the first slash-bearing token when the head is not a family", () => {
    expect(parseIdentity("  (orchestrator) gemini/flash (antigravity)")?.family).toBe(
      "gemini/flash",
    );
  });

  it("returns null for empty identities instead of inventing a family", () => {
    expect(parseIdentity(null)).toBeNull();
    expect(parseIdentity("   ")).toBeNull();
    expect(parseIdentity("gemini")?.family).toBe("gemini");
  });

  it("extracts only the governance trailers from a commit body", () => {
    const body = [
      "Plan provenance: keep this line",
      "",
      "Authored-by: gemini/4-argon (antigravity)",
      "Reviewed-by: deepseek/VS Code (kimi-code)",
      "Co-authored-by: someone/else",
    ].join("\n");

    expect(extractTrailers(body)).toEqual({
      author: "gemini/4-argon (antigravity)",
      reviewer: "deepseek/VS Code (kimi-code)",
    });
  });

  it("ignores trailer-like lines without a value or with a leading colon", () => {
    const body = [
      "Authored-by:",
      "Authored-by:   ",
      ": no key here",
      "Reviewed-by: claude/sonnet",
    ].join("\n");

    expect(extractTrailers(body)).toEqual({ author: null, reviewer: "claude/sonnet" });
  });

  it("parses long adversarial trailer and identity strings without super-linear backtracking", () => {
    const payload = `${"a".repeat(20000)}/${"b ".repeat(5000)}`;
    const trailers = [`Authored-by: ${payload}`, "Reviewed-by: ".repeat(5000)].join("\n");

    const start = performance.now();
    parseIdentity(payload);
    parseIdentity(`(qualifier) ${payload}`);
    extractTrailers(trailers);
    extractTrailers(`${"x".repeat(50000)}:${" ".repeat(5000)}`);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(1000);
  });
});

describe("Canonical family normalization for the flagship Gemini 4 identities", () => {
  it("collapses display names and provider slugs onto one canonical family", () => {
    expect(parseIdentity("Gemini 4 Carbon")?.family).toBe("gemini/carbon");
    expect(parseIdentity("Gemini 4 Carbon (antigravity, role: orchestrator)")?.family).toBe(
      "gemini/carbon",
    );
    expect(parseIdentity("gemini/carbon (antigravity)")?.family).toBe("gemini/carbon");
    expect(parseIdentity("google/gemini-4-carbon (antigravity)")?.family).toBe("gemini/carbon");
    expect(parseIdentity("Gemini 4 Argon")?.family).toBe("gemini/argon");
    expect(parseIdentity("gemini/argon (antigravity)")?.family).toBe("gemini/argon");
  });

  it("keeps unrelated families untouched", () => {
    expect(parseIdentity("deepseek/VS Code (kimi-code)")?.family).toBe("deepseek/vs-code");
    expect(parseIdentity("claude/sonnet (opus-harness)")?.family).toBe("claude/sonnet");
  });

  it("blocks self-approval between a Carbon display name and its slug aliases", () => {
    for (const reviewer of [
      "gemini/carbon (antigravity)",
      "google/gemini-4-carbon (antigravity)",
    ]) {
      expect(checkSelfApproval("Gemini 4 Carbon", reviewer).isSelfApproval).toBe(true);
    }
    expect(checkSelfApproval("Gemini 4 Argon", "gemini/argon (antigravity)").isSelfApproval).toBe(
      true,
    );
  });

  it("still permits cross-model review between distinct families", () => {
    expect(checkSelfApproval("Gemini 4 Carbon", "Gemini 4 Argon").isSelfApproval).toBe(false);
    expect(
      checkSelfApproval("deepseek/VS Code (kimi-code)", "Gemini 4 Carbon").isSelfApproval,
    ).toBe(false);
    expect(
      checkSelfApproval("deepseek/VS Code (kimi-code)", "gemini/carbon (antigravity)")
        .isSelfApproval,
    ).toBe(false);
  });
});
