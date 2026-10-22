import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearState,
  createEmptyState,
  finishSubtask,
  loadState,
  saveState,
  setSubtask,
} from "../src/state/manager.js";
import { LognexusStateSchema } from "../src/state/schema.js";

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
});
