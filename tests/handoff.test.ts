import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { attachNote } from "../src/notes/notes.js";
import {
  AUDITOR_IDENTITY,
  CONTEXT_MAX_FILES,
  CONTEXT_MAX_LOC,
  discoverPlanFile,
  evaluateContextBudget,
  generateContextHandoff,
  getHandoffPath,
  IMPLEMENTER_IDENTITY,
  renderCompactDispatchPrompt,
  renderContextHandoff,
  writeContextHandoffFile,
} from "../src/state/handoff.js";
import { saveState, setSubtask } from "../src/state/manager.js";

function git(args: string, cwd: string): string {
  return execSync(`git ${args}`, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
}

function gitArgs(args: string[], cwd: string): void {
  execFileSync("git", args, { cwd, stdio: "ignore", shell: false });
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

  it("releases the contract and drift tracking once the subtask is completed", () => {
    seedState();
    setSubtask(
      "T4",
      "Bump atomic version contract",
      { allowedFiles: ["package.json"], decisionBudget: "narrow" },
      tempDir,
    );

    const current = JSON.parse(readFileSync(join(tempDir, ".lognexus", "state.json"), "utf8"));
    current.currentSubtask.status = "completed";
    writeFileSync(
      join(tempDir, ".lognexus", "state.json"),
      JSON.stringify(current, null, 2),
      "utf8",
    );

    const handoff = generateContextHandoff(tempDir);
    // A completed subtask holds no scope: neither the contract nor an allowed-file list.
    expect(handoff.contract).toBeNull();
    expect(handoff.scopeDrift).toEqual({ detected: false, unauthorizedFiles: [] });
  });

  it("prefers the Authored-by trailer and the active issue when resolving completed subtasks", () => {
    seedState();

    writeFileSync(join(tempDir, "t1.txt"), "t1\n", "utf8");
    gitArgs(["add", "-A"], tempDir);
    gitArgs(
      ["commit", "-q", "-m", "feat(#26/T1): stale external subtask", "--author", "gemini <g@x.io>"],
      tempDir,
    );

    writeFileSync(join(tempDir, "t1-scoped.txt"), "scoped\n", "utf8");
    gitArgs(["add", "-A"], tempDir);
    gitArgs(
      [
        "commit",
        "-q",
        "-m",
        "feat(#30/T1): scoped subtask\n\nAuthored-by: deepseek/VS Code (kimi-code)",
        "--author",
        "Someone Else <someone@example.com>",
      ],
      tempDir,
    );
    const scopedSha = git("rev-parse HEAD", tempDir);

    const current = JSON.parse(readFileSync(join(tempDir, ".lognexus", "state.json"), "utf8"));
    current.completedSubtasks = ["T1"];
    writeFileSync(
      join(tempDir, ".lognexus", "state.json"),
      JSON.stringify(current, null, 2),
      "utf8",
    );

    const [entry] = generateContextHandoff(tempDir).completedSubtasks;
    expect(entry.sha).toBe(scopedSha);
    expect(entry.author).toBe("deepseek/VS Code (kimi-code)");
    expect(entry.summary).toContain("#30/T1");
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

  it("renders a compact dispatch prompt referencing the handoff and the implementer identity", () => {
    seedState();
    setSubtask("T3", "Implement handoff", { allowedFiles: [], decisionBudget: "narrow" }, tempDir);

    const prompt = renderCompactDispatchPrompt(generateContextHandoff(tempDir));
    const lines = prompt.split("\n");

    expect(lines.length).toBeLessThanOrEqual(12);
    expect(prompt).toContain(IMPLEMENTER_IDENTITY);
    expect(prompt).toContain(".lognexus/handoff.md");
    expect(prompt).toContain("Issue #30");
    expect(prompt).toContain("src/mcp/tools.ts");
  });

  it("reports the plan file next to the cycle state", () => {
    seedState();
    const planPath = join(tempDir, "docs", "contexto");
    mkdirSync(planPath, { recursive: true });
    writeFileSync(join(planPath, "issue-30-plan.md"), "# plan\n", "utf8");

    const handoff = generateContextHandoff(tempDir);

    expect(handoff.planFile).toBe("docs/contexto/issue-30-plan.md");
    expect(discoverPlanFile(30, tempDir)).toBe("docs/contexto/issue-30-plan.md");
    expect(renderContextHandoff(handoff)).toContain(
      "- **Plan file:** `docs/contexto/issue-30-plan.md`",
    );
  });

  it("falls back to git log when completedSubtasks is empty", () => {
    seedState();
    git('commit -q --allow-empty -m "feat(#30/T1): first slice"', tempDir);
    git('commit -q --allow-empty -m "feat(#30/T2): second slice"', tempDir);

    const handoff = generateContextHandoff(tempDir);

    expect(handoff.completedSubtasks.map((entry) => entry.id)).toEqual(["T1", "T2"]);
  });

  it("keeps the context budget inside bounds for a small contract", () => {
    seedState();
    setSubtask(
      "T3",
      "Implement handoff",
      { allowedFiles: ["src/state/handoff.ts", "docs/plan.md"], decisionBudget: "narrow" },
      tempDir,
    );
    writeFileSync(join(tempDir, "src.ts"), "const a = 1;\n", "utf8");

    const budget = evaluateContextBudget(tempDir);

    expect(budget.fileCount).toBe(1);
    expect(budget.exceeded).toBe(false);
    expect(budget.recommendation).toBeNull();
    expect(budget.maxFiles).toBe(CONTEXT_MAX_FILES);
    expect(budget.maxLines).toBe(CONTEXT_MAX_LOC);
  });

  it("flags an oversized contract with a delegation recommendation", () => {
    seedState();
    const files = Array.from({ length: CONTEXT_MAX_FILES + 1 }, (_, i) => `src/mod-${i}.ts`);
    setSubtask("T3", "Wide contract", { allowedFiles: files, decisionBudget: "full" }, tempDir);

    const handoff = generateContextHandoff(tempDir);

    expect(handoff.contextBudget?.exceeded).toBe(true);
    expect(handoff.contextBudget?.fileCount).toBe(files.length);
    expect(handoff.contextBudget?.recommendation).toContain("subagent");
    expect(renderContextHandoff(handoff)).toContain("[WARN]");
  });
});
