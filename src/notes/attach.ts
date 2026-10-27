import { execFileSync } from "node:child_process";
import { checkSelfApproval, extractTrailers } from "../audit/audit.js";
import { getCliVersion } from "../cli.js";
import { validateGitReference } from "../git/safe.js";
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
  escalated?: boolean;
}

export interface NoteAttachOptions extends NoteOptions {
  /** Effective routing tier used for this commit (defaults to the active issue tier). */
  tier?: string;
  /** Marks the commit as an explicit tier escalation (e.g. tier-1 author on a tier-3 subtask). */
  escalated?: boolean;
}

export function buildStateNotePayload(
  targetDir: string = process.cwd(),
  options: { tier?: string; escalated?: boolean } = {},
): GitNotePayload {
  const state = loadState(targetDir);

  const payload: GitNotePayload = {
    $schema: "https://lognexus.digital-lake.ai/schemas/git-note-v1.json",
    generator: "LogNexus",
    version: getCliVersion(),
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
    tier: options.tier ?? state.activeIssue?.tier ?? "tier-3",
  };

  if (options.escalated) {
    payload.escalated = true;
  }

  return payload;
}

function getCommitMessage(commitRef: string, cwd: string): string {
  try {
    const sanitized = validateGitReference(commitRef);
    return execFileSync("git", ["log", "-1", "--format=%B", sanitized], {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });
  } catch {
    return "";
  }
}

export function attachCurrentStateToCommit(
  commitRef: string = "HEAD",
  options: NoteAttachOptions = {},
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

  const payload = buildStateNotePayload(cwd, {
    tier: options.tier,
    escalated: options.escalated,
  });
  const serialized = JSON.stringify(payload, null, 2);
  attachNote(serialized, commitRef, options);
  return payload;
}
