import { execFileSync } from "node:child_process";
import { rejectNotesReference, validateGitReference } from "../git/safe.js";
import { getNote } from "../notes/notes.js";
import {
  type EffectiveReviewGateMode,
  parseRoutingConfigContent,
  resolveRoutingProfile,
} from "../routing/profile.js";
import { inferTierFromAuthor, isGovernanceOrConfigSurface } from "../telemetry/detector.js";
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
    | "base-branch-range"
    | "tier-routing-violation";
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

const VALID_TYPES = "feat, fix, docs, refactor, test, chore, style, perf, ci, build";
export const TICKET_PATTERN_SOURCE = "(?:#\\d+|[A-Z][A-Z0-9]*-\\d+)";
export const SUBTASK_PATTERN_SOURCE = "T\\d+(?:-[a-zA-Z0-9]+)?";
export const COMMIT_FORMAT_PATTERN = new RegExp(
  `^(feat|fix|docs|refactor|test|chore|style|perf|ci|build)\\(${TICKET_PATTERN_SOURCE}(\\/${SUBTASK_PATTERN_SOURCE})?\\): \\S+`,
);
export const SUBJECT_TASK_PATTERN = new RegExp(
  `\\(${TICKET_PATTERN_SOURCE}\\/(${SUBTASK_PATTERN_SOURCE})\\)`,
  "i",
);
const FAMILY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_. -]+$/;

interface NoteContract {
  allowedFiles?: unknown;
  forbiddenFiles?: unknown;
}

interface NotePayload {
  issue?: { tier?: unknown } | null;
  subtask?: { contract?: NoteContract | null } | null;
  tier?: unknown;
  escalated?: unknown;
}

export interface Identity {
  full: string;
  family: string;
}

/**
 * Client qualifiers can carry spaces (`deepseek/VS Code (kimi-code)`), so a naive
 * first-token match would truncate the family to `deepseek/vs`. The family is the
 * slash segment before the parenthetical qualifier, with inner whitespace collapsed
 * to single dashes; `deepseek/chat` keeps resolving to `deepseek/chat`.
 */
function extractFamily(value: string): string | null {
  const head = value.split("(")[0].trim();
  if (FAMILY_PATTERN.test(head)) {
    return head.replace(/\s+/g, "-").toLowerCase();
  }
  for (const token of value.trim().split(/\s+/)) {
    const slashIdx = token.indexOf("/");
    if (slashIdx > 0 && slashIdx < token.length - 1) {
      return token.toLowerCase();
    }
  }
  return null;
}

/**
 * Official provider prefixes that may decorate a flagship slug.
 *
 * Stripping them is a `startsWith` probe rather than a regex alternation, so normalization
 * stays linear in the length of the identity string.
 */
const EFFORT_VARIANT_SUFFIXES = [
  "-extra-high",
  "-xtrahigh",
  "-xhigh",
  "-minimal",
  "-medium",
  "-high",
  "-low",
  "-none",
] as const;
const PROVIDER_ALIASES: ReadonlyArray<readonly [readonly string[], string]> = [
  [["google/", "vertex/", "vertexai/"], "gemini"],
  [["anthropic/"], "claude"],
];

function stripCanonicalDecorations(collapsed: string): string {
  let slug = collapsed;
  for (let i = 0; i < 2; i++) {
    const suffix = EFFORT_VARIANT_SUFFIXES.find((candidate) => slug.endsWith(candidate));
    if (!suffix) break;
    slug = slug.slice(0, -suffix.length);
  }

  for (const [prefixes, target] of PROVIDER_ALIASES) {
    const prefix = prefixes.find((p) => slug.startsWith(p));
    if (!prefix) continue;
    const rest = slug.slice(prefix.length);
    if (rest.startsWith(`${target}-`)) slug = `${target}/${rest.slice(target.length + 1)}`;
    else slug = rest.startsWith(`${target}/`) ? rest : `${target}/${rest}`;
    break;
  }
  if (slug.startsWith("claude-")) slug = `claude/${slug.slice("claude-".length)}`;
  if (slug.startsWith("claude/")) {
    slug = slug.replace(/^claude\/([a-z0-9-]+)-(\d+)-(\d+)$/, "claude/$1-$2.$3");
  }
  return slug;
}

function canonicalBasename(slug: string): string {
  if (slug.startsWith("gemini/")) return slug.slice("gemini/".length);
  if (slug.startsWith("gemini-")) return slug.slice("gemini-".length);
  return slug;
}

/**
 * Normalizes display names, provider prefixes, dash/dot versions, and effort suffixes onto a
 * canonical family identifier so formatting or reasoning-effort differences cannot bypass review gates.
 */
function normalizeCanonicalFamily(raw: string): string {
  const collapsed = raw
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
  const slug = stripCanonicalDecorations(collapsed);
  const basename = canonicalBasename(slug);

  return CANONICAL_FLAGSHIP_BASENAMES.get(basename) ?? slug;
}

/**
 * Tier-1 and tier-2 flagship basenames, keyed by the identity once provider prefix,
 * `gemini/` binder and `-high` suffix have been removed.
 */
const CANONICAL_FLAGSHIP_BASENAMES = new Map<string, string>([
  ["4-carbon", "gemini/carbon"],
  ["carbon", "gemini/carbon"],
  ["4-argon", "gemini/argon"],
  ["argon", "gemini/argon"],
  ["4-hydrogen", "gemini/hydrogen"],
  ["hydrogen", "gemini/hydrogen"],
]);

export function parseIdentity(value: string | null): Identity | null {
  if (value === null) return null;

  const head = value.split("(")[0].trim();
  const family = extractFamily(value);
  if (family === null) {
    const trimmed = head.toLowerCase();
    if (trimmed === "") {
      const fullOnly = value.trim().toLowerCase();
      return fullOnly === ""
        ? null
        : { full: fullOnly, family: normalizeCanonicalFamily(fullOnly) };
    }
    return {
      full: value.trim().toLowerCase(),
      family: normalizeCanonicalFamily(trimmed),
    };
  }

  return { full: value.trim().toLowerCase(), family: normalizeCanonicalFamily(family) };
}

export function extractTrailers(commitBody: string): {
  author: string | null;
  reviewer: string | null;
} {
  let author: string | null = null;
  let reviewer: string | null = null;

  for (const rawLine of commitBody.split(/\r?\n/)) {
    const line = rawLine.trim();
    const colonIdx = line.indexOf(":");
    if (colonIdx <= 0) continue;

    const key = line.slice(0, colonIdx).toLowerCase();
    const value = line.slice(colonIdx + 1).trim();
    if (value === "") continue;

    if (key === "authored-by") {
      author = value;
    } else if (key === "reviewed-by") {
      reviewer = value;
    }
  }

  return { author, reviewer };
}

export interface ReviewGateCheckResult {
  violated: boolean;
  severity: "error" | "warn";
  message?: string;
}

/**
 * Derives vendor strictly from the normalized model family prefix before `/`,
 * never from parenthetical client qualifiers.
 */
export function extractVendor(identity: Identity): string {
  return identity.family.split("/")[0];
}

/**
 * Evaluates review-gate separation under the resolved `review_gate` mode.
 * Identical full identity (`author.full === reviewer.full`) is an unbreakable error floor in all modes.
 */
export function checkReviewGate(
  authorStr: string | null,
  reviewerStr: string | null,
  mode: EffectiveReviewGateMode = "intra-fleet",
): ReviewGateCheckResult {
  const author = parseIdentity(authorStr);
  const reviewer = parseIdentity(reviewerStr);
  if (author === null || reviewer === null) {
    return { violated: false, severity: "error" };
  }

  if (author.full === reviewer.full) {
    return {
      violated: true,
      severity: "error",
      message: `Self-approval detected: author '${authorStr}' and reviewer '${reviewerStr}' share the same identity ('${author.full}').`,
    };
  }

  if (mode === "off") return { violated: false, severity: "warn" };

  if (author.family === reviewer.family) {
    return {
      violated: true,
      severity: mode === "advisory" ? "warn" : "error",
      message: `Self-approval detected: author '${authorStr}' and reviewer '${reviewerStr}' share the same model family ('${author.family}')${mode === "advisory" ? " (advisory review_gate mode)" : ""}.`,
    };
  }

  if (mode === "cross-vendor") {
    const vendor = extractVendor(author);
    if (vendor === extractVendor(reviewer)) {
      return {
        violated: true,
        severity: "error",
        message: `Cross-vendor review-gate violation: author '${authorStr}' and reviewer '${reviewerStr}' share the same vendor ('${vendor}').`,
      };
    }
  }

  return { violated: false, severity: mode === "advisory" ? "warn" : "error" };
}

export function checkSelfApproval(
  authorStr: string | null,
  reviewerStr: string | null,
): { isSelfApproval: boolean; message?: string } {
  const res = checkReviewGate(authorStr, reviewerStr, "intra-fleet");
  return res.violated ? { isSelfApproval: true, message: res.message } : { isSelfApproval: false };
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

function isEscalationAcknowledged(note: string | null, subject: string): boolean {
  if (/\[escalated\]/i.test(subject)) return true;
  if (note === null) return false;
  try {
    const parsed = JSON.parse(note) as NotePayload;
    return parsed?.escalated === true;
  } catch {
    return false;
  }
}

/**
 * A tier-1 issue declares its subtasks as orchestrator work, so a tier-1 author editing
 * implementation files there is inside its scope and needs no escalation acknowledgement.
 */
function isTierOneIssue(note: string | null): boolean {
  if (note === null) return false;
  try {
    const parsed = JSON.parse(note) as NotePayload;
    return parsed?.issue?.tier === "tier-1";
  } catch {
    return false;
  }
}

function isImplementationFile(file: string): boolean {
  return !isGovernanceOrConfigSurface(file) && !file.startsWith(".lognexus/");
}

/**
 * Framework bookkeeping (`state.json`, plan files) is rewritten by the CLI on the
 * agent's behalf and never describes the delivered change, so it must not count
 * as scope drift against a subtask contract.
 */
function isBookkeepingFile(file: string): boolean {
  return file.startsWith(".lognexus/") || file.startsWith("docs/contexto/");
}

const GATE_STRICTNESS: Record<EffectiveReviewGateMode, number> = {
  off: 0,
  advisory: 1,
  "intra-fleet": 2,
  "cross-vendor": 3,
};

function readGitFileAtRef(ref: string, filePath: string, targetDir: string): string | null {
  try {
    const safeRef = validateGitReference(ref);
    return execFileSync("git", ["show", `${safeRef}:${filePath}`], {
      cwd: targetDir,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });
  } catch {
    return null;
  }
}

function parseEffectiveGate(content: string): EffectiveReviewGateMode {
  const { configuredReviewGate } = parseRoutingConfigContent(content);
  return configuredReviewGate === "auto" ? "intra-fleet" : configuredReviewGate;
}

function auditCommit(
  item: TimelineItem,
  targetDir: string,
  gateMode: EffectiveReviewGateMode,
): AuditViolation[] {
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

  const gateCheck = checkReviewGate(item.author, item.reviewer, gateMode);
  if (gateCheck.violated) {
    violations.push({
      ...base,
      rule: "review-gate-separation",
      message:
        gateCheck.message ??
        `Self-approval detected: author '${item.author}' and reviewer '${item.reviewer}' share the same identity.`,
      severity: gateCheck.severity,
    });
  }

  const changedFiles = listCommitFiles(item.sha, targetDir);
  if (changedFiles.includes(".lognexus/routing.md")) {
    const commitRouting = readGitFileAtRef(item.sha, ".lognexus/routing.md", targetDir);
    if (commitRouting !== null) {
      const commitGate = parseEffectiveGate(commitRouting);
      if (GATE_STRICTNESS[commitGate] < GATE_STRICTNESS[gateMode]) {
        violations.push({
          ...base,
          rule: "review-gate-separation",
          message: `Commit modifies .lognexus/routing.md and weakens review_gate from '${gateMode}' to '${commitGate}'; base branch gate '${gateMode}' remains enforced.`,
          severity: "warn",
        });
      }
    }
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
        (file) => !isBookkeepingFile(file) && !allowedFiles.some((rule) => matchesPath(file, rule)),
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

    if (
      inferTierFromAuthor(item.author) === "tier-1" &&
      !isTierOneIssue(note) &&
      !isEscalationAcknowledged(note, item.subject)
    ) {
      const implementationFiles = changedFiles.filter(isImplementationFile);
      if (implementationFiles.length > 0) {
        violations.push({
          ...base,
          rule: "tier-routing-violation",
          message: `Tier-1 author '${item.author}' modified implementation file(s) on a contracted subtask without an escalation acknowledgement: ${implementationFiles.join(", ")}.`,
          severity: "warn",
        });
      }
    }
  }

  return violations;
}

export function auditBranch(
  baseBranch: string = "main",
  targetDir: string = process.cwd(),
  options?: { reviewGateMode?: EffectiveReviewGateMode },
): AuditResult {
  const safeBase = rejectNotesReference(baseBranch, "audit base branch");
  const baseRoutingRaw = readGitFileAtRef(safeBase, ".lognexus/routing.md", targetDir);
  const gateMode: EffectiveReviewGateMode =
    options?.reviewGateMode ??
    (baseRoutingRaw !== null
      ? parseEffectiveGate(baseRoutingRaw)
      : resolveRoutingProfile(targetDir).effectiveReviewGate);

  const timeline = getJourneyTimeline(safeBase, targetDir);
  const violations = timeline.items.flatMap((item) => auditCommit(item, targetDir, gateMode));

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
