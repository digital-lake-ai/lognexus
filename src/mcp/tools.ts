import { attachCurrentStateToCommit } from "../notes/attach.js";
import { getNote } from "../notes/notes.js";
import { clearState, finishSubtask, loadState, setSubtask } from "../state/manager.js";
import { syncStateFromGit } from "../state/sync.js";
import { getProjectStatus } from "../status.js";

export const MCP_SERVER_NAME = "lognexus";

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

function resolveCommitRef(args: Record<string, unknown>): string {
  return readStringArg(args, "commitRef") ?? "HEAD";
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
        return textResult(setSubtask(taskId, title, undefined, targetDir));
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

      default:
        return errorResult(`Unknown LogNexus tool: '${name}'.`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResult(`Tool '${name}' failed: ${message}`);
  }
}
