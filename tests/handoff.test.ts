import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { attachNote } from "../src/notes/notes.js";
import {
  AUDITOR_IDENTITY,
  generateContextHandoff,
  getHandoffPath,
  IMPLEMENTER_IDENTITY,
  renderContextHandoff,
  writeContextHandoffFile,
} from "../src/state/handoff.js";
import { saveState, setSubtask } from "../src/state/manager.js";

function git(args: string, cwd: string): string {
  return execSync(`git ${args}`, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
}

describe("Context Handoff Generator", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lognexus-handoff-test-"));
    git("init -q", tempDir);
    git("config user.email handoff@example.com", tempDir);
    git("config user.name Handoff", tempDir);
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "handoff-fixture", version: "1.3.0" }),
      "utf8",
    );
    git("add -A", tempDir);
    git('commit -q -m "chore: initial fixture"', tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function seedState(): void {
    saveState(
      {
        schemaVersion: "1.0.0",
        activeIssue: {
          id: 30,
          title: "v1.3.0 handoff, drift recall and update gate",
          branch: "issue/30-v1-3-0-handoff-drift-recall-and-update-gate",
          phase: "execute",
          tier: "tier-3",
          readiness: "ready",
        },
        currentSubtask: null,
        completedSubtasks: [],
        lastSync: new Date().toISOString(),
      },
      tempDir,
    );
  }

  it("returns a null issue/contract handoff for an uninitialized repository", () => {
    const handoff = generateContextHandoff(tempDir);

    expect(handoff.issue).toBeNull();
    expect(handoff.contract).toBeNull();
    expect(handoff.completedSubtasks).toEqual([]);
    expect(handoff.version).toBe("1.3.0");
    expect(handoff.nextAction).toContain(AUDITOR_IDENTITY);
  });

  it("captures the active issue, version and subtask contract", () => {
    seedState();
    setSubtask(
      "T3",
      "Implement automated context handoff generator",
      {
        allowedFiles: ["src/state/handoff.ts", "src/cli.ts"],
        forbiddenFiles: ["src/mcp/tools.ts"],
        decisionBudget: "narrow",
        verificationCmd: "npm test",
      },
      tempDir,
      { tier: "tier-3" },
    );

    const handoff = generateContextHandoff(tempDir);

    expect(handoff.issue?.id).toBe(30);
    expect(handoff.issue?.branch).toBe("issue/30-v1-3-0-handoff-drift-recall-and-update-gate");
    expect(handoff.version).toBe("1.3.0");
    expect(handoff.contract).toEqual({
      id: "T3",
      title: "Implement automated context handoff generator",
      tier: "tier-3",
      decisionBudget: "narrow",
      allowedFiles: ["src/state/handoff.ts", "src/cli.ts"],
    });
    expect(handoff.nextAction).toBe(`Implementer: ${IMPLEMENTER_IDENTITY}`);
  });

  it("switches the next action to the auditor once the subtask is completed", () => {
    seedState();
    setSubtask("T3", "Implement handoff", undefined, tempDir);

    const completedState = generateContextHandoff(tempDir);
    expect(completedState.nextAction).toContain("Implementer");

    const current = JSON.parse(readFileSync(join(tempDir, ".lognexus", "state.json"), "utf8"));
    current.currentSubtask.status = "completed";
    writeFileSync(
      join(tempDir, ".lognexus", "state.json"),
      JSON.stringify(current, null, 2),
      "utf8",
    );

    const handoff = generateContextHandoff(tempDir);
    expect(handoff.nextAction).toBe(
      `Cross-Model Auditor: ${AUDITOR_IDENTITY} under supervision of Gemini 4 Argon`,
    );
  });

  it("flags unauthorized working-tree files as scope drift", () => {
    seedState();
    setSubtask("T3", "Implement handoff", { allowedFiles: ["src/cli.ts"] }, tempDir);

    writeFileSync(join(tempDir, "rogue.ts"), "export const rogue = 1;\n", "utf8");

    const drifted = generateContextHandoff(tempDir);
    expect(drifted.scopeDrift.detected).toBe(true);
    expect(drifted.scopeDrift.unauthorizedFiles).toContain("rogue.ts");

    rmSync(join(tempDir, "rogue.ts"));
    const clean = generateContextHandoff(tempDir);
    expect(clean.scopeDrift.detected).toBe(false);
    expect(clean.scopeDrift.unauthorizedFiles).toEqual([]);
  });

  it("ignores .lognexus artifacts when evaluating scope drift", () => {
    seedState();
    setSubtask("T3", "Implement handoff", { allowedFiles: [] }, tempDir);

    const handoff = generateContextHandoff(tempDir);
    expect(handoff.scopeDrift.detected).toBe(false);
  });

  it("resolves completed subtasks with SHA, author and Git Note summary", () => {
    seedState();
    setSubtask("T1", "Handoff subtask", { allowedFiles: [], decisionBudget: "none" }, tempDir);

    writeFileSync(join(tempDir, "t1.txt"), "t1\n", "utf8");
    git("add -A", tempDir);
    git(
      'commit -q -m "feat(#30/T1): standardize VS Code identity" --author "deepseek/VS Code <ds@example.com>"',
      tempDir,
    );

    const sha = git("rev-parse HEAD", tempDir);
    attachNote(
      JSON.stringify({
        generator: "LogNexus",
        subtask: { id: "T1", title: "Standardized identity trailers" },
      }),
      sha,
      { cwd: tempDir },
    );

    const completed = JSON.parse(readFileSync(join(tempDir, ".lognexus", "state.json"), "utf8"));
    completed.completedSubtasks = ["T1"];
    writeFileSync(
      join(tempDir, ".lognexus", "state.json"),
      JSON.stringify(completed, null, 2),
      "utf8",
    );

    const handoff = generateContextHandoff(tempDir);
    expect(handoff.completedSubtasks).toHaveLength(1);

    const [entry] = handoff.completedSubtasks;
    expect(entry.id).toBe("T1");
    expect(entry.sha).toBe(sha);
    expect(entry.shortSha).toHaveLength(7);
    expect(entry.author).toBe("deepseek/VS Code");
    expect(entry.summary).toContain("standardize VS Code identity");
    expect(entry.title).toBe("Standardized identity trailers");
  });

  it("renders a markdown report with every required section", () => {
    seedState();
    setSubtask(
      "T3",
      "Implement handoff",
      { allowedFiles: ["src/cli.ts"], decisionBudget: "narrow" },
      tempDir,
    );

    const markdown = renderContextHandoff(generateContextHandoff(tempDir));

    expect(markdown).toContain("# LogNexus Context Handoff");
    expect(markdown).toContain("## Cycle State");
    expect(markdown).toContain("## Active Subtask Contract");
    expect(markdown).toContain("## Live Scope-Drift Guard");
    expect(markdown).toContain("## Completed Subtasks");
    expect(markdown).toContain("## Next Required Action");
    expect(markdown).toContain("`src/cli.ts`");
    expect(markdown).toContain(IMPLEMENTER_IDENTITY);
  });

  it("writes .lognexus/handoff.md and reloads it from disk", () => {
    seedState();
    setSubtask("T3", "Implement handoff", { allowedFiles: [], decisionBudget: "narrow" }, tempDir);

    const handoff = writeContextHandoffFile(tempDir);
    const filePath = getHandoffPath(tempDir);

    expect(existsSync(filePath)).toBe(true);
    const written = readFileSync(filePath, "utf8");
    expect(written).toBe(renderContextHandoff(handoff));
    expect(written).toContain("## Next Required Action");
  });
});
