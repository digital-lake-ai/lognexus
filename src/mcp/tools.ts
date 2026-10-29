import { auditBranch, formatAuditResult } from "../audit/audit.js";
import { executeAtomicCommit } from "../commit.js";
import { detectBaseBranch } from "../git/safe.js";
import { attachCurrentStateToCommit } from "../notes/attach.js";
import { getNote } from "../notes/notes.js";
import { clearState, finishSubtask, loadState, setSubtask } from "../state/manager.js";
import type { ActiveIssueState, SubtaskContract } from "../state/schema.js";
import { syncStateFromGit } from "../state/sync.js";
import { getProjectStatus } from "../status.js";
import {
  buildAnonymousCommunityPayload,
  clearTelemetry,
  disableTelemetry,
  enableTelemetry,
  isTelemetryGloballyDisabled,
  loadTelemetry,
} from "../telemetry/collector.js";
import { generateTelemetryReportFile } from "../telemetry/report.js";
import { getJourneyTimeline } from "../timeline/timeline.js";

export const MCP_SERVER_NAME = "lognexus";

const TIER_VALUES: readonly string[] = ["tier-1", "tier-2", "tier-3"];
const DECISION_BUDGET_VALUES: readonly string[] = ["none", "narrow", "full"];

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    examples?: Record<string, unknown>[];
  };
}

export interface ToolTextContent {
  type: "text";
  text: string;
}

export interface ToolCallResult {
  content: ToolTextContent[];
  isError?: boolean;
}

export class McpToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpToolError";
  }
}

const TIER_DESCRIPTION = "Operational routing tier ('tier-1', 'tier-2', 'tier-3').";

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "lognexus_status",
    title: "LogNexus Status: Inspect workspace and Git branch state",
    description:
      "Inspect the current Git branch, whether the directory is a Git repository, the active issue, the routing mode and the recommended model tier. Use when you need a cheap read-only snapshot before choosing a branch, a tier, or a next action. Not for reading the subtask contract (use lognexus_state_get) or for refreshing the state from Git and GitHub (use lognexus_state_sync).",
    inputSchema: {
      type: "object",
      properties: {},
      examples: [{}],
    },
  },
  {
    name: "lognexus_state_get",
    title: "LogNexus State: Get persistent session state",
    description:
      "Return the persistent LogNexus agent state (.lognexus/state.json) as stored on disk: active issue, current subtask and its file contract, completed subtasks and last synchronization timestamp. Use when you need the current contract or completion list and nothing has changed the branch since the last sync. Not for validating the state against the Git branch or GitHub (use lognexus_state_sync), and not for starting or finishing subtasks (use lognexus_state_set_task or lognexus_state_finish_task).",
    inputSchema: {
      type: "object",
      properties: {},
      examples: [{}],
    },
  },
  {
    name: "lognexus_state_sync",
    title: "LogNexus State: Synchronize state from Git branch and GitHub",
    description:
      "Reconcile the persistent state with the current Git branch and GitHub metadata, rewriting .lognexus/state.json and returning the updated state. Use when you just checked out a branch, rebased, opened a PR, or suspect the stored state is stale. Not for a plain read of what is already on disk (use lognexus_state_get); sync mutates the store and runs git and gh.",
    inputSchema: {
      type: "object",
      properties: {},
      examples: [{}],
    },
  },
  {
    name: "lognexus_state_set_task",
    title: "LogNexus State: Set active subtask and file contract",
    description:
      "Mark a subtask as in progress and persist its closed delegation contract (allowed files, forbidden files, decision budget, verification command) plus the active issue tier. Equivalent to 'lognexus state set-task <id> [title]'. Use when you begin a new subtask and need the file scope enforced by the commit engine and the audit. Not for marking a subtask complete (use lognexus_state_finish_task) and not for reading the contract (use lognexus_state_get).",
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "Subtask identifier, e.g. 'T1'.",
        },
        title: {
          type: "string",
          description: "Optional human-readable subtask title.",
        },
        tier: {
          type: "string",
          enum: ["tier-1", "tier-2", "tier-3"],
          description: TIER_DESCRIPTION,
        },
        allowedFiles: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of files the subtask may modify.",
        },
        forbiddenFiles: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of files the subtask must not modify.",
        },
        decisionBudget: {
          type: "string",
          enum: ["none", "narrow", "full"],
          description: "Optional decision budget for the subtask contract.",
        },
        verificationCmd: {
          type: "string",
          description: "Optional verification command for the subtask contract.",
        },
      },
      required: ["taskId"],
      examples: [
        {
          taskId: "T1",
          title: "Remove dead telemetry dispatch",
          tier: "tier-3",
          allowedFiles: ["src/telemetry/collector.ts"],
          forbiddenFiles: ["package.json"],
          decisionBudget: "none",
          verificationCmd: "npm test",
        },
      ],
    },
  },
  {
    name: "lognexus_state_finish_task",
    title: "LogNexus State: Finish subtask and mark completed",
    description:
      "Mark a subtask as completed in the persistent state and return the updated state. Equivalent to 'lognexus state finish-task <id>'. Use when the subtask work has already been committed and its Git Note attached. Not for creating the commit itself (use lognexus_commit with finishTask: true, which finishes the task atomically) and not for editing the contract (use lognexus_state_set_task).",
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "Subtask identifier, e.g. 'T1'.",
        },
      },
      required: ["taskId"],
      examples: [{ taskId: "T1" }],
    },
  },
  {
    name: "lognexus_state_clear",
    title: "LogNexus State: Clear session state",
    description:
      "Reset the persistent LogNexus agent state to empty. Equivalent to 'lognexus state clear'. Use when abandoning an issue, switching to an unrelated task, or recovering from a corrupted state file. Not for finishing a single subtask (use lognexus_state_finish_task); clearing is destructive and drops the whole contract.",
    inputSchema: {
      type: "object",
      properties: {},
      examples: [{}],
    },
  },
  {
    name: "lognexus_commit",
    title: "LogNexus Commit: Atomic commit with Git Note and review gate",
    description:
      "Atomically create a Git commit with conventional commit format, authorship trailers, subtask file contract validation, optional task finishing, and Git Note attachment in a single operation. Use when creating any commit on a LogNexus branch, including the atomic subtask commits that close a Tn. Not for retro-attaching a note to a commit that already exists (use lognexus_note_attach), and not for bypassing the gate: the commit engine refuses to run on a protected branch and rejects files outside the contract.",
    inputSchema: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description:
            "Conventional commit message, e.g. 'feat(#15/T1): add atomic commit CLI and tool'.",
        },
        author: {
          type: "string",
          description: "Author trailer identity, e.g. 'gemini/flash (antigravity)'.",
        },
        reviewer: {
          type: "string",
          description: "Optional reviewer trailer identity, e.g. 'gemini/pro (review-gate)'.",
        },
        finishTask: {
          type: "boolean",
          description: "If true, marks the active subtask as completed in the persistent state.",
        },
        allowEmpty: {
          type: "boolean",
          description: "If true, allows creating an empty commit.",
        },
        tier: {
          type: "string",
          enum: TIER_VALUES,
          description: TIER_DESCRIPTION,
        },
        escalated: {
          type: "boolean",
          description:
            "If true, acknowledges a tier-1 author working on a tier-3 subtask (records 'escalated: true' in the Git Note).",
        },
      },
      required: ["message"],
      examples: [
        {
          message: "feat(#26/T3): normalize MCP tool titles and schema examples",
          author: "deepseek/chat (kimi-code)",
          finishTask: true,
        },
      ],
    },
  },
  {
    name: "lognexus_note_show",
    title: "LogNexus Note: Show Git Note attached to commit",
    description:
      "Read the LogNexus Git Note (refs/notes/lognexus) attached to a commit and return its parsed JSON payload. Defaults to HEAD. Use when verifying that a commit carries the expected tier, subtask and contract before a review or a merge. Not for creating or repairing notes (use lognexus_note_attach).",
    inputSchema: {
      type: "object",
      properties: {
        commitRef: {
          type: "string",
          description: "Git commit reference (SHA, branch, tag or HEAD). Defaults to HEAD.",
        },
      },
      examples: [{ commitRef: "HEAD" }],
    },
  },
  {
    name: "lognexus_note_attach",
    title: "LogNexus Note: Attach state as Git Note to commit",
    description:
      "Attach the current LogNexus state as a Git Note (refs/notes/lognexus) to a commit that already exists. Defaults to HEAD. Use when backfilling manually on commits created outside the commit engine, or repairing a missing note. Not for normal commits: lognexus_commit already attaches the note as part of the atomic operation, so attaching again is only needed when the note was lost.",
    inputSchema: {
      type: "object",
      properties: {
        commitRef: {
          type: "string",
          description: "Git commit reference (SHA, branch, tag or HEAD). Defaults to HEAD.",
        },
      },
      examples: [{ commitRef: "HEAD" }],
    },
  },
  {
    name: "lognexus_timeline",
    title: "LogNexus Timeline: Generate PR Journey Timeline",
    description:
      "Reconstruct the branch Journey Timeline against a base branch: commit list enriched with Git Notes, subtask IDs, tiers and Authored-by/Reviewed-by trailers, rendered as a Markdown table, JSON or a PR body draft. Use when preparing a pull request description or reviewing the subtask sequence of a branch. Not for judging compliance (use lognexus_audit, which reports violations rather than a narrative).",
    inputSchema: {
      type: "object",
      properties: {
        baseBranch: {
          type: "string",
          description: "Base branch to compare against. Defaults to 'main' with origin fallback.",
        },
        format: {
          type: "string",
          enum: ["table", "json", "pr-body"],
          description: "Output format. Defaults to 'table'.",
        },
      },
      examples: [{ baseBranch: "main", format: "pr-body" }],
    },
  },
  {
    name: "lognexus_audit",
    title: "LogNexus Audit: Audit review gate and commit traceability",
    description:
      "Audit the branch commits against the LogNexus review gate: commit format, Authored-by trailer, Git Notes coverage, subtask file contracts, and author/reviewer separation including self-approval detection. Use when you need the pass/fail gate before merging or before opening a pull request. Not for producing the PR narrative (use lognexus_timeline); audit reports violations and never fixes them.",
    inputSchema: {
      type: "object",
      properties: {
        baseBranch: {
          type: "string",
          description: "Base branch to compare against. Defaults to 'main' with origin fallback.",
        },
      },
      examples: [{ baseBranch: "main" }],
    },
  },
  {
    name: "lognexus_telemetry",
    title: "LogNexus Telemetry: Local performance and ROI cost report",
    description:
      "Inspect local telemetry status, enable strictly local performance metrics (zero network calls), disable tracking, inspect the zero-PII local payload, generate telemetry markdown reports, or clear the metrics store. Use when measuring subtask duration, Git Notes coverage and estimated cost savings. Not for any form of upload: telemetry is local-only, stored in .lognexus/telemetry.json, and no data leaves the working directory.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["status", "enable", "disable", "inspect", "report", "clear"],
          description: "Telemetry action to perform. Defaults to 'status'.",
        },
        outputPath: {
          type: "string",
          description:
            "Target file path when generating report (defaults to .lognexus/telemetry.md).",
        },
      },
      examples: [{ action: "report" }],
    },
  },
];

export function listMcpTools(): ToolDefinition[] {
  return TOOL_DEFINITIONS;
}

export function isKnownTool(name: string): boolean {
  return TOOL_DEFINITIONS.some((tool) => tool.name === name);
}

function textResult(value: unknown): ToolCallResult {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }] };
}

function errorResult(message: string): ToolCallResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

function readStringArg(
  args: Record<string, unknown>,
  key: string,
  options: { required?: boolean } = {},
): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) {
    if (options.required) {
      throw new McpToolError(`Missing required argument: '${key}'.`);
    }
    return undefined;
  }
  if (typeof value !== "string") {
    throw new McpToolError(`Argument '${key}' must be a string.`);
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    if (options.required) {
      throw new McpToolError(`Argument '${key}' must be a non-empty string.`);
    }
    return undefined;
  }
  return trimmed;
}

function readStringArrayArg(args: Record<string, unknown>, key: string): string[] | undefined {
  const value = args[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new McpToolError(`Argument '${key}' must be an array of strings.`);
  }
  return value.map((entry) => (entry as string).trim()).filter((entry) => entry.length > 0);
}

function resolveCommitRef(args: Record<string, unknown>): string {
  return readStringArg(args, "commitRef") ?? "HEAD";
}

const TIMELINE_FORMATS = ["table", "json", "pr-body"] as const;
type TimelineFormat = (typeof TIMELINE_FORMATS)[number];

function resolveTimelineFormat(args: Record<string, unknown>): TimelineFormat {
  const raw = readStringArg(args, "format");
  if (raw === undefined) return "table";
  if (!(TIMELINE_FORMATS as readonly string[]).includes(raw)) {
    throw new McpToolError(
      `Argument 'format' must be one of: ${TIMELINE_FORMATS.join(", ")}. Got '${raw}'.`,
    );
  }
  return raw as TimelineFormat;
}

function resolveBaseBranch(args: Record<string, unknown>, targetDir: string): string {
  return readStringArg(args, "baseBranch") ?? detectBaseBranch(targetDir);
}

export async function callMcpTool(
  name: string,
  args: Record<string, unknown> = {},
  targetDir: string = process.cwd(),
): Promise<ToolCallResult> {
  try {
    switch (name) {
      case "lognexus_status":
        return textResult(getProjectStatus(targetDir));

      case "lognexus_state_get":
        return textResult(loadState(targetDir));

      case "lognexus_state_sync":
        return textResult(syncStateFromGit(targetDir));

      case "lognexus_state_set_task": {
        const taskId = readStringArg(args, "taskId", { required: true }) as string;
        const title = readStringArg(args, "title") ?? "";
        const tierValue = readStringArg(args, "tier");
        if (tierValue !== undefined && !TIER_VALUES.includes(tierValue)) {
          throw new McpToolError("Argument 'tier' must be one of 'tier-1', 'tier-2', 'tier-3'.");
        }
        const tier = tierValue as ActiveIssueState["tier"] | undefined;
        const allowedFiles = readStringArrayArg(args, "allowedFiles");
        const forbiddenFiles = readStringArrayArg(args, "forbiddenFiles");
        const decisionBudget = readStringArg(args, "decisionBudget");
        if (decisionBudget !== undefined && !DECISION_BUDGET_VALUES.includes(decisionBudget)) {
          throw new McpToolError(
            "Argument 'decisionBudget' must be one of 'none', 'narrow', 'full'.",
          );
        }
        const verificationCmd = readStringArg(args, "verificationCmd");

        const contract =
          allowedFiles !== undefined ||
          forbiddenFiles !== undefined ||
          decisionBudget !== undefined ||
          verificationCmd !== undefined
            ? {
                allowedFiles: allowedFiles ?? [],
                forbiddenFiles: forbiddenFiles ?? [],
                decisionBudget: (decisionBudget as SubtaskContract["decisionBudget"]) ?? "none",
                verificationCmd,
              }
            : undefined;

        return textResult(setSubtask(taskId, title, contract, targetDir, { tier }));
      }

      case "lognexus_state_finish_task": {
        const taskId = readStringArg(args, "taskId", { required: true }) as string;
        return textResult(finishSubtask(taskId, targetDir));
      }

      case "lognexus_state_clear": {
        const cleared = clearState(targetDir);
        return {
          content: [
            { type: "text", text: "LogNexus state cleared." },
            { type: "text", text: JSON.stringify(cleared, null, 2) },
          ],
        };
      }

      case "lognexus_commit": {
        const message = readStringArg(args, "message", { required: true }) as string;
        const author = readStringArg(args, "author");
        const reviewer = readStringArg(args, "reviewer");
        const finishTask = Boolean(args.finishTask);
        const allowEmpty = Boolean(args.allowEmpty);
        const tierValue = readStringArg(args, "tier");
        if (tierValue !== undefined && !TIER_VALUES.includes(tierValue)) {
          throw new McpToolError("Argument 'tier' must be one of 'tier-1', 'tier-2', 'tier-3'.");
        }
        const res = executeAtomicCommit({
          message,
          author,
          reviewer,
          finishTask,
          allowEmpty,
          tier: tierValue as ActiveIssueState["tier"] | undefined,
          escalated: Boolean(args.escalated),
          targetDir,
        });
        return textResult(res);
      }

      case "lognexus_note_show": {
        const commitRef = resolveCommitRef(args);
        const note = getNote(commitRef, { cwd: targetDir });
        if (note === null) {
          return errorResult(`No LogNexus note found for commit '${commitRef}'.`);
        }
        return textResult(note);
      }

      case "lognexus_note_attach": {
        const commitRef = resolveCommitRef(args);
        return textResult(attachCurrentStateToCommit(commitRef, { cwd: targetDir }));
      }

      case "lognexus_timeline": {
        const baseBranch = resolveBaseBranch(args, targetDir);
        const format = resolveTimelineFormat(args);
        const timeline = getJourneyTimeline(baseBranch, targetDir);
        if (format === "json") return textResult(timeline);
        if (format === "pr-body") return textResult(timeline.prBodyDraft);
        return textResult(timeline.markdownTable);
      }

      case "lognexus_audit": {
        const baseBranch = resolveBaseBranch(args, targetDir);
        const result = auditBranch(baseBranch, targetDir);
        return textResult(`${JSON.stringify(result, null, 2)}\n\n${formatAuditResult(result)}`);
      }

      case "lognexus_telemetry": {
        const action = readStringArg(args, "action") ?? "status";
        if (action === "status") {
          const store = loadTelemetry(targetDir);
          const disabled = isTelemetryGloballyDisabled();
          return textResult({
            active: !disabled && store.mode === "local",
            mode: store.mode,
            globallyDisabled: disabled,
            detectedStacks: store.detectedStacks,
            consent: store.consent,
            summary: store.summary,
            lastUpdated: store.lastUpdated,
          });
        }
        if (action === "enable") {
          const result = enableTelemetry({ cwd: targetDir });
          return textResult({
            message: `Telemetry enabled in '${result.mode}' mode.`,
            ...result,
          });
        }
        if (action === "disable") {
          disableTelemetry(targetDir);
          return textResult({ message: "Telemetry disabled." });
        }
        if (action === "inspect") {
          const store = loadTelemetry(targetDir);
          const payload = buildAnonymousCommunityPayload(store);
          return textResult(payload);
        }
        if (action === "report") {
          const outputPath = readStringArg(args, "outputPath");
          const res = generateTelemetryReportFile(targetDir, outputPath);
          return textResult({
            message: `Telemetry report written to ${res.filePath}`,
            filePath: res.filePath,
            content: res.content,
          });
        }
        if (action === "clear") {
          clearTelemetry(targetDir);
          return textResult({ message: "Telemetry store reset." });
        }
        throw new McpToolError(
          `Unknown telemetry action: '${action}'. Expected one of: status, enable, disable, inspect, report, clear.`,
        );
      }

      default:
        return errorResult(`Unknown LogNexus tool: '${name}'.`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResult(`Tool '${name}' failed: ${message}`);
  }
}
