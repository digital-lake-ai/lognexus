export { checkGit, checkGitHubCli, checkRulesConfig, runDiagnostics } from "./doctor.js";
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
export { initProject } from "./scaffold.js";
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
