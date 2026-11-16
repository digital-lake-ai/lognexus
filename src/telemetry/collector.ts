import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractTrailers, SUBJECT_TASK_PATTERN } from "../audit/audit.js";
import { getCliVersion } from "../cli.js";
import { validateGitReference } from "../git/safe.js";
import { getNote, listNotes } from "../notes/notes.js";
import {
  type DiffStatItem,
  detectProjectStacks,
  extractCommitDiffStats,
  extractModelFamilyCategory,
  inferTierFromAuthor,
} from "./detector.js";
import {
  type AnonymousDiagnosticPayload,
  DEFAULT_TELEMETRY_SUMMARY,
  type DiffCategory,
  type ExtensionStat,
  type ModelStat,
  type TelemetryMode,
  type TelemetryStore,
  TelemetryStoreSchema,
} from "./schema.js";

/**
 * Restricts a telemetry recomputation to a single issue, date range or branch.
 *
 * A scoped recomputation is returned in memory only: it never rewrites the local store,
 * so ad-hoc reporting can never corrupt the persisted aggregates.
 */
export interface ScopedTelemetryFilter {
  issue?: string | number;
  since?: string;
  branch?: string;
}

/**
 * Economic profile of one routing tier.
 *
 * `base*` charges the fixed reasoning overhead of a single commit and `per*Loc*` charges
 * every changed line, so a 400-line subtask costs far more than a 3-line typo fix while
 * documentation churn stays cheap at every tier.
 */
export interface TierPricingProfile {
  baseUsd: number;
  perSourceLocUsd: number;
  perDocsLocUsd: number;
  baseInputTokens: number;
  inputTokensPerLoc: number;
  outputTokensPerLoc: number;
}

export const TIER_PRICING_PROFILES: Record<"tier-1" | "tier-2" | "tier-3", TierPricingProfile> = {
  "tier-1": {
    baseUsd: 0.05,
    perSourceLocUsd: 0.00015,
    perDocsLocUsd: 0.00004,
    baseInputTokens: 3200,
    inputTokensPerLoc: 14,
    outputTokensPerLoc: 8,
  },
  "tier-2": {
    baseUsd: 0.015,
    perSourceLocUsd: 0.000045,
    perDocsLocUsd: 0.000012,
    baseInputTokens: 2400,
    inputTokensPerLoc: 12,
    outputTokensPerLoc: 7,
  },
  "tier-3": {
    baseUsd: 0.002,
    perSourceLocUsd: 0.000008,
    perDocsLocUsd: 0.000002,
    baseInputTokens: 1600,
    inputTokensPerLoc: 10,
    outputTokensPerLoc: 6,
  },
};

export type PricingTierKey = keyof typeof TIER_PRICING_PROFILES;

/**
 * Loc-weighted token and cost model of one commit: `sourceLoc` prices source and test
 * lines (same authoring effort), `docsLoc` prices documentation and configuration lines.
 */
export interface LocPricing {
  sourceLoc: number;
  docsLoc: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

function round3(value: number): number {
  return Number(value.toFixed(3));
}

/**
 * Resolves any tier string (including legacy or unexpected values) onto a priced profile,
 * defaulting to the cheap execution tier used by inline scoped agents.
 */
function resolvePricingTier(tier: string | null | undefined): PricingTierKey {
  if (tier === "tier-1" || tier === "tier-2" || tier === "tier-3") return tier;
  return "tier-3";
}

/**
 * Prices a commit from its diff categories alone.
 *
 * Test lines are billed as source because they carry the same authoring effort, which is
 * what makes a large refactor with a matching test suite visibly more expensive than a
 * prose-only change. Rounding happens on the per-commit total so summing thousands of
 * commits cannot drift.
 */
export function estimateCommitPricing(
  authorOrTier: string | null | undefined,
  linesByCategory: Partial<Record<DiffCategory, number>>,
): LocPricing {
  const tier = resolvePricingTier(authorOrTier);
  const profile = TIER_PRICING_PROFILES[tier];

  const sourceLoc = (linesByCategory.source ?? 0) + (linesByCategory.test ?? 0);
  const docsLoc = (linesByCategory.docs ?? 0) + (linesByCategory.config ?? 0);

  const inputTokens = Math.round(
    profile.baseInputTokens + (sourceLoc + docsLoc) * profile.inputTokensPerLoc,
  );
  const outputTokens = Math.round((sourceLoc + docsLoc) * profile.outputTokensPerLoc);
  const costUsd = Number(
    (
      profile.baseUsd +
      sourceLoc * profile.perSourceLocUsd +
      docsLoc * profile.perDocsLocUsd
    ).toFixed(6),
  );

  return { sourceLoc, docsLoc, inputTokens, outputTokens, costUsd };
}

/**
 * Seeds a model bucket with every numeric field spelled out.
 *
 * Relying on the schema defaults here is not equivalent: `accumulateModelPricing` reads the
 * bucket before validation ever runs, and `undefined + number` would poison the aggregate
 * with `NaN`, which `JSON.stringify` then persists as `null` and rejects on reload.
 */
function createModelStat(family: string, tier: string): ModelStat {
  return {
    family,
    tier,
    commits: 0,
    totalDurationSec: 0,
    avgSubtaskDurationSec: 0,
    sourceLinesAdded: 0,
    docsLinesAdded: 0,
    estimatedInputTokens: 0,
    estimatedOutputTokens: 0,
    estimatedCostUsd: 0,
  };
}

/**
 * Accumulates a commit's LOC split, estimated tokens and estimated cost onto a model
 * bucket so both the live recorder and the Git-note reconciliation price identically.
 */
function accumulateModelPricing(
  model: ModelStat,
  linesByCategory: Partial<Record<DiffCategory, number>>,
): void {
  for (const [category, lines] of Object.entries(linesByCategory)) {
    const added = Number.isFinite(lines) ? (lines ?? 0) : 0;
    if (category === "source" || category === "test") {
      model.sourceLinesAdded += added;
    } else {
      model.docsLinesAdded += added;
    }
  }

  const pricing = estimateCommitPricing(model.tier, linesByCategory);
  model.estimatedInputTokens += pricing.inputTokens;
  model.estimatedOutputTokens += pricing.outputTokens;
  model.estimatedCostUsd = round6(model.estimatedCostUsd + pricing.costUsd);
}

function round6(value: number): number {
  return Number(value.toFixed(6));
}

/** Folds one diff bucket into the summary's per-category line counters. */
function accumulateCategoryLines(
  summary: TelemetryStore["summary"],
  category: DiffCategory,
  linesAdded: number,
): void {
  if (category === "test") {
    summary.testLinesAdded += linesAdded;
  } else if (category === "docs") {
    summary.docsLinesAdded += linesAdded;
  } else if (category === "config") {
    summary.configLinesAdded += linesAdded;
  } else {
    summary.sourceLinesAdded += linesAdded;
  }
}

/** Totals a commit's added lines per diff category for the LOC-weighted pricing model. */
function linesByCategory(items: DiffStatItem[]): Partial<Record<DiffCategory, number>> {
  const totals: Partial<Record<DiffCategory, number>> = {};
  for (const item of items) {
    totals[item.category] = (totals[item.category] ?? 0) + item.linesAdded;
  }
  return totals;
}

export const LOCAL_ONLY_TELEMETRY_ERROR =
  "Community telemetry dispatch has been retired in favor of strict local-only telemetry. Run 'lognexus telemetry enable' for local performance metrics (zero network calls).";

export function isTelemetryGloballyDisabled(): boolean {
  return (
    process.env.DO_NOT_TRACK === "1" ||
    process.env.DO_NOT_TRACK === "true" ||
    process.env.LOGNEXUS_TELEMETRY_DISABLED === "1" ||
    process.env.LOGNEXUS_TELEMETRY_DISABLED === "true"
  );
}

export function getTelemetryPath(targetDir: string = process.cwd()): string {
  return join(targetDir, ".lognexus", "telemetry.json");
}

export function createDefaultTelemetryStore(targetDir: string = process.cwd()): TelemetryStore {
  return {
    schemaVersion: "2.0.0",
    mode: "off",
    anonymousProjectId: randomUUID(),
    consent: {
      accepted: false,
      policyVersion: "1.0.0",
      acceptedAt: null,
    },
    detectedStacks: detectProjectStacks(targetDir),
    taskTimings: {},
    extensions: {},
    models: {},
    summary: { ...DEFAULT_TELEMETRY_SUMMARY },
    lastUpdated: new Date().toISOString(),
  };
}

export function loadTelemetry(targetDir: string = process.cwd()): TelemetryStore {
  if (isTelemetryGloballyDisabled()) {
    const store = createDefaultTelemetryStore(targetDir);
    store.mode = "off";
    return store;
  }

  const filePath = getTelemetryPath(targetDir);
  if (!existsSync(filePath)) {
    return createDefaultTelemetryStore(targetDir);
  }

  try {
    const raw = readFileSync(filePath, "utf8");
    const json = JSON.parse(raw);
    const parsed = TelemetryStoreSchema.safeParse(json);
    if (parsed.success) {
      return parsed.data;
    }
  } catch {
    // Ignore corrupt files and return default
  }

  return createDefaultTelemetryStore(targetDir);
}

export function saveTelemetry(store: TelemetryStore, targetDir: string = process.cwd()): void {
  const dirPath = join(targetDir, ".lognexus");
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }

  store.lastUpdated = new Date().toISOString();
  store.detectedStacks = detectProjectStacks(targetDir);

  const filePath = getTelemetryPath(targetDir);
  writeFileSync(filePath, JSON.stringify(store, null, 2), "utf8");
}

export function isTelemetryActive(targetDir: string = process.cwd()): boolean {
  if (isTelemetryGloballyDisabled()) return false;
  const store = loadTelemetry(targetDir);
  return store.mode === "local";
}

export function enableTelemetry(options: {
  share?: boolean;
  acceptTerms?: boolean;
  cwd?: string;
}): { mode: TelemetryMode; anonymousProjectId: string } {
  const cwd = options.cwd ?? process.cwd();
  const store = loadTelemetry(cwd);

  if (options.share) {
    throw new Error(LOCAL_ONLY_TELEMETRY_ERROR);
  }

  store.mode = "local";
  saveTelemetry(store, cwd);
  return { mode: store.mode, anonymousProjectId: store.anonymousProjectId };
}

export function disableTelemetry(targetDir: string = process.cwd()): void {
  const store = loadTelemetry(targetDir);
  store.mode = "off";
  saveTelemetry(store, targetDir);
}

export function clearTelemetry(targetDir: string = process.cwd()): void {
  const store = createDefaultTelemetryStore(targetDir);
  store.mode = "off";
  saveTelemetry(store, targetDir);
}

export function recordTaskStart(taskId: string, targetDir: string = process.cwd()): void {
  if (!isTelemetryActive(targetDir)) return;

  const store = loadTelemetry(targetDir);
  store.taskTimings[taskId] = {
    taskId,
    startedAt: new Date().toISOString(),
    completedAt: null,
    durationSec: 0,
  };
  saveTelemetry(store, targetDir);
}

export function recordTaskFinish(taskId: string, targetDir: string = process.cwd()): number {
  if (!isTelemetryActive(targetDir)) return 0;

  const store = loadTelemetry(targetDir);
  const entry = store.taskTimings[taskId];
  let durationSec = 0;

  if (entry?.startedAt) {
    const started = new Date(entry.startedAt).getTime();
    const now = Date.now();
    durationSec = Math.max(1, Math.round((now - started) / 1000));
    entry.completedAt = new Date(now).toISOString();
    entry.durationSec = durationSec;
  }

  store.summary.totalSubtasksCompleted += 1;
  saveTelemetry(store, targetDir);
  return durationSec;
}

export function recordReviewGateBlock(targetDir: string = process.cwd()): void {
  if (!isTelemetryActive(targetDir)) return;

  const store = loadTelemetry(targetDir);
  store.summary.reviewGateBlocksPrevented += 1;
  saveTelemetry(store, targetDir);
}

/**
 * Recomputes the cost/token roll-up from the per-model buckets.
 *
 * The baseline prices every commit as if a frontier orchestrator had authored it alone,
 * from LOC-weighted profiles rather than a flat per-commit rate, so a heavy refactor is
 * never under-priced. Totals are re-derived from `store.models`, which keeps the call
 * idempotent and lets a partially-backfilled store converge after one pass.
 */
export function updateCostSavingsEstimate(store: TelemetryStore): void {
  const sum = store.summary;
  const models = Object.values(store.models);

  let totalSourceLoc = 0;
  let totalDocsLoc = 0;
  let totalCommits = 0;
  let actualCostRaw = 0;
  let actualInputTokens = 0;
  let actualOutputTokens = 0;

  for (const model of models) {
    totalSourceLoc += model.sourceLinesAdded;
    totalDocsLoc += model.docsLinesAdded;
    totalCommits += model.commits;
    actualCostRaw += model.estimatedCostUsd;
    actualInputTokens += model.estimatedInputTokens;
    actualOutputTokens += model.estimatedOutputTokens;
  }

  sum.tierCommits = { "tier-1": 0, "tier-2": 0, "tier-3": 0 };
  for (const model of models) {
    const tier = resolvePricingTier(model.tier);
    sum.tierCommits[tier] += model.commits;
  }

  if (totalCommits === 0) {
    sum.estimatedBaselineCostUsd = 0;
    sum.estimatedActualCostUsd = 0;
    sum.estimatedCostSavingsUsd = 0;
    sum.estimatedCostSavingsPct = 0;
    sum.estimatedBaselineTokens = 0;
    sum.estimatedActualTokens = 0;
    sum.estimatedTokensSaved = 0;
    return;
  }

  const baselineProfile = TIER_PRICING_PROFILES["tier-1"];
  const totalLoc = totalSourceLoc + totalDocsLoc;
  const baselineCostRaw =
    totalCommits * baselineProfile.baseUsd +
    totalSourceLoc * baselineProfile.perSourceLocUsd +
    totalDocsLoc * baselineProfile.perDocsLocUsd;
  const baselineTokens = Math.round(
    totalCommits * baselineProfile.baseInputTokens +
      totalLoc * baselineProfile.inputTokensPerLoc +
      totalLoc * baselineProfile.outputTokensPerLoc,
  );
  const actualTokens = actualInputTokens + actualOutputTokens;

  const roundedBaseline = round3(baselineCostRaw);
  const roundedActual = round3(actualCostRaw);
  const savingsUsd = Math.max(0, round3(roundedBaseline - roundedActual));

  sum.estimatedBaselineCostUsd = roundedBaseline;
  sum.estimatedActualCostUsd = roundedActual;
  sum.estimatedCostSavingsUsd = savingsUsd;
  sum.estimatedCostSavingsPct =
    roundedBaseline > 0 ? Number(((savingsUsd / roundedBaseline) * 100).toFixed(1)) : 0;
  sum.estimatedBaselineTokens = baselineTokens;
  sum.estimatedActualTokens = actualTokens;
  sum.estimatedTokensSaved = Math.max(0, baselineTokens - actualTokens);
}

export function recordCommitTelemetry(options: {
  sha: string;
  author?: string;
  tier?: string;
  targetDir?: string;
}): void {
  const cwd = options.targetDir ?? process.cwd();
  if (!isTelemetryActive(cwd)) return;

  const store = loadTelemetry(cwd);
  const diffItems = extractCommitDiffStats(options.sha, cwd);

  let commitAdded = 0;
  let commitDeleted = 0;
  const seenExts = new Set<string>();

  for (const item of diffItems) {
    commitAdded += item.linesAdded;
    commitDeleted += item.linesDeleted;
    accumulateCategoryLines(store.summary, item.category, item.linesAdded);

    // One commit touching `.ts` in `src/` and `tests/` counts as a single `.ts` commit.
    if (seenExts.has(item.ext)) continue;
    seenExts.add(item.ext);

    const existing: ExtensionStat = store.extensions[item.ext] ?? {
      ext: item.ext,
      category: item.category,
      commits: 0,
      linesAdded: 0,
      linesDeleted: 0,
    };
    existing.commits += 1;
    existing.linesAdded += item.linesAdded;
    existing.linesDeleted += item.linesDeleted;
    store.extensions[item.ext] = existing;
  }

  store.summary.totalCommits += 1;
  store.summary.totalLinesAdded += commitAdded;
  store.summary.totalLinesDeleted += commitDeleted;

  const modelKey = extractModelFamilyCategory(options.author);
  const tier = options.tier ?? "tier-3";
  const existingModel: ModelStat = store.models[modelKey] ?? createModelStat(modelKey, tier);
  existingModel.tier = tier;
  existingModel.commits += 1;
  accumulateModelPricing(existingModel, linesByCategory(diffItems));
  store.models[modelKey] = existingModel;

  updateCostSavingsEstimate(store);
  saveTelemetry(store, cwd);
}

const GIT_LOG_FORMAT = "--format=%H%x1f%s%x1f%an%x1f%aI%x1f%B%x1e";

const EPHEMERAL_PATH_PREFIX = ".lognexus/";

const REWORK_SUBJECT_PATTERN = /^(?:fix|revert)(?:\(|:)/i;

const ESCALATION_SUBJECT_PATTERN = /\[escalated\]/i;

/**
 * Normalizes an issue filter into a bare identifier: `58`, `"58"`, `"#58"` and `"#058"`
 * all collapse to `"58"`, while alphanumeric tickets such as `"SLM-201"` are upper-cased.
 */
export function normalizeIssueFilter(issue: string | number): string {
  const raw = String(issue).trim().replace(/^#+/, "");
  const numeric = Number.parseInt(raw, 10);
  if (raw !== "" && String(numeric) === raw) return String(numeric);
  return raw.toUpperCase();
}

interface ScopedCommit {
  sha: string;
  subject: string;
  author: string;
  body: string;
  committedAtMs: number;
}

function readScopedCommits(
  targetDir: string,
  filter: ScopedTelemetryFilter | undefined,
): ScopedCommit[] {
  const args = ["log", GIT_LOG_FORMAT, "--no-color"];

  if (filter?.since !== undefined && filter.since !== "") {
    // Rejecting a leading dash keeps the value from ever being parsed as a Git flag.
    if (filter.since.startsWith("-")) {
      throw new Error(
        `Governance violation: Invalid telemetry scope value: "${filter.since}" (leading dash).`,
      );
    }
    args.push(`--since=${filter.since}`);
  }

  if (filter?.branch !== undefined && filter.branch !== "") {
    args.push(validateGitReference(filter.branch));
  }

  let raw = "";
  try {
    raw = execFileSync("git", args, {
      cwd: targetDir,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });
  } catch {
    return [];
  }

  const commits: ScopedCommit[] = [];
  for (const record of raw.split("\u001e")) {
    const trimmed = record.replace(/^\n+/, "");
    if (trimmed === "") continue;

    const fields = trimmed.split("\u001f");
    if (fields.length < 5) continue;
    const [sha = "", subject = "", author = "", committedAt = "", ...bodyParts] = fields;
    const committedAtMs = Date.parse(committedAt);
    if (Number.isNaN(committedAtMs)) continue;

    commits.push({
      sha: sha.trim(),
      subject: subject.trim(),
      author,
      body: bodyParts.join("\u001f"),
      committedAtMs,
    });
  }

  return commits;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1] + sorted[middle]) / 2)
    : sorted[middle];
}

function percentage(part: number, whole: number, whenEmpty: number): number {
  if (whole === 0) return whenEmpty;
  return Number(((part / whole) * 100).toFixed(1));
}

function listChangedFiles(sha: string, targetDir: string): string[] {
  try {
    const raw = execFileSync(
      "git",
      ["diff-tree", "--no-commit-id", "--name-only", "-r", validateGitReference(sha)],
      {
        cwd: targetDir,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
      },
    );

    return raw
      .split("\n")
      .map((line) => line.trim().replace(/\\/g, "/"))
      .filter((line) => line !== "" && !line.startsWith(EPHEMERAL_PATH_PREFIX));
  } catch {
    return [];
  }
}

/**
 * Checks whether every non-ephemeral file of a commit fell inside the active subtask
 * contract, which is what makes the contract a real execution boundary and not a comment.
 */
function isCommitContracted(sha: string, allowedFiles: string[], targetDir: string): boolean {
  const allowed = new Set(allowedFiles.map((file) => file.trim().replace(/\\/g, "/")));
  const changed = listChangedFiles(sha, targetDir);
  if (changed.length === 0) return true;
  return changed.every((file) => allowed.has(file));
}

interface ParsedNote {
  $schema?: unknown;
  issue?: { id?: unknown } | null;
  subtask?: { id?: unknown; contract?: { allowedFiles?: unknown } | null } | null;
  tier?: unknown;
  escalated?: unknown;
}

/**
 * Resolves the routing tier of a noted commit.
 *
 * Modern notes (carrying `$schema`) are authoritative: an explicitly recorded `tier-3` is
 * preserved unless the author is unambiguously a frontier orchestrator, which keeps the
 * historical backfill of pre-1.3.4 notes working without letting a stale `tier-3` default
 * outvote a resolved tier-1 identity.
 */
function resolveCommitTier(
  parsedNote: ParsedNote | null,
  inferredTier: string | null,
): PricingTierKey {
  const noteTier = typeof parsedNote?.tier === "string" ? parsedNote.tier : null;
  const isModernNote = typeof parsedNote?.$schema === "string";

  if (noteTier === null) return resolvePricingTier(inferredTier);
  if (isModernNote && noteTier === "tier-3" && inferredTier !== "tier-1") return "tier-3";
  if (noteTier !== "tier-3") return resolvePricingTier(noteTier);
  return resolvePricingTier(inferredTier ?? noteTier);
}

function hasScope(filter: ScopedTelemetryFilter | undefined): boolean {
  if (filter === undefined) return false;
  return filter.issue !== undefined || filter.since !== undefined || filter.branch !== undefined;
}

function matchesIssueFilter(issueFilter: string, commit: ScopedCommit, noteId: unknown): boolean {
  if (typeof noteId === "number" || typeof noteId === "string") {
    if (normalizeIssueFilter(noteId) === issueFilter) return true;
  }

  // The subject convention carries the issue id before the subtask tag, as in
  // `feat(#61/T2): ...` or `fix(SLM-201/T1): ...`, so both prefixes are matched.
  const loweredIssue = issueFilter.toLowerCase();
  const normalizedSubject = commit.subject.toLowerCase();
  const candidates = [
    `(#${loweredIssue}/`,
    `(#${loweredIssue})`,
    `(${loweredIssue}/`,
    `(${loweredIssue})`,
  ];
  return candidates.some((candidate) => normalizedSubject.includes(candidate));
}

/**
 * Rebuilds the commit aggregates from `refs/notes/lognexus`.
 *
 * Telemetry is opt-in, so every commit made before the user enabled it — or during a
 * run where the store was rewritten — still leaves a Git note behind. The notes are the
 * authoritative record: this reads them and recomputes the aggregates from scratch,
 * which makes the reconciliation idempotent and keeps it entirely offline.
 *
 * A scoped call (`filter` set) is a read-only projection: it is returned in memory and
 * never persisted, so an ad-hoc `issue`/`since`/`branch` report can never shrink the
 * aggregates a user accumulated over months.
 */
export function syncTelemetryFromGitNotes(
  targetDir: string = process.cwd(),
  filter?: ScopedTelemetryFilter,
): TelemetryStore {
  const store = loadTelemetry(targetDir);
  if (isTelemetryGloballyDisabled()) return store;

  const scoped = hasScope(filter);
  const allNotes = listNotes({ cwd: targetDir });
  const notedShas = new Set(allNotes.map((note) => note.commitSha));
  const commits = readScopedCommits(targetDir, filter);

  // An unscoped reconciliation is a no-op only when the repository carries nothing to
  // rebuild from; otherwise it always runs, so a legacy 1.x store is upgraded in place.
  if (!scoped && allNotes.length === 0 && commits.length === 0) return store;

  const issueFilter =
    filter?.issue !== undefined && filter.issue !== null
      ? normalizeIssueFilter(filter.issue)
      : null;

  const extensions: Record<string, ExtensionStat> = {};
  const models: Record<string, ModelStat> = {};
  const notedSubtasks = new Set<string>();
  const coverageScope = scoped ? commits : commits.filter((commit) => notedShas.has(commit.sha));
  const summary = store.summary;

  // Every aggregate is re-derived from the scanned commits, including the per-category line
  // counters; carrying a previous partial recording over would double count the same commit.
  summary.sourceLinesAdded = 0;
  summary.testLinesAdded = 0;
  summary.docsLinesAdded = 0;
  summary.configLinesAdded = 0;

  let totalLinesAdded = 0;
  let totalLinesDeleted = 0;
  let commitsInScope = 0;
  let coveredCommits = 0;
  let contractedCommits = 0;
  let compliantCommits = 0;
  let escalatedCommits = 0;
  let reworkCommits = 0;
  const timestamps: number[] = [];

  for (const commit of commits) {
    let safeSha: string;
    try {
      safeSha = validateGitReference(commit.sha);
    } catch {
      continue;
    }

    let parsedNote: ParsedNote | null = null;
    const rawNote = getNote(safeSha, { cwd: targetDir });
    if (rawNote !== null && rawNote !== "") {
      try {
        parsedNote = JSON.parse(rawNote) as ParsedNote;
      } catch {
        parsedNote = null;
      }
    }

    if (issueFilter !== null && !matchesIssueFilter(issueFilter, commit, parsedNote?.issue?.id)) {
      continue;
    }

    const isNoted = notedShas.has(safeSha);
    const author = extractTrailers(commit.body).author ?? commit.author.trim();
    const tier = resolveCommitTier(parsedNote, inferTierFromAuthor(author));

    const noteSubtaskId =
      typeof parsedNote?.subtask?.id === "string" ? parsedNote.subtask.id : null;
    if (noteSubtaskId !== null) {
      const issueId =
        typeof parsedNote?.issue?.id === "number"
          ? String(parsedNote.issue.id)
          : (issueFilter ?? "0");
      notedSubtasks.add(`${issueId}/${noteSubtaskId}`);
    } else {
      const subjectSubtasks = commit.subject.match(new RegExp(SUBJECT_TASK_PATTERN, "gi"));
      for (const match of subjectSubtasks ?? []) {
        notedSubtasks.add(match);
      }
    }

    commitsInScope += 1;
    timestamps.push(commit.committedAtMs);
    if (isNoted) coveredCommits += 1;
    if (parsedNote?.escalated === true || ESCALATION_SUBJECT_PATTERN.test(commit.subject)) {
      escalatedCommits += 1;
    }
    if (REWORK_SUBJECT_PATTERN.test(commit.subject)) reworkCommits += 1;

    const allowedFiles = parsedNote?.subtask?.contract?.allowedFiles;
    if (Array.isArray(allowedFiles)) {
      const declared = allowedFiles.filter((file): file is string => typeof file === "string");
      if (declared.length > 0) {
        contractedCommits += 1;
        if (isCommitContracted(safeSha, declared, targetDir)) compliantCommits += 1;
      }
    }

    const diffItems = extractCommitDiffStats(safeSha, targetDir);
    const seenExts = new Set<string>();

    for (const item of diffItems) {
      totalLinesAdded += item.linesAdded;
      totalLinesDeleted += item.linesDeleted;
      accumulateCategoryLines(store.summary, item.category, item.linesAdded);

      if (seenExts.has(item.ext)) continue;
      seenExts.add(item.ext);

      const existing: ExtensionStat = extensions[item.ext] ?? {
        ext: item.ext,
        category: item.category,
        commits: 0,
        linesAdded: 0,
        linesDeleted: 0,
      };
      existing.commits += 1;
      existing.linesAdded += item.linesAdded;
      existing.linesDeleted += item.linesDeleted;
      extensions[item.ext] = existing;
    }

    const modelKey = extractModelFamilyCategory(author);
    const existingModel: ModelStat = models[modelKey] ?? createModelStat(modelKey, tier);
    existingModel.tier = tier;
    existingModel.commits += 1;
    accumulateModelPricing(existingModel, linesByCategory(diffItems));
    models[modelKey] = existingModel;
  }

  store.extensions = extensions;
  store.models = models;
  summary.totalCommits = commitsInScope;
  summary.totalLinesAdded = totalLinesAdded;
  summary.totalLinesDeleted = totalLinesDeleted;
  summary.totalSubtasksCompleted = Math.max(summary.totalSubtasksCompleted, notedSubtasks.size);
  summary.gitNotesCoveragePct = percentage(coveredCommits, coverageScope.length, 100);
  summary.contractedCommits = contractedCommits;
  summary.contractCompliancePct = percentage(compliantCommits, contractedCommits, 100);
  summary.escalatedCommits = escalatedCommits;
  summary.reworkCommits = reworkCommits;
  summary.reworkRatioPct = percentage(reworkCommits, commitsInScope, 0);

  const ordered = [...timestamps].sort((a, b) => a - b);
  summary.activeDevelopmentSpanSec =
    ordered.length >= 2 ? Math.round((ordered[ordered.length - 1] - ordered[0]) / 1000) : 0;
  summary.medianCommitCadenceSec = median(
    ordered.slice(1).map((value, index) => Math.round((value - ordered[index]) / 1000)),
  );

  updateCostSavingsEstimate(store);

  // Scoped projections stay in memory: persisting them would overwrite the full history.
  if (scoped) return store;

  if (isTelemetryActive(targetDir)) {
    saveTelemetry(store, targetDir);
  }

  return store;
}

export function buildAnonymousDiagnosticPayload(
  store: TelemetryStore,
  filter?: ScopedTelemetryFilter,
): AnonymousDiagnosticPayload {
  const timestamp = new Date().toISOString();
  const payload: AnonymousDiagnosticPayload = {
    schemaVersion: "2.0.0",
    anonymousProjectId: store.anonymousProjectId,
    consent: store.consent,
    environment: {
      os: process.platform,
      nodeVersion: process.version,
      lognexusVersion: getCliVersion(),
      detectedStacks: store.detectedStacks,
    },
    summary: store.summary,
    languageBreakdown: Object.values(store.extensions),
    modelBreakdown: Object.values(store.models),
    generatedAt: timestamp,
    dispatchedAt: timestamp,
  };

  if (filter !== undefined) {
    payload.scope = {
      issue: filter.issue ?? null,
      since: filter.since ?? null,
      branch: filter.branch ?? null,
    };
  }

  return payload;
}

export const buildAnonymousCommunityPayload = buildAnonymousDiagnosticPayload;
