import { execFileSync } from "node:child_process";
import { rejectNotesReference, validateGitReference } from "../git/safe.js";
import { getNote } from "../notes/notes.js";
import { getJourneyTimeline, type TimelineItem } from "../timeline/timeline.js";

export interface AuditViolation {
  commitSha: string;
  shortSha: string;
  rule:
    | "commit-format"
    | "authored-by-trailer"
    | "git-note-presence"
    | "contract-files"
    | "review-gate-separation"
    | "base-branch-range";
  message: string;
  severity: "error" | "warn";
}

export interface AuditResult {
  passed: boolean;
  commitCount: number;
  violations: AuditViolation[];
  summary: {
    errors: number;
    warnings: number;
  };
}

const VALID_TYPES = "feat, fix, docs, refactor, test, chore, style, perf";
export const TICKET_PATTERN_SOURCE = "(?:#\\d+|[A-Z][A-Z0-9]*-\\d+)";
export const COMMIT_FORMAT_PATTERN = new RegExp(
  `^(feat|fix|docs|refactor|test|chore|style|perf)\\(${TICKET_PATTERN_SOURCE}(\\/T\\d+(?:-T?\\d+)?)?\\): \\S+`,
);
export const SUBJECT_TASK_PATTERN = new RegExp(
  `\\(${TICKET_PATTERN_SOURCE}\\/(T\\d+(?:-T?\\d+)?)\\)`,
  "i",
);
const IDENTITY_PATTERN = /(\S+\/\S+)/;
const TRAILER_PATTERN = /^\s*(Authored-by|Reviewed-by|Last-code-by|Updated-by):\s*(.+)$/gim;

interface NoteContract {
  allowedFiles?: unknown;
  forbiddenFiles?: unknown;
}

interface NotePayload {
  subtask?: { contract?: NoteContract | null } | null;
}

export interface Identity {
  full: string;
  family: string;
}

export function parseIdentity(value: string | null): Identity | null {
  if (value === null) return null;

  const match = value.match(IDENTITY_PATTERN);
  if (!match) {
    const trimmed = value.trim().toLowerCase();
    return trimmed === "" ? null : { full: trimmed, family: trimmed };
  }

  return { full: value.trim().toLowerCase(), family: match[1].toLowerCase() };
}

export function extractTrailers(commitBody: string): {
  author: string | null;
  reviewer: string | null;
} {
  let author: string | null = null;
  let reviewer: string | null = null;

  for (const match of commitBody.matchAll(TRAILER_PATTERN)) {
    const key = match[1].toLowerCase();
    const value = match[2].trim();
    if (value === "") continue;

    if (key === "authored-by") {
      author = value;
    } else if (key === "reviewed-by") {
      reviewer = value;
    }
  }

  return { author, reviewer };
}

export function checkSelfApproval(
  authorStr: string | null,
  reviewerStr: string | null,
): { isSelfApproval: boolean; message?: string } {
  const author = parseIdentity(authorStr);
  const reviewer = parseIdentity(reviewerStr);

  if (author !== null && reviewer !== null) {
    if (author.full === reviewer.full || author.family === reviewer.family) {
      return {
        isSelfApproval: true,
        message: `Self-approval detected: author '${authorStr}' and reviewer '${reviewerStr}' share the same identity or model family ('${author.family}').`,
      };
    }
  }

  return { isSelfApproval: false };
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string").map(normalizePath);
}

function matchesPath(file: string, rule: string): boolean {
  if (rule === "") return false;
  if (rule.endsWith("/")) return file.startsWith(rule);
  if (rule.includes("*")) {
    const pattern = new RegExp(
      `^${rule
        .split("*")
        .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*")}$`,
    );
    return pattern.test(file);
  }
  return file === rule;
}

function listCommitFiles(sha: string, targetDir: string): string[] {
  try {
    const safeSha = validateGitReference(sha);
    const output = execFileSync(
      "git",
      ["diff-tree", "--no-commit-id", "--name-only", "-r", safeSha],
      {
        cwd: targetDir,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
      },
    );
    return output
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => normalizePath(line))
      .filter((line) => line !== "");
  } catch {
    return [];
  }
}

function readContract(note: string | null): NoteContract | null {
  if (note === null) return null;
  try {
    const parsed = JSON.parse(note) as NotePayload;
    return parsed?.subtask?.contract ?? null;
  } catch {
    return null;
  }
}

function auditCommit(item: TimelineItem, targetDir: string): AuditViolation[] {
  const violations: AuditViolation[] = [];
  const base = { commitSha: item.sha, shortSha: item.shortSha };

  if (item.author === null) {
    violations.push({
      ...base,
      rule: "authored-by-trailer",
      message: `Missing 'Authored-by:' trailer in commit body (got: ${item.subject}).`,
      severity: "error",
    });
  }

  const selfApprovalCheck = checkSelfApproval(item.author, item.reviewer);
  if (selfApprovalCheck.isSelfApproval) {
    violations.push({
      ...base,
      rule: "review-gate-separation",
      message:
        selfApprovalCheck.message ??
        `Self-approval detected: author '${item.author}' and reviewer '${item.reviewer}' share the same identity.`,
      severity: "error",
    });
  }

  const note = getNote(item.sha, { cwd: targetDir });
  if (note === null) {
    violations.push({
      ...base,
      rule: "git-note-presence",
      message: "No Git Note found under refs/notes/lognexus (run 'lognexus note attach <sha>').",
      severity: "warn",
    });
  }

  if (!COMMIT_FORMAT_PATTERN.test(item.subject)) {
    violations.push({
      ...base,
      rule: "commit-format",
      message: `Subject does not match '<type>(#<issue>/T<n>): <description>' with a valid type (${VALID_TYPES}).`,
      severity: "warn",
    });
  } else if (!SUBJECT_TASK_PATTERN.test(item.subject)) {
    violations.push({
      ...base,
      rule: "commit-format",
      message: "Subject lacks a subtask tag 'T<n>' (e.g. 'feat(#9/T1): ...').",
      severity: "warn",
    });
  }

  const contract = readContract(note);
  if (contract !== null) {
    const allowedFiles = toStringList(contract.allowedFiles);
    const forbiddenFiles = toStringList(contract.forbiddenFiles);
    const changedFiles = listCommitFiles(item.sha, targetDir);

    const forbidden = changedFiles.filter((file) =>
      forbiddenFiles.some((rule) => matchesPath(file, rule)),
    );
    if (forbidden.length > 0) {
      violations.push({
        ...base,
        rule: "contract-files",
        message: `Commit touches forbidden file(s): ${forbidden.join(", ")}.`,
        severity: "error",
      });
    }

    if (allowedFiles.length > 0) {
      const outside = changedFiles.filter(
        (file) => !allowedFiles.some((rule) => matchesPath(file, rule)),
      );
      if (outside.length > 0) {
        violations.push({
          ...base,
          rule: "contract-files",
          message: `Commit touches file(s) outside the allowed set: ${outside.join(", ")}.`,
          severity: "error",
        });
      }
    }
  }

  return violations;
}

export function auditBranch(
  baseBranch: string = "main",
  targetDir: string = process.cwd(),
): AuditResult {
  const safeBase = rejectNotesReference(baseBranch, "audit base branch");
  const timeline = getJourneyTimeline(safeBase, targetDir);
  const violations = timeline.items.flatMap((item) => auditCommit(item, targetDir));

  const normalizedCurrent = timeline.branch.replace(/^refs\/heads\//, "");
  const normalizedBase = safeBase.replace(/^refs\/heads\//, "").replace(/^origin\//, "");
  if (normalizedCurrent === normalizedBase && timeline.commitCount === 0) {
    violations.push({
      commitSha: "HEAD",
      shortSha: "HEAD",
      rule: "base-branch-range",
      message: `Auditing base branch '${safeBase}' directly: 0 commits in range ${safeBase}..${timeline.branch}. Run from a feature branch or specify a base commit/range.`,
      severity: "error",
    });
  }

  const errors = violations.filter((violation) => violation.severity === "error").length;
  const warnings = violations.length - errors;

  return {
    passed: errors === 0,
    commitCount: timeline.commitCount,
    violations,
    summary: { errors, warnings },
  };
}

export function formatAuditResult(result: AuditResult): string {
  if (result.violations.length === 0) {
    return "[PASS] All traceability checks passed";
  }

  return result.violations
    .map((violation) => {
      const tag = violation.severity === "error" ? "[ERROR]" : "[WARN] ";
      return `${tag} ${violation.shortSha} ${violation.rule}: ${violation.message}`;
    })
    .join("\n");
}
