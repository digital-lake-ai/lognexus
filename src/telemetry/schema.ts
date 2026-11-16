import { z } from "zod";

const LEGACY_COMMUNITY_MODE = "community";

export const TelemetryModeSchema = z
  .enum(["off", "local", LEGACY_COMMUNITY_MODE])
  .transform((mode): "off" | "local" => (mode === "off" ? "off" : "local"));
export type TelemetryMode = z.infer<typeof TelemetryModeSchema>;

export const TelemetryConsentSchema = z.object({
  accepted: z.boolean().default(false),
  policyVersion: z.string().default("1.0.0"),
  acceptedAt: z.string().nullable().default(null),
});
export type TelemetryConsent = z.infer<typeof TelemetryConsentSchema>;

export const DiffCategorySchema = z.enum(["source", "test", "docs", "config"]);
export type DiffCategory = z.infer<typeof DiffCategorySchema>;

export const ExtensionStatSchema = z.object({
  ext: z.string(),
  category: DiffCategorySchema.default("source"),
  commits: z.number().default(0),
  linesAdded: z.number().default(0),
  linesDeleted: z.number().default(0),
});
export type ExtensionStat = z.infer<typeof ExtensionStatSchema>;

export const ModelStatSchema = z.object({
  family: z.string(),
  tier: z.string().default("tier-3"),
  commits: z.number().default(0),
  totalDurationSec: z.number().default(0),
  avgSubtaskDurationSec: z.number().default(0),
  sourceLinesAdded: z.number().default(0),
  docsLinesAdded: z.number().default(0),
  estimatedInputTokens: z.number().default(0),
  estimatedOutputTokens: z.number().default(0),
  estimatedCostUsd: z.number().default(0),
});
export type ModelStat = z.infer<typeof ModelStatSchema>;

export const TierCommitDistributionSchema = z.object({
  "tier-1": z.number().default(0),
  "tier-2": z.number().default(0),
  "tier-3": z.number().default(0),
});
export type TierCommitDistribution = z.infer<typeof TierCommitDistributionSchema>;

export const TelemetrySummarySchema = z.object({
  totalCommits: z.number().default(0),
  totalLinesAdded: z.number().default(0),
  totalLinesDeleted: z.number().default(0),
  totalSubtasksCompleted: z.number().default(0),
  gitNotesCoveragePct: z.number().default(100),
  reviewGateBlocksPrevented: z.number().default(0),
  estimatedBaselineCostUsd: z.number().default(0),
  estimatedActualCostUsd: z.number().default(0),
  estimatedCostSavingsUsd: z.number().default(0),
  estimatedCostSavingsPct: z.number().default(0),
  sourceLinesAdded: z.number().default(0),
  sourceLinesDeleted: z.number().default(0),
  testLinesAdded: z.number().default(0),
  docsLinesAdded: z.number().default(0),
  configLinesAdded: z.number().default(0),
  activeDevelopmentSpanSec: z.number().default(0),
  medianCommitCadenceSec: z.number().default(0),
  contractedCommits: z.number().default(0),
  contractCompliancePct: z.number().default(100),
  escalatedCommits: z.number().default(0),
  reworkCommits: z.number().default(0),
  reworkRatioPct: z.number().default(0),
  tierCommits: TierCommitDistributionSchema.default({ "tier-1": 0, "tier-2": 0, "tier-3": 0 }),
  estimatedBaselineTokens: z.number().default(0),
  estimatedActualTokens: z.number().default(0),
  estimatedTokensSaved: z.number().default(0),
});
export type TelemetrySummary = z.infer<typeof TelemetrySummarySchema>;

export const DEFAULT_TELEMETRY_SUMMARY: TelemetrySummary = {
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
  sourceLinesAdded: 0,
  sourceLinesDeleted: 0,
  testLinesAdded: 0,
  docsLinesAdded: 0,
  configLinesAdded: 0,
  activeDevelopmentSpanSec: 0,
  medianCommitCadenceSec: 0,
  contractedCommits: 0,
  contractCompliancePct: 100,
  escalatedCommits: 0,
  reworkCommits: 0,
  reworkRatioPct: 0,
  tierCommits: { "tier-1": 0, "tier-2": 0, "tier-3": 0 },
  estimatedBaselineTokens: 0,
  estimatedActualTokens: 0,
  estimatedTokensSaved: 0,
};

export const TaskTimingEntrySchema = z.object({
  taskId: z.string(),
  startedAt: z.string(),
  completedAt: z.string().nullable().default(null),
  durationSec: z.number().default(0),
});
export type TaskTimingEntry = z.infer<typeof TaskTimingEntrySchema>;

export const TelemetryStoreSchema = z.object({
  schemaVersion: z.string().default("2.0.0"),
  mode: TelemetryModeSchema.default("off"),
  anonymousProjectId: z.string(),
  consent: TelemetryConsentSchema,
  detectedStacks: z.array(z.string()).default([]),
  taskTimings: z.record(z.string(), TaskTimingEntrySchema).default({}),
  extensions: z.record(z.string(), ExtensionStatSchema).default({}),
  models: z.record(z.string(), ModelStatSchema).default({}),
  summary: TelemetrySummarySchema.default(DEFAULT_TELEMETRY_SUMMARY),
  lastUpdated: z.string().default(() => new Date().toISOString()),
});
export type TelemetryStore = z.infer<typeof TelemetryStoreSchema>;

export const AnonymousDiagnosticScopeSchema = z.object({
  issue: z.union([z.string(), z.number()]).nullable().default(null),
  since: z.string().nullable().default(null),
  branch: z.string().nullable().default(null),
});
export type AnonymousDiagnosticScope = z.infer<typeof AnonymousDiagnosticScopeSchema>;

export const AnonymousDiagnosticPayloadSchema = z.object({
  schemaVersion: z.string().default("2.0.0"),
  anonymousProjectId: z.string(),
  consent: TelemetryConsentSchema,
  environment: z.object({
    os: z.string(),
    nodeVersion: z.string(),
    lognexusVersion: z.string(),
    detectedStacks: z.array(z.string()),
  }),
  summary: TelemetrySummarySchema,
  languageBreakdown: z.array(ExtensionStatSchema),
  modelBreakdown: z.array(ModelStatSchema),
  scope: AnonymousDiagnosticScopeSchema.optional(),
  generatedAt: z.string().default(() => new Date().toISOString()),
  dispatchedAt: z.string().optional(),
});
export type AnonymousDiagnosticPayload = z.infer<typeof AnonymousDiagnosticPayloadSchema>;

export const AnonymousCommunityPayloadSchema = AnonymousDiagnosticPayloadSchema;
export type AnonymousCommunityPayload = AnonymousDiagnosticPayload;

const CohortTotalsSchema = z.object({
  commits: z.number().default(0),
  sourceLinesAdded: z.number().default(0),
  testLinesAdded: z.number().default(0),
  docsLinesAdded: z.number().default(0),
  configLinesAdded: z.number().default(0),
  totalLinesAdded: z.number().default(0),
  totalLinesDeleted: z.number().default(0),
  baselineCostUsd: z.number().default(0),
  actualCostUsd: z.number().default(0),
  costSavingsUsd: z.number().default(0),
  weightedCostSavingsPct: z.number().default(0),
  baselineTokens: z.number().default(0),
  actualTokens: z.number().default(0),
  tokensSaved: z.number().default(0),
  escalatedCommits: z.number().default(0),
  reworkCommits: z.number().default(0),
});
export type CohortTotals = z.infer<typeof CohortTotalsSchema>;

const CohortMediansSchema = z.object({
  costSavingsPct: z.number().default(0),
  gitNotesCoveragePct: z.number().default(0),
  contractCompliancePct: z.number().default(0),
  reworkRatioPct: z.number().default(0),
  commitCadenceSec: z.number().default(0),
});
export type CohortMedians = z.infer<typeof CohortMediansSchema>;

const CohortModelEntrySchema = z.object({
  tier: z.string(),
  commits: z.number(),
  sourceLinesAdded: z.number(),
  docsLinesAdded: z.number(),
  estimatedCostUsd: z.number(),
});
export type CohortModelEntry = z.infer<typeof CohortModelEntrySchema>;

export const COHORT_TOTALS_DEFAULT: CohortTotals = {
  commits: 0,
  sourceLinesAdded: 0,
  testLinesAdded: 0,
  docsLinesAdded: 0,
  configLinesAdded: 0,
  totalLinesAdded: 0,
  totalLinesDeleted: 0,
  baselineCostUsd: 0,
  actualCostUsd: 0,
  costSavingsUsd: 0,
  weightedCostSavingsPct: 0,
  baselineTokens: 0,
  actualTokens: 0,
  tokensSaved: 0,
  escalatedCommits: 0,
  reworkCommits: 0,
};

export const COHORT_MEDIANS_DEFAULT: CohortMedians = {
  costSavingsPct: 0,
  gitNotesCoveragePct: 0,
  contractCompliancePct: 0,
  reworkRatioPct: 0,
  commitCadenceSec: 0,
};

export const CohortBenchmarkSchema = z.object({
  schemaVersion: z.string().default("2.0.0"),
  generatedAt: z.string(),
  cohortSize: z.number(),
  projectIds: z.array(z.string()),
  totals: CohortTotalsSchema.default(COHORT_TOTALS_DEFAULT),
  medians: CohortMediansSchema.default(COHORT_MEDIANS_DEFAULT),
  tierDistribution: TierCommitDistributionSchema.default({
    "tier-1": 0,
    "tier-2": 0,
    "tier-3": 0,
  }),
  stackDistribution: z.record(z.string(), z.number()).default({}),
  modelDistribution: z.record(z.string(), CohortModelEntrySchema).default({}),
});
export type CohortBenchmark = z.infer<typeof CohortBenchmarkSchema>;
