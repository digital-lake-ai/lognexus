import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { extractIssueNumber } from "./branch.js";

export interface ProjectStatus {
  branch: string;
  isInsideGit: boolean;
  activeIssue: string | null;
  routingMode: string;
  recommendedTier: string;
  scopeDrift: ScopeDrift;
}

export interface ScopeDrift {
  detected: boolean;
  unauthorizedFiles: string[];
  allowedFiles: string[];
}

/** Paths that describe agent state rather than source, so they never count as drift. */
const DRIFT_IGNORED_PREFIXES = [".lognexus/", "docs/contexto/"];

function isDriftIgnored(file: string): boolean {
  return DRIFT_IGNORED_PREFIXES.some((prefix) => file.startsWith(prefix));
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

function readAllowedFiles(targetDir: string): string[] | null {
  try {
    const statePath = join(targetDir, ".lognexus", "state.json");
    if (!existsSync(statePath)) return null;
    const state = JSON.parse(readFileSync(statePath, "utf8")) as {
      currentSubtask?: { status?: string; contract?: { allowedFiles?: unknown } } | null;
    };
    const subtask = state.currentSubtask;
    if (subtask === null || subtask === undefined) return null;
    const allowed = subtask.contract?.allowedFiles;
    if (!Array.isArray(allowed)) return null;
    return allowed.filter((entry): entry is string => typeof entry === "string").map(normalizePath);
  } catch {
    return null;
  }
}

function readTouchedFiles(targetDir: string): string[] {
  try {
    const output = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
      cwd: targetDir,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });

    return output
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => normalizePath(line.slice(3)))
      .filter((file) => file !== "");
  } catch {
    return [];
  }
}

/**
 * Compares the working tree against the active subtask contract. A file counts as
 * drift when it is touched but absent from `allowedFiles`; agent bookkeeping under
 * `.lognexus/` and the plan documents under `docs/contexto/` are always exempt.
 */
export function getScopeDrift(targetDir: string = process.cwd()): ScopeDrift {
  const allowedFiles = readAllowedFiles(targetDir);
  if (allowedFiles === null) {
    return { detected: false, unauthorizedFiles: [], allowedFiles: [] };
  }

  const allowedSet = new Set(allowedFiles);
  const unauthorizedFiles = readTouchedFiles(targetDir)
    .filter((file) => !isDriftIgnored(file))
    .filter((file) => !allowedSet.has(file));

  return {
    detected: unauthorizedFiles.length > 0,
    unauthorizedFiles,
    allowedFiles,
  };
}

export function getProjectStatus(targetDir: string = process.cwd()): ProjectStatus {
  let isInsideGit = false;
  let branch = "detached";

  try {
    const inside = execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: targetDir,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    }).trim();
    isInsideGit = inside === "true";

    if (isInsideGit) {
      branch =
        execFileSync("git", ["branch", "--show-current"], {
          cwd: targetDir,
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
          shell: false,
        }).trim() || "detached";
    }
  } catch {
    isInsideGit = false;
  }

  let activeIssue: string | null = null;
  const issueNumber = extractIssueNumber(branch);
  if (issueNumber) {
    activeIssue = `#${issueNumber}`;
  }

  let routingMode = "not configured";
  const routingFile = join(targetDir, ".lognexus", "routing.md");
  if (existsSync(routingFile)) {
    const content = readFileSync(routingFile, "utf8");
    const m = content.match(/routing:\s*(confirm|warn|off)/i);
    if (m) routingMode = m[1].toLowerCase();
  }

  let recommendedTier =
    "tier-1 (Reasoning / Planning: Claude Opus, OpenAI o3, Gemini Pro, DeepSeek R1)";
  if (activeIssue) {
    recommendedTier =
      "tier-3 (Scoped Execution: Claude Haiku, GPT-4o-mini, DeepSeek Chat, Gemini Flash)";
  }

  return {
    branch,
    isInsideGit,
    activeIssue,
    routingMode,
    recommendedTier,
    scopeDrift: isInsideGit
      ? getScopeDrift(targetDir)
      : { detected: false, unauthorizedFiles: [], allowedFiles: [] },
  };
}
