import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { attachCurrentStateToCommit } from "../src/notes/attach.js";
import { attachNote, getNote, listNotes } from "../src/notes/notes.js";
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
