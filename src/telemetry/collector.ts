import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getCliVersion } from "../cli.js";
import {
  detectProjectStacks,
  extractCommitDiffStats,
  extractModelFamilyCategory,
} from "./detector.js";
import {
  type AnonymousCommunityPayload,
  type ExtensionStat,
  type ModelStat,
  type TelemetryMode,
  type TelemetryStore,
  TelemetryStoreSchema,
} from "./schema.js";

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
    schemaVersion: "1.0.0",
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
    summary: {
      totalCommits: 0,
      totalLinesAdded: 0,
      totalLinesDeleted: 0,
      totalSubtasksCompleted: 0,
      gitNotesCoveragePct: 100,
      reviewGateBlocksPrevented: 0,
      estimatedBaselineCostUsd: 0,
      estimatedActualCostUsd: 0,
      estimatedCostSavingsUsd: 0,
      estimatedCostSavingsPct: 0,
    },
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

export function updateCostSavingsEstimate(store: TelemetryStore): void {
  // Economic model:
  // Monolithic Tier-1 (Frontier) Baseline: Assumes 100% of tasks done by frontier model without file scoping
  // Heuristic average cost: $0.05 per commit / diff unit
  // LogNexus Multi-Tier actual cost:
  // tier-1 (Arch/Review): $0.04
  // tier-2 (Orchestration): $0.015
  // tier-3 (Execution with Flash / DeepSeek V3 / Haiku / Kimi): $0.002
  const totalCommits = store.summary.totalCommits;
  if (totalCommits === 0) {
    store.summary.estimatedBaselineCostUsd = 0;
    store.summary.estimatedActualCostUsd = 0;
    store.summary.estimatedCostSavingsUsd = 0;
    store.summary.estimatedCostSavingsPct = 0;
    return;
  }

  const baselineCost = totalCommits * 0.05;
  let actualCost = 0;

  for (const model of Object.values(store.models)) {
    const unitCost = model.tier === "tier-1" ? 0.04 : model.tier === "tier-2" ? 0.015 : 0.002;
    actualCost += model.commits * unitCost;
  }

  const savingsUsd = Math.max(0, baselineCost - actualCost);
  const savingsPct = baselineCost > 0 ? (savingsUsd / baselineCost) * 100 : 0;

  store.summary.estimatedBaselineCostUsd = Number(baselineCost.toFixed(3));
  store.summary.estimatedActualCostUsd = Number(actualCost.toFixed(3));
  store.summary.estimatedCostSavingsUsd = Number(savingsUsd.toFixed(3));
  store.summary.estimatedCostSavingsPct = Number(savingsPct.toFixed(1));
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

  for (const item of diffItems) {
    commitAdded += item.linesAdded;
    commitDeleted += item.linesDeleted;

    const existing: ExtensionStat = store.extensions[item.ext] ?? {
      ext: item.ext,
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
  const existingModel: ModelStat = store.models[modelKey] ?? {
    family: modelKey,
    tier,
    commits: 0,
    totalDurationSec: 0,
    avgSubtaskDurationSec: 0,
  };
  existingModel.tier = tier;
  existingModel.commits += 1;
  store.models[modelKey] = existingModel;

  updateCostSavingsEstimate(store);
  saveTelemetry(store, cwd);
}

export function buildAnonymousCommunityPayload(store: TelemetryStore): AnonymousCommunityPayload {
  return {
    schemaVersion: "1.0.0",
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
    dispatchedAt: new Date().toISOString(),
  };
}
