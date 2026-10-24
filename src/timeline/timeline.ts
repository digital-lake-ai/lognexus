import { execFileSync } from "node:child_process";
import { getNote } from "../notes/notes.js";

export function validateGitReference(ref: string): string {
  const sanitized = ref.trim();
  if (!/^[a-zA-Z0-9._/-]+$/.test(sanitized) || sanitized.startsWith("-")) {
    throw new Error(`Governance violation: Invalid or unsafe Git reference provided: "${ref}"`);
  }
  return sanitized;
}

export function sanitizeMarkdown(value: string | null): string {
  if (value === null || value === "") return NO_VALUE;
  return value
    .replace(/\|/g, "\\|")
    .replace(/`/g, "'")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\*/g, "\\*");
}

export interface TimelineItem {
  sha: string;
  shortSha: string;
  date: string;
  subject: string;
  taskId: string | null;
  taskTitle: string | null;
  tier: string | null;
  author: string | null;
  reviewer: string | null;
  hasNote: boolean;
}

export interface JourneyTimelineResult {
  branch: string;
  baseBranch: string;
  commitCount: number;
  items: TimelineItem[];
  markdownTable: string;
  prBodyDraft: string;
}

const TRAILER_PATTERN = /^\s*(Authored-by|Reviewed-by|Last-code-by|Updated-by):\s*(.+)$/gim;
const TASK_ID_PATTERN = /\((?:#\d+|[A-Z][A-Z0-9]*-\d+)\/(T[\d]+(?:-T?[\d]+)?)\)/i;
const SUBJECT_TASK_PATTERN = /\b(T\d+(?:-T?\d+)?)\b/;
const TIER_PATTERN = /\[(tier-\d)\]|(?:^|\s)(tier-\d)(?:\s|$)/i;
const BRANCH_ISSUE_PATTERN = /issue\/(\d+)/i;
const FIELD_SEPARATOR = "\x1f";
const RECORD_SEPARATOR = "\x1e";
const NO_VALUE = "—";

interface RawCommit {
  sha: string;
  shortSha: string;
  date: string;
  subject: string;
  body: string;
}

interface NotePayload {
  subtask?: { id?: unknown; title?: unknown } | null;
  tier?: unknown;
}

function runGit(args: string[], targetDir: string): string | null {
  try {
    const output = execFileSync("git", args, {
      cwd: targetDir,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });
    return output.replace(/\r\n/g, "\n");
  } catch {
    return null;
  }
}

function getCurrentBranch(targetDir: string): string {
  const branch = runGit(["branch", "--show-current"], targetDir)?.trim();
  return branch ? branch : "detached";
}

function refExists(ref: string, targetDir: string): boolean {
  const output = runGit(["rev-parse", "--verify", "--quiet", ref], targetDir);
  return output !== null && output.trim() !== "";
}

function resolveBaseBranch(
  requested: string,
  _currentBranch: string,
  targetDir: string,
): string | null {
  const candidates = [requested, `origin/${requested}`];

  const remoteHead = runGit(
    ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
    targetDir,
  );
  if (remoteHead) {
    candidates.push(remoteHead.trim());
  }

  for (const candidate of candidates) {
    if (candidate === "") continue;
    if (refExists(candidate, targetDir)) return candidate;
  }

  for (const fallback of ["main", "master", "origin/main", "origin/master"]) {
    if (refExists(fallback, targetDir)) return fallback;
  }

  return null;
}

function listCommits(base: string | null, targetDir: string): RawCommit[] {
  if (base === null) return [];
  const range = `${base}..HEAD`;
  const format = `--pretty=format:%H${FIELD_SEPARATOR}%h${FIELD_SEPARATOR}%ad${FIELD_SEPARATOR}%s${FIELD_SEPARATOR}%b${RECORD_SEPARATOR}`;
  const output = runGit(["log", range, format, "--date=iso"], targetDir);
  if (!output) return [];

  const commits: RawCommit[] = [];
  for (const record of output.split(RECORD_SEPARATOR)) {
    const trimmed = record.replace(/^\n+/, "");
    if (trimmed === "") continue;

    const [sha, shortSha, date, subject, ...body] = trimmed.split(FIELD_SEPARATOR);
    if (!sha || !shortSha) continue;

    commits.push({
      sha: sha.trim(),
      shortSha: shortSha.trim(),
      date: (date ?? "").trim(),
      subject: (subject ?? "").trim(),
      body: body.join(FIELD_SEPARATOR).trim(),
    });
  }

  return commits;
}

function readTrailer(body: string, trailer: string): string | null {
  const target = trailer.toLowerCase();
  let value: string | null = null;

  for (const match of body.matchAll(TRAILER_PATTERN)) {
    if (match[1].toLowerCase() === target) {
      const trimmed = match[2].trim();
      if (trimmed !== "") value = trimmed;
    }
  }

  return value;
}

function parseNotePayload(note: string | null): NotePayload | null {
  if (note === null) return null;
  try {
    const parsed = JSON.parse(note) as unknown;
    if (parsed === null || typeof parsed !== "object") return null;
    return parsed as NotePayload;
  } catch {
    return null;
  }
}

function extractTaskId(subject: string): string | null {
  const scoped = subject.match(TASK_ID_PATTERN);
  if (scoped) return scoped[1].toUpperCase();

  const loose = subject.match(SUBJECT_TASK_PATTERN);
  if (loose) return loose[1].toUpperCase();

  return null;
}

function extractTier(subject: string): string | null {
  const match = subject.match(TIER_PATTERN);
  if (!match) return null;
  return (match[1] ?? match[2] ?? "").toLowerCase() || null;
}

function buildItem(commit: RawCommit, targetDir: string): TimelineItem {
  const note = getNote(commit.sha, { cwd: targetDir });
  const payload = parseNotePayload(note);

  const noteSubtaskId =
    payload?.subtask && typeof payload.subtask.id === "string" && payload.subtask.id.trim() !== ""
      ? payload.subtask.id.trim()
      : null;
  const noteSubtaskTitle =
    payload?.subtask &&
    typeof payload.subtask.title === "string" &&
    payload.subtask.title.trim() !== ""
      ? payload.subtask.title.trim()
      : null;
  const noteTier =
    typeof payload?.tier === "string" && payload.tier.trim() !== "" ? payload.tier.trim() : null;

  return {
    sha: commit.sha,
    shortSha: commit.shortSha,
    date: commit.date,
    subject: commit.subject,
    taskId: noteSubtaskId ?? extractTaskId(commit.subject),
    taskTitle: noteSubtaskTitle,
    tier: noteTier ?? extractTier(commit.subject),
    author: readTrailer(commit.body, "Authored-by"),
    reviewer: readTrailer(commit.body, "Reviewed-by"),
    hasNote: note !== null,
  };
}

function cell(value: string | null): string {
  if (value === null || value === "") return NO_VALUE;
  return `\`${value.replace(/\|/g, "\\|")}\``;
}

export function buildTimelineTable(items: TimelineItem[]): string {
  const lines = [
    "| Commit | Subtask | Summary | Tier | Author | Note |",
    "|---|---|---|---|---|---|",
  ];

  for (const item of items) {
    lines.push(
      `| ${cell(item.shortSha)} | ${cell(item.taskId)} | ${sanitizeMarkdown(item.subject)} | ${cell(item.tier)} | ${cell(item.author)} | ${item.hasNote ? "Yes" : "No"} |`,
    );
  }

  return lines.join("\n");
}

function extractIssueNumber(branch: string): string | null {
  const match = branch.match(BRANCH_ISSUE_PATTERN);
  if (match) return `#${match[1]}`;
  const alphanumericMatch = branch.match(/([A-Z][A-Z0-9]*-\d+)/i);
  if (alphanumericMatch) return alphanumericMatch[1].toUpperCase();
  return null;
}

function buildPrBodyDraft(branch: string, baseBranch: string, items: TimelineItem[]): string {
  const issueNumber = extractIssueNumber(branch);
  const closingLine = issueNumber ? `Closes ${issueNumber}` : "Closes #<N>";
  const lastAuthor = [...items].reverse().find((item) => item.author !== null)?.author ?? null;
  const signature = lastAuthor ?? "<family>/<version> (<tool>)";

  const changes =
    items.length === 0
      ? "_No commits ahead of the base branch yet._"
      : items
          .map((item) => `- \`${item.shortSha}\` — ${sanitizeMarkdown(item.subject)}`)
          .join("\n");

  const tiers = [...new Set(items.map((item) => item.tier).filter((tier) => tier !== null))];
  const notesCoverage = items.filter((item) => item.hasNote).length;

  return `<!-- lognexus:
kind: history
status: open
phase: 5
readiness: needs-review
branch: ${branch}
base_branch: ${baseBranch}
task_count: ${items.length}
tasks_complete: ${items.length}
updated_at: ${new Date().toISOString()}
-->

## Summary

- ${items.length} commit(s) ahead of \`${baseBranch}\` on \`${branch}\`.
- Tiers involved: ${tiers.length > 0 ? tiers.map((tier) => `\`${tier}\``).join(", ") : NO_VALUE}.
- Git Note coverage: ${notesCoverage}/${items.length} commit(s).

${closingLine}

## Journey Timeline

### Initial Plan

<TODO: 1-2 sentences on what the issue called for>

### What We Discovered

<TODO: discoveries, blockers encountered, approach changes; remove this section if none>

### Key Decisions

| Decision | Rationale |
|----------|-----------|
| <TODO: decision> | <TODO: why> |

### Changes Made

${changes}

### Traceability

${buildTimelineTable(items)}

## Verification

- [ ] \`npm run build\`
- [ ] \`npm run lint\`
- [ ] \`npm test\`
- [ ] \`lognexus audit ${baseBranch}\` passes

## Reviews

<!-- Awaiting cross-model review. See commands/lognexus/review.md for the review sub-skill. -->

Current state: awaiting review
Last reviewed by: —
Last reviewed at: —
Reviewed commit: —
Source artifact: —
Needs re-review since: —

---
Authored-by: ${signature}
Last-code-by: ${signature}
*Captain's log — PR timeline by **lognexus***`;
}

export function getJourneyTimeline(
  baseBranch: string = "main",
  targetDir: string = process.cwd(),
): JourneyTimelineResult {
  const safeBase = validateGitReference(baseBranch);
  const branch = getCurrentBranch(targetDir);
  const resolvedBase = resolveBaseBranch(safeBase, branch, targetDir);
  const rawCommits = listCommits(resolvedBase, targetDir);
  const items = rawCommits.map((commit) => buildItem(commit, targetDir));
  const effectiveBase = resolvedBase ?? `${safeBase} (unresolved)`;

  return {
    branch,
    baseBranch: effectiveBase,
    commitCount: items.length,
    items,
    markdownTable: buildTimelineTable(items),
    prBodyDraft: buildPrBodyDraft(branch, effectiveBase, items),
  };
}
