import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { extractTrailers } from "../audit/audit.js";
import { getCliVersion } from "../cli.js";
import { getNote } from "../notes/notes.js";
import { ensureLocalGitExclude } from "../update/gate.js";
import { loadState } from "./manager.js";

export const IMPLEMENTER_IDENTITY = "deepseek/VS Code (kimi-code)";
export const AUDITOR_IDENTITY = "google/gemini-3.8-flash-high (antigravity)";
export const ARCHITECT_IDENTITY = "Gemini 4 Argon";
export const CO_ARCHITECT_IDENTITY = "Gemini 4 Carbon";

/** Hard ceiling on implementation files a single subtask may touch in one turn. */
export const CONTEXT_MAX_FILES = 6;
/** Hard ceiling on total lines of implementation code a single subtask may touch. */
export const CONTEXT_MAX_LOC = 1200;

export interface ContextBudgetStatus {
  exceeded: boolean;
  fileCount: number;
  totalLines: number;
  maxFiles: number;
  maxLines: number;
  recommendation: string | null;
}

const CONTEXT_BUDGET_RECOMMENDATION =
  "Subtask exceeds single-turn context budget (>6 files or >1200 LOC). Consider splitting the subtask or using your host assistant's native subagent/exploration capabilities while keeping contract execution strictly bounded.";

export interface HandoffSubtaskEntry {
  id: string;
  title: string;
  sha: string | null;
  shortSha: string | null;
  author: string | null;
  summary: string | null;
}

export interface HandoffScopeDrift {
  detected: boolean;
  unauthorizedFiles: string[];
}

export interface ContextHandoff {
  generatedAt: string;
  issue: { id: number; title: string; branch: string; tier: string } | null;
  version: string | null;
  planFile?: string | null;
  contract: {
    id: string;
    title: string;
    tier: string;
    decisionBudget: string;
    allowedFiles: string[];
  } | null;
  contextBudget?: ContextBudgetStatus;
  scopeDrift: HandoffScopeDrift;
  completedSubtasks: HandoffSubtaskEntry[];
  nextAction: string;
}

export function getHandoffPath(targetDir: string = process.cwd()): string {
  return join(targetDir, ".lognexus", "handoff.md");
}

function runGit(args: string[], cwd: string): string | null {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    }).trim();
  } catch {
    return null;
  }
}

function readPackageVersion(targetDir: string): string | null {
  const raw = runGit(["show", "HEAD:package.json"], targetDir);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === "object" && "version" in parsed) {
      const version = (parsed as { version?: unknown }).version;
      return typeof version === "string" && version.trim() !== "" ? version : null;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Resolves the version of the cycle. A repository checkout without a readable
 * `package.json` (installed CLI, fresh scaffold) still reports the running CLI version
 * instead of the opaque "unknown" placeholder.
 */
function readVersion(targetDir: string): string | null {
  return readPackageVersion(targetDir) ?? getCliVersion();
}

function toPosix(value: string): string {
  return value.replace(/\\/g, "/");
}

/**
 * Locates the technical specification of the given issue: the canonical
 * `docs/contexto/issue-<id>-plan.md` first, then any scoped plan filename.
 */
export function discoverPlanFile(
  issueId: number | null,
  targetDir: string = process.cwd(),
): string | null {
  if (issueId === null) return null;

  const canonical = `docs/contexto/issue-${issueId}-plan.md`;
  if (existsSync(join(targetDir, canonical))) {
    return canonical;
  }

  const pattern = new RegExp(`^(?:PLAN-ISSUE-|issue-)${issueId}(?:[-_.]|$).*\\.md$`, "i");
  for (const dir of [".lognexus", "docs/contexto"]) {
    const absoluteDir = join(targetDir, dir);
    if (!existsSync(absoluteDir)) continue;
    try {
      const match = readdirSync(absoluteDir)
        .filter((entry) => pattern.test(entry))
        .sort()[0];
      if (match !== undefined) {
        return toPosix(relative(resolve(targetDir), join(absoluteDir, match)));
      }
    } catch {}
  }

  return null;
}

function firstLine(noteBlob: string | null): string | null {
  if (!noteBlob) return null;
  try {
    const parsed: unknown = JSON.parse(noteBlob);
    if (parsed !== null && typeof parsed === "object") {
      if ("subtask" in parsed) {
        const subtask = (parsed as { subtask?: { title?: unknown } | null }).subtask;
        if (subtask && typeof subtask.title === "string" && subtask.title.trim() !== "") {
          return subtask.title.trim();
        }
      }
      return null;
    }
  } catch {
    // notes written outside LogNexus carry free-form text
  }
  const line = noteBlob.split("\n")[0].trim();
  return line === "" ? null : line;
}

/**
 * Walks the commits reachable from HEAD (newest first) and resolves the commit that
 * belongs to each completed subtask, together with its Git Note provenance.
 */
function collectCompletedSubtasks(
  subtaskIds: string[],
  targetDir: string,
  activeIssueId: number | null = null,
): HandoffSubtaskEntry[] {
  if (subtaskIds.length === 0) return [];

  const log = runGit(["log", "--format=%H%x1f%h%x1f%an%x1f%s%x1f%B%x1e", "-n", "200"], targetDir);
  if (!log) {
    return subtaskIds.map((id) => ({
      id,
      title: "",
      sha: null,
      shortSha: null,
      author: null,
      summary: null,
    }));
  }

  const commits = log
    .split("\u001e")
    .map((record) => record.trim())
    .filter((record) => record !== "")
    .map((record) => {
      const [sha = "", shortSha = "", gitAuthor = "", subject = "", body = ""] =
        record.split("\u001f");
      const trailerAuthor = extractTrailers(body).author;
      return {
        sha: sha.trim(),
        shortSha: shortSha.trim(),
        author: trailerAuthor ?? gitAuthor.trim(),
        subject,
      };
    });

  return subtaskIds.map((id) => {
    // Prefer the commit nested under the active issue, then fall back to any scoped form.
    const scopedPattern =
      activeIssueId !== null ? new RegExp(`\\(#${activeIssueId}/${id}\\)`, "i") : null;
    const fallbackPattern = new RegExp(`\\((?:#\\d+|[A-Z][A-Z0-9]*-\\d+)/${id}\\)`, "i");
    const match =
      (scopedPattern ? commits.find((commit) => scopedPattern.test(commit.subject)) : undefined) ??
      commits.find((commit) => fallbackPattern.test(commit.subject));
    if (!match) {
      return { id, title: "", sha: null, shortSha: null, author: null, summary: null };
    }
    return {
      id,
      title: "",
      sha: match.sha,
      shortSha: match.shortSha || match.sha.slice(0, 7),
      author: match.author === "" ? null : match.author,
      summary: match.subject,
    };
  });
}

/**
 * Rebuilds the completed-subtask list from the commit history when the state file lost
 * it (fresh clone, restored index, crash before write). Chronological order is restored
 * by inverting `git log`, which yields newest first.
 */
function collectCompletedSubtasksFromGit(
  activeIssueId: number,
  targetDir: string,
): HandoffSubtaskEntry[] {
  const log = runGit(["log", "--format=%s", "-n", "200"], targetDir);
  if (!log) return [];

  const pattern = new RegExp(`\\(#${activeIssueId}/(T\\d+(?:-[a-zA-Z0-9]+)?)\\)`, "i");
  const subjects = log.split("\n").reverse();
  const ids: string[] = [];
  for (const subject of subjects) {
    const match = subject.match(pattern);
    if (match === null) continue;
    const id = match[1].toUpperCase();
    if (!ids.includes(id)) ids.push(id);
  }

  return collectCompletedSubtasks(ids, targetDir, activeIssueId);
}

function resolveScopeDrift(targetDir: string, allowedFiles: string[]): HandoffScopeDrift {
  const raw = runGit(["status", "--porcelain", "--untracked-files=all"], targetDir);
  if (!raw) return { detected: false, unauthorizedFiles: [] };

  const ignoredPrefixes = [".lognexus/", "docs/contexto/"];
  const unauthorized = raw
    .split("\n")
    // Porcelain entries start with a two-column XY status; never trim the blob first,
    // the first entry legitimately begins with a space (" M path").
    .filter((line) => line.length > 3 && line.slice(2, 3) === " ")
    .map((line) => {
      // Renames report "R  old -> new": keep the destination path only.
      const path = line.slice(3).trim();
      const arrow = path.indexOf(" -> ");
      return arrow === -1 ? path : path.slice(arrow + 4).trim();
    })
    .filter((path) => path !== "")
    .filter((path) => !ignoredPrefixes.some((prefix) => path.startsWith(prefix)))
    .filter((path) => !allowedFiles.includes(path));

  return { detected: unauthorized.length > 0, unauthorizedFiles: unauthorized };
}

/**
 * Reviews the active contract against the single-turn context ceiling. Large contracts
 * do not fail governance; they carry the delegation recommendation in the handoff.
 */
const GENERATED_LOCKFILES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "Cargo.lock",
  "poetry.lock",
  "uv.lock",
  "composer.lock",
  "Gemfile.lock",
]);

export function evaluateContextBudget(targetDir: string = process.cwd()): ContextBudgetStatus {
  const state = loadState(targetDir);
  const allowedFiles =
    state.currentSubtask !== null && state.currentSubtask.status !== "completed"
      ? (state.currentSubtask.contract?.allowedFiles ?? [])
      : [];

  const implFiles = allowedFiles.filter(
    (file) =>
      !file.endsWith(".md") &&
      !file.startsWith(".lognexus/") &&
      !file.startsWith("tests/") &&
      !GENERATED_LOCKFILES.has(basename(file)),
  );

  let totalLines = 0;
  for (const file of implFiles) {
    const absolutePath = join(targetDir, file);
    if (!existsSync(absolutePath)) continue;
    try {
      const content = readFileSync(absolutePath, "utf8");
      totalLines += content === "" ? 0 : content.split(/\r?\n/).length;
    } catch {}
  }

  const exceeded = implFiles.length > CONTEXT_MAX_FILES || totalLines > CONTEXT_MAX_LOC;

  return {
    exceeded,
    fileCount: implFiles.length,
    totalLines,
    maxFiles: CONTEXT_MAX_FILES,
    maxLines: CONTEXT_MAX_LOC,
    recommendation: exceeded ? CONTEXT_BUDGET_RECOMMENDATION : null,
  };
}

function resolveNextAction(state: ReturnType<typeof loadState>): string {
  if (state.currentSubtask === null) {
    return `Cross-Model Auditor: ${AUDITOR_IDENTITY} under supervision of ${ARCHITECT_IDENTITY}`;
  }
  if (state.currentSubtask.status === "completed") {
    return `Cross-Model Auditor: ${AUDITOR_IDENTITY} under supervision of ${ARCHITECT_IDENTITY}`;
  }
  return `Implementer: ${IMPLEMENTER_IDENTITY}`;
}

export function generateContextHandoff(targetDir: string = process.cwd()): ContextHandoff {
  const state = loadState(targetDir);
  // A completed subtask releases its contract: nothing is pending, so nothing can drift.
  const activeSubtask =
    state.currentSubtask !== null && state.currentSubtask.status !== "completed"
      ? state.currentSubtask
      : null;
  const contract = activeSubtask?.contract;

  const completedSubtasks = (
    state.completedSubtasks.length > 0 || state.activeIssue === null
      ? collectCompletedSubtasks(state.completedSubtasks, targetDir, state.activeIssue?.id ?? null)
      : collectCompletedSubtasksFromGit(state.activeIssue.id, targetDir)
  ).map((entry) => {
    const note = entry.sha ? getNote(entry.sha, { cwd: targetDir }) : null;
    const summary = firstLine(note);
    return summary === null ? entry : { ...entry, title: summary };
  });

  return {
    generatedAt: new Date().toISOString(),
    issue: state.activeIssue
      ? {
          id: state.activeIssue.id,
          title: state.activeIssue.title,
          branch: state.activeIssue.branch,
          tier: state.activeIssue.tier,
        }
      : null,
    version: readVersion(targetDir),
    planFile: discoverPlanFile(state.activeIssue?.id ?? null, targetDir),
    contract: activeSubtask
      ? {
          id: activeSubtask.id,
          title: activeSubtask.title,
          tier: state.activeIssue?.tier ?? "tier-3",
          decisionBudget: contract?.decisionBudget ?? "none",
          allowedFiles: contract?.allowedFiles ?? [],
        }
      : null,
    contextBudget: evaluateContextBudget(targetDir),
    scopeDrift: resolveScopeDrift(targetDir, contract?.allowedFiles ?? []),
    completedSubtasks,
    nextAction: resolveNextAction(state),
  };
}

export function renderContextHandoff(handoff: ContextHandoff): string {
  const lines: string[] = [];

  lines.push("# LogNexus Context Handoff");
  lines.push("");
  lines.push(`_Generated at ${handoff.generatedAt}_`);
  lines.push("");
  lines.push("## Cycle State");
  lines.push("");
  if (handoff.issue) {
    lines.push(`- **Issue:** #${handoff.issue.id} — ${handoff.issue.title}`);
    lines.push(`- **Branch:** \`${handoff.issue.branch}\``);
    lines.push(`- **Issue tier:** ${handoff.issue.tier}`);
  } else {
    lines.push("- **Issue:** none active");
  }
  lines.push(`- **Version:** ${handoff.version ?? "unknown"}`);
  if (handoff.planFile) {
    lines.push(`- **Plan file:** \`${handoff.planFile}\``);
  }
  lines.push("");
  lines.push("## Active Subtask Contract");
  lines.push("");
  if (handoff.contract) {
    lines.push(`- **ID:** ${handoff.contract.id}`);
    lines.push(`- **Title:** ${handoff.contract.title}`);
    lines.push(`- **Tier:** ${handoff.contract.tier}`);
    lines.push(`- **Decision budget:** ${handoff.contract.decisionBudget}`);
    lines.push("- **Allowed files:**");
    if (handoff.contract.allowedFiles.length === 0) {
      lines.push("  - _(none declared)_");
    }
    for (const file of handoff.contract.allowedFiles) {
      lines.push(`  - \`${file}\``);
    }
  } else {
    lines.push("- **Active subtask:** none");
  }
  lines.push("");
  lines.push("## Live Scope-Drift Guard");
  lines.push("");
  if (handoff.scopeDrift.detected) {
    lines.push("[SCOPE DRIFT DETECTED]");
    lines.push("");
    lines.push("Working-tree files outside the active contract:");
    for (const file of handoff.scopeDrift.unauthorizedFiles) {
      lines.push(`- \`${file}\``);
    }
  } else {
    lines.push("[PASS] Working tree matches the active contract.");
  }
  if (handoff.contextBudget?.exceeded) {
    lines.push("");
    lines.push(
      `[WARN] ${handoff.contextBudget.recommendation} (${handoff.contextBudget.fileCount} files, ${handoff.contextBudget.totalLines} LOC)`,
    );
  }
  lines.push("");
  lines.push("## Completed Subtasks");
  lines.push("");
  if (handoff.completedSubtasks.length === 0) {
    lines.push("_No subtasks completed yet._");
  } else {
    lines.push("| Subtask | SHA | Author | Note summary |");
    lines.push("| --- | --- | --- | --- |");
    for (const entry of handoff.completedSubtasks) {
      const sha = entry.shortSha ? `\`${entry.shortSha}\`` : "—";
      const author = entry.author ?? "—";
      const summary = (entry.title || entry.summary || "—")
        .replace(/\\/g, "\\\\")
        .replace(/\|/g, "\\|");
      lines.push(`| ${entry.id} | ${sha} | ${author} | ${summary} |`);
    }
  }
  lines.push("");
  lines.push("## Next Required Action");
  lines.push("");
  lines.push(handoff.nextAction);
  lines.push("");

  return lines.join("\n");
}

/**
 * Renders the short dispatch block an orchestrator pastes to the implementer, so the
 * full specification stays in the plan file instead of being inlined into the chat.
 */
export function renderCompactDispatchPrompt(handoff: ContextHandoff): string {
  const issueTag = handoff.issue ? `Issue #${handoff.issue.id}` : "active issue";
  const branch = handoff.issue?.branch ?? "current scoped branch";
  const planRef = handoff.planFile ?? ".lognexus/handoff.md";
  const taskRef = handoff.contract ? `subtask ${handoff.contract.id}` : "all planned subtasks";
  return [
    `Execute ${issueTag} (${taskRef}) on branch \`${branch}\`.`,
    `1. Read \`${planRef}\`, \`.lognexus/handoff.md\`, and \`.lognexus/state.json\` first (do not inline specs in chat).`,
    `2. Sign every commit with \`--author "${IMPLEMENTER_IDENTITY}"\` and \`--finish-task\`.`,
    `3. Governance guards: 0 changes in \`src/mcp/tools.ts\`, 0 \`fetch()\` calls, and strict \`{ shell: false }\`.`,
    `4. Assistant vs. Contract boundary: operate freely with your native IDE/assistant capabilities during conversation and exploration, but once executing the active subtask contract, strictly obey LogNexus contract governance (\`allowedFiles\`, \`forbiddenFiles\`, \`decisionBudget\`, and verification).`,
    `5. Do NOT write \`Reviewed-by:\` trailers, do NOT run \`git push\`, and do NOT open a PR. Run \`npm test && npm run build && npx lognexus audit main\` when done.`,
  ].join("\n");
}

export function writeContextHandoffFile(targetDir: string = process.cwd()): ContextHandoff {
  const handoff = generateContextHandoff(targetDir);
  const filePath = getHandoffPath(targetDir);
  const dirPath = join(targetDir, ".lognexus");
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
  writeFileSync(filePath, renderContextHandoff(handoff), "utf8");
  ensureLocalGitExclude(targetDir);
  return handoff;
}

/**
 * Best-effort regeneration used by the state and commit engines: a handoff failure
 * must never abort a commit or a subtask transition.
 */
export function refreshContextHandoff(targetDir: string = process.cwd()): void {
  try {
    writeContextHandoffFile(targetDir);
  } catch {
    // the handoff is a diagnostic artifact; never block the governance flow
  }
}
