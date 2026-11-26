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
  normalizeDiffTreePath,
} from "./detector.js";
import {
  type AnonymousDiagnosticPayload,
  DEFAULT_TELEMETRY_SUMMARY,
  type DiffCategory,
  type ExtensionStat,
  type ModelStat,
  TELEMETRY_POLICY_VERSION,
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
  tier: string = model.tier,
): void {
  for (const [category, lines] of Object.entries(linesByCategory)) {
    const added = Number.isFinite(lines) ? (lines ?? 0) : 0;
    if (category === "source" || category === "test") {
      model.sourceLinesAdded += added;
    } else {
      model.docsLinesAdded += added;
    }
  }

  const pricing = estimateCommitPricing(tier, linesByCategory);
  model.estimatedInputTokens += pricing.inputTokens;
  model.estimatedOutputTokens += pricing.outputTokens;
  model.estimatedCostUsd = round6(model.estimatedCostUsd + pricing.costUsd);
}

/**
 * Folds a completed subtask duration into a model bucket's cumulative and average duration
 * counters without letting un-timed commits dilute `avgSubtaskDurationSec`.
 */
function accumulateModelDuration(
  model: ModelStat,
  durationSec: number | null | undefined,
  timedCounts?: Map<string, number>,
): void {
  if (typeof durationSec !== "number" || !Number.isSafeInteger(durationSec) || durationSec <= 0) {
    return;
  }

  if (timedCounts !== undefined) {
    const count = (timedCounts.get(model.family) ?? 0) + 1;
    timedCounts.set(model.family, count);
    model.totalDurationSec += durationSec;
    model.avgSubtaskDurationSec = Math.round(model.totalDurationSec / count);
    return;
  }

  const prevCount =
    model.totalDurationSec > 0 && model.avgSubtaskDurationSec > 0
      ? Math.max(1, Math.round(model.totalDurationSec / model.avgSubtaskDurationSec))
      : 0;
  const nextCount = prevCount + 1;
  model.totalDurationSec += durationSec;
  model.avgSubtaskDurationSec = Math.round(model.totalDurationSec / nextCount);
}

function round6(value: number): number {
  return Number(value.toFixed(6));
}

/** Folds one diff bucket into the summary's per-category line counters. */
function accumulateCategoryLines(
  summary: TelemetryStore["summary"],
  category: DiffCategory,
  linesAdded: number,
  linesDeleted: number,
): void {
  if (category === "test") {
    summary.testLinesAdded += linesAdded;
  } else if (category === "docs") {
    summary.docsLinesAdded += linesAdded;
  } else if (category === "config") {
    summary.configLinesAdded += linesAdded;
  } else {
    summary.sourceLinesAdded += linesAdded;
    summary.sourceLinesDeleted += linesDeleted;
  }
}

/**
 * Folds one diff bucket into the per-extension roll-up.
 *
 * A commit that touches `.ts` files in both `src/` and `tests/` is one `.ts` commit, so the
 * commit counter only moves on the first sighting of the extension, while the line totals
 * always accumulate — otherwise the second bucket's lines would be dropped.
 */
function accumulateExtensionLines(
  extensions: Record<string, ExtensionStat>,
  item: DiffStatItem,
  isNewExtInCommit: boolean,
): void {
  const existing: ExtensionStat = extensions[item.ext] ?? {
    ext: item.ext,
    category: item.category,
    commits: 0,
    linesAdded: 0,
    linesDeleted: 0,
  };
  if (isNewExtInCommit) existing.commits += 1;
  if (item.category === "source") existing.category = "source";
  existing.linesAdded += item.linesAdded;
  existing.linesDeleted += item.linesDeleted;
  extensions[item.ext] = existing;
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

export type TelemetryConsentState = "accepted" | "declined" | "outdated" | "unanswered";

export function createDefaultTelemetryStore(targetDir: string = process.cwd()): TelemetryStore {
  return {
    schemaVersion: "2.0.0",
    mode: "off",
    anonymousProjectId: randomUUID(),
    consent: {
      accepted: false,
      policyVersion: TELEMETRY_POLICY_VERSION,
      acceptedAt: null,
      declinedAt: null,
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

  // The identity must outlive a single run: without a persisted store every export would mint a
  // fresh id, and a cohort could never tell two snapshots of one repository apart from two
  // repositories. The id is a random UUID, never derived from the path or the repository name.
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
  try {
    const dirPath = join(targetDir, ".lognexus");
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true });
    }

    store.schemaVersion = "2.0.0";
    store.lastUpdated = new Date().toISOString();
    store.detectedStacks = detectProjectStacks(targetDir);

    const filePath = getTelemetryPath(targetDir);
    writeFileSync(filePath, JSON.stringify(store, null, 2), "utf8");
  } catch {
    /* fail-silent */
  }
}

export function getTelemetryConsentState(targetDir: string = process.cwd()): TelemetryConsentState {
  if (isTelemetryGloballyDisabled() || !existsSync(getTelemetryPath(targetDir))) {
    return "unanswered";
  }

  const store = loadTelemetry(targetDir);
  if (store.consent.accepted && store.consent.policyVersion === TELEMETRY_POLICY_VERSION) {
    return "accepted";
  }
  if (
    !store.consent.accepted &&
    store.consent.declinedAt !== null &&
    store.consent.policyVersion === TELEMETRY_POLICY_VERSION
  ) {
    return "declined";
  }
  if (
    (store.consent.accepted || store.consent.declinedAt !== null || store.mode === "local") &&
    store.consent.policyVersion !== TELEMETRY_POLICY_VERSION
  ) {
    return "outdated";
  }
  return "unanswered";
}

export function isTelemetryActive(targetDir: string = process.cwd()): boolean {
  if (isTelemetryGloballyDisabled()) return false;
  if (!existsSync(getTelemetryPath(targetDir))) return false;
  const store = loadTelemetry(targetDir);
  return (
    store.mode === "local" &&
    store.consent.accepted === true &&
    store.consent.policyVersion === TELEMETRY_POLICY_VERSION
  );
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
  if (options.acceptTerms === true) {
    store.consent = {
      accepted: true,
      policyVersion: TELEMETRY_POLICY_VERSION,
      acceptedAt: new Date().toISOString(),
      declinedAt: null,
    };
  }
  saveTelemetry(store, cwd);
  return { mode: store.mode, anonymousProjectId: store.anonymousProjectId };
}

export function declineTelemetry(targetDir: string = process.cwd()): void {
  const store = loadTelemetry(targetDir);
  store.mode = "off";
  store.consent = {
    accepted: false,
    policyVersion: TELEMETRY_POLICY_VERSION,
    acceptedAt: null,
    declinedAt: new Date().toISOString(),
  };
  saveTelemetry(store, targetDir);
}

export function disableTelemetry(targetDir: string = process.cwd()): void {
  declineTelemetry(targetDir);
}

function readStoredConsent(targetDir: string): TelemetryStore["consent"] | null {
  const filePath = getTelemetryPath(targetDir);
  if (!existsSync(filePath)) return null;

  try {
    const parsed = TelemetryStoreSchema.safeParse(JSON.parse(readFileSync(filePath, "utf8")));
    return parsed.success ? parsed.data.consent : null;
  } catch {
    return null;
  }
}

export function clearTelemetry(targetDir: string = process.cwd()): void {
  const previousConsent = readStoredConsent(targetDir);
  const store = createDefaultTelemetryStore(targetDir);
  store.mode = "off";
  if (
    previousConsent !== null &&
    (previousConsent.accepted === true || previousConsent.declinedAt !== null)
  ) {
    store.consent = {
      accepted: false,
      policyVersion: previousConsent.policyVersion,
      acceptedAt: null,
      declinedAt: previousConsent.declinedAt ?? new Date().toISOString(),
    };
  }
  saveTelemetry(store, targetDir);
}

export function recordTaskStart(taskId: string, targetDir: string = process.cwd()): void {
  try {
    if (!isTelemetryActive(targetDir)) return;

    const store = loadTelemetry(targetDir);
    store.taskTimings[taskId] = {
      taskId,
      startedAt: new Date().toISOString(),
      completedAt: null,
      durationSec: 0,
    };
    saveTelemetry(store, targetDir);
  } catch {
    /* fail-silent */
  }
}

export function recordTaskFinish(taskId: string, targetDir: string = process.cwd()): number {
  try {
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
  } catch {
    /* fail-silent */
    return 0;
  }
}

export function recordReviewGateBlock(targetDir: string = process.cwd()): void {
  try {
    if (!isTelemetryActive(targetDir)) return;

    const store = loadTelemetry(targetDir);
    store.summary.reviewGateBlocksPrevented += 1;
    saveTelemetry(store, targetDir);
  } catch {
    /* fail-silent */
  }
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

  // `tierCommits` is accumulated per commit by the callers, so a mixed-tier history keeps its
  // real split. It is only re-derived from the model buckets when the totals disagree — as a
  // legacy store would, or one assembled by hand without going through a commit recorder.
  const declaredTierCommits = sum.tierCommits;
  const declaredTierTotal =
    (declaredTierCommits?.["tier-1"] ?? 0) +
    (declaredTierCommits?.["tier-2"] ?? 0) +
    (declaredTierCommits?.["tier-3"] ?? 0);
  if (declaredTierCommits === undefined || declaredTierTotal !== totalCommits) {
    sum.tierCommits = { "tier-1": 0, "tier-2": 0, "tier-3": 0 };
    for (const model of models) {
      const tier = resolvePricingTier(model.tier);
      sum.tierCommits[tier] += model.commits;
    }
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

const GIT_LOG_FORMAT = "--format=%H%x1f%s%x1f%an%x1f%aI%x1f%B%x1e";

const EPHEMERAL_PATH_PREFIX = ".lognexus/";

const REWORK_SUBJECT_PATTERN = /^(?:fix|revert)(?:\(|:)/i;

const ESCALATION_SUBJECT_PATTERN = /\[escalated\]/i;

function percentage(part: number, whole: number, whenEmpty: number): number {
  if (whole === 0) return whenEmpty;
  return Number(((part / whole) * 100).toFixed(1));
}

function isSwarmAuthor(author: string): boolean {
  const lowered = author.toLowerCase();
  return (
    lowered.includes("gemini-flash-worker-agy") ||
    lowered.includes("orchestrator (carbon)") ||
    lowered.includes("orchestrator (argon)") ||
    lowered.includes("orchestrator (neon)") ||
    lowered.includes("gemini-pro-orchestrator")
  );
}

function readCommitSubject(safeSha: string, targetDir: string): string {
  try {
    return execFileSync("git", ["show", "-s", "--format=%s", safeSha], {
      cwd: targetDir,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    }).trim();
  } catch {
    return "";
  }
}

function listChangedFiles(sha: string, targetDir: string): string[] {
  try {
    const raw = execFileSync(
      "git",
      [
        "-c",
        "core.quotePath=false",
        "diff-tree",
        "--root",
        "--no-commit-id",
        "--name-only",
        "-r",
        validateGitReference(sha),
      ],
      {
        cwd: targetDir,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
      },
    );

    return raw
      .split("\n")
      .map((line) => normalizeDiffTreePath(line).replace(/\\/g, "/"))
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

export function recordCommitTelemetry(options: {
  sha: string;
  author?: string;
  tier?: string;
  tierExplicit?: boolean;
  durationSec?: number;
  targetDir?: string;
}): void {
  try {
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
      accumulateCategoryLines(store.summary, item.category, item.linesAdded, item.linesDeleted);

      // One commit touching `.ts` in `src/` and `tests/` counts as a single `.ts` commit.
      const isNewExtInCommit = !seenExts.has(item.ext);
      if (isNewExtInCommit) seenExts.add(item.ext);
      accumulateExtensionLines(store.extensions, item, isNewExtInCommit);
    }

    store.summary.totalCommits += 1;
    store.summary.totalLinesAdded += commitAdded;
    store.summary.totalLinesDeleted += commitDeleted;

    let safeSha: string | null = null;
    try {
      safeSha = validateGitReference(options.sha);
    } catch {
      safeSha = null;
    }

    const parsedNote = readParsedNote(safeSha ?? options.sha, cwd);
    const inferredTier = inferTierFromAuthor(options.author);
    const tier =
      options.tierExplicit === false
        ? (inferredTier ?? options.tier ?? "tier-3")
        : (options.tier ?? inferredTier ?? "tier-3");

    const modelKey = extractModelFamilyCategory(options.author);
    const existingModel: ModelStat = store.models[modelKey] ?? createModelStat(modelKey, tier);
    existingModel.tier = tier;
    existingModel.commits += 1;
    accumulateModelPricing(existingModel, linesByCategory(diffItems), tier);
    const effectiveDuration =
      typeof options.durationSec === "number" &&
      Number.isSafeInteger(options.durationSec) &&
      options.durationSec > 0
        ? options.durationSec
        : parseNonNegativeInt(parsedNote?.subtask?.durationSec);
    accumulateModelDuration(existingModel, effectiveDuration);
    store.models[modelKey] = existingModel;

    const pricingTier = resolvePricingTier(tier);
    if (store.summary.tierCommits === undefined) {
      store.summary.tierCommits = { "tier-1": 0, "tier-2": 0, "tier-3": 0 };
    }
    store.summary.tierCommits[pricingTier] += 1;

    const subject = safeSha !== null ? readCommitSubject(safeSha, cwd) : "";

    if (parsedNote?.escalated === true || ESCALATION_SUBJECT_PATTERN.test(subject)) {
      store.summary.escalatedCommits = (store.summary.escalatedCommits ?? 0) + 1;
    }

    if (REWORK_SUBJECT_PATTERN.test(subject)) {
      store.summary.reworkCommits = (store.summary.reworkCommits ?? 0) + 1;
    }
    store.summary.reworkRatioPct = percentage(
      store.summary.reworkCommits ?? 0,
      store.summary.totalCommits,
      0,
    );

    const allowedFiles = parsedNote?.subtask?.contract?.allowedFiles;
    if (Array.isArray(allowedFiles) && safeSha !== null) {
      const declared = allowedFiles.filter((file): file is string => typeof file === "string");
      if (declared.length > 0) {
        const prevContracted = store.summary.contractedCommits ?? 0;
        const prevCompliant =
          prevContracted === 0
            ? 0
            : Math.round(((store.summary.contractCompliancePct ?? 100) / 100) * prevContracted);
        const compliant = isCommitContracted(safeSha, declared, cwd) ? 1 : 0;
        const nextContracted = prevContracted + 1;
        store.summary.contractedCommits = nextContracted;
        store.summary.contractCompliancePct = percentage(
          prevCompliant + compliant,
          nextContracted,
          100,
        );
      }
    }

    const swarmMetrics = extractNoteSwarmMetrics(parsedNote);
    if (swarmMetrics.isSwarm || isSwarmAuthor(options.author ?? "")) {
      store.summary.swarmCommits = (store.summary.swarmCommits ?? 0) + 1;
      store.summary.totalSwarmPosts = (store.summary.totalSwarmPosts ?? 0) + swarmMetrics.posts;
      store.summary.maxSwarmWorkers = Math.max(
        store.summary.maxSwarmWorkers ?? 0,
        swarmMetrics.workers,
      );
    }

    updateCostSavingsEstimate(store);
    saveTelemetry(store, cwd);
  } catch {
    /* fail-silent */
  }
}

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
  // Merge commits carry no authored diff of their own, so counting them would inflate the
  // commit totals and dilute the rework and coverage ratios.
  const args = ["log", "--no-merges", GIT_LOG_FORMAT, "--no-color"];

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

interface ParsedNote {
  $schema?: unknown;
  version?: unknown;
  author?: unknown;
  issue?: { id?: unknown; tier?: unknown } | null;
  subtask?: {
    id?: unknown;
    durationSec?: unknown;
    contract?: {
      allowedFiles?: unknown;
      isolation?: unknown;
      swarmWorkers?: unknown;
      swarmPosts?: unknown;
    } | null;
  } | null;
  tier?: unknown;
  tierExplicit?: unknown;
  escalated?: unknown;
  swarm?: { workers?: unknown; posts?: unknown } | null;
}

function parseNonNegativeInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return null;
  }
  return value;
}

function readParsedNote(sha: string, targetDir: string): ParsedNote | null {
  const rawNote = getNote(sha, { cwd: targetDir });
  if (rawNote === null || rawNote === "") return null;
  try {
    return JSON.parse(rawNote) as ParsedNote;
  } catch {
    return null;
  }
}

export function extractNoteSwarmMetrics(parsedNote: ParsedNote | null): {
  isSwarm: boolean;
  workers: number;
  posts: number;
} {
  const workers =
    parseNonNegativeInt(parsedNote?.swarm?.workers) ??
    parseNonNegativeInt(parsedNote?.subtask?.contract?.swarmWorkers);
  const posts =
    parseNonNegativeInt(parsedNote?.swarm?.posts) ??
    parseNonNegativeInt(parsedNote?.subtask?.contract?.swarmPosts);
  const isSwarm =
    parsedNote?.subtask?.contract?.isolation === "swarm" ||
    workers !== null ||
    posts !== null ||
    (parsedNote?.swarm !== null && typeof parsedNote?.swarm === "object");

  return {
    isSwarm,
    workers: workers ?? 0,
    posts: posts ?? 0,
  };
}

function isPre140NoteVersion(version: unknown): boolean {
  if (typeof version !== "string") return false;
  const match = version.trim().match(/^(\d+)\.(\d+)\./);
  if (!match) return false;
  const major = Number.parseInt(match[1], 10);
  const minor = Number.parseInt(match[2], 10);
  return major < 1 || (major === 1 && minor < 4);
}

/**
 * Resolves the routing tier of a noted commit.
 *
 * Modern notes carrying `tierExplicit` distinguish `--tier` overrides (`true`) from
 * inferred/inherited tiers (`false`), while notes from earlier schemas reconcile `issue: null`
 * fallback notes and pre-`1.4.0` flagship `tier-1` commits accurately.
 */
export function resolveCommitTier(
  parsedNote: ParsedNote | null,
  inferredTier: string | null,
): PricingTierKey {
  const noteTier = typeof parsedNote?.tier === "string" ? parsedNote.tier : null;
  if (noteTier === null) return resolvePricingTier(inferredTier);
  if (parsedNote?.tierExplicit === true) return resolvePricingTier(noteTier);
  if (parsedNote?.tierExplicit === false) return resolvePricingTier(inferredTier ?? noteTier);

  const isModernNote = typeof parsedNote?.$schema === "string";
  if (isModernNote) {
    if (parsedNote?.issue === null && noteTier === "tier-3" && inferredTier !== null) {
      return resolvePricingTier(inferredTier);
    }
    if (
      isPre140NoteVersion(parsedNote?.version) &&
      inferredTier === "tier-1" &&
      (noteTier === "tier-2" || noteTier === "tier-3")
    ) {
      return "tier-1";
    }
    const issueTier = typeof parsedNote?.issue?.tier === "string" ? parsedNote.issue.tier : null;
    if (inferredTier !== null && issueTier !== null && noteTier === issueTier) {
      return resolvePricingTier(inferredTier);
    }
    return resolvePricingTier(noteTier);
  }
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
  const timedSubtaskCounts = new Map<string, number>();
  const notedSubtasks = new Set<string>();
  const summary = store.summary;

  // Every aggregate is re-derived from the scanned commits, including the per-category line
  // counters; carrying a previous partial recording over would double count the same commit.
  summary.sourceLinesAdded = 0;
  summary.sourceLinesDeleted = 0;
  summary.testLinesAdded = 0;
  summary.docsLinesAdded = 0;
  summary.configLinesAdded = 0;
  summary.tierCommits = { "tier-1": 0, "tier-2": 0, "tier-3": 0 };
  summary.swarmCommits = 0;
  summary.totalSwarmPosts = 0;
  summary.maxSwarmWorkers = 0;

  let totalLinesAdded = 0;
  let totalLinesDeleted = 0;
  let commitsInScope = 0;
  let coveredCommits = 0;
  let contractedCommits = 0;
  let compliantCommits = 0;
  let escalatedCommits = 0;
  let reworkCommits = 0;
  let swarmCommits = 0;
  let totalSwarmPosts = 0;
  let maxSwarmWorkers = 0;
  const timestamps: number[] = [];

  for (const commit of commits) {
    let safeSha: string;
    try {
      safeSha = validateGitReference(commit.sha);
    } catch {
      continue;
    }

    const parsedNote = readParsedNote(safeSha, targetDir);

    if (issueFilter !== null && !matchesIssueFilter(issueFilter, commit, parsedNote?.issue?.id)) {
      continue;
    }

    const isNoted = notedShas.has(safeSha);
    const noteAuthor =
      typeof parsedNote?.author === "string" && parsedNote.author.trim() !== ""
        ? parsedNote.author.trim()
        : null;
    const author = extractTrailers(commit.body).author ?? noteAuthor ?? commit.author.trim();
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
      accumulateCategoryLines(store.summary, item.category, item.linesAdded, item.linesDeleted);

      const isNewExtInCommit = !seenExts.has(item.ext);
      if (isNewExtInCommit) seenExts.add(item.ext);
      accumulateExtensionLines(extensions, item, isNewExtInCommit);
    }

    const modelKey = extractModelFamilyCategory(author);
    const existingModel: ModelStat = models[modelKey] ?? createModelStat(modelKey, tier);
    existingModel.commits += 1;
    accumulateModelPricing(existingModel, linesByCategory(diffItems), tier);
    const noteDuration = parseNonNegativeInt(parsedNote?.subtask?.durationSec);
    accumulateModelDuration(existingModel, noteDuration, timedSubtaskCounts);
    models[modelKey] = existingModel;

    summary.tierCommits[resolvePricingTier(tier)] += 1;

    const swarmMetrics = extractNoteSwarmMetrics(parsedNote);
    if (swarmMetrics.isSwarm || isSwarmAuthor(author)) {
      swarmCommits += 1;
      totalSwarmPosts += swarmMetrics.posts;
      maxSwarmWorkers = Math.max(maxSwarmWorkers, swarmMetrics.workers);
    }
  }

  store.extensions = extensions;
  store.models = models;
  summary.totalCommits = commitsInScope;
  summary.totalLinesAdded = totalLinesAdded;
  summary.totalLinesDeleted = totalLinesDeleted;
  summary.totalSubtasksCompleted = Math.max(summary.totalSubtasksCompleted, notedSubtasks.size);
  summary.gitNotesCoveragePct = percentage(coveredCommits, commitsInScope, 100);
  summary.contractedCommits = contractedCommits;
  summary.contractCompliancePct = percentage(compliantCommits, contractedCommits, 100);
  summary.escalatedCommits = escalatedCommits;
  summary.reworkCommits = reworkCommits;
  summary.reworkRatioPct = percentage(reworkCommits, commitsInScope, 0);
  summary.swarmCommits = swarmCommits;
  summary.totalSwarmPosts = totalSwarmPosts;
  summary.maxSwarmWorkers = maxSwarmWorkers;

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
