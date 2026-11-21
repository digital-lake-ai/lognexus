import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { extractTrailers } from "../audit/audit.js";
import { rejectNotesReference, validateGitReference, verifyCommitish } from "../git/safe.js";
import { resolveConfinedOutputPath } from "../telemetry/report.js";

export const DEFAULT_NOTES_REF = "refs/notes/lognexus";

export interface NoteOptions {
  ref?: string;
  cwd?: string;
  force?: boolean;
}

function validateRef(ref: string): string {
  return validateGitReference(ref);
}

export function attachNote(
  content: string,
  commitRef: string = "HEAD",
  options: NoteOptions = {},
): void {
  const ref = validateRef(options.ref ?? DEFAULT_NOTES_REF);
  const safeCommitRef = validateRef(commitRef);
  const cwd = options.cwd ?? process.cwd();

  // Pass note content via stdin (-F -) for 100% reliable cross-platform escaping
  execFileSync("git", ["notes", `--ref=${ref}`, "add", "-f", "-F", "-", safeCommitRef], {
    input: content,
    cwd,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
  });
}

export function getNote(commitRef: string = "HEAD", options: NoteOptions = {}): string | null {
  try {
    const ref = validateRef(options.ref ?? DEFAULT_NOTES_REF);
    const safeCommitRef = validateRef(commitRef);
    const cwd = options.cwd ?? process.cwd();

    const output = execFileSync("git", ["notes", `--ref=${ref}`, "show", safeCommitRef], {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });
    return output.trim();
  } catch {
    return null;
  }
}

export function listNotes(
  options: NoteOptions = {},
): Array<{ commitSha: string; noteBlob: string }> {
  try {
    const ref = validateRef(options.ref ?? DEFAULT_NOTES_REF);
    const cwd = options.cwd ?? process.cwd();

    const raw = execFileSync("git", ["notes", `--ref=${ref}`, "list"], {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    }).trim();

    if (!raw) return [];

    return raw.split("\n").map((line) => {
      const parts = line.trim().split(/\s+/);
      return {
        noteBlob: parts[0],
        commitSha: parts[1],
      };
    });
  } catch {
    return [];
  }
}

export interface NoteSearchFilter {
  /** Free-text match against the commit subject, note summary and note body. */
  query?: string;
  /** Restrict to commits that touched the given path. */
  file?: string;
  /** Match the commit author or a trailer identity (Authored-by / Reviewed-by). */
  author?: string;
  /** Restrict to commits whose Git Note belongs to the given issue number. */
  issue?: number;
  /** Hard cap on returned entries (newest first). Defaults to 20. */
  limit?: number;
}

export interface NoteSearchResult {
  commitSha: string;
  shortSha: string;
  subject: string;
  author: string;
  /** Parsed LogNexus note payload, or null when the note is free-form text. */
  subtaskId: string | null;
  subtaskTitle: string | null;
  issueId: number | null;
  tier: string | null;
  files: string[];
  note: string;
}

export const DEFAULT_SEARCH_LIMIT = 20;

function runGitLines(args: string[], cwd: string): string[] {
  try {
    const raw = execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
  } catch {
    return [];
  }
}

function parseNotePayload(note: string): {
  subtaskId: string | null;
  subtaskTitle: string | null;
  issueId: number | null;
  tier: string | null;
} {
  const empty = { subtaskId: null, subtaskTitle: null, issueId: null, tier: null };
  try {
    const parsed: unknown = JSON.parse(note);
    if (parsed === null || typeof parsed !== "object") return empty;
    const record = parsed as {
      issue?: { id?: unknown } | null;
      subtask?: { id?: unknown; title?: unknown } | null;
      tier?: unknown;
    };
    return {
      subtaskId: typeof record.subtask?.id === "string" ? record.subtask.id : null,
      subtaskTitle: typeof record.subtask?.title === "string" ? record.subtask.title : null,
      issueId: typeof record.issue?.id === "number" ? record.issue.id : null,
      tier: typeof record.tier === "string" ? record.tier : null,
    };
  } catch {
    return empty;
  }
}

/**
 * Recalls past LogNexus decisions from `refs/notes/lognexus`. Every filter is optional
 * and applied conjunctively; results are returned newest-first and capped by `limit`.
 * The search is strictly local: no network access and no remote lookups.
 */
export function searchNotesMemory(
  targetDir: string = process.cwd(),
  filter: NoteSearchFilter = {},
): NoteSearchResult[] {
  const limit =
    filter.limit !== undefined && filter.limit > 0 ? filter.limit : DEFAULT_SEARCH_LIMIT;
  const query = filter.query?.trim().toLowerCase() ?? "";
  const author = filter.author?.trim().toLowerCase() ?? "";
  const file = filter.file?.trim() ?? "";

  const notes = listNotes({ cwd: targetDir });
  if (notes.length === 0) return [];

  const shas = notes.map((entry) => entry.commitSha);
  const subjects = new Map<string, string>();
  const authors = new Map<string, string>();
  const commitBodies = new Map<string, string>();
  const timestamps = new Map<string, number>();

  if (shas.length > 0) {
    // The commit body carries the provenance trailers, so a single log pass resolves
    // subject, author and Authored-by attribution without a second git invocation.
    const meta = runGitLines(
      ["log", "--no-walk", "--format=%H%x00%at%x00%an%x00%s%x00%B%x1e", ...shas],
      targetDir,
    );
    for (const record of meta.join("\n").split("\u001e")) {
      const trimmed = record.trim();
      if (trimmed === "") continue;
      const [sha = "", at = "", gitAuthor = "", subject = "", body = ""] = trimmed.split("\u0000");
      if (sha === "") continue;
      subjects.set(sha, subject);
      const trailerAuthor = extractTrailers(body).author;
      authors.set(sha, trailerAuthor ?? gitAuthor.trim());
      commitBodies.set(sha, body);
      const seconds = Number.parseInt(at, 10);
      timestamps.set(sha, Number.isNaN(seconds) ? 0 : seconds);
    }
  }

  const filesCache = new Map<string, string[]>();
  const filesOf = (sha: string): string[] => {
    const cached = filesCache.get(sha);
    if (cached) return cached;
    const files = runGitLines(["show", "--name-only", "--format=", sha], targetDir);
    filesCache.set(sha, files);
    return files;
  };

  const results: NoteSearchResult[] = [];

  // `git notes list` yields the ref's insertion order; recall is newest-first.
  const ordered = [...notes].sort(
    (left, right) => (timestamps.get(right.commitSha) ?? 0) - (timestamps.get(left.commitSha) ?? 0),
  );

  for (const entry of ordered) {
    const note = getNote(entry.commitSha, { cwd: targetDir }) ?? "";
    const payload = parseNotePayload(note);
    const subject = subjects.get(entry.commitSha) ?? "";
    const commitAuthor = authors.get(entry.commitSha) ?? "";
    const body = commitBodies.get(entry.commitSha) ?? "";

    if (filter.issue !== undefined && payload.issueId !== filter.issue) continue;

    if (author !== "") {
      const haystack = `${commitAuthor}\n${body}`.toLowerCase();
      if (!haystack.includes(author)) continue;
    }

    let files: string[] = [];
    if (file !== "") {
      files = filesOf(entry.commitSha);
      if (!files.includes(file)) continue;
    }

    if (query !== "") {
      // Search only commit- and subtask-scoped fields: the note payload's issue block is
      // shared by every commit of a cycle, so including it would match all of them.
      // Free-form notes keep their full text searchable.
      const subtaskBlock =
        payload.subtaskId !== null
          ? [payload.subtaskId, payload.subtaskTitle ?? ""].join(" ").trim()
          : note;
      const haystack = [
        subject,
        subtaskBlock,
        payload.tier ?? "",
        commitAuthor,
        (files.length > 0 ? files : filesOf(entry.commitSha)).join(" "),
        body,
      ]
        .join("\n")
        .toLowerCase();
      if (!haystack.includes(query)) continue;
    }

    results.push({
      commitSha: entry.commitSha,
      shortSha: entry.commitSha.slice(0, 7),
      subject,
      author: commitAuthor,
      subtaskId: payload.subtaskId,
      subtaskTitle: payload.subtaskTitle,
      issueId: payload.issueId,
      tier: payload.tier,
      files: files.length > 0 ? files : filesOf(entry.commitSha),
      note,
    });

    if (results.length >= limit) break;
  }

  return results;
}

export function pushNotes(remote: string = "origin", options: NoteOptions = {}): boolean {
  try {
    const ref = validateRef(options.ref ?? DEFAULT_NOTES_REF);
    const safeRemote = validateRef(remote);
    const cwd = options.cwd ?? process.cwd();

    execFileSync("git", ["push", safeRemote, ref], {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });
    return true;
  } catch {
    return false;
  }
}

export function fetchNotes(remote: string = "origin", options: NoteOptions = {}): boolean {
  try {
    const ref = validateRef(options.ref ?? DEFAULT_NOTES_REF);
    const safeRemote = validateRef(remote);
    const cwd = options.cwd ?? process.cwd();

    execFileSync("git", ["fetch", safeRemote, `${ref}:${ref}`], {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });
    return true;
  } catch {
    return false;
  }
}

export interface NoteExportOptions {
  /** Exclude commits reachable from this commitish (`<since>..HEAD`). */
  since?: string;
  /** Restrict exported records to a ticket identifier (e.g. `40`, `#40`, `PROJ-12`). */
  issue?: string;
  /** Confined relative or in-repo output file path for the generated JSONL archive. */
  outputPath?: string;
  /** Git Notes reference to export from. Defaults to `refs/notes/lognexus`. */
  ref?: string;
}

export interface ExportedNoteRecord {
  sha: string;
  timestamp: string;
  subject: string;
  note: Record<string, unknown> | string;
}

export interface NoteExportResult {
  count: number;
  jsonl: string;
  outputPath: string | null;
}

function normalizeIssueIdentifier(issue: string | number): string {
  let raw = String(issue).trim();
  while (raw.startsWith("#")) raw = raw.slice(1);
  const numeric = Number.parseInt(raw, 10);
  if (raw !== "" && String(numeric) === raw) return String(numeric);
  return raw.toUpperCase();
}

function isTokenChar(code: number): boolean {
  return (
    (code >= 97 && code <= 122) || // a-z
    (code >= 48 && code <= 57) || // 0-9
    code === 95 || // _
    code === 45 // -
  );
}

function hasDelimitedToken(haystack: string, token: string): boolean {
  if (token === "") return false;
  let fromIndex = 0;
  while (fromIndex <= haystack.length - token.length) {
    const idx = haystack.indexOf(token, fromIndex);
    if (idx === -1) return false;
    const beforeOk = idx === 0 || !isTokenChar(haystack.charCodeAt(idx - 1));
    const afterIdx = idx + token.length;
    const afterOk = afterIdx === haystack.length || !isTokenChar(haystack.charCodeAt(afterIdx));
    if (beforeOk && afterOk) return true;
    fromIndex = idx + 1;
  }
  return false;
}

function parseNoteExportContent(rawNote: string): Record<string, unknown> | string {
  const trimmed = rawNote.trim();
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Plain-text or legacy notes remain trimmed strings.
  }
  return trimmed;
}

function matchesExportIssue(
  normalizedIssue: string,
  subject: string,
  body: string,
  note: Record<string, unknown> | string,
): boolean {
  if (normalizedIssue === "") return false;

  if (typeof note === "object" && note !== null) {
    const issueField = note.issue;
    if (issueField !== null && typeof issueField === "object" && !Array.isArray(issueField)) {
      const noteIssueId = (issueField as { id?: unknown }).id;
      if (typeof noteIssueId === "number" || typeof noteIssueId === "string") {
        if (normalizeIssueIdentifier(noteIssueId) === normalizedIssue) return true;
      }
    }
  }

  const lowered = normalizedIssue.toLowerCase();
  const haystack = `${subject}\n${body}`.toLowerCase();
  const scopedCandidates = [`(#${lowered}/`, `(#${lowered})`, `(${lowered}/`, `(${lowered})`];
  if (scopedCandidates.some((candidate) => haystack.includes(candidate))) return true;

  const isNumeric = String(Number.parseInt(normalizedIssue, 10)) === normalizedIssue;
  return isNumeric
    ? hasDelimitedToken(haystack, `#${lowered}`)
    : hasDelimitedToken(haystack, lowered);
}

function writeConfinedJsonl(outputPath: string | null, jsonl: string): void {
  if (outputPath === null) return;
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, jsonl, "utf8");
}

/**
 * Exports Git Notes locally in deterministic topological oldest-to-newest JSONL order.
 * Validates all Git references and confines optional file output inside `targetDir`.
 */
export function exportNotesJsonl(
  targetDir: string = process.cwd(),
  options: NoteExportOptions = {},
): NoteExportResult {
  const ref = validateRef(options.ref ?? DEFAULT_NOTES_REF);

  const trimmedOutputPath = options.outputPath?.trim() ?? "";
  const resolvedOutputPath =
    trimmedOutputPath !== "" ? resolveConfinedOutputPath(targetDir, trimmedOutputPath) : null;

  const sinceInput = options.since?.trim() ?? "";
  let rangeArg = "HEAD";
  if (sinceInput !== "") {
    const safeSince = rejectNotesReference(sinceInput, "--since");
    const sinceSha = verifyCommitish(safeSince, targetDir);
    rangeArg = `${sinceSha}..HEAD`;
  }

  try {
    verifyCommitish("HEAD", targetDir);
  } catch {
    writeConfinedJsonl(resolvedOutputPath, "");
    return { count: 0, jsonl: "", outputPath: resolvedOutputPath };
  }

  const notes = listNotes({ cwd: targetDir, ref });
  if (notes.length === 0) {
    writeConfinedJsonl(resolvedOutputPath, "");
    return { count: 0, jsonl: "", outputPath: resolvedOutputPath };
  }

  const notedShas = new Set<string>(notes.map((entry) => entry.commitSha));
  const issueInput = options.issue?.trim() ?? "";
  const normalizedIssue = issueInput !== "" ? normalizeIssueIdentifier(issueInput) : null;

  const rawLog = execFileSync(
    "git",
    ["log", "--topo-order", "--reverse", "--format=%H%x00%cI%x00%s%x00%B%x1e", rangeArg],
    {
      cwd: targetDir,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    },
  );

  const records: ExportedNoteRecord[] = [];
  for (const rawRecord of rawLog.split("\u001e")) {
    const cleaned = rawRecord.trimStart();
    if (cleaned === "") continue;

    const [rawSha = "", timestamp = "", subject = "", ...bodyParts] = cleaned.split("\u0000");
    const sha = rawSha.trim();
    if (sha === "" || !notedShas.has(sha)) continue;

    const rawNote = getNote(sha, { cwd: targetDir, ref });
    if (rawNote === null) continue;

    const note = parseNoteExportContent(rawNote);
    const body = bodyParts.join("\u0000");
    if (normalizedIssue !== null && !matchesExportIssue(normalizedIssue, subject, body, note)) {
      continue;
    }

    records.push({
      sha,
      timestamp: timestamp.trim(),
      subject: subject.trim(),
      note,
    });
  }

  const jsonl =
    records.length > 0 ? `${records.map((record) => JSON.stringify(record)).join("\n")}\n` : "";
  writeConfinedJsonl(resolvedOutputPath, jsonl);

  return {
    count: records.length,
    jsonl,
    outputPath: resolvedOutputPath,
  };
}
