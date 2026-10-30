import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getNote } from "../notes/notes.js";
import { loadState } from "./manager.js";

export const IMPLEMENTER_IDENTITY = "deepseek/VS Code (kimi-code)";
export const AUDITOR_IDENTITY = "google/gemini-3.8-flash-high (antigravity)";
export const ARCHITECT_IDENTITY = "Gemini 4 Argon";

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
  contract: {
    id: string;
    title: string;
    tier: string;
    decisionBudget: string;
    allowedFiles: string[];
  } | null;
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

function readVersion(targetDir: string): string | null {
  const raw = runGit(["show", "HEAD:package.json"], targetDir);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === "object" && "version" in parsed) {
      const version = (parsed as { version?: unknown }).version;
      return typeof version === "string" ? version : null;
    }
  } catch {
    return null;
  }
  return null;
}

function firstLine(noteBlob: string | null): string | null {
  if (!noteBlob) return null;
  try {
    const parsed: unknown = JSON.parse(noteBlob);
    if (parsed !== null && typeof parsed === "object" && "subtask" in parsed) {
      const subtask = (parsed as { subtask?: { title?: unknown } | null }).subtask;
      if (subtask && typeof subtask.title === "string" && subtask.title.trim() !== "") {
        return subtask.title.trim();
      }
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
function collectCompletedSubtasks(subtaskIds: string[], targetDir: string): HandoffSubtaskEntry[] {
  if (subtaskIds.length === 0) return [];

  const log = runGit(["log", "--format=%H%x00%an%x00%s", "-n", "200"], targetDir);
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

  const commits = log.split("\n").map((line) => {
    const [sha = "", author = "", subject = ""] = line.split("\u0000");
    return { sha, author, subject };
  });

  return subtaskIds.map((id) => {
    const pattern = new RegExp(`\\(#\\d+/${id}\\)`);
    const match = commits.find((commit) => pattern.test(commit.subject));
    if (!match) {
      return { id, title: "", sha: null, shortSha: null, author: null, summary: null };
    }
    return {
      id,
      title: "",
      sha: match.sha,
      shortSha: match.sha.slice(0, 7),
      author: match.author === "" ? null : match.author,
      summary: match.subject,
    };
  });
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
  const contract = state.currentSubtask?.contract;

  const completedSubtasks = collectCompletedSubtasks(state.completedSubtasks, targetDir).map(
    (entry) => {
      const note = entry.sha ? getNote(entry.sha, { cwd: targetDir }) : null;
      const summary = firstLine(note);
      return summary === null ? entry : { ...entry, title: summary };
    },
  );

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
    contract: state.currentSubtask
      ? {
          id: state.currentSubtask.id,
          title: state.currentSubtask.title,
          tier: state.activeIssue?.tier ?? "tier-3",
          decisionBudget: contract?.decisionBudget ?? "none",
          allowedFiles: contract?.allowedFiles ?? [],
        }
      : null,
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
      const summary = (entry.title || entry.summary || "—").replace(/\|/g, "\\|");
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

export function writeContextHandoffFile(targetDir: string = process.cwd()): ContextHandoff {
  const handoff = generateContextHandoff(targetDir);
  const filePath = getHandoffPath(targetDir);
  const dirPath = join(targetDir, ".lognexus");
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
  writeFileSync(filePath, renderContextHandoff(handoff), "utf8");
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
