import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { recordTaskFinish, recordTaskStart } from "../telemetry/collector.js";
import {
  type LognexusState,
  LognexusStateSchema,
  type SubtaskContract,
  type SubtaskState,
} from "./schema.js";

export function getStatePath(targetDir: string = process.cwd()): string {
  return join(targetDir, ".lognexus", "state.json");
}

export function createEmptyState(): LognexusState {
  return {
    schemaVersion: "1.0.0",
    activeIssue: null,
    currentSubtask: null,
    completedSubtasks: [],
    lastSync: new Date().toISOString(),
  };
}

export function loadState(targetDir: string = process.cwd()): LognexusState {
  const filePath = getStatePath(targetDir);

  if (!existsSync(filePath)) {
    return createEmptyState();
  }

  try {
    const raw = readFileSync(filePath, "utf8");
    const json = JSON.parse(raw);
    const parsed = LognexusStateSchema.safeParse(json);
    if (parsed.success) {
      return parsed.data;
    }
    return createEmptyState();
  } catch {
    return createEmptyState();
  }
}

export function saveState(state: LognexusState, targetDir: string = process.cwd()): void {
  const dirPath = join(targetDir, ".lognexus");
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }

  state.lastSync = new Date().toISOString();
  const validated = LognexusStateSchema.parse(state);
  const filePath = getStatePath(targetDir);
  writeFileSync(filePath, JSON.stringify(validated, null, 2), "utf8");
}

export function clearState(targetDir: string = process.cwd()): LognexusState {
  const empty = createEmptyState();
  saveState(empty, targetDir);
  return empty;
}

export function setSubtask(
  taskId: string,
  title: string = "",
  contract?: SubtaskContract,
  targetDir: string = process.cwd(),
): LognexusState {
  const state = loadState(targetDir);
  const subtask: SubtaskState = {
    id: taskId,
    title,
    status: "in-progress",
    contract,
  };
  state.currentSubtask = subtask;
  saveState(state, targetDir);
  recordTaskStart(taskId, targetDir);
  return state;
}

export function finishSubtask(taskId: string, targetDir: string = process.cwd()): LognexusState {
  const state = loadState(targetDir);
  if (!state.completedSubtasks.includes(taskId)) {
    state.completedSubtasks.push(taskId);
  }
  if (state.currentSubtask?.id === taskId) {
    state.currentSubtask.status = "completed";
  } else if (!state.currentSubtask) {
    state.currentSubtask = {
      id: taskId,
      title: "",
      status: "completed",
    };
  }
  saveState(state, targetDir);
  recordTaskFinish(taskId, targetDir);
  return state;
}
