export {
  type AuditResult,
  type AuditViolation,
  auditBranch,
  COMMIT_FORMAT_PATTERN,
  checkSelfApproval,
  extractTrailers,
  formatAuditResult,
  type Identity,
  parseIdentity,
  SUBJECT_TASK_PATTERN,
} from "./audit/audit.js";
export {
  getCliVersion,
  isDirectCliExecution,
  type ParsedCommitArgs,
  parseCommitArgs,
} from "./cli.js";
export {
  type CommitOptions,
  type CommitResult,
  executeAtomicCommit,
} from "./commit.js";
export {
  checkGit,
  checkGitHubCli,
  checkRulesConfig,
  checkScopeDrift,
  runDiagnostics,
} from "./doctor.js";
export { fetchNpmPackagePolicy, type NpmPackagePolicy, resolveNpmCliScript } from "./git/safe.js";
export {
  getMcpPrompt,
  listMcpPrompts,
  type PromptDefinition,
  type PromptMessage,
  type PromptResult,
} from "./mcp/prompts.js";
export {
  listMcpResources,
  MCP_RESOURCE_PREFIX,
  type ResourceDefinition,
  readMcpResource,
} from "./mcp/resources.js";
export {
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_VERSION,
  processMcpMessage,
  startMcpServer,
} from "./mcp/server.js";
export {
  callMcpTool,
  listMcpTools,
  MCP_SERVER_NAME,
  type ToolCallResult,
  type ToolDefinition,
} from "./mcp/tools.js";
export {
  attachCurrentStateToCommit,
  buildStateNotePayload,
  type GitNotePayload,
} from "./notes/attach.js";
export {
  attachNote,
  DEFAULT_NOTES_REF,
  DEFAULT_SEARCH_LIMIT,
  fetchNotes,
  getNote,
  listNotes,
  type NoteOptions,
  type NoteSearchFilter,
  type NoteSearchResult,
  pushNotes,
  searchNotesMemory,
} from "./notes/notes.js";
export { DEFAULT_ROUTING_TEMPLATE, initProject, LOGNEXUS_GITIGNORE_ENTRIES } from "./scaffold.js";
export {
  ARCHITECT_IDENTITY,
  AUDITOR_IDENTITY,
  CONTEXT_MAX_FILES,
  CONTEXT_MAX_LOC,
  type ContextBudgetStatus,
  type ContextHandoff,
  discoverPlanFile,
  evaluateContextBudget,
  generateContextHandoff,
  getHandoffPath,
  type HandoffScopeDrift,
  type HandoffSubtaskEntry,
  IMPLEMENTER_IDENTITY,
  refreshContextHandoff,
  renderCompactDispatchPrompt,
  renderContextHandoff,
  writeContextHandoffFile,
} from "./state/handoff.js";
export {
  clearState,
  createEmptyState,
  finishSubtask,
  getStatePath,
  loadState,
  saveState,
  setSubtask,
} from "./state/manager.js";
export * from "./state/schema.js";
export { fetchIssueMeta, getBranchName, syncStateFromGit } from "./state/sync.js";
export { getProjectStatus, getScopeDrift, type ScopeDrift } from "./status.js";
export * from "./telemetry/index.js";
export {
  buildTimelineTable,
  getJourneyTimeline,
  type JourneyTimelineResult,
  type TimelineItem,
} from "./timeline/timeline.js";
export {
  acceptTerms,
  checkUpdateGate,
  compareVersions,
  EPHEMERAL_LOGNEXUS_FILES,
  ensureLocalGitExclude,
  formatUpdateGateResult,
  getTermsConsentPath,
  getUpdateCachePath,
  isUpdateCheckDisabled,
  readLocalPolicy,
  readTermsConsent,
  type TermsConsent,
  UPDATE_CHECK_DISABLED_ENV,
  UPGRADE_COMMAND,
  type UpdateGateResult,
  type UpdatePolicy,
} from "./update/gate.js";
