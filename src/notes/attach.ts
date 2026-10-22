import { execSync } from "node:child_process";
import { checkSelfApproval, extractTrailers } from "../audit/audit.js";
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
    status?: "pending" | "in-progress" | "completed";
    contract?: unknown;
  } | null;
  tier: string;
}

export function buildStateNotePayload(targetDir: string = process.cwd()): GitNotePayload {
  const state = loadState(targetDir);

  return {
    $schema: "https://lognexus.digital-lake.ai/schemas/git-note-v1.json",
    generator: "LogNexus",
    version: "1.1.0",
    timestamp: new Date().toISOString(),
    issue: state.activeIssue ? { id: state.activeIssue.id, title: state.activeIssue.title } : null,
    subtask: state.currentSubtask
      ? {
          id: state.currentSubtask.id,
          title: state.currentSubtask.title,
          status: state.currentSubtask.status,
          contract: state.currentSubtask.contract,
        }
      : null,
    tier: state.activeIssue?.tier ?? "tier-3",
  };
}

function getCommitMessage(commitRef: string, cwd: string): string {
  try {
    return execSync(`git log -1 --format=%B ${commitRef}`, {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    return "";
  }
}

export function attachCurrentStateToCommit(
  commitRef: string = "HEAD",
  options: NoteOptions = {},
): GitNotePayload {
  const cwd = options.cwd ?? process.cwd();

  // Parche 3: Pre-flight validation against review-gate separation (self-approval)
  if (!options.force) {
    const commitBody = getCommitMessage(commitRef, cwd);
    if (commitBody) {
      const { author, reviewer } = extractTrailers(commitBody);
      const check = checkSelfApproval(author, reviewer);
      if (check.isSelfApproval) {
        throw new Error(`Review-gate separation violation: ${check.message}`);
      }
    }
  }

  const payload = buildStateNotePayload(cwd);
  const serialized = JSON.stringify(payload, null, 2);
  attachNote(serialized, commitRef, options);
  return payload;
}
