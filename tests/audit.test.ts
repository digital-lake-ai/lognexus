import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  auditBranch,
  checkReviewGate,
  checkSelfApproval,
  extractTrailers,
  extractVendor,
  isInvalidPlaceholderIdentity,
  loadAuditPolicy,
  matchesPath,
  NON_OVERRIDABLE_AUDIT_RULES,
  parseIdentity,
  resolveAuditRuleSeverity,
  unwrapOuterBalancedParens,
} from "../src/audit/audit.js";
import { executeAtomicCommit } from "../src/commit.js";
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

  it("does not warn about tier routing when the note declares a tier-1 issue", () => {
    commitFile(
      tempDir,
      "schema.ts",
      "export const schema = 1;",
      "feat(#61/T1): extend telemetry schemas\n\nAuthored-by: gemini/pro (antigravity)\n",
    );
    attachNote(
      JSON.stringify({
        issue: { id: 61, title: "Telemetry v2", tier: "tier-1" },
        subtask: { id: "T1", contract: { allowedFiles: ["schema.ts"] } },
        tier: "tier-1",
      }),
      "HEAD",
      { cwd: tempDir },
    );

    const result = auditBranch(baseBranch, tempDir);
    expect(result.violations.some((v) => v.rule === "tier-routing-violation")).toBe(false);
  });

  it.each(["CLAUDE.md", "package.json", ".github/workflows/ci.yml"])(
    "does not warn about tier routing for the governance surface %s",
    (fileName) => {
      mkdirSync(join(tempDir, fileName, ".."), { recursive: true });
      commitFile(
        tempDir,
        fileName,
        "value: 1",
        "chore(#9/T1): update governance surface\n\nAuthored-by: gemini/pro (antigravity)\n",
      );
      attachNote(
        JSON.stringify({
          subtask: { id: "T1", contract: { allowedFiles: [fileName] } },
          tier: "tier-3",
        }),
        "HEAD",
        { cwd: tempDir },
      );

      const result = auditBranch(baseBranch, tempDir);
      expect(result.violations.some((v) => v.rule === "tier-routing-violation")).toBe(false);
    },
  );

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

  describe("Gemini 4 Hydrogen normalization", () => {
    it.each([
      "gemini 4 hydrogen",
      "gemini/hydrogen",
      "gemini/4-hydrogen",
      "gemini-4-hydrogen",
      "google/gemini-4-hydrogen",
      "google/gemini-4-hydrogen-high",
      "google/gemini-4-hydrogen-high (antigravity)",
    ])("normalizes %s to the hydrogen family", (value) => {
      expect(parseIdentity(value)?.family).toBe("gemini/hydrogen");
    });

    it("collapses the -high reasoning-effort suffix on the flagship families", () => {
      expect(parseIdentity("google/gemini-4-carbon-high")?.family).toBe("gemini/carbon");
      expect(parseIdentity("google/gemini-4-argon-high")?.family).toBe("gemini/argon");
    });

    it("blocks self-approval between Hydrogen display names and their slug aliases", () => {
      expect(checkSelfApproval("Gemini 4 Hydrogen", "gemini/hydrogen").isSelfApproval).toBe(true);
      expect(
        checkSelfApproval("google/gemini-4-hydrogen-high (antigravity)", "Gemini 4 Hydrogen")
          .isSelfApproval,
      ).toBe(true);
    });

    it("permits peer review between Hydrogen and the tier-1 orchestrators", () => {
      expect(checkSelfApproval("Gemini 4 Hydrogen", "Gemini 4 Carbon").isSelfApproval).toBe(false);
      expect(checkSelfApproval("Gemini 4 Hydrogen", "Gemini 4 Argon").isSelfApproval).toBe(false);
      expect(
        checkSelfApproval("google/gemini-4-hydrogen-high (antigravity)", "gemini/carbon")
          .isSelfApproval,
      ).toBe(false);
      expect(
        checkSelfApproval("google/gemini-4-hydrogen-high (antigravity)", "gemini/argon")
          .isSelfApproval,
      ).toBe(false);
    });
  });

  describe("Antigravity Orchestrator (Carbon/Argon) & Flash Worker normalization", () => {
    it.each([
      ["Orchestrator (Carbon)", "gemini/carbon"],
      ["Orchestrator (Argon)", "gemini/argon"],
      ["gemini-pro-orchestrator", "gemini/carbon"],
      ["google/gemini-pro-orchestrator (antigravity)", "gemini/carbon"],
      ["gemini-pro-orchestrator-argon", "gemini/argon"],
      ["google/gemini-pro-orchestrator-argon (antigravity)", "gemini/argon"],
      ["gemini-flash-worker-agy", "gemini/flash-worker-agy"],
      ["flash-worker-agy", "gemini/flash-worker-agy"],
      ["google/gemini-flash-worker-agy (antigravity)", "gemini/flash-worker-agy"],
    ])("normalizes %s to %s", (input, expected) => {
      expect(parseIdentity(input)?.family).toBe(expected);
    });

    it("separates Orchestrator (Carbon) from Orchestrator (Argon) and blocks alias self-approval", () => {
      expect(
        checkSelfApproval("Orchestrator (Carbon)", "Orchestrator (Argon)").isSelfApproval,
      ).toBe(false);
      expect(checkSelfApproval("Orchestrator (Carbon)", "Gemini 4 Carbon").isSelfApproval).toBe(
        true,
      );
      expect(
        checkSelfApproval("Orchestrator (Argon)", "gemini-pro-orchestrator-argon").isSelfApproval,
      ).toBe(true);
      expect(
        checkSelfApproval("gemini-flash-worker-agy", "Orchestrator (Carbon)").isSelfApproval,
      ).toBe(false);
      expect(
        checkSelfApproval("gemini-flash-worker-agy", "google/gemini-flash-worker-agy")
          .isSelfApproval,
      ).toBe(true);
    });
  });

  describe("Universal effort-suffix, provider alias, and vendor normalization", () => {
    it.each([
      ["openai/o3-xhigh", "openai/o3"],
      ["openai/o3-extra-high", "openai/o3"],
      ["openai/gpt-5.4-medium", "openai/gpt-5.4"],
      ["deepseek/r1-low", "deepseek/r1"],
      ["deepseek/r1-minimal", "deepseek/r1"],
      ["claude/sonnet-high", "claude/sonnet"],
      ["claude/sonnet-none", "claude/sonnet"],
      ["anthropic/claude-sonnet-4-6-high", "claude/sonnet-4.6"],
      ["claude/opus-4-5", "claude/opus-4.5"],
      ["claude-opus-5-5-medium", "claude/opus-5.5"],
      ["claude/fable-5-2", "claude/fable-5.2"],
      ["Claude Fable 5.2", "claude/fable-5.2"],
      ["anthropic/claude-fable-5-2-max", "claude/fable-5.2"],
      ["claude/mythos-5-2-ultrafast", "claude/mythos-5.2"],
      ["openai/gpt-6-2-astra", "openai/gpt-6.2-astra"],
      ["gpt-6-2-astra", "openai/gpt-6.2-astra"],
      ["gpt-6.2-astra-fast", "openai/gpt-6.2-astra"],
      ["codex/gpt-6-2-astra-ultrafast", "openai/gpt-6.2-astra"],
      ["openai/gpt-6-luna-light", "openai/gpt-6-luna"],
      ["codex-mini", "openai/codex-mini"],
      ["o4-mini", "openai/o4-mini"],
      ["o4", "openai/o4"],
      ["o1", "openai/o1"],
      ["o3-xhigh", "openai/o3"],
      ["deepseek/VS Code (kimi-code)", "deepseek/vs-code"],
    ])("normalizes %s to %s", (input, expected) => {
      expect(parseIdentity(input)?.family).toBe(expected);
    });

    it("does not collapse -max, -thinking, -mini, or tier suffixes", () => {
      expect(parseIdentity("qwen/qwen-max")?.family).toBe("qwen/qwen-max");
      expect(parseIdentity("qwen/qwen-plus")?.family).toBe("qwen/qwen-plus");
      expect(parseIdentity("openai/gpt-5.1-codex-max")?.family).toBe("openai/gpt-5.1-codex-max");
      expect(parseIdentity("openai/gpt-5.1-codex")?.family).toBe("openai/gpt-5.1-codex");
      expect(parseIdentity("kimi/k2-thinking")?.family).toBe("kimi/k2-thinking");
      expect(parseIdentity("kimi/k2")?.family).toBe("kimi/k2");
      expect(parseIdentity("openai/o3-mini")?.family).toBe("openai/o3-mini");
    });

    it("normalizes November 2026 frontier aliases across xAI, Z.ai, DeepSeek V4, Qwen 4 Max, and GPT-6-Cyber", () => {
      expect(parseIdentity("x-ai/grok-4.7")?.family).toBe("xai/grok-4.7");
      expect(parseIdentity("grok-4.7")?.family).toBe("xai/grok-4.7");
      expect(parseIdentity("xAI Grok 4.7")?.family).toBe("xai/grok-4.7");
      expect(parseIdentity("z.ai/glm-5.4")?.family).toBe("zai/glm-5.4");
      expect(parseIdentity("z-ai/glm-5.4-high")?.family).toBe("zai/glm-5.4");
      expect(parseIdentity("glm-5.4")?.family).toBe("zai/glm-5.4");
      expect(parseIdentity("Z.ai GLM 5.4")?.family).toBe("zai/glm-5.4");
      expect(parseIdentity("deepseek-v4-pro-high")?.family).toBe("deepseek/v4-pro");
      expect(parseIdentity("DeepSeek V4 Pro")?.family).toBe("deepseek/v4-pro");
      expect(parseIdentity("qwen-4-max")?.family).toBe("qwen/qwen-4-max");
      expect(parseIdentity("qwen-4-max-high")?.family).toBe("qwen/qwen-4-max");
      expect(parseIdentity("qwen/qwen-4-max")?.family).toBe("qwen/qwen-4-max");
      expect(parseIdentity("gpt-6-2-cyber-high")?.family).toBe("openai/gpt-6.2-cyber");
      expect(parseIdentity("OpenAI GPT-6-Cyber")?.family).toBe("openai/gpt-6-cyber");

      expect(checkReviewGate("x-ai/grok-4.7", "grok-4.7", "intra-fleet").violated).toBe(true);
      expect(checkReviewGate("z.ai/glm-5.4", "glm-5.4", "intra-fleet").violated).toBe(true);
      expect(checkReviewGate("qwen-4-max", "qwen/qwen-4-max", "intra-fleet").violated).toBe(true);
      expect(checkReviewGate("xai/grok-4.7", "zai/glm-5.4", "cross-vendor").violated).toBe(false);
    });

    it("derives vendor strictly from the model family prefix, never from client qualifiers", () => {
      const ds = parseIdentity("deepseek/VS Code (kimi-code)");
      const claude = parseIdentity("anthropic/claude-sonnet-4-6-high (cursor)");
      const gemini = parseIdentity("google/gemini-4-hydrogen-high (antigravity)");
      expect(ds).not.toBeNull();
      expect(claude).not.toBeNull();
      expect(gemini).not.toBeNull();
      if (ds) expect(extractVendor(ds)).toBe("deepseek");
      if (claude) expect(extractVendor(claude)).toBe("claude");
      if (gemini) expect(extractVendor(gemini)).toBe("gemini");
    });
  });

  describe("checkReviewGate across all modes and hard floor", () => {
    it("enforces identical-identity hard floor in every mode including advisory and off", () => {
      for (const mode of ["intra-fleet", "cross-vendor", "advisory", "off"] as const) {
        const res = checkReviewGate("claude/sonnet-4.6", "claude/sonnet-4.6", mode);
        expect(res.violated).toBe(true);
        expect(res.severity).toBe("error");
      }
    });

    it("blocks cross-effort self-approval in intra-fleet and cross-vendor modes", () => {
      const intra = checkReviewGate(
        "anthropic/claude-sonnet-4-6-high",
        "claude/sonnet-4.6-low",
        "intra-fleet",
      );
      expect(intra.violated).toBe(true);
      expect(intra.severity).toBe("error");

      const intraDistinct = checkReviewGate("claude/opus-4.5", "claude/sonnet-4.6", "intra-fleet");
      expect(intraDistinct.violated).toBe(false);
    });

    it("blocks same-vendor different-family reviews only in cross-vendor mode", () => {
      const sameVendor = checkReviewGate("claude/opus-4.5", "claude/sonnet-4.6", "cross-vendor");
      expect(sameVendor.violated).toBe(true);
      expect(sameVendor.severity).toBe("error");

      const diffVendor = checkReviewGate("claude/opus-4.5", "openai/o3-xhigh", "cross-vendor");
      expect(diffVendor.violated).toBe(false);
    });

    it("downgrades distinct-identity same-family to warn in advisory and skips in off", () => {
      const adv = checkReviewGate(
        "claude/sonnet-4.6-high (claude-code)",
        "claude/sonnet-4.6-low (cursor)",
        "advisory",
      );
      expect(adv.violated).toBe(true);
      expect(adv.severity).toBe("warn");

      const off = checkReviewGate(
        "claude/sonnet-4.6-high (claude-code)",
        "claude/sonnet-4.6-low (cursor)",
        "off",
      );
      expect(off.violated).toBe(false);
    });

    it("blocks Fable <-> Mythos cross-review as shared-weights self-approval while allowing Opus/Sonnet/Haiku and OpenAI 6.2 peers", () => {
      for (const mode of ["intra-fleet", "cross-vendor"] as const) {
        const fableToMythos = checkReviewGate("Claude Fable 5.2", "Claude Mythos 5.2", mode);
        expect(fableToMythos.violated).toBe(true);
        expect(fableToMythos.severity).toBe("error");
        expect(fableToMythos.message).toContain("Claude Fable and Claude Mythos");

        const mythosToFable = checkReviewGate(
          "anthropic/claude-mythos-5-2-ultrafast",
          "claude/fable-5.2-max",
          mode,
        );
        expect(mythosToFable.violated).toBe(true);
        expect(mythosToFable.severity).toBe("error");
      }

      const fableAdvisory = checkReviewGate("Claude Fable 5.2", "Claude Mythos 5.2", "advisory");
      expect(fableAdvisory.violated).toBe(true);
      expect(fableAdvisory.severity).toBe("warn");

      const fableOff = checkReviewGate("Claude Fable 5.2", "Claude Mythos 5.2", "off");
      expect(fableOff.violated).toBe(false);

      expect(checkReviewGate("Claude Fable 5.2", "claude/sonnet-4.6", "intra-fleet").violated).toBe(
        false,
      );
      expect(checkReviewGate("Claude Mythos 5.2", "claude/opus-4.6", "intra-fleet").violated).toBe(
        false,
      );

      expect(checkReviewGate("openai/gpt-6.2-astra", "gpt-6-2-astra", "intra-fleet").violated).toBe(
        true,
      );
      expect(
        checkReviewGate("openai/gpt-6.2-astra", "openai/gpt-6.2-sol", "intra-fleet").violated,
      ).toBe(false);
      expect(checkReviewGate("openai/gpt-6.2-astra", "gpt-6-luna", "intra-fleet").violated).toBe(
        false,
      );
      expect(
        checkReviewGate("openai/gpt-6.2-astra", "openai/gpt-6.2-sol", "cross-vendor").violated,
      ).toBe(true);
    });
  });

  describe("Tamper-proof base-ref review_gate in auditBranch", () => {
    it("enforces base branch review_gate and warns when a PR weakens .lognexus/routing.md", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "lognexus-audit-tamper-"));
      try {
        execSync("git init", { cwd: tempDir, stdio: "ignore" });
        execSync('git config user.name "Test Runner"', { cwd: tempDir, stdio: "ignore" });
        execSync('git config user.email "test@example.com"', { cwd: tempDir, stdio: "ignore" });
        execSync('git config commit.gpgsign "false"', { cwd: tempDir, stdio: "ignore" });

        mkdirSync(join(tempDir, ".lognexus"), { recursive: true });
        commitFile(
          tempDir,
          ".lognexus/routing.md",
          "routing: confirm\nreview_gate: cross-vendor\n",
          "chore: seed base routing",
        );
        const baseBranch = git("branch --show-current", tempDir) || "main";
        execSync("git checkout -b issue/63-tamper-check", { cwd: tempDir, stdio: "ignore" });

        commitFile(
          tempDir,
          ".lognexus/routing.md",
          "routing: confirm\nreview_gate: off\n",
          "chore(#63/T1): attempt to weaken review_gate\n\nAuthored-by: gemini/hydrogen\nReviewed-by: gemini/argon\n",
        );
        attachCurrentStateToCommit("HEAD", { cwd: tempDir, force: true });

        const result = auditBranch(baseBranch, tempDir);
        const gateErrors = result.violations.filter(
          (v) => v.rule === "review-gate-separation" && v.severity === "error",
        );
        const gateWarns = result.violations.filter(
          (v) => v.rule === "review-gate-separation" && v.severity === "warn",
        );

        expect(gateErrors).toHaveLength(1);
        expect(gateErrors[0].message).toContain("Cross-vendor review-gate violation");
        expect(gateWarns).toHaveLength(1);
        expect(gateWarns[0].message).toContain("weakens review_gate");
        expect(result.passed).toBe(false);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("Cycle 4 review-gate hardening, placeholder rejection, and linear glob matching", () => {
    it("blocks self-review between Gemini 3.8 Flash display name and google/gemini-3.8-flash-high slug", () => {
      expect(parseIdentity("Gemini 3.8 Flash")?.family).toBe("gemini/3.8-flash");
      expect(parseIdentity("(google/gemini-3.8-flash-high)")?.family).toBe("gemini/3.8-flash");
      const wrapped = parseIdentity("(google/gemini-3.8-flash-high)");
      expect(wrapped).not.toBeNull();
      if (wrapped) expect(extractVendor(wrapped)).toBe("gemini");

      const res = checkReviewGate(
        "Gemini 3.8 Flash",
        "google/gemini-3.8-flash-high (antigravity)",
        "intra-fleet",
      );
      expect(res.violated).toBe(true);
      expect(res.severity).toBe("error");
    });

    it("resolves Orchestrator (<qualifier>) models cleanly across intra-fleet and cross-vendor gates", () => {
      const orchFlash = parseIdentity("Orchestrator (google/gemini-3.8-flash-high)");
      expect(orchFlash?.family).toBe("gemini/3.8-flash");
      if (orchFlash) expect(extractVendor(orchFlash)).toBe("gemini");

      expect(parseIdentity("Orchestrator (Gemini 3.8 Flash)")?.family).toBe("gemini/3.8-flash");
      expect(parseIdentity("Orchestrator (Gemini 4 Hydrogen)")?.family).toBe("gemini/hydrogen");

      const intraAllowed = checkReviewGate(
        "Orchestrator (google/gemini-3.8-flash-high)",
        "google/gemini-4-argon",
        "intra-fleet",
      );
      expect(intraAllowed.violated).toBe(false);

      const crossBlocked = checkReviewGate(
        "Orchestrator (google/gemini-3.8-flash-high)",
        "google/gemini-4-argon",
        "cross-vendor",
      );
      expect(crossBlocked.violated).toBe(true);
      expect(crossBlocked.severity).toBe("error");

      const distinctOrch = checkReviewGate(
        "Orchestrator (Gemini 3.8 Flash)",
        "Orchestrator (Carbon)",
        "intra-fleet",
      );
      expect(distinctOrch.violated).toBe(false);

      const sameOrchSelf = checkReviewGate(
        "Orchestrator (Gemini 3.8 Flash)",
        "google/gemini-3.8-flash-high (antigravity)",
        "intra-fleet",
      );
      expect(sameOrchSelf.violated).toBe(true);
      expect(sameOrchSelf.severity).toBe("error");
    });

    it("rejects placeholder identities in checkReviewGate regardless of mode and flags invalid-identity in auditBranch", () => {
      for (const placeholder of [
        "auto",
        "Auto (antigravity)",
        "orchestrator",
        "Orchestrator ()",
        "unknown",
        "unknown/other",
        "<provider>/<model> (<client>)",
      ]) {
        expect(isInvalidPlaceholderIdentity(placeholder)).toBe(true);
        for (const mode of ["intra-fleet", "cross-vendor", "advisory", "off"] as const) {
          const asAuthor = checkReviewGate(placeholder, "claude/opus-4.6", mode);
          expect(asAuthor.violated).toBe(true);
          expect(asAuthor.severity).toBe("error");

          const asReviewer = checkReviewGate(
            "google/gemini-3.8-flash-high (antigravity)",
            placeholder,
            mode,
          );
          expect(asReviewer.violated).toBe(true);
          expect(asReviewer.severity).toBe("error");
        }
      }

      expect(isInvalidPlaceholderIdentity(null)).toBe(false);
      expect(isInvalidPlaceholderIdentity("")).toBe(false);
      expect(isInvalidPlaceholderIdentity("Orchestrator (Carbon)")).toBe(false);
      expect(isInvalidPlaceholderIdentity("google/gemini-flash-worker-agy (antigravity)")).toBe(
        false,
      );

      const tempDir = mkdtempSync(join(tmpdir(), "lognexus-audit-placeholder-"));
      try {
        execSync("git init", { cwd: tempDir, stdio: "ignore" });
        execSync('git config user.name "Test Runner"', { cwd: tempDir, stdio: "ignore" });
        execSync('git config user.email "test@example.com"', { cwd: tempDir, stdio: "ignore" });
        execSync('git config commit.gpgsign "false"', { cwd: tempDir, stdio: "ignore" });
        commitFile(tempDir, "README.md", "# seed", "chore: seed");
        const base = git("branch --show-current", tempDir) || "main";
        execSync("git checkout -b issue/67-placeholder-audit", { cwd: tempDir, stdio: "ignore" });

        commitFile(
          tempDir,
          "bad.ts",
          "export const x = 1;\n",
          "feat(#67/T3): placeholder trailer\n\nAuthored-by: auto\n",
        );
        attachCurrentStateToCommit("HEAD", { cwd: tempDir, force: true });

        const result = auditBranch(base, tempDir);
        const invalid = result.violations.find((v) => v.rule === "invalid-identity");
        expect(invalid).toBeDefined();
        expect(invalid?.severity).toBe("error");
        expect(result.passed).toBe(false);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("matches contract paths cleanly with linear multi-* and ** glob rules", () => {
      expect(matchesPath("", "src/*.ts")).toBe(false);
      expect(matchesPath("src/a.ts", "")).toBe(false);
      expect(matchesPath("src/audit/audit.ts", "src/audit/audit.ts")).toBe(true);
      expect(matchesPath("./src\\audit\\audit.ts", "src/audit/audit.ts")).toBe(true);
      expect(matchesPath("src/audit/audit.ts", "src/audit/")).toBe(true);
      expect(matchesPath("src/a.ts", "src/*.ts")).toBe(true);
      expect(matchesPath("src/nested/a.ts", "src/*.ts")).toBe(false);
      expect(matchesPath("src/my-test-unit-spec-v2.ts", "src/*test*spec*.ts")).toBe(true);
      expect(matchesPath("src/my-test-unit.ts", "src/*test*spec*.ts")).toBe(false);
      expect(matchesPath("src/a", "src/a*a")).toBe(false);
      expect(matchesPath("src/aa", "src/a*a")).toBe(true);
      expect(matchesPath("src/aba", "src/a*a")).toBe(true);
      expect(matchesPath("src/a.ts", "src/**/*.ts")).toBe(true);
      expect(matchesPath("src/a/b/c.ts", "src/**/*.ts")).toBe(true);
      expect(matchesPath("tests/a.ts", "src/**/*.ts")).toBe(false);
      expect(matchesPath("a.test.ts", "**/*.test.ts")).toBe(true);
      expect(matchesPath("tests/unit/a.test.ts", "**/*.test.ts")).toBe(true);
      expect(matchesPath("src/a/b.ts", "src/**")).toBe(true);
      expect(matchesPath("src/a.ts", "src/*")).toBe(true);
      expect(matchesPath("src/nested/a.ts", "src/*")).toBe(false);
      expect(matchesPath("src/a.ts", "src/**")).toBe(true);
      expect(matchesPath("src/nested/a.ts", "src/**")).toBe(true);
      expect(matchesPath("src/sub/a.ts", "src/*/")).toBe(true);
      expect(matchesPath("src/sub/deep/a.ts", "src/*/")).toBe(true);
      expect(matchesPath("src/a.ts", "src/*/")).toBe(false);
      expect(matchesPath("src/sub/a.ts", "src/**/")).toBe(true);
      expect(matchesPath("src/a.ts", "src/**/")).toBe(true);
      expect(matchesPath("other/sub/a.ts", "src/*/")).toBe(false);
      expect(matchesPath("src/audit-other/audit.ts", "src/audit/")).toBe(false);
      expect(matchesPath("a/b/c.ts", "a/**/b/**/c.ts")).toBe(true);
      expect(matchesPath("a/x/b/y/z/c.ts", "a/**/b/**/c.ts")).toBe(true);

      const start = performance.now();
      expect(matchesPath("a".repeat(50_000), `${"*a".repeat(1000)}*b`)).toBe(false);
      expect(performance.now() - start).toBeLessThan(100);
    });

    it("unwraps deeply nested balanced outer parentheses in O(n) without stripping sibling groups", () => {
      expect(unwrapOuterBalancedParens("(a) (b)")).toBe("(a) (b)");
      expect(unwrapOuterBalancedParens("  (( (a) (b) ))  ")).toBe("(a) (b)");
      expect(unwrapOuterBalancedParens("(   )")).toBe("");
      expect(unwrapOuterBalancedParens("((a)")).toBe("((a)");

      const nested = `${"(".repeat(20_000)}a${")".repeat(20_000)}`;
      const nestedNeon = `${"(".repeat(20_000)}google/gemini-4-neon-extra${")".repeat(20_000)}`;
      const start = performance.now();
      expect(unwrapOuterBalancedParens(nested)).toBe("a");
      expect(parseIdentity(nestedNeon)?.family).toBe("gemini/neon");
      expect(performance.now() - start).toBeLessThan(200);
    });

    describe("Gemini 4 Neon normalization and review-gate matrix", () => {
      it.each([
        "Gemini 4 Neon",
        "Gemini 4 Neon (Extra)",
        "Gemini 4 Neon (XHigh)",
        "gemini/neon",
        "gemini/4-neon",
        "gemini-4-neon",
        "google/gemini-4-neon",
        "google/gemini-4-neon-high",
        "google/gemini-4-neon-xhigh",
        "google/gemini-4-neon-extra",
        "google/gemini-4-neon-extra-high (antigravity)",
        "Orchestrator (Neon)",
        "Orchestrator (Gemini 4 Neon)",
        "gemini-pro-orchestrator-neon",
        "google/gemini-pro-orchestrator-neon (antigravity)",
      ])("normalizes %s to gemini/neon", (identity) => {
        expect(parseIdentity(identity)?.family).toBe("gemini/neon");
      });

      it("blocks self-review across Gemini 4 Neon display names, effort suffixes, and orchestrator aliases", () => {
        for (const [author, reviewer] of [
          ["Gemini 4 Neon", "google/gemini-4-neon-xhigh"],
          ["Gemini 4 Neon (Extra)", "google/gemini-4-neon-extra"],
          ["Orchestrator (Neon)", "gemini-pro-orchestrator-neon"],
          ["google/gemini-pro-orchestrator-neon (antigravity)", "Gemini 4 Neon (Extra)"],
        ] as const) {
          const gate = checkReviewGate(author, reviewer, "intra-fleet");
          expect(gate.violated).toBe(true);
          expect(gate.severity).toBe("error");
          expect(checkSelfApproval(author, reviewer).isSelfApproval).toBe(true);
        }
      });

      it("permits intra-fleet review between Neon and Hydrogen, Flash, Carbon, and Argon", () => {
        for (const peer of [
          "google/gemini-4-hydrogen-high (antigravity)",
          "google/gemini-3.8-flash-high (antigravity)",
          "Orchestrator (Carbon)",
          "Orchestrator (Argon)",
        ]) {
          const asReviewer = checkReviewGate(peer, "Orchestrator (Neon)", "intra-fleet");
          expect(asReviewer.violated).toBe(false);

          const asAuthor = checkReviewGate("Gemini 4 Neon (Extra)", peer, "intra-fleet");
          expect(asAuthor.violated).toBe(false);
        }
      });

      it("blocks Orchestrator (Neon) vs google/gemini-4-hydrogen-high under cross-vendor on vendor gemini", () => {
        const res = checkReviewGate(
          "Orchestrator (Neon)",
          "google/gemini-4-hydrogen-high",
          "cross-vendor",
        );
        expect(res.violated).toBe(true);
        expect(res.severity).toBe("error");
        expect(res.message).toContain("('gemini')");

        const crossVendorAllowed = checkReviewGate(
          "Orchestrator (Neon)",
          "claude/opus-4.6",
          "cross-vendor",
        );
        expect(crossVendorAllowed.violated).toBe(false);
      });
    });

    it("rejects placeholder identities in executeAtomicCommit while allowing omitted reviewer", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "lognexus-commit-placeholder-"));
      try {
        execSync("git init", { cwd: tempDir, stdio: "ignore" });
        execSync('git config user.name "Test Runner"', { cwd: tempDir, stdio: "ignore" });
        execSync('git config user.email "test@example.com"', { cwd: tempDir, stdio: "ignore" });
        execSync('git config commit.gpgsign "false"', { cwd: tempDir, stdio: "ignore" });
        commitFile(tempDir, "README.md", "# seed", "chore: seed");
        execSync("git checkout -b issue/67-commit-guard", { cwd: tempDir, stdio: "ignore" });

        writeFileSync(join(tempDir, "feature.ts"), "export const ok = true;\n", "utf8");
        execSync("git add feature.ts", { cwd: tempDir, stdio: "ignore" });

        for (const badAuthor of [
          "auto",
          "orchestrator",
          "unknown/other",
          "<provider>/<model> (<client>)",
        ]) {
          expect(() =>
            executeAtomicCommit({
              message: "feat(#67/T3): reject placeholder author",
              author: badAuthor,
              targetDir: tempDir,
            }),
          ).toThrow(/Invalid placeholder identity/);
        }

        expect(() =>
          executeAtomicCommit({
            message: "feat(#67/T3): reject placeholder reviewer",
            author: "google/gemini-flash-worker-agy (antigravity)",
            reviewer: "auto",
            targetDir: tempDir,
          }),
        ).toThrow(/Invalid placeholder identity/);

        const res = executeAtomicCommit({
          message: "feat(#67/T3): allow omitted reviewer with valid author",
          author: "google/gemini-flash-worker-agy (antigravity)",
          targetDir: tempDir,
        });
        expect(res.reviewer).toBeNull();
        expect(res.noteAttached).toBe(true);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe(".lognexus/policy.json audit severity profiles (#42)", () => {
    let tempDir: string;
    let baseBranch: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), "lognexus-audit-policy-test-"));
      execSync("git init", { cwd: tempDir, stdio: "ignore" });
      execSync('git config user.name "Test Runner"', { cwd: tempDir, stdio: "ignore" });
      execSync('git config user.email "test@example.com"', { cwd: tempDir, stdio: "ignore" });
      execSync('git config commit.gpgsign "false"', { cwd: tempDir, stdio: "ignore" });
      commitFile(tempDir, "file.txt", "hello world", "chore: initial commit");
      baseBranch = git("branch --show-current", tempDir) || "main";
      execSync("git checkout -b issue/42-audit-policy", { cwd: tempDir, stdio: "ignore" });
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it("keeps current strict defaults when .lognexus/policy.json is missing", () => {
      const loaded = loadAuditPolicy(tempDir);
      expect(loaded).toEqual({
        exists: false,
        valid: true,
        profile: "default",
        rules: {},
        errors: [],
      });
      expect(NON_OVERRIDABLE_AUDIT_RULES).toEqual([
        "invalid-identity",
        "review-gate-separation",
        "base-branch-range",
      ]);

      commitFile(
        tempDir,
        "legacy.ts",
        "export const legacy = true;\n",
        "legacy commit without trailer or note",
      );

      const result = auditBranch(baseBranch, tempDir);
      const authoredViolation = result.violations.find((v) => v.rule === "authored-by-trailer");
      const noteViolation = result.violations.find((v) => v.rule === "git-note-presence");
      const formatViolation = result.violations.find((v) => v.rule === "commit-format");

      expect(authoredViolation?.severity).toBe("error");
      expect(noteViolation?.severity).toBe("warn");
      expect(formatViolation?.severity).toBe("warn");
      expect(result.passed).toBe(false);
      expect(result.summary).toEqual({ errors: 1, warnings: 2 });
    });

    it("downgrades missing Authored-by and contract-files violations to warn under profile 'incremental'", () => {
      mkdirSync(join(tempDir, ".lognexus"), { recursive: true });
      writeFileSync(
        join(tempDir, ".lognexus", "policy.json"),
        JSON.stringify({ profile: "incremental" }, null, 2),
        "utf8",
      );

      // Legacy commit missing Authored-by, note, and conventional subject
      commitFile(tempDir, "legacy.ts", "export const a = 1;\n", "legacy cleanup");

      // Contracted commit touching an outside file
      commitFile(
        tempDir,
        "allowed.ts",
        "export const ok = true;\n",
        "feat(#42/T1): contract test\n\nAuthored-by: google/gemini-4-hydrogen-high (antigravity)\n",
      );
      commitFile(
        tempDir,
        "outside.ts",
        "export const outside = true;\n",
        "feat(#42/T1): contract test\n\nAuthored-by: google/gemini-4-hydrogen-high (antigravity)\n",
      );
      attachNote(
        JSON.stringify({
          subtask: { id: "T1", contract: { allowedFiles: ["allowed.ts"] } },
          tier: "tier-2",
        }),
        "HEAD",
        { cwd: tempDir },
      );

      const result = auditBranch(baseBranch, tempDir);
      const authored = result.violations.find((v) => v.rule === "authored-by-trailer");
      const contract = result.violations.find((v) => v.rule === "contract-files");

      expect(authored?.severity).toBe("warn");
      expect(contract?.severity).toBe("warn");
      expect(result.summary.errors).toBe(0);
      expect(result.summary.warnings).toBeGreaterThan(0);
      expect(result.passed).toBe(true);
    });

    it("promotes missing Git Notes, commit-format, tier-routing-violation, and routing-weakening warn to error under profile 'strict'", () => {
      mkdirSync(join(tempDir, ".lognexus"), { recursive: true });
      writeFileSync(
        join(tempDir, ".lognexus", "policy.json"),
        JSON.stringify({ profile: "strict" }, null, 2),
        "utf8",
      );

      commitFile(
        tempDir,
        "feature.ts",
        "export const ok = true;\n",
        "non conventional subject\n\nAuthored-by: google/gemini-4-hydrogen-high (antigravity)\n",
      );

      const result = auditBranch(baseBranch, tempDir);
      const noteViolation = result.violations.find((v) => v.rule === "git-note-presence");
      const formatViolation = result.violations.find((v) => v.rule === "commit-format");

      expect(noteViolation?.severity).toBe("error");
      expect(formatViolation?.severity).toBe("error");
      expect(result.passed).toBe(false);
      expect(result.summary.errors).toBe(2);

      // Also verify direct resolution for tier-routing-violation and advisory/routing-weakening review-gate-separation
      const loaded = loadAuditPolicy(tempDir);
      expect(resolveAuditRuleSeverity("tier-routing-violation", "warn", loaded)).toBe("error");
      expect(resolveAuditRuleSeverity("review-gate-separation", "warn", loaded)).toBe("error");
    });

    it("applies per-rule overrides on top of a profile preset", () => {
      mkdirSync(join(tempDir, ".lognexus"), { recursive: true });
      writeFileSync(
        join(tempDir, ".lognexus", "policy.json"),
        JSON.stringify(
          {
            profile: "incremental",
            rules: {
              "contract-files": "error",
            },
          },
          null,
          2,
        ),
        "utf8",
      );

      commitFile(tempDir, "legacy.ts", "export const a = 1;\n", "legacy change");
      commitFile(
        tempDir,
        "outside.ts",
        "export const outside = true;\n",
        "feat(#42/T2): strict contract override\n\nAuthored-by: google/gemini-4-hydrogen-high (antigravity)\n",
      );
      attachNote(
        JSON.stringify({
          subtask: { id: "T2", contract: { allowedFiles: ["allowed.ts"] } },
          tier: "tier-2",
        }),
        "HEAD",
        { cwd: tempDir },
      );

      const result = auditBranch(baseBranch, tempDir);
      const authored = result.violations.find((v) => v.rule === "authored-by-trailer");
      const contract = result.violations.find((v) => v.rule === "contract-files");

      expect(authored?.severity).toBe("warn");
      expect(contract?.severity).toBe("error");
      expect(result.passed).toBe(false);
      expect(result.summary.errors).toBe(1);
    });

    it.each([
      {
        label: "downgrading review-gate-separation to warn",
        raw: JSON.stringify({
          profile: "incremental",
          rules: { "review-gate-separation": "warn" },
        }),
      },
      {
        label: "downgrading invalid-identity to warn",
        raw: JSON.stringify({
          rules: { "invalid-identity": "warn" },
        }),
      },
      {
        label: "unknown top-level key",
        raw: JSON.stringify({
          profile: "incremental",
          unknownKey: true,
        }),
      },
      {
        label: "invalid JSON syntax",
        raw: "{ profile: incremental",
      },
    ])(
      "flags invalid-policy error and falls back to strict defaults on $label while keeping self-approval error",
      ({ raw }) => {
        mkdirSync(join(tempDir, ".lognexus"), { recursive: true });
        writeFileSync(join(tempDir, ".lognexus", "policy.json"), raw, "utf8");

        const loaded = loadAuditPolicy(tempDir);
        expect(loaded.exists).toBe(true);
        expect(loaded.valid).toBe(false);
        expect(loaded.errors.length).toBeGreaterThan(0);

        commitFile(
          tempDir,
          "feature.ts",
          "export const ok = true;\n",
          "feat(#42/T3): self-approved commit\n\nAuthored-by: google/gemini-4-hydrogen-high (antigravity)\nReviewed-by: google/gemini-4-hydrogen-high (antigravity)\n",
        );
        attachNote(JSON.stringify({}), "HEAD", { cwd: tempDir });

        commitFile(
          tempDir,
          "legacy.ts",
          "export const legacy = true;\n",
          "feat(#42/T3): missing author",
        );
        attachNote(JSON.stringify({}), "HEAD", { cwd: tempDir });

        const result = auditBranch(baseBranch, tempDir);
        const policyViolation = result.violations.find((v) => v.rule === "invalid-policy");
        const reviewGateViolation = result.violations.find(
          (v) => v.rule === "review-gate-separation",
        );
        const authoredViolation = result.violations.find((v) => v.rule === "authored-by-trailer");

        expect(policyViolation).toBeDefined();
        expect(policyViolation?.severity).toBe("error");
        expect(policyViolation?.shortSha).toBe("policy");
        expect(reviewGateViolation).toBeDefined();
        expect(reviewGateViolation?.severity).toBe("error");
        expect(authoredViolation?.severity).toBe("error");
        expect(result.passed).toBe(false);
      },
    );

    it("enforces non-overridable error floor even if a forged policy object is passed programmatically", () => {
      const forgedPolicy = {
        exists: true,
        valid: true,
        profile: "incremental" as const,
        rules: {
          "invalid-identity": "warn",
          "review-gate-separation": "warn",
          "base-branch-range": "warn",
        } as Partial<
          Record<
            "invalid-identity" | "review-gate-separation" | "base-branch-range",
            "error" | "warn"
          >
        >,
        errors: [],
      };

      expect(resolveAuditRuleSeverity("invalid-identity", "error", forgedPolicy)).toBe("error");
      expect(resolveAuditRuleSeverity("review-gate-separation", "error", forgedPolicy)).toBe(
        "error",
      );
      expect(resolveAuditRuleSeverity("base-branch-range", "error", forgedPolicy)).toBe("error");
      expect(resolveAuditRuleSeverity("invalid-policy", "error", forgedPolicy)).toBe("error");
    });
  });
});
