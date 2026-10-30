import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { recordTaskFinish, recordTaskStart } from "../telemetry/collector.js";
import { refreshContextHandoff } from "./handoff.js";
import {
  type ActiveIssueState,
  ActiveIssueStateSchema,
  type LognexusState,
  LognexusStateSchema,
  type SubtaskContract,
  type SubtaskState,
  SubtaskStateSchema,
} from "./schema.js";
import { inferActiveIssueFromBranch } from "./sync.js";

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

  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    return createEmptyState();
  }

  const backup = () => {
    try {
      writeFileSync(`${filePath}.bak`, raw, "utf8");
    } catch {
      // the backup is best-effort; never block state loading
    }
  };

  const warn = (path: string, message: string) => {
    process.stderr.write(
      `[WARN] .lognexus/state.json schema error at ${path || "<root>"}: ${message}\n`,
    );
  };

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    warn("<root>", "Invalid JSON");
    backup();
    return createEmptyState();
  }

  const parsed = LognexusStateSchema.safeParse(json);
  if (parsed.success) {
    return parsed.data;
  }

  for (const issue of parsed.error.issues) {
    warn(issue.path.join("."), issue.message);
  }
  backup();

  return rescueState(json);
}

function rescueState(json: unknown): LognexusState {
  const source: Record<string, unknown> =
    json !== null && typeof json === "object" && !Array.isArray(json)
      ? (json as Record<string, unknown>)
      : {};

  const rescued = createEmptyState();

  const activeIssue = ActiveIssueStateSchema.safeParse(source.activeIssue);
  if (activeIssue.success) {
    rescued.activeIssue = activeIssue.data;
  }

  const currentSubtask = SubtaskStateSchema.safeParse(source.currentSubtask);
  if (currentSubtask.success) {
    rescued.currentSubtask = currentSubtask.data;
  }

  if (Array.isArray(source.completedSubtasks)) {
    rescued.completedSubtasks = source.completedSubtasks.filter(
      (entry): entry is string => typeof entry === "string",
    );
  }

  return rescued;
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
  options?: { tier?: ActiveIssueState["tier"] },
): LognexusState {
  const state = loadState(targetDir);

  if (state.activeIssue === null) {
    state.activeIssue = inferActiveIssueFromBranch(targetDir);
  }

  if (options?.tier && state.activeIssue !== null) {
    state.activeIssue.tier = options.tier;
  }

  const subtask: SubtaskState = {
    id: taskId,
    title,
    status: "in-progress",
    contract,
  };
  state.currentSubtask = subtask;
  saveState(state, targetDir);
  recordTaskStart(taskId, targetDir);
  refreshContextHandoff(targetDir);
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

export const SUBTASK_ID_PATTERN = /^T\d+(?:-[a-zA-Z0-9]+)?$/;

const TIERS: ActiveIssueState["tier"][] = ["tier-1", "tier-2", "tier-3"];
const DECISION_BUDGETS: SubtaskContract["decisionBudget"][] = ["none", "narrow", "full"];

export interface ParsedSetTaskArgs {
  taskId: string;
  title: string;
  contract?: SubtaskContract;
  tier?: ActiveIssueState["tier"];
}

function readFlagValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for '${flag}'.`);
  }
  return value;
}

function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function parseSetTaskArgs(args: string[]): ParsedSetTaskArgs {
  const positional: string[] = [];
  let tier: ActiveIssueState["tier"] | undefined;
  let allowedFiles: string[] | undefined;
  let forbiddenFiles: string[] | undefined;
  let decisionBudget: SubtaskContract["decisionBudget"] | undefined;
  let verificationCmd: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }

    switch (arg) {
      case "--tier": {
        const value = readFlagValue(args, index, arg);
        if (!(TIERS as string[]).includes(value)) {
          throw new Error(`Invalid tier '${value}'. Expected one of: ${TIERS.join(", ")}.`);
        }
        tier = value as ActiveIssueState["tier"];
        index += 1;
        break;
      }
      case "--allowed":
      case "--forbidden": {
        const value = parseCsv(readFlagValue(args, index, arg));
        if (arg === "--allowed") {
          allowedFiles = value;
        } else {
          forbiddenFiles = value;
        }
        index += 1;
        break;
      }
      case "--budget": {
        const value = readFlagValue(args, index, arg);
        if (!(DECISION_BUDGETS as string[]).includes(value)) {
          throw new Error(
            `Invalid decision budget '${value}'. Expected one of: ${DECISION_BUDGETS.join(", ")}.`,
          );
        }
        decisionBudget = value as SubtaskContract["decisionBudget"];
        index += 1;
        break;
      }
      case "--verify": {
        verificationCmd = readFlagValue(args, index, arg);
        index += 1;
        break;
      }
      default:
        throw new Error(`Unknown flag '${arg}'.`);
    }
  }

  const [taskId, ...titleTokens] = positional;
  if (!taskId) {
    throw new Error("Subtask ID is required (e.g. lognexus state set-task T1 'Add schema').");
  }
  if (!SUBTASK_ID_PATTERN.test(taskId)) {
    throw new Error(`Invalid subtask ID '${taskId}'. Expected a format like T1 or T1-v2.`);
  }

  const contract: SubtaskContract | undefined =
    allowedFiles !== undefined ||
    forbiddenFiles !== undefined ||
    decisionBudget !== undefined ||
    verificationCmd !== undefined
      ? {
          allowedFiles: allowedFiles ?? [],
          forbiddenFiles: forbiddenFiles ?? [],
          decisionBudget: decisionBudget ?? "none",
          verificationCmd,
        }
      : undefined;

  return {
    taskId,
    title: titleTokens.join(" "),
    contract,
    tier,
  };
}
