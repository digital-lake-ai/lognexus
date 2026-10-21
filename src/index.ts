export { checkGit, checkGitHubCli, checkRulesConfig, runDiagnostics } from "./doctor.js";
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
  fetchNotes,
  getNote,
  listNotes,
  type NoteOptions,
  pushNotes,
} from "./notes/notes.js";
export { DEFAULT_ROUTING_TEMPLATE, initProject } from "./scaffold.js";
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
export { getProjectStatus } from "./status.js";
