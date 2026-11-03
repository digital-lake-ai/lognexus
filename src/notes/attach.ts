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

interface InferredSubjectMeta {
  issueId: number | null;
  subtaskId: string | null;
  description: string;
  subject: string;
}

const SUBJECT_ISSUE_PATTERN = /#(\d+)/;
const SUBJECT_SUBTASK_PATTERN = /\((?:#\d+|[A-Z][A-Z0-9]*-\d+)\/(T\d+(?:-[a-zA-Z0-9]+)?)\)/i;
const SUBJECT_DESCRIPTION_PATTERN = /\):\s*(.+)$/;

/**
 * Reads the conventional subject of the commit being noted, so a note attached to a
 * commit made from outside an active cycle still carries its issue and subtask.
 */
function inferCommitSubjectMeta(commitSha: string, cwd: string): InferredSubjectMeta {
  let subject = "";
  try {
    const sanitized = validateGitReference(commitSha);
    subject = execFileSync("git", ["log", "-1", "--format=%s", sanitized], {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    }).trim();
  } catch {
    return { issueId: null, subtaskId: null, description: "", subject: "" };
  }

  const issueMatch = subject.match(SUBJECT_ISSUE_PATTERN);
  const subtaskMatch = subject.match(SUBJECT_SUBTASK_PATTERN);
  const descriptionMatch = subject.match(SUBJECT_DESCRIPTION_PATTERN);

  const parsedIssue = issueMatch ? Number.parseInt(issueMatch[1], 10) : Number.NaN;
  const rawSubtask = subtaskMatch?.[1] ?? null;

  return {
    issueId: Number.isNaN(parsedIssue) ? null : parsedIssue,
    subtaskId: rawSubtask === null ? null : `T${rawSubtask.slice(1)}`,
    description: descriptionMatch?.[1]?.trim() ?? "",
    subject,
  };
}

export function buildStateNotePayload(
  targetDir: string = process.cwd(),
  options: { tier?: string; escalated?: boolean; commitSha?: string } = {},
): GitNotePayload {
  const state = loadState(targetDir);
  const meta =
    options.commitSha !== undefined ? inferCommitSubjectMeta(options.commitSha, targetDir) : null;

  let issue = state.activeIssue
    ? { id: state.activeIssue.id, title: state.activeIssue.title }
    : null;
  if (issue === null && meta !== null && meta.issueId !== null) {
    issue = { id: meta.issueId, title: meta.subject };
  }

  let subtask = state.currentSubtask
    ? {
        id: state.currentSubtask.id,
        title: state.currentSubtask.title,
        status: state.currentSubtask.status,
        contract: state.currentSubtask.contract,
      }
    : null;
  if (subtask === null && meta !== null && meta.subtaskId !== null) {
    subtask = {
      id: meta.subtaskId,
      title: meta.description || meta.subject,
      status: "completed",
      contract: undefined,
    };
  }

  const payload: GitNotePayload = {
    $schema: "https://lognexus.digital-lake.ai/schemas/git-note-v1.json",
    generator: "LogNexus",
    version: getCliVersion(),
    timestamp: new Date().toISOString(),
    issue,
    subtask,
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
  const safeSha = validateGitReference(commitRef);

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
    commitSha: safeSha,
  });
  const serialized = JSON.stringify(payload, null, 2);
  attachNote(serialized, safeSha, options);
  return payload;
}
