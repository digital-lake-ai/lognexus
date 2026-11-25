import { execFileSync } from "node:child_process";
import { type Dirent, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { extractIssueNumber } from "./branch.js";
import {
  type AgentEcosystemId,
  type EffectiveReviewGateMode,
  type OrchestrationMode,
  resolveRoutingProfile,
} from "./routing/profile.js";

export interface ProjectStatus {
  branch: string;
  isInsideGit: boolean;
  activeIssue: string | null;
  routingMode: string;
  orchestrationMode: OrchestrationMode;
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

export interface ManifestVersionEntry {
  path: string;
  version: string;
}

const MANIFEST_IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "dist-pypi",
  "build",
  "target",
  "coverage",
  ".lognexus",
]);

function readJsonManifestVersion(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as {
      version?: unknown;
      package?: { version?: unknown } | null;
    };
    const raw =
      typeof parsed.version === "string"
        ? parsed.version
        : typeof parsed.package?.version === "string"
          ? parsed.package.version
          : null;
    const trimmed = raw?.trim() ?? "";
    return trimmed !== "" ? trimmed : null;
  } catch {
    return null;
  }
}

/** Reads `version` inside `[project]` or `[package]` in linear O(n) time without polynomial regexes. */
function readTomlPackageVersion(
  content: string,
  sectionName: "project" | "package",
): string | null {
  let inSection = false;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    if (line.startsWith("[")) {
      const end = line.indexOf("]");
      inSection = (end === -1 ? line.slice(1) : line.slice(1, end)).trim() === sectionName;
      continue;
    }
    if (!inSection) continue;
    const eq = line.indexOf("=");
    if (eq <= 0 || line.slice(0, eq).trim() !== "version") continue;
    const val = line.slice(eq + 1).trim();
    const quote = val[0] === '"' || val[0] === "'" ? val[0] : null;
    const endIdx = quote !== null ? val.indexOf(quote, 1) : val.indexOf("#");
    const raw =
      quote !== null
        ? val.slice(1, endIdx === -1 ? undefined : endIdx)
        : endIdx === -1
          ? val
          : val.slice(0, endIdx);
    const trimmed = raw.trim();
    return trimmed !== "" ? trimmed : null;
  }
  return null;
}

function readTomlManifestVersion(filePath: string, section: "project" | "package"): string | null {
  if (!existsSync(filePath)) return null;
  try {
    return readTomlPackageVersion(readFileSync(filePath, "utf8"), section);
  } catch {
    return null;
  }
}

function scanPluginManifests(
  dir: string,
  relPrefix: string,
  depth: number,
  entries: ManifestVersionEntry[],
): void {
  let children: Dirent[];
  try {
    children = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  } catch {
    return;
  }
  for (const child of children) {
    if (child.isSymbolicLink()) continue;
    const relPath = relPrefix === "" ? child.name : `${relPrefix}/${child.name}`;
    const fullPath = join(dir, child.name);
    if (child.isFile() && child.name === "plugin.manifest.json") {
      const version = readJsonManifestVersion(fullPath);
      if (version !== null) entries.push({ path: relPath, version });
    } else if (child.isDirectory() && depth < 2 && !MANIFEST_IGNORED_DIRS.has(child.name)) {
      scanPluginManifests(fullPath, relPath, depth + 1, entries);
    }
  }
}

/** Collects declared software versions across root manifests and up to 2-depth plugin manifests. */
export function detectProjectManifestVersions(
  targetDir: string = process.cwd(),
): ManifestVersionEntry[] {
  const entries: ManifestVersionEntry[] = [];
  for (const relPath of ["package.json", "tauri.conf.json", "src-tauri/tauri.conf.json"]) {
    const version = readJsonManifestVersion(join(targetDir, relPath));
    if (version !== null) entries.push({ path: relPath, version });
  }
  for (const [relPath, section] of [
    ["pyproject.toml", "project"],
    ["Cargo.toml", "package"],
    ["src-tauri/Cargo.toml", "package"],
  ] as const) {
    const version = readTomlManifestVersion(join(targetDir, relPath), section);
    if (version !== null) entries.push({ path: relPath, version });
  }
  scanPluginManifests(targetDir, "", 0, entries);
  return entries;
}

/**
 * Reads the host project version from the first manifest that declares one, so
 * `lognexus status` can show which release line the repository under governance is
 * on. Returns `null` when no manifest is present or it cannot be parsed.
 */
export function detectHostProjectVersion(targetDir: string = process.cwd()): string | null {
  return (
    readJsonManifestVersion(join(targetDir, "package.json")) ??
    readTomlManifestVersion(join(targetDir, "pyproject.toml"), "project") ??
    readTomlManifestVersion(join(targetDir, "Cargo.toml"), "package") ??
    readJsonManifestVersion(join(targetDir, "src-tauri/tauri.conf.json")) ??
    readJsonManifestVersion(join(targetDir, "tauri.conf.json"))
  );
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
    base: "tier-1 (Reasoning / Planning: Gemini 4 Carbon / Argon / Neon)",
    issue: "tier-3 (Scoped Execution: Gemini 3.8 Flash)",
  },
  "claude-code": {
    base: "tier-1 (Reasoning / Planning: Claude Fable 5.2 / Mythos 5.2 / Claude Opus 5.5)",
    issue: "tier-3 (Scoped Execution: Claude Haiku 5.5)",
  },
  cursor: {
    base: "tier-1 (Reasoning / Planning: Claude Fable 5.2 / GPT-6.2 Astra / Gemini 4 Carbon / Cursor Frontier)",
    issue:
      "tier-3 (Scoped Execution: Claude Haiku 5.5 / GPT-6 Luna / Gemini 3.8 Flash / Cursor Fast)",
  },
  codex: {
    base: "tier-1 (Reasoning / Planning: OpenAI GPT-6.2 Astra / GPT-6-Cyber / o3)",
    issue: "tier-3 (Scoped Execution: OpenAI GPT-6 Luna / codex-mini)",
  },
  copilot: {
    base: "tier-1 (Reasoning / Planning: Claude Fable 5.2 / GPT-6.2 Astra)",
    issue: "tier-3 (Scoped Execution: Claude Haiku 5.5 / GPT-6 Luna)",
  },
  kimi: {
    base: "tier-1 (Reasoning / Planning: Kimi K3.1 Pro / K3 Thinking)",
    issue: "tier-3 (Scoped Execution: Kimi Code / K3)",
  },
  zed: {
    base: "tier-1 (Reasoning / Planning: Zed — Claude Fable 5.2 / GPT-6.2 Astra / Gemini 4 Carbon)",
    issue: "tier-3 (Scoped Execution: Zed — Claude Haiku 5.5 / GPT-6 Luna / Gemini 3.8 Flash)",
  },
  windsurf: {
    base: "tier-1 (Reasoning / Planning: Windsurf — Claude Fable 5.2 / GPT-6.2 Astra / Gemini 4 Carbon)",
    issue: "tier-3 (Scoped Execution: Windsurf — Claude Haiku 5.5 / GPT-6 Luna / Gemini 3.8 Flash)",
  },
  roo: {
    base: "tier-1 (Reasoning / Planning: Roo Code — Claude Fable 5.2 / GPT-6.2 Astra / Gemini 4 Carbon)",
    issue: "tier-3 (Scoped Execution: Roo Code — Claude Haiku 5.5 / GPT-6 Luna / Gemini 3.8 Flash)",
  },
  aider: {
    base: "tier-1 (Reasoning / Planning: Aider Architect — Claude Fable 5.2 / GPT-6.2 Astra / Gemini 4 Carbon)",
    issue:
      "tier-3 (Scoped Execution: Aider Editor — Claude Haiku 5.5 / GPT-6 Luna / Gemini 3.8 Flash)",
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
      "tier-3 (Scoped Execution: Claude Haiku 5.5, GPT-6 Luna / GPT-4o-mini, DeepSeek V4-Flash / Chat, GLM-4-Flash, Grok Code Fast, Gemini Flash)")
    : (singleLabels?.base ??
      "tier-1 (Reasoning / Planning: Gemini 4 Carbon / Argon / Neon, Claude Fable 5.2 / Claude Opus 5.5, OpenAI GPT-6.2 Astra / GPT-6-Cyber / o3, Grok 4.7, DeepSeek R1 / V4-Pro, GLM-5.4, Qwen 4 Max)");

  return {
    branch,
    isInsideGit,
    activeIssue,
    routingMode,
    orchestrationMode: profile.orchestrationMode,
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
