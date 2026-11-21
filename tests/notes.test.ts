import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { attachCurrentStateToCommit } from "../src/notes/attach.js";
import {
  attachNote,
  type ExportedNoteRecord,
  exportNotesJsonl,
  getNote,
  listNotes,
  searchNotesMemory,
} from "../src/notes/notes.js";
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

  it("infers issue and subtask from the commit subject when state is empty", () => {
    writeFileSync(join(tempDir, "undead.scp"), "[EOF]\n", "utf8");
    execSync("git add -A", { cwd: tempDir, stdio: "ignore" });
    execSync('git commit -m "fix(#8/T4): add MT_RUN to undead"', {
      cwd: tempDir,
      stdio: "ignore",
    });

    const payload = attachCurrentStateToCommit("HEAD", { cwd: tempDir });
    expect(payload.issue?.id).toBe(8);
    expect(payload.subtask?.id).toBe("T4");
    expect(payload.subtask?.status).toBe("completed");
    expect(payload.subtask?.title).toBe("add MT_RUN to undead");
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

  it("enforces cross-vendor and advisory review_gate modes on attachCurrentStateToCommit", () => {
    mkdirSync(join(tempDir, ".lognexus"), { recursive: true });
    writeFileSync(
      join(tempDir, ".lognexus", "routing.md"),
      "routing: confirm\nreview_gate: cross-vendor\n",
      "utf8",
    );
    writeFileSync(join(tempDir, "file4.txt"), "cross-vendor check", "utf8");
    execSync("git add file4.txt", { cwd: tempDir, stdio: "ignore" });
    const msgFile = join(tmpdir(), `msg-cv-${Date.now()}.txt`);
    writeFileSync(
      msgFile,
      "feat(#63/T2): test cross-vendor\n\nAuthored-by: gemini/flash\nReviewed-by: gemini/pro\n",
      "utf8",
    );
    try {
      execSync(`git commit -F "${msgFile}"`, { cwd: tempDir, stdio: "ignore" });
    } finally {
      rmSync(msgFile, { force: true });
    }

    expect(() => {
      attachCurrentStateToCommit("HEAD", { cwd: tempDir });
    }).toThrow(/Review-gate separation violation/);

    writeFileSync(
      join(tempDir, ".lognexus", "routing.md"),
      "routing: confirm\nreview_gate: advisory\n",
      "utf8",
    );
    expect(() => {
      attachCurrentStateToCommit("HEAD", { cwd: tempDir });
    }).not.toThrow();
  });

  it("attaches swarm metadata from contract defaults and explicit overrides", () => {
    saveState(
      {
        schemaVersion: "1.0.0",
        activeIssue: {
          id: 65,
          title: "Swarm telemetry",
          branch: "issue/65-swarm-telemetry-and-semver-guard",
          phase: "commit",
          tier: "tier-2",
          readiness: "ready",
        },
        currentSubtask: {
          id: "T1",
          title: "Swarm note defaults",
          status: "in-progress",
          contract: {
            allowedFiles: ["src/notes/attach.ts"],
            forbiddenFiles: [],
            decisionBudget: "none",
            isolation: "swarm",
          },
        },
        completedSubtasks: [],
        lastSync: new Date().toISOString(),
      },
      tempDir,
    );

    const defaulted = attachCurrentStateToCommit("HEAD", { cwd: tempDir });
    expect(defaulted.swarm).toEqual({ workers: 0, posts: 0 });

    const overridden = attachCurrentStateToCommit("HEAD", {
      cwd: tempDir,
      swarmWorkers: 3,
      swarmPosts: 14,
    });
    expect(overridden.swarm).toEqual({ workers: 3, posts: 14 });
  });

  it("omits swarm metadata when non-swarm and no swarm options are passed", () => {
    const payload = attachCurrentStateToCommit("HEAD", { cwd: tempDir });
    expect(payload.swarm).toBeUndefined();

    const partial = attachCurrentStateToCommit("HEAD", { cwd: tempDir, swarmWorkers: 2 });
    expect(partial.swarm).toEqual({ workers: 2 });
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

  it("scopes the query to subtask fields instead of the shared issue payload", () => {
    // Every commit in a cycle shares issue.title, so a title word must not match them all.
    const results = searchNotesMemory(tempDir, { issue: 30, query: "scope-drift" });

    expect(results).toHaveLength(1);
    expect(results[0].subtaskId).toBe("T2");
    expect(results.some((entry) => entry.subtaskId === "T3")).toBe(false);
  });

  it("resolves the Authored-by trailer as the commit author", () => {
    const target = join(tempDir, "src/trailer.ts");
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, "export const trailer = true;\n", "utf8");
    git("add -A");
    execFileSync(
      "git",
      [
        "commit",
        "-m",
        "feat(#30/T1): standardize identity trailers\n\nAuthored-by: deepseek/VS Code (kimi-code)",
        "--author",
        "Someone Else <someone@example.com>",
      ],
      { cwd: tempDir, stdio: "pipe", shell: false },
    );
    const sha = git("rev-parse HEAD");
    attachNote(notePayload(30, "T1", "Standardize identity trailers"), sha, { cwd: tempDir });

    const byTrailer = searchNotesMemory(tempDir, { author: "kimi-code" });
    expect(byTrailer).toHaveLength(1);
    expect(byTrailer[0].author).toBe("deepseek/VS Code (kimi-code)");

    const [entry] = searchNotesMemory(tempDir, { issue: 30, query: "identity trailers" });
    expect(entry.author).toBe("deepseek/VS Code (kimi-code)");
  });
});

describe("Git Notes JSONL Export (exportNotesJsonl)", () => {
  let tempDir: string;
  let shaInitial: string;
  let shaFirstNoted: string;
  let shaUnnoted: string;
  let shaSecondNoted: string;
  let shaLegacyNoted: string;

  function git(args: string[], dateIso?: string): string {
    const env = dateIso
      ? { ...process.env, GIT_AUTHOR_DATE: dateIso, GIT_COMMITTER_DATE: dateIso }
      : process.env;
    return execFileSync("git", args, {
      cwd: tempDir,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      env,
    }).trim();
  }

  function commitFile(file: string, content: string, message: string, dateIso: string): string {
    const target = join(tempDir, file);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, content, "utf8");
    git(["add", "-A"]);
    git(["commit", "-m", message], dateIso);
    return git(["rev-parse", "HEAD"]);
  }

  function jsonNote(issueId: number | string, subtaskId: string, title: string): string {
    return JSON.stringify({
      $schema: "https://lognexus.digital-lake.ai/schemas/git-note-v1.json",
      generator: "LogNexus",
      version: "1.4.1",
      timestamp: "2026-11-21T10:00:00Z",
      issue: { id: issueId, title: `Issue ${issueId}` },
      subtask: { id: subtaskId, title, status: "completed" },
      tier: "tier-2",
    });
  }

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lognexus-export-test-"));
    git(["init"]);
    git(["config", "user.name", "Test Runner"]);
    git(["config", "user.email", "test@example.com"]);

    shaInitial = commitFile(
      "README.md",
      "# fixture\n",
      "chore: initial fixture",
      "2026-11-20T10:00:00Z",
    );

    shaFirstNoted = commitFile(
      "src/export.ts",
      "export const v = 1;\n",
      "feat(#40/T1): implement initial exporter",
      "2026-11-20T10:01:00Z",
    );
    attachNote(jsonNote(40, "T1", "Implement initial exporter"), shaFirstNoted, { cwd: tempDir });
    git(["tag", "v0.1.0", shaFirstNoted]);

    shaUnnoted = commitFile(
      "src/unnoted.ts",
      "export const plain = true;\n",
      "chore(#40/T2): unnoted intermediate commit",
      "2026-11-20T10:02:00Z",
    );

    shaSecondNoted = commitFile(
      "src/jira.ts",
      "export const jira = true;\n",
      "fix(PROJ-12/T1): handle alphanumeric ticket",
      "2026-11-20T10:03:00Z",
    );
    attachNote(jsonNote("PROJ-12", "T1", "Handle alphanumeric ticket"), shaSecondNoted, {
      cwd: tempDir,
    });

    shaLegacyNoted = commitFile(
      "src/legacy.ts",
      "export const legacy = true;\n",
      "docs: legacy plain text note\n\nRefs #40",
      "2026-11-20T10:04:00Z",
    );
    attachNote("Reviewed-by: claude/sonnet (cursor)\nLegacy plain-text note", shaLegacyNoted, {
      cwd: tempDir,
    });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("exports noted commits in oldest-to-newest topological order and skips unnoted commits", () => {
    const result = exportNotesJsonl(tempDir);

    expect(result.count).toBe(3);
    expect(result.outputPath).toBeNull();
    expect(result.jsonl.endsWith("\n")).toBe(true);

    const lines = result.jsonl.trimEnd().split("\n");
    expect(lines).toHaveLength(3);

    const records = lines.map((line) => JSON.parse(line) as ExportedNoteRecord);
    expect(records.map((r) => r.sha)).toEqual([shaFirstNoted, shaSecondNoted, shaLegacyNoted]);
    expect(records.some((r) => r.sha === shaInitial || r.sha === shaUnnoted)).toBe(false);

    expect(records[0]).toMatchObject({
      sha: shaFirstNoted,
      subject: "feat(#40/T1): implement initial exporter",
    });
    expect(typeof records[0].timestamp).toBe("string");
    expect(records[0].timestamp).toContain("2026-11-20");
    expect(typeof records[0].note).toBe("object");
    expect((records[0].note as { issue: { id: number } }).issue.id).toBe(40);
  });

  it("preserves plain-text legacy and non-object JSON notes as trimmed strings", () => {
    const arrayCommit = commitFile(
      "src/array-note.ts",
      "export const arr = [];\n",
      "chore: json array note",
      "2026-11-20T10:05:00Z",
    );
    attachNote("  [1, 2, 3]  ", arrayCommit, { cwd: tempDir });

    const result = exportNotesJsonl(tempDir);
    const records = result.jsonl
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line) as ExportedNoteRecord);

    const legacyRecord = records.find((r) => r.sha === shaLegacyNoted);
    expect(legacyRecord?.note).toBe("Reviewed-by: claude/sonnet (cursor)\nLegacy plain-text note");

    const arrayRecord = records.find((r) => r.sha === arrayCommit);
    expect(arrayRecord?.note).toBe("[1, 2, 3]");
  });

  it("filters commits by valid since tag or SHA and rejects unsafe or missing since refs", () => {
    const byTag = exportNotesJsonl(tempDir, { since: "v0.1.0" });
    expect(byTag.count).toBe(2);
    const tagShas = byTag.jsonl
      .trimEnd()
      .split("\n")
      .map((line) => (JSON.parse(line) as ExportedNoteRecord).sha);
    expect(tagShas).toEqual([shaSecondNoted, shaLegacyNoted]);

    const bySha = exportNotesJsonl(tempDir, { since: shaSecondNoted.slice(0, 7) });
    expect(bySha.count).toBe(1);
    expect((JSON.parse(bySha.jsonl.trim()) as ExportedNoteRecord).sha).toBe(shaLegacyNoted);

    expect(() => exportNotesJsonl(tempDir, { since: "--bad" })).toThrow(/Governance violation/);
    expect(() => exportNotesJsonl(tempDir, { since: "refs/notes/lognexus" })).toThrow(
      /Governance violation/,
    );
    expect(() => exportNotesJsonl(tempDir, { since: "nonexistent-ref" })).toThrow(
      /Governance violation/,
    );
  });

  it("filters by numeric (#40, 40) and alphanumeric (PROJ-12) issue identifiers without prefix collisions", () => {
    const sha400 = commitFile(
      "src/issue400.ts",
      "export const other = 400;\n",
      "feat(#400/T1): unrelated issue mentioning 40 items",
      "2026-11-20T10:05:00Z",
    );
    attachNote(jsonNote(400, "T1", "Unrelated 400"), sha400, { cwd: tempDir });

    const byNumber = exportNotesJsonl(tempDir, { issue: "40" });
    expect(byNumber.count).toBe(2);
    const shas40 = byNumber.jsonl
      .trimEnd()
      .split("\n")
      .map((line) => (JSON.parse(line) as ExportedNoteRecord).sha);
    expect(shas40).toEqual([shaFirstNoted, shaLegacyNoted]);

    const byHash = exportNotesJsonl(tempDir, { issue: "#40" });
    expect(byHash.count).toBe(2);
    expect(byHash.jsonl).toBe(byNumber.jsonl);

    const byJira = exportNotesJsonl(tempDir, { issue: "PROJ-12" });
    expect(byJira.count).toBe(1);
    expect((JSON.parse(byJira.jsonl.trim()) as ExportedNoteRecord).sha).toBe(shaSecondNoted);
  });

  it("confines outputPath inside targetDir and rejects path traversal even with zero notes", () => {
    const nestedRel = ".lognexus/exports/notes-archive.jsonl";
    const result = exportNotesJsonl(tempDir, { outputPath: nestedRel });
    const expectedPath = resolve(tempDir, nestedRel);

    expect(result.outputPath).toBe(expectedPath);
    expect(existsSync(expectedPath)).toBe(true);
    expect(readFileSync(expectedPath, "utf8")).toBe(result.jsonl);

    expect(() => exportNotesJsonl(tempDir, { outputPath: "../outside.jsonl" })).toThrow(
      /Governance violation: Path traversal detected/,
    );

    const outsideAbsolute = resolve(tempDir, "..", "outside-abs.jsonl");
    expect(() => exportNotesJsonl(tempDir, { outputPath: outsideAbsolute })).toThrow(
      /Governance violation: Path traversal detected/,
    );

    const emptyDir = mkdtempSync(join(tmpdir(), "lognexus-export-empty-"));
    try {
      execFileSync("git", ["init"], { cwd: emptyDir, stdio: "ignore", shell: false });
      expect(() => exportNotesJsonl(emptyDir, { outputPath: "../outside.jsonl" })).toThrow(
        /Governance violation: Path traversal detected/,
      );

      const emptyOut = exportNotesJsonl(emptyDir, { outputPath: ".lognexus/empty.jsonl" });
      expect(emptyOut).toEqual({
        count: 0,
        jsonl: "",
        outputPath: resolve(emptyDir, ".lognexus/empty.jsonl"),
      });
      expect(readFileSync(emptyOut.outputPath as string, "utf8")).toBe("");
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it("handles zero matching notes and custom notes refs cleanly", () => {
    const noMatch = exportNotesJsonl(tempDir, { issue: "9999" });
    expect(noMatch).toEqual({ count: 0, jsonl: "", outputPath: null });

    attachNote('{"custom":true}', shaUnnoted, { cwd: tempDir, ref: "refs/notes/custom" });
    const custom = exportNotesJsonl(tempDir, { ref: "refs/notes/custom" });
    expect(custom.count).toBe(1);
    const parsed = JSON.parse(custom.jsonl.trim()) as ExportedNoteRecord;
    expect(parsed.sha).toBe(shaUnnoted);
    expect(parsed.note).toEqual({ custom: true });

    expect(() => exportNotesJsonl(tempDir, { ref: "--bad-ref" })).toThrow(/Governance violation/);
  });
});
