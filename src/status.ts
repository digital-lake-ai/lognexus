import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { extractIssueNumber } from "./branch.js";
import {
  type AgentEcosystemId,
  type EffectiveReviewGateMode,
  resolveRoutingProfile,
} from "./routing/profile.js";

export interface ProjectStatus {
  branch: string;
  isInsideGit: boolean;
  activeIssue: string | null;
  routingMode: string;
  recommendedTier: string;
  ecosystemProfile: string;
  reviewGateMode: EffectiveReviewGateMode;
  scopeDrift: ScopeDrift;
  projectVersion: string | null;
  publishedReleases: number;
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
      currentSubtask?: {
        status?: string;
        contract?: { allowedFiles?: unknown } | null;
      } | null;
    };
    const subtask = state.currentSubtask;
    if (subtask === null || subtask === undefined) return null;
    // A completed subtask has no contract in force: its commits are already written,
    // so pending edits cannot be judged against a scope that no longer applies.
    if (subtask.status === "completed") return null;
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

    // Never `.trim()` the whole output: the first line of an unstaged modification
    // starts with a space (" M src/file.ts"), and trimming would shift `slice(3)`
    // by one character and corrupt the first path.
    const files: string[] = [];
    for (const rawLine of output.replace(/\r\n/g, "\n").split("\n")) {
      if (rawLine.length < 4) continue;
      const rawPath = rawLine.slice(3).trim();
      if (rawPath === "") continue;
      const renamed = rawPath.indexOf(" -> ");
      const filePath = renamed >= 0 ? rawPath.slice(renamed + 4) : rawPath;
      const normalized = normalizePath(filePath);
      if (normalized !== "") files.push(normalized);
    }

    return files;
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

/**
 * Reads the host project version from the first manifest that declares one, so
 * `lognexus status` can show which release line the repository under governance is
 * on. Returns `null` when no manifest is present or it cannot be parsed.
 */
export function detectHostProjectVersion(targetDir: string = process.cwd()): string | null {
  const packageJsonPath = join(targetDir, "package.json");
  if (existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: unknown };
      if (typeof pkg.version === "string" && pkg.version.trim() !== "") {
        return pkg.version.trim();
      }
    } catch {
      // A malformed manifest falls through to the other manifest formats.
    }
  }

  const tomlManifests = ["pyproject.toml", "Cargo.toml"];
  for (const manifest of tomlManifests) {
    const manifestPath = join(targetDir, manifest);
    if (!existsSync(manifestPath)) continue;
    try {
      const match = readFileSync(manifestPath, "utf8").match(/^version\s*=\s*"([^"]+)"/m);
      if (match?.[1] && match[1].trim() !== "") {
        return match[1].trim();
      }
    } catch {
      // An unreadable manifest is treated as absent.
    }
  }

  return null;
}

/** Counts the Git tags published in the repository; `0` outside Git or on error. */
export function countPublishedReleases(targetDir: string = process.cwd()): number {
  try {
    const output = execFileSync("git", ["tag", "-l"], {
      cwd: targetDir,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "").length;
  } catch {
    return 0;
  }
}

const SINGLE_ECOSYSTEM_TIER_LABELS: Partial<
  Record<AgentEcosystemId, { readonly base: string; readonly issue: string }>
> = {
  antigravity: {
    base: "tier-1 (Reasoning / Planning: Gemini 4 Carbon / Argon)",
    issue: "tier-3 (Scoped Execution: Gemini 3.8 Flash / Gemini 4 Hydrogen)",
  },
  "claude-code": {
    base: "tier-1 (Reasoning / Planning: Claude Opus)",
    issue: "tier-3 (Scoped Execution: Claude Haiku / Claude Sonnet)",
  },
  cursor: {
    base: "tier-1 (Reasoning / Planning: Cursor Frontier / Tier-1)",
    issue: "tier-3 (Scoped Execution: Cursor Fast / Tier-3)",
  },
  codex: {
    base: "tier-1 (Reasoning / Planning: OpenAI o3 / GPT-5)",
    issue: "tier-3 (Scoped Execution: OpenAI GPT-4o-mini / o3-mini)",
  },
  kimi: {
    base: "tier-1 (Reasoning / Planning: Kimi K3 Thinking / Tier-1)",
    issue: "tier-3 (Scoped Execution: Kimi Code / Tier-3)",
  },
  zed: {
    base: "tier-1 (Reasoning / Planning: Zed Configured Tier-1 Model)",
    issue: "tier-3 (Scoped Execution: Zed Configured Tier-3 Model)",
  },
  windsurf: {
    base: "tier-1 (Reasoning / Planning: Windsurf Configured Tier-1 Model)",
    issue: "tier-3 (Scoped Execution: Windsurf Configured Tier-3 Model)",
  },
  roo: {
    base: "tier-1 (Reasoning / Planning: Roo Code Configured Tier-1 Model)",
    issue: "tier-3 (Scoped Execution: Roo Code Configured Tier-3 Model)",
  },
  aider: {
    base: "tier-1 (Reasoning / Planning: Aider Architect Model)",
    issue: "tier-3 (Scoped Execution: Aider Editor Model)",
  },
};

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

  const profile = resolveRoutingProfile(targetDir);
  const routingMode = profile.hasRoutingFile ? profile.routingMode : "not configured";

  const singleEcosystem =
    profile.ecosystems.strong.length === 1 ? profile.ecosystems.strong[0] : null;
  const singleLabels = singleEcosystem ? SINGLE_ECOSYSTEM_TIER_LABELS[singleEcosystem] : undefined;
  const recommendedTier = activeIssue
    ? (singleLabels?.issue ??
      "tier-3 (Scoped Execution: Claude Haiku, GPT-4o-mini, DeepSeek Chat, Gemini Flash)")
    : (singleLabels?.base ??
      "tier-1 (Reasoning / Planning: Gemini 4 Carbon / Argon, Claude Opus, OpenAI o3, DeepSeek R1)");

  return {
    branch,
    isInsideGit,
    activeIssue,
    routingMode,
    recommendedTier,
    ecosystemProfile: profile.ecosystems.profileLabel,
    reviewGateMode: profile.effectiveReviewGate,
    scopeDrift: isInsideGit
      ? getScopeDrift(targetDir)
      : { detected: false, unauthorizedFiles: [], allowedFiles: [] },
    projectVersion: detectHostProjectVersion(targetDir),
    publishedReleases: isInsideGit ? countPublishedReleases(targetDir) : 0,
  };
}
