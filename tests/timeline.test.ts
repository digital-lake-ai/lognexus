import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { attachCurrentStateToCommit } from "../src/notes/attach.js";
import { setSubtask } from "../src/state/manager.js";
import {
  getJourneyTimeline,
  sanitizeMarkdown,
  validateGitReference,
} from "../src/timeline/timeline.js";

function git(args: string, targetDir: string): string {
  return execSync(`git ${args}`, { cwd: targetDir, encoding: "utf8" }).trim();
}

function baseBranchName(targetDir: string): string {
  const branch = git("branch --show-current", targetDir);
  return branch === "" ? "main" : branch;
}

function createBranch(targetDir: string, branch: string): void {
  execSync(`git checkout -b ${branch}`, { cwd: targetDir, stdio: "ignore" });
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

describe("Journey Timeline", () => {
  let tempDir: string;
  let baseBranch: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lognexus-timeline-test-"));
    execSync("git init", { cwd: tempDir, stdio: "ignore" });
    execSync('git config user.name "Test Runner"', { cwd: tempDir, stdio: "ignore" });
    execSync('git config user.email "test@example.com"', { cwd: tempDir, stdio: "ignore" });
    execSync('git config commit.gpgsign "false"', { cwd: tempDir, stdio: "ignore" });
    commitFile(tempDir, "file.txt", "hello world", "chore: initial commit");
    baseBranch = baseBranchName(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns an empty timeline when there are no commits ahead of the base branch", () => {
    const timeline = getJourneyTimeline(baseBranch, tempDir);

    expect(timeline.commitCount).toBe(0);
    expect(timeline.items).toEqual([]);
    expect(timeline.baseBranch).toBe(baseBranch);
    expect(timeline.markdownTable).toBe(
      "| Commit | Subtask | Summary | Tier | Author | Note |\n|---|---|---|---|---|---|",
    );
  });

  it("extracts commits with trailers, Git Notes and builds a valid markdown table", () => {
    createBranch(tempDir, "issue/9-timeline-audit");

    const sha = commitFile(
      tempDir,
      "feature.txt",
      "feature",
      "feat(#9/T1): implement journey timeline\n\nAdds the timeline engine.\n\nAuthored-by: deepseek/chat (kimi-code)\n",
    );

    setSubtask("T1", "Timeline engine", undefined, tempDir);
    attachCurrentStateToCommit("HEAD", { cwd: tempDir });

    const timeline = getJourneyTimeline(baseBranch, tempDir);

    expect(timeline.commitCount).toBe(1);
    expect(timeline.items).toHaveLength(1);

    const [item] = timeline.items;
    expect(item.sha).toBe(sha);
    expect(item.shortSha).toBe(sha.slice(0, 7));
    expect(item.subject).toContain("feat(#9/T1)");
    expect(item.taskId).toBe("T1");
    expect(item.taskTitle).toBe("Timeline engine");
    expect(item.tier).toBe("tier-3");
    expect(item.author).toBe("deepseek/chat (kimi-code)");
    expect(item.reviewer).toBeNull();
    expect(item.hasNote).toBe(true);

    const lines = timeline.markdownTable.split("\n");
    expect(lines[0]).toBe("| Commit | Subtask | Summary | Tier | Author | Note |");
    expect(lines[1]).toBe("|---|---|---|---|---|---|");
    expect(lines).toHaveLength(3);
    expect(lines[2]).toContain(`\`${item.shortSha}\``);
    expect(lines[2]).toContain("`T1`");
    expect(lines[2]).toContain("`tier-3`");
    expect(lines[2]).toContain("`deepseek/chat (kimi-code)`");
    expect(lines[2]).toMatch(/\| Yes \|$/);
  });

  it("falls back to the commit subject when no Git Note is attached", () => {
    createBranch(tempDir, "issue/9-timeline-audit");

    commitFile(
      tempDir,
      "feature.txt",
      "feature",
      "fix(#9/T2): handle CRLF line endings [tier-3]\n\nAuthored-by: gemini/flash (cursor)\nReviewed-by: claude/opus-4.6 (claude-code)\n",
    );

    const timeline = getJourneyTimeline(baseBranch, tempDir);
    const [item] = timeline.items;

    expect(item.hasNote).toBe(false);
    expect(item.taskId).toBe("T2");
    expect(item.taskTitle).toBeNull();
    expect(item.tier).toBe("tier-3");
    expect(item.author).toBe("gemini/flash (cursor)");
    expect(item.reviewer).toBe("claude/opus-4.6 (claude-code)");
    expect(timeline.markdownTable.split("\n")[2]).toMatch(/\| No \|$/);
  });

  it("generates a structured PR body draft", () => {
    createBranch(tempDir, "issue/9-timeline-audit");

    commitFile(
      tempDir,
      "feature.txt",
      "feature",
      "feat(#9/T1): implement journey timeline\n\nAuthored-by: deepseek/chat (kimi-code)\n",
    );

    const timeline = getJourneyTimeline(baseBranch, tempDir);
    const { prBodyDraft } = timeline;

    expect(prBodyDraft).toContain("<!-- lognexus:");
    expect(prBodyDraft).toContain("kind: history");
    expect(prBodyDraft).toContain("readiness: needs-review");
    expect(prBodyDraft).toContain("## Summary");
    expect(prBodyDraft).toContain("Closes #9");
    expect(prBodyDraft).toContain("## Journey Timeline");
    expect(prBodyDraft).toContain("### Changes Made");
    expect(prBodyDraft).toContain("### Traceability");
    expect(prBodyDraft).toContain("## Verification");
    expect(prBodyDraft).toContain("- [ ] `npm run build`");
    expect(prBodyDraft).toContain("- [ ] `npm test`");
    expect(prBodyDraft).toContain("## Reviews");
    expect(prBodyDraft).toContain("Authored-by: deepseek/chat (kimi-code)");
    expect(prBodyDraft).toContain("Last-code-by: deepseek/chat (kimi-code)");
    expect(prBodyDraft).toContain("*Captain's log — PR timeline by **lognexus***");
    expect(prBodyDraft).toContain(timeline.markdownTable);
    expect(prBodyDraft).toContain(timeline.items[0].shortSha);
  });

  it("extracts subtask and issue from alphanumeric ticket schemes (e.g. SLM-201/T1)", () => {
    createBranch(tempDir, "feature/SLM-201-parser");

    commitFile(
      tempDir,
      "feature.txt",
      "feature",
      "feat(SLM-201/T1): add symbol table indexer\n\nAuthored-by: gemini/flash\n",
    );

    const timeline = getJourneyTimeline(baseBranch, tempDir);
    const [item] = timeline.items;

    expect(item.taskId).toBe("T1");
    expect(item.subject).toContain("SLM-201/T1");
    expect(timeline.prBodyDraft).toContain("Closes SLM-201");
  });

  describe("Security Hardening & Injection Mitigation (Issue #21)", () => {
    it("aborts execution and throws governance violation when baseBranch contains shell metacharacters", () => {
      const maliciousPayloads = [
        "main; echo pwned",
        "main | rm -rf /",
        "main && evil",
        "main$(whoami)",
        "main`id`",
        "main\nmalicious",
      ];

      for (const payload of maliciousPayloads) {
        expect(
          () => getJourneyTimeline(payload, tempDir),
          `Expected payload "${payload}" to be blocked`,
        ).toThrowError(/Governance violation: Invalid or unsafe Git reference provided/);
      }
    });

    it("aborts execution and throws governance violation when baseBranch starts with flag injection (--*)", () => {
      const maliciousFlags = ["--upload-pack=evil", "--help", "-v", "--output=/dev/null"];

      for (const flag of maliciousFlags) {
        expect(
          () => getJourneyTimeline(flag, tempDir),
          `Expected flag "${flag}" to be blocked`,
        ).toThrowError(/Governance violation: Invalid or unsafe Git reference provided/);
      }
    });

    it("validates Git references strictly with validateGitReference", () => {
      expect(validateGitReference("main")).toBe("main");
      expect(validateGitReference("origin/main")).toBe("origin/main");
      expect(validateGitReference("issue/21-security-command-injection-fix")).toBe(
        "issue/21-security-command-injection-fix",
      );
      expect(validateGitReference("v1.2.3")).toBe("v1.2.3");
      expect(validateGitReference("HEAD")).toBe("HEAD");
      expect(validateGitReference("0303b48")).toBe("0303b48");
      expect(validateGitReference("feature/sub_task-1.0")).toBe("feature/sub_task-1.0");

      expect(() => validateGitReference("")).toThrow(/Governance violation/);
      expect(() => validateGitReference("   ")).toThrow(/Governance violation/);
      expect(() => validateGitReference("--upload-pack=evil")).toThrow(/Governance violation/);
      expect(() => validateGitReference("main; echo pwned")).toThrow(/Governance violation/);
    });

    it("sanitizes Markdown special characters in commit subject to prevent format injection", () => {
      createBranch(tempDir, "issue/21-sanitize");

      commitFile(
        tempDir,
        "sanitize.txt",
        "data",
        "feat(#21/T1): test [tier-3] with | pipe & *star* & `code`\n\nAuthored-by: gemini/flash\n",
      );

      const timeline = getJourneyTimeline(baseBranch, tempDir);
      const [item] = timeline.items;

      expect(item.subject).toBe("feat(#21/T1): test [tier-3] with | pipe & *star* & `code`");

      // Verify sanitized in markdown table
      expect(timeline.markdownTable).toContain(
        "test \\[tier-3\\] with \\| pipe & \\*star\\* & 'code'",
      );

      // Verify sanitizeMarkdown unit behavior
      expect(sanitizeMarkdown("hello | world")).toBe("hello \\| world");
      expect(sanitizeMarkdown("[link]")).toBe("\\[link\\]");
      expect(sanitizeMarkdown("*bold*")).toBe("\\*bold\\*");
      expect(sanitizeMarkdown("`code`")).toBe("'code'");
      expect(sanitizeMarkdown(null)).toBe("—");
    });
  });
});
