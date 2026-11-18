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
    | "invalid-identity"
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
 * Strips matched outer parenthesis pairs (`((...))` -> `...`) in a single linear pass
 * without removing sibling groups such as `(a) (b)`.
 */
export function unwrapOuterBalancedParens(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length < 2 || trimmed[0] !== "(" || trimmed[trimmed.length - 1] !== ")") {
    return trimmed;
  }

  const matchClose = new Int32Array(trimmed.length).fill(-1);
  const stack: number[] = [];
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed.charCodeAt(i);
    if (ch === 40) {
      stack.push(i);
    } else if (ch === 41) {
      const openIdx = stack.pop();
      if (openIdx !== undefined) {
        matchClose[openIdx] = i;
      }
    }
  }

  let left = 0;
  let right = trimmed.length - 1;
  while (left < right && matchClose[left] === right) {
    left += 1;
    right -= 1;
    while (left <= right && trimmed.charCodeAt(left) <= 32) left += 1;
    while (right >= left && trimmed.charCodeAt(right) <= 32) right -= 1;
  }

  return left > right ? "" : trimmed.slice(left, right + 1);
}

function stripStrayOuterParens(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === "(") start += 1;
  while (end > start && value[end - 1] === ")") end -= 1;
  return value.slice(start, end);
}

function extractBalancedParenthetical(value: string, openIdx: number): string {
  let depth = 0;
  for (let i = openIdx; i < value.length; i += 1) {
    if (value[i] === "(") {
      depth += 1;
    } else if (value[i] === ")") {
      depth -= 1;
      if (depth === 0) {
        return value.slice(openIdx + 1, i).trim();
      }
    }
  }
  return value.slice(openIdx + 1).trim();
}

const INVALID_PLACEHOLDER_HEADS = new Set(["auto", "unknown", "unknown/other"]);

/**
 * Rejects template or placeholder agent identities (`auto`, bare `orchestrator`,
 * `unknown`, `unknown/other`, or `<provider>/<model>` placeholders) while keeping
 * empty/omitted strings (`false`) and qualified orchestrators (`Orchestrator (Carbon)`) distinct.
 */
export function isInvalidPlaceholderIdentity(raw?: string | null): boolean {
  if (raw == null) return false;
  let current = raw.trim().toLowerCase();
  if (current === "") return false;
  if (current.includes("<") || current.includes(">")) {
    return true;
  }

  for (let depth = 0; depth < 16 && current !== ""; depth += 1) {
    const parenIdx = current.indexOf("(");
    const head = (parenIdx === -1 ? current : current.slice(0, parenIdx)).trim();
    if (INVALID_PLACEHOLDER_HEADS.has(head)) {
      return true;
    }
    if (head !== "orchestrator") {
      return false;
    }
    if (parenIdx === -1) {
      return true;
    }
    const qualifier = extractBalancedParenthetical(current, parenIdx);
    if (qualifier === "") {
      return true;
    }
    current = qualifier;
  }
  return true;
}

/**
 * Client qualifiers can carry spaces (`deepseek/VS Code (kimi-code)`), so a naive
 * first-token match would truncate the family to `deepseek/vs`. The family is the
 * slash segment before the parenthetical qualifier, with inner whitespace collapsed
 * to single dashes; `deepseek/chat` keeps resolving to `deepseek/chat`.
 */
function extractFamily(value: string): string | null {
  const head = stripStrayOuterParens(value.split("(")[0].trim());
  if (FAMILY_PATTERN.test(head)) {
    return head.replace(/\s+/g, "-").toLowerCase();
  }
  for (const rawToken of value.trim().split(/\s+/)) {
    const token = stripStrayOuterParens(rawToken);
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
  "-extra",
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

function isAsciiDigits(value: string): boolean {
  if (value.length === 0) return false;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 48 || code > 57) return false;
  }
  return true;
}

function isLowerAlnumOrDash(value: string): boolean {
  if (value.length === 0) return false;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    const isLower = code >= 97 && code <= 122;
    const isDigit = code >= 48 && code <= 57;
    if (!isLower && !isDigit && code !== 45) return false;
  }
  return true;
}

/** Converts trailing `-<major>-<minor>` dash pairs on `claude/` slugs to `.<minor>` in O(n). */
function normalizeClaudeTrailingVersion(slug: string): string {
  if (!slug.startsWith("claude/")) return slug;
  const rest = slug.slice("claude/".length);
  const parts = rest.split("-");
  if (parts.length < 3) return slug;
  const minor = parts[parts.length - 1];
  const major = parts[parts.length - 2];
  const prefix = parts.slice(0, -2).join("-");
  if (!isLowerAlnumOrDash(prefix) || !isAsciiDigits(major) || !isAsciiDigits(minor)) {
    return slug;
  }
  return `claude/${prefix}-${major}.${minor}`;
}

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
  if (slug.startsWith("gemini-")) slug = `gemini/${slug.slice("gemini-".length)}`;
  if (slug.startsWith("claude-")) slug = `claude/${slug.slice("claude-".length)}`;
  slug = normalizeClaudeTrailingVersion(slug);
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
  ["pro-orchestrator", "gemini/carbon"],
  ["4-argon", "gemini/argon"],
  ["argon", "gemini/argon"],
  ["pro-orchestrator-argon", "gemini/argon"],
  ["4-neon", "gemini/neon"],
  ["neon", "gemini/neon"],
  ["pro-orchestrator-neon", "gemini/neon"],
  ["4-hydrogen", "gemini/hydrogen"],
  ["hydrogen", "gemini/hydrogen"],
  ["flash-worker-agy", "gemini/flash-worker-agy"],
]);

function parseIdentityInternal(value: string | null, depth: number): Identity | null {
  if (value === null) return null;

  const trimmedValue = value.trim();
  if (trimmedValue === "") return null;

  const cleaned = unwrapOuterBalancedParens(trimmedValue);
  if (cleaned === "") return null;

  const parenIdx = cleaned.indexOf("(");
  const rawHead = (parenIdx === -1 ? cleaned : cleaned.slice(0, parenIdx)).trim();
  const head = stripStrayOuterParens(rawHead);
  const collapsedHead = head.toLowerCase().replace(/[\s_]+/g, "-");
  if (collapsedHead === "orchestrator" && parenIdx !== -1 && depth < 16) {
    const qualifier = extractBalancedParenthetical(cleaned, parenIdx);
    const lowerQualifier = qualifier.toLowerCase();
    if (lowerQualifier.includes("carbon")) {
      return { full: trimmedValue.toLowerCase(), family: "gemini/carbon" };
    }
    if (lowerQualifier.includes("argon")) {
      return { full: trimmedValue.toLowerCase(), family: "gemini/argon" };
    }
    if (lowerQualifier.includes("neon")) {
      return { full: trimmedValue.toLowerCase(), family: "gemini/neon" };
    }
    if (qualifier !== "") {
      const inner = parseIdentityInternal(qualifier, depth + 1);
      if (inner !== null) {
        return { full: trimmedValue.toLowerCase(), family: inner.family };
      }
    }
  }

  const family = extractFamily(cleaned);
  if (family === null) {
    const trimmed = head.toLowerCase();
    if (trimmed === "") {
      const strippedFull = stripStrayOuterParens(cleaned).toLowerCase();
      return {
        full: trimmedValue.toLowerCase(),
        family: normalizeCanonicalFamily(strippedFull || cleaned.toLowerCase()),
      };
    }
    return {
      full: trimmedValue.toLowerCase(),
      family: normalizeCanonicalFamily(trimmed),
    };
  }

  return { full: trimmedValue.toLowerCase(), family: normalizeCanonicalFamily(family) };
}

export function parseIdentity(value: string | null): Identity | null {
  return parseIdentityInternal(value, 0);
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
  if (isInvalidPlaceholderIdentity(authorStr)) {
    return {
      violated: true,
      severity: "error",
      message: `Invalid placeholder author identity '${authorStr}'. Specify the exact runtime model identity (e.g. 'google/gemini-3.8-flash-high (antigravity)').`,
    };
  }
  if (
    reviewerStr !== null &&
    reviewerStr.trim() !== "" &&
    isInvalidPlaceholderIdentity(reviewerStr)
  ) {
    return {
      violated: true,
      severity: "error",
      message: `Invalid placeholder reviewer identity '${reviewerStr}'. Specify the exact runtime model identity (e.g. 'claude/opus-4.6 (claude-code)').`,
    };
  }

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

function matchSegment(segment: string, pattern: string): boolean {
  if (pattern === "*" || pattern === "**") return true;
  if (!pattern.includes("*")) return segment === pattern;

  const parts = pattern.split("*");
  const first = parts[0];
  const last = parts[parts.length - 1];
  if (!segment.startsWith(first)) return false;
  if (last !== "" && !segment.endsWith(last)) return false;

  let pos = first.length;
  const limit = segment.length - last.length;
  if (pos > limit) return false;

  for (let i = 1; i < parts.length - 1; i += 1) {
    const part = parts[i];
    if (part === "") continue;
    const idx = segment.indexOf(part, pos);
    if (idx === -1 || idx + part.length > limit) return false;
    pos = idx + part.length;
  }
  return true;
}

/**
 * Matches a normalized repository path against a contract rule (`dir/`, exact path,
 * intra-segment `*` wildcards, or `**` directory-crossing segments) in deterministic
 * linear time without `new RegExp`.
 */
export function matchesPath(file: string, rule: string): boolean {
  const normFile = normalizePath(file);
  const normRule = normalizePath(rule);
  if (normFile === "" || normRule === "") return false;
  if (normRule.endsWith("/") && !normRule.includes("*")) {
    return normFile.startsWith(normRule);
  }
  if (!normRule.includes("*")) return normFile === normRule;

  const fileSegments = normFile.split("/");
  let ruleSegments: string[];
  if (normRule.endsWith("/")) {
    let dirPrefix = normRule;
    while (dirPrefix.endsWith("/")) {
      dirPrefix = dirPrefix.slice(0, -1);
    }
    if (dirPrefix === "") return false;
    ruleSegments = [...dirPrefix.split("/"), "*", "**"];
  } else {
    ruleSegments = normRule.split("/");
  }
  let fi = 0;
  let ri = 0;
  let starRi = -1;
  let matchFi = 0;

  while (fi < fileSegments.length) {
    if (ri < ruleSegments.length && ruleSegments[ri] === "**") {
      starRi = ri;
      matchFi = fi;
      ri += 1;
    } else if (ri < ruleSegments.length && matchSegment(fileSegments[fi], ruleSegments[ri])) {
      fi += 1;
      ri += 1;
    } else if (starRi !== -1) {
      matchFi += 1;
      fi = matchFi;
      ri = starRi + 1;
    } else {
      return false;
    }
  }

  while (ri < ruleSegments.length && ruleSegments[ri] === "**") {
    ri += 1;
  }
  return ri === ruleSegments.length;
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

  const hasInvalidAuthor = isInvalidPlaceholderIdentity(item.author);
  const hasInvalidReviewer = isInvalidPlaceholderIdentity(item.reviewer);
  if (hasInvalidAuthor) {
    violations.push({
      ...base,
      rule: "invalid-identity",
      message: `Invalid placeholder Authored-by identity '${item.author}'. Specify the exact runtime model identity (e.g. 'google/gemini-3.8-flash-high (antigravity)').`,
      severity: "error",
    });
  }
  if (hasInvalidReviewer) {
    violations.push({
      ...base,
      rule: "invalid-identity",
      message: `Invalid placeholder Reviewed-by identity '${item.reviewer}'. Specify the exact runtime model identity (e.g. 'claude/opus-4.6 (claude-code)').`,
      severity: "error",
    });
  }

  if (!hasInvalidAuthor && !hasInvalidReviewer) {
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
