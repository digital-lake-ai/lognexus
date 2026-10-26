import { execFileSync } from "node:child_process";
import { auditBranch, formatAuditResult } from "../audit/audit.js";
import { executeAtomicCommit } from "../commit.js";
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

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "lognexus_status",
    title: "LogNexus project status",
    description:
      "Inspect the current Git branch, whether the directory is a Git repository, the active issue, the routing mode and the recommended model tier.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "lognexus_state_get",
    title: "Get agent state",
    description:
      "Return the persistent LogNexus agent state (.lognexus/state.json): active issue, current subtask, completed subtasks and last synchronization timestamp.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "lognexus_state_sync",
    title: "Sync state from Git",
    description:
      "Synchronize the persistent state from the current Git branch and GitHub metadata, then return the updated state.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "lognexus_state_set_task",
    title: "Set active subtask",
    description:
      "Mark a subtask as in progress (equivalent to 'lognexus state set-task <id> [title]') and return the updated state.",
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
          description: "Optional routing tier to assign to the active issue.",
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
    },
  },
  {
    name: "lognexus_state_finish_task",
    title: "Finish subtask",
    description:
      "Mark a subtask as completed (equivalent to 'lognexus state finish-task <id>') and return the updated state.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "Subtask identifier, e.g. 'T1'.",
        },
      },
      required: ["taskId"],
    },
  },
  {
    name: "lognexus_state_clear",
    title: "Clear agent state",
    description:
      "Reset the persistent LogNexus agent state to empty (equivalent to 'lognexus state clear').",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "lognexus_commit",
    title: "Atomic commit",
    description:
      "Atomically create a Git commit with conventional commit format, authorship trailers, subtask file contract validation, automatic task finishing, and Git Note attachment in a single operation.",
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
      },
      required: ["message"],
    },
  },
  {
    name: "lognexus_note_show",
    title: "Show Git Note",
    description:
      "Read the LogNexus Git Note (refs/notes/lognexus) attached to a commit and return its parsed JSON payload. Defaults to HEAD.",
    inputSchema: {
      type: "object",
      properties: {
        commitRef: {
          type: "string",
          description: "Git commit reference (SHA, branch, tag or HEAD). Defaults to HEAD.",
        },
      },
    },
  },
  {
    name: "lognexus_note_attach",
    title: "Attach Git Note",
    description:
      "Attach the current LogNexus state as a Git Note (refs/notes/lognexus) to a commit. Defaults to HEAD.",
    inputSchema: {
      type: "object",
      properties: {
        commitRef: {
          type: "string",
          description: "Git commit reference (SHA, branch, tag or HEAD). Defaults to HEAD.",
        },
      },
    },
  },
  {
    name: "lognexus_timeline",
    title: "Journey Timeline",
    description:
      "Reconstruct the branch Journey Timeline against a base branch: commit list enriched with Git Notes, subtask IDs, tiers and Authored-by/Reviewed-by trailers, rendered as a Markdown table, JSON or a PR body draft.",
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
    },
  },
  {
    name: "lognexus_audit",
    title: "Traceability audit",
    description:
      "Audit the branch commits against the LogNexus review gate: commit format, Authored-by trailer, Git Note presence, subtask file contracts and reviewer/author separation.",
    inputSchema: {
      type: "object",
      properties: {
        baseBranch: {
          type: "string",
          description: "Base branch to compare against. Defaults to 'main' with origin fallback.",
        },
      },
    },
  },
  {
    name: "lognexus_telemetry",
    title: "Opt-in telemetry & ROI report engine",
    description:
      "Inspect telemetry status, enable local or anonymous community telemetry, disable tracking, inspect zero-PII payload, generate telemetry markdown reports, or clear metrics store.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["status", "enable", "disable", "inspect", "report", "clear"],
          description: "Telemetry action to perform. Defaults to 'status'.",
        },
        share: {
          type: "boolean",
          description:
            "When action is 'enable', set to true to enable anonymous community telemetry.",
        },
        acceptTerms: {
          type: "boolean",
          description: "Explicit acceptance of telemetry terms (required when share is true).",
        },
        outputPath: {
          type: "string",
          description:
            "Target file path when generating report (defaults to .lognexus/telemetry.md).",
        },
      },
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

function detectBaseBranch(targetDir: string): string {
  for (const candidate of ["main", "master"]) {
    try {
      execFileSync("git", ["rev-parse", "--verify", "--quiet", `${candidate}^{commit}`], {
        cwd: targetDir,
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
      });
      return candidate;
    } catch {
      // Candidate branch does not exist in this repository.
    }
  }

  return "main";
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
        const res = executeAtomicCommit({
          message,
          author,
          reviewer,
          finishTask,
          allowEmpty,
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
            active: !disabled && (store.mode === "local" || store.mode === "community"),
            mode: store.mode,
            globallyDisabled: disabled,
            detectedStacks: store.detectedStacks,
            consent: store.consent,
            summary: store.summary,
            lastUpdated: store.lastUpdated,
          });
        }
        if (action === "enable") {
          const share = Boolean(args.share);
          const acceptTerms = Boolean(args.acceptTerms);
          const result = enableTelemetry({ share, acceptTerms, cwd: targetDir });
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
