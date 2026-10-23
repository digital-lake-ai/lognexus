import { z } from "zod";

export const TelemetryModeSchema = z.enum(["off", "local", "community"]);
export type TelemetryMode = z.infer<typeof TelemetryModeSchema>;

export const TelemetryConsentSchema = z.object({
  accepted: z.boolean().default(false),
  policyVersion: z.string().default("1.0.0"),
  acceptedAt: z.string().nullable().default(null),
});
export type TelemetryConsent = z.infer<typeof TelemetryConsentSchema>;

export const ExtensionStatSchema = z.object({
  ext: z.string(),
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
});
export type ModelStat = z.infer<typeof ModelStatSchema>;

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
};

export const TaskTimingEntrySchema = z.object({
  taskId: z.string(),
  startedAt: z.string(),
  completedAt: z.string().nullable().default(null),
  durationSec: z.number().default(0),
});
export type TaskTimingEntry = z.infer<typeof TaskTimingEntrySchema>;

export const TelemetryStoreSchema = z.object({
  schemaVersion: z.string().default("1.0.0"),
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

export const AnonymousCommunityPayloadSchema = z.object({
  schemaVersion: z.string().default("1.0.0"),
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
  dispatchedAt: z.string().default(() => new Date().toISOString()),
});
export type AnonymousCommunityPayload = z.infer<typeof AnonymousCommunityPayloadSchema>;
