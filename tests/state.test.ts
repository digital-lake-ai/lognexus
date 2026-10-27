import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearState,
  createEmptyState,
  finishSubtask,
  loadState,
  parseSetTaskArgs,
  saveState,
  setSubtask,
} from "../src/state/manager.js";
import { LognexusStateSchema } from "../src/state/schema.js";
import { inferActiveIssueFromBranch } from "../src/state/sync.js";

describe("State Manager & Schema", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lognexus-state-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("createEmptyState produces a valid LognexusState schema", () => {
    const empty = createEmptyState();
    const parsed = LognexusStateSchema.safeParse(empty);
    expect(parsed.success).toBe(true);
    expect(empty.schemaVersion).toBe("1.0.0");
    expect(empty.activeIssue).toBeNull();
    expect(empty.currentSubtask).toBeNull();
    expect(empty.completedSubtasks).toEqual([]);
  });

  it("loads empty state when state.json does not exist", () => {
    const state = loadState(tempDir);
    expect(state.activeIssue).toBeNull();
    expect(state.completedSubtasks).toHaveLength(0);
  });

  it("saves and reloads state successfully", () => {
    const state = createEmptyState();
    state.activeIssue = {
      id: 42,
      title: "Test Feature",
      branch: "issue/42-test-feature",
      phase: "commit",
      tier: "tier-3",
      readiness: "ready",
    };

    saveState(state, tempDir);

    const statePath = join(tempDir, ".lognexus", "state.json");
    expect(existsSync(statePath)).toBe(true);

    const reloaded = loadState(tempDir);
    expect(reloaded.activeIssue).not.toBeNull();
    expect(reloaded.activeIssue?.id).toBe(42);
    expect(reloaded.activeIssue?.title).toBe("Test Feature");
  });

  it("setSubtask updates active subtask and persists contract", () => {
    setSubtask(
      "T1",
      "Scaffold types",
      {
        allowedFiles: ["src/types.ts"],
        forbiddenFiles: ["package.json"],
        decisionBudget: "none",
        verificationCmd: "npm test",
      },
      tempDir,
    );

    const state = loadState(tempDir);
    expect(state.currentSubtask).not.toBeNull();
    expect(state.currentSubtask?.id).toBe("T1");
    expect(state.currentSubtask?.title).toBe("Scaffold types");
    expect(state.currentSubtask?.status).toBe("in-progress");
    expect(state.currentSubtask?.contract?.decisionBudget).toBe("none");
    expect(state.currentSubtask?.contract?.allowedFiles).toEqual(["src/types.ts"]);
  });

  it("finishSubtask moves subtask to completed list and marks currentSubtask status as completed", () => {
    setSubtask("T1", "Task 1", undefined, tempDir);
    finishSubtask("T1", tempDir);

    const state = loadState(tempDir);
    expect(state.currentSubtask).not.toBeNull();
    expect(state.currentSubtask?.id).toBe("T1");
    expect(state.currentSubtask?.status).toBe("completed");
    expect(state.completedSubtasks).toContain("T1");
  });

  it("clearState resets state to empty", () => {
    setSubtask("T1", "Task 1", undefined, tempDir);
    clearState(tempDir);

    const state = loadState(tempDir);
    expect(state.activeIssue).toBeNull();
    expect(state.currentSubtask).toBeNull();
    expect(state.completedSubtasks).toHaveLength(0);
  });

  it("accepts the 'execute' phase in the active issue schema", () => {
    const state = createEmptyState();
    state.activeIssue = {
      id: 24,
      title: "Field telemetry",
      branch: "issue/24-field-telemetry-and-state-hardening",
      phase: "execute",
      tier: "tier-3",
      readiness: "ready",
    };

    saveState(state, tempDir);
    expect(loadState(tempDir).activeIssue?.phase).toBe("execute");
  });

  it("hoists contract fields declared at the subtask root into contract", () => {
    mkdirSync(join(tempDir, ".lognexus"), { recursive: true });
    writeFileSync(
      join(tempDir, ".lognexus", "state.json"),
      JSON.stringify({
        schemaVersion: "1.0.0",
        activeIssue: null,
        currentSubtask: {
          id: "T1",
          title: "Root-level contract",
          status: "in-progress",
          allowedFiles: ["src/a.ts"],
          forbiddenFiles: ["package.json"],
          decisionBudget: "narrow",
          verificationCmd: "npm test",
        },
        completedSubtasks: [],
      }),
      "utf8",
    );

    const state = loadState(tempDir);
    expect(state.currentSubtask?.contract?.allowedFiles).toEqual(["src/a.ts"]);
    expect(state.currentSubtask?.contract?.forbiddenFiles).toEqual(["package.json"]);
    expect(state.currentSubtask?.contract?.decisionBudget).toBe("narrow");
    expect(state.currentSubtask?.contract?.verificationCmd).toBe("npm test");
    expect((state.currentSubtask as Record<string, unknown>).allowedFiles).toBeUndefined();
  });

  it("loadState rescues valid blocks, warns on stderr and writes a backup on schema errors", () => {
    mkdirSync(join(tempDir, ".lognexus"), { recursive: true });
    const badPayload = JSON.stringify({
      schemaVersion: "1.0.0",
      activeIssue: {
        id: 24,
        title: "Field telemetry",
        branch: "issue/24-field-telemetry-and-state-hardening",
        phase: "not-a-phase",
        tier: "tier-3",
        readiness: "ready",
      },
      currentSubtask: { id: "T2", title: "Second", status: "in-progress" },
      completedSubtasks: ["T1", 42],
    });
    writeFileSync(join(tempDir, ".lognexus", "state.json"), badPayload, "utf8");

    const warnings: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      warnings.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    let state: ReturnType<typeof loadState>;
    try {
      state = loadState(tempDir);
    } finally {
      process.stderr.write = originalWrite;
    }

    expect(warnings.some((w) => w.includes("[WARN] .lognexus/state.json schema error at"))).toBe(
      true,
    );
    expect(existsSync(join(tempDir, ".lognexus", "state.json.bak"))).toBe(true);

    expect(state.activeIssue).toBeNull();
    expect(state.currentSubtask?.id).toBe("T2");
    expect(state.completedSubtasks).toEqual(["T1"]);
  });

  it("loadState reports invalid JSON and preserves history through the backup", () => {
    mkdirSync(join(tempDir, ".lognexus"), { recursive: true });
    writeFileSync(join(tempDir, ".lognexus", "state.json"), "{ not json", "utf8");

    const warnings: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      warnings.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    let state: ReturnType<typeof loadState>;
    try {
      state = loadState(tempDir);
    } finally {
      process.stderr.write = originalWrite;
    }

    expect(warnings.join("")).toContain(
      "[WARN] .lognexus/state.json schema error at <root>: Invalid JSON",
    );
    expect(existsSync(join(tempDir, ".lognexus", "state.json.bak"))).toBe(true);
    expect(state.completedSubtasks).toEqual([]);
  });

  it("setSubtask infers the active issue from the current branch and applies the tier", () => {
    execSync("git init", { cwd: tempDir, stdio: "ignore" });
    execSync('git config user.email "test@example.com"', { cwd: tempDir, stdio: "ignore" });
    execSync('git config user.name "Test Runner"', { cwd: tempDir, stdio: "ignore" });
    execSync("git checkout -b issue/24-field-telemetry-and-state-hardening", {
      cwd: tempDir,
      stdio: "ignore",
    });

    setSubtask("T1", "Hardening", undefined, tempDir, { tier: "tier-2" });

    const state = loadState(tempDir);
    expect(state.activeIssue).not.toBeNull();
    expect(state.activeIssue?.id).toBe(24);
    expect(state.activeIssue?.branch).toBe("issue/24-field-telemetry-and-state-hardening");
    expect(state.activeIssue?.title).toBe("field telemetry and state hardening");
    expect(state.activeIssue?.phase).toBe("execute");
    expect(state.activeIssue?.tier).toBe("tier-2");
  });
});

describe("inferActiveIssueFromBranch", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), "lognexus-infer-test-"));
    execSync("git init", { cwd: repoDir, stdio: "ignore" });
    execSync('git config user.email "test@example.com"', { cwd: repoDir, stdio: "ignore" });
    execSync('git config user.name "Test Runner"', { cwd: repoDir, stdio: "ignore" });
    writeFileSync(join(repoDir, "a.txt"), "a", "utf8");
    execSync("git add a.txt", { cwd: repoDir, stdio: "ignore" });
    execSync('git commit -m "init"', { cwd: repoDir, stdio: "ignore" });
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("infers the active issue from a scoped branch", () => {
    execSync("git checkout -b issue/24-field-telemetry-and-state-hardening", {
      cwd: repoDir,
      stdio: "ignore",
    });

    expect(inferActiveIssueFromBranch(repoDir)).toEqual({
      id: 24,
      title: "field telemetry and state hardening",
      branch: "issue/24-field-telemetry-and-state-hardening",
      phase: "execute",
      tier: "tier-3",
      readiness: "ready",
    });
  });

  it("infers the security lane too", () => {
    execSync("git checkout -b security/7-supply-chain-hardening", {
      cwd: repoDir,
      stdio: "ignore",
    });

    const issue = inferActiveIssueFromBranch(repoDir);
    expect(issue?.id).toBe(7);
    expect(issue?.title).toBe("supply chain hardening");
  });

  it("returns null on main, master or an unscoped branch", () => {
    execSync("git checkout -B master", { cwd: repoDir, stdio: "ignore" });
    expect(inferActiveIssueFromBranch(repoDir)).toBeNull();

    execSync("git checkout -b main", { cwd: repoDir, stdio: "ignore" });
    expect(inferActiveIssueFromBranch(repoDir)).toBeNull();

    execSync("git checkout -b feature/loose-work", { cwd: repoDir, stdio: "ignore" });
    expect(inferActiveIssueFromBranch(repoDir)).toBeNull();
  });
});

describe("parseSetTaskArgs", () => {
  it("parses the task id and a plain title", () => {
    expect(parseSetTaskArgs(["T1", "Add", "schema"])).toEqual({
      taskId: "T1",
      title: "Add schema",
      contract: undefined,
      tier: undefined,
    });
  });

  it("parses contract flags and the tier", () => {
    const parsed = parseSetTaskArgs([
      "T0-v2",
      "Hardening",
      "work",
      "--tier",
      "tier-2",
      "--allowed",
      "src/a.ts, src/b.ts",
      "--forbidden",
      "package.json",
      "--budget",
      "narrow",
      "--verify",
      "npm test",
    ]);

    expect(parsed.taskId).toBe("T0-v2");
    expect(parsed.title).toBe("Hardening work");
    expect(parsed.tier).toBe("tier-2");
    expect(parsed.contract).toEqual({
      allowedFiles: ["src/a.ts", "src/b.ts"],
      forbiddenFiles: ["package.json"],
      decisionBudget: "narrow",
      verificationCmd: "npm test",
    });
  });

  it("leaves the contract undefined when no contract flags are given", () => {
    expect(parseSetTaskArgs(["T3"]).contract).toBeUndefined();
    expect(parseSetTaskArgs(["T3"]).title).toBe("");
  });

  it("rejects an invalid subtask id", () => {
    expect(() => parseSetTaskArgs(["X1"])).toThrow(/Invalid subtask ID/);
  });

  it("rejects invalid tier and budget values", () => {
    expect(() => parseSetTaskArgs(["T1", "--tier", "tier-9"])).toThrow(/Invalid tier/);
    expect(() => parseSetTaskArgs(["T1", "--budget", "unbounded"])).toThrow(
      /Invalid decision budget/,
    );
  });
});
