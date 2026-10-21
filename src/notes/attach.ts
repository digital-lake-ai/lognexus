import { loadState } from "../state/manager.js";
import { attachNote, type NoteOptions } from "./notes.js";

export interface GitNotePayload {
  $schema: string;
  generator: string;
  version: string;
  timestamp: string;
  issue: { id: number; title: string } | null;
  subtask: {
    id: string;
    title: string;
    contract?: unknown;
  } | null;
  tier: string;
}

export function buildStateNotePayload(targetDir: string = process.cwd()): GitNotePayload {
  const state = loadState(targetDir);

  return {
    $schema: "https://lognexus.digital-lake.ai/schemas/git-note-v1.json",
    generator: "LogNexus",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    issue: state.activeIssue ? { id: state.activeIssue.id, title: state.activeIssue.title } : null,
    subtask: state.currentSubtask
      ? {
          id: state.currentSubtask.id,
          title: state.currentSubtask.title,
          contract: state.currentSubtask.contract,
        }
      : null,
    tier: state.activeIssue?.tier ?? "tier-3",
  };
}

export function attachCurrentStateToCommit(
  commitRef: string = "HEAD",
  options: NoteOptions = {},
): GitNotePayload {
  const payload = buildStateNotePayload(options.cwd);
  const serialized = JSON.stringify(payload, null, 2);
  attachNote(serialized, commitRef, options);
  return payload;
}
