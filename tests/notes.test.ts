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
});
