export {
  buildAnonymousCommunityPayload,
  clearTelemetry,
  createDefaultTelemetryStore,
  DEFAULT_TELEMETRY_ENDPOINT,
  disableTelemetry,
  dispatchCommunityTelemetry,
  enableTelemetry,
  getTelemetryPath,
  isTelemetryActive,
  isTelemetryGloballyDisabled,
  loadTelemetry,
  recordCommitTelemetry,
  recordReviewGateBlock,
  recordTaskFinish,
  recordTaskStart,
  saveTelemetry,
  updateCostSavingsEstimate,
} from "./collector.js";
export {
  detectProjectStacks,
  extractCommitDiffStats,
  extractModelFamilyCategory,
} from "./detector.js";
export {
  CUSTOM_NOTES_MARKER,
  formatTelemetryMarkdownReport,
  generateTelemetryReportFile,
} from "./report.js";
export {
  type AnonymousCommunityPayload,
  AnonymousCommunityPayloadSchema,
  DEFAULT_TELEMETRY_SUMMARY,
  type ExtensionStat,
  type ModelStat,
  type TaskTimingEntry,
  TaskTimingEntrySchema,
  type TelemetryConsent,
  type TelemetryMode,
  type TelemetryStore,
  TelemetryStoreSchema,
  type TelemetrySummary,
} from "./schema.js";
