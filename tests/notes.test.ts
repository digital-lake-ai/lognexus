import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { attachCurrentStateToCommit } from "../src/notes/attach.js";
import { attachNote, getNote, listNotes, searchNotesMemory } from "../src/notes/notes.js";
import { saveState } from "../src/state/manager.js";

describe("Git Notes (Quiet Mode)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lognexus-notes-test-"));
    // Initialize temporary git repo
    execSync("git init", { cwd: tempDir, stdio: "ignore" });
    execSync('git config user.name "Test Runner"', { cwd: tempDir, stdio: "ignore" });
    execSync('git config user.email "test@example.com"', { cwd: tempDir, stdio: "ignore" });

    // Make an initial commit with double quotes for cross-platform cmd compatibility
    writeFileSync(join(tempDir, "file.txt"), "hello world", "utf8");
    execSync("git add file.txt", { cwd: tempDir, stdio: "ignore" });
    execSync('git commit -m "initial commit"', { cwd: tempDir, stdio: "ignore" });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("attaches and reads a custom Git Note", () => {
    attachNote("hello from lognexus note", "HEAD", { cwd: tempDir });

    const note = getNote("HEAD", { cwd: tempDir });
    expect(note).toBe("hello from lognexus note");
  });

  it("returns null when no note is attached", () => {
    const note = getNote("HEAD", { cwd: tempDir });
    expect(note).toBeNull();
  });

  it("lists all commits with attached notes", () => {
    attachNote("test note 1", "HEAD", { cwd: tempDir });

    const notes = listNotes({ cwd: tempDir });
    expect(notes.length).toBe(1);
    expect(typeof notes[0].commitSha).toBe("string");
    expect(typeof notes[0].noteBlob).toBe("string");
  });

  it("attaches current state note payload to commit", () => {
    // Populate state in tempDir
    saveState(
      {
        schemaVersion: "1.0.0",
        activeIssue: {
          id: 5,
          title: "Git Notes Feature",
          branch: "issue/5-git-notes",
          phase: "commit",
          tier: "tier-3",
          readiness: "ready",
        },
        currentSubtask: {
          id: "T1",
          title: "Core Notes",
          status: "in-progress",
          contract: {
            allowedFiles: ["src/notes.ts"],
            forbiddenFiles: [],
            decisionBudget: "none",
          },
        },
        completedSubtasks: [],
        lastSync: new Date().toISOString(),
      },
      tempDir,
    );

    const payload = attachCurrentStateToCommit("HEAD", { cwd: tempDir });
    expect(payload.issue?.id).toBe(5);
    expect(payload.subtask?.id).toBe("T1");

    const noteRaw = getNote("HEAD", { cwd: tempDir });
    expect(noteRaw).not.toBeNull();

    const parsed = JSON.parse(noteRaw as string);
    expect(parsed.generator).toBe("LogNexus");
    expect(parsed.issue.id).toBe(5);
    expect(parsed.subtask.id).toBe("T1");
  });

  it("throws error on attachCurrentStateToCommit when self-approval is detected", () => {
    writeFileSync(join(tempDir, "file2.txt"), "more content", "utf8");
    execSync("git add file2.txt", { cwd: tempDir, stdio: "ignore" });
    const msg =
      "feat(#5/T1): test commit\n\nAuthored-by: gemini/flash\nReviewed-by: gemini/flash\n";
    const msgFile = join(tmpdir(), `msg-${Date.now()}.txt`);
    writeFileSync(msgFile, msg, "utf8");
    try {
      execSync(`git commit -F "${msgFile}"`, { cwd: tempDir, stdio: "ignore" });
    } finally {
      rmSync(msgFile, { force: true });
    }

    expect(() => {
      attachCurrentStateToCommit("HEAD", { cwd: tempDir });
    }).toThrow(/Review-gate separation violation/);
  });

  it("allows attachCurrentStateToCommit when author and reviewer belong to different families", () => {
    writeFileSync(join(tempDir, "file3.txt"), "valid content", "utf8");
    execSync("git add file3.txt", { cwd: tempDir, stdio: "ignore" });
    const msg =
      "feat(#5/T1): valid commit\n\nAuthored-by: deepseek/chat\nReviewed-by: gemini/pro\n";
    const msgFile = join(tmpdir(), `msg-${Date.now()}.txt`);
    writeFileSync(msgFile, msg, "utf8");
    try {
      execSync(`git commit -F "${msgFile}"`, { cwd: tempDir, stdio: "ignore" });
    } finally {
      rmSync(msgFile, { force: true });
    }

    expect(() => {
      attachCurrentStateToCommit("HEAD", { cwd: tempDir });
    }).not.toThrow();
  });
});

describe("Memory Recall (Git Notes search)", () => {
  let tempDir: string;

  function git(args: string): string {
    return execSync(`git ${args}`, { cwd: tempDir, encoding: "utf8", stdio: "pipe" }).trim();
  }

  function commitFile(
    file: string,
    content: string,
    message: string,
    author: string,
    dateIso?: string,
  ): string {
    const target = join(tempDir, file);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, content, "utf8");
    git("add -A");
    const dateArg = dateIso ? ` --date="${dateIso}"` : "";
    const env = dateIso ? { ...process.env, GIT_COMMITTER_DATE: dateIso } : process.env;
    execSync(`git commit -m "${message}" --author "${author}"${dateArg}`, {
      cwd: tempDir,
      stdio: "pipe",
      env,
    });
    return git("rev-parse HEAD");
  }

  function notePayload(issueId: number, subtaskId: string, title: string): string {
    return JSON.stringify({
      $schema: "https://lognexus.digital-lake.ai/schemas/git-note-v1.json",
      generator: "LogNexus",
      version: "1.3.0",
      timestamp: new Date().toISOString(),
      issue: { id: issueId, title: `Issue ${issueId}` },
      subtask: { id: subtaskId, title, status: "completed" },
      tier: "tier-3",
    });
  }

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lognexus-recall-test-"));
    execSync("git init", { cwd: tempDir, stdio: "ignore" });
    execSync('git config user.name "Test Runner"', { cwd: tempDir, stdio: "ignore" });
    execSync('git config user.email "test@example.com"', { cwd: tempDir, stdio: "ignore" });

    writeFileSync(join(tempDir, "README.md"), "# fixture\n", "utf8");
    git("add README.md");
    git('commit -m "chore: initial fixture"');

    const shaDrift = commitFile(
      "src/status.ts",
      "export const drift = true;\n",
      "feat(#30/T2): implement live scope-drift guard",
      "deepseek/VS Code <deepseek@example.com>",
      "2026-10-30T10:00:01Z",
    );
    attachNote(notePayload(30, "T2", "Implement live scope-drift guard"), shaDrift, {
      cwd: tempDir,
    });

    const shaHandoff = commitFile(
      "src/state/handoff.ts",
      "export const handoff = true;\n",
      "feat(#30/T3): implement context handoff generator",
      "deepseek/VS Code <deepseek@example.com>",
      "2026-10-30T10:00:02Z",
    );
    attachNote(notePayload(30, "T3", "Implement automated context handoff"), shaHandoff, {
      cwd: tempDir,
    });

    const shaBump = commitFile(
      "package.json",
      '{"version":"1.2.6"}\n',
      "chore(#26/T4): bump atomic version contract to 1.2.6",
      "gemini/flash <gemini@example.com>",
      "2026-10-30T10:00:03Z",
    );
    attachNote(notePayload(26, "T4", "Bump atomic version contract"), shaBump, { cwd: tempDir });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns every noted commit newest-first when no filter is given", () => {
    const results = searchNotesMemory(tempDir);

    expect(results).toHaveLength(3);
    expect(results[0].subject).toContain("bump atomic version contract");
    expect(results[2].subject).toContain("scope-drift guard");
    expect(results[0].shortSha).toHaveLength(7);
  });

  it("filters by free-text query across the note and commit subject", () => {
    const bySubject = searchNotesMemory(tempDir, { query: "handoff" });
    expect(bySubject).toHaveLength(1);
    expect(bySubject[0].subtaskId).toBe("T3");

    const byNote = searchNotesMemory(tempDir, { query: "scope-drift guard" });
    expect(byNote).toHaveLength(1);
    expect(byNote[0].issueId).toBe(30);

    expect(searchNotesMemory(tempDir, { query: "nonexistent-term" })).toEqual([]);
  });

  it("filters by touched file", () => {
    const results = searchNotesMemory(tempDir, { file: "src/state/handoff.ts" });

    expect(results).toHaveLength(1);
    expect(results[0].subtaskId).toBe("T3");
    expect(results[0].files).toContain("src/state/handoff.ts");
  });

  it("filters by author identity", () => {
    const results = searchNotesMemory(tempDir, { author: "gemini/flash" });

    expect(results).toHaveLength(1);
    expect(results[0].subtaskId).toBe("T4");
    expect(results[0].author).toContain("gemini/flash");
  });

  it("filters by issue number", () => {
    const results = searchNotesMemory(tempDir, { issue: 30 });

    expect(results).toHaveLength(2);
    expect(results.every((entry) => entry.issueId === 30)).toBe(true);

    expect(searchNotesMemory(tempDir, { issue: 999 })).toEqual([]);
  });

  it("combines filters conjunctively", () => {
    const matching = searchNotesMemory(tempDir, { issue: 30, query: "handoff" });
    expect(matching).toHaveLength(1);
    expect(matching[0].subtaskId).toBe("T3");

    const conflicting = searchNotesMemory(tempDir, { issue: 30, author: "gemini/flash" });
    expect(conflicting).toEqual([]);
  });

  it("respects the limit option", () => {
    const results = searchNotesMemory(tempDir, { limit: 1 });

    expect(results).toHaveLength(1);
    expect(results[0].subtaskId).toBe("T4");
  });

  it("defaults the limit when a non-positive value is supplied", () => {
    const results = searchNotesMemory(tempDir, { limit: 0 });
    expect(results).toHaveLength(3);
  });

  it("returns an empty array when no notes exist", () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "lognexus-recall-empty-"));
    try {
      execSync("git init", { cwd: emptyDir, stdio: "ignore" });
      expect(searchNotesMemory(emptyDir)).toEqual([]);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it("keeps free-form notes searchable without a JSON payload", () => {
    const sha = commitFile(
      "notes.txt",
      "free form\n",
      "docs: free-form note commit",
      "claude/sonnet <claude@example.com>",
    );
    attachNote("Reviewed-by: claude/sonnet (cursor)", sha, { cwd: tempDir });

    const results = searchNotesMemory(tempDir, { query: "Reviewed-by" });
    expect(results).toHaveLength(1);
    expect(results[0].subtaskId).toBeNull();
    expect(results[0].issueId).toBeNull();
    expect(results[0].note).toContain("Reviewed-by");
  });
});
