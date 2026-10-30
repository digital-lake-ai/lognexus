import { execFileSync } from "node:child_process";
import { validateGitReference } from "../git/safe.js";

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
  const bodies = new Map<string, string>();
  const timestamps = new Map<string, number>();

  if (shas.length > 0) {
    const meta = runGitLines(
      ["log", "--no-walk", "--format=%H%x00%at%x00%an%x00%s", ...shas],
      targetDir,
    );
    for (const line of meta) {
      const [sha = "", at = "", commitAuthor = "", subject = ""] = line.split("\u0000");
      if (sha === "") continue;
      subjects.set(sha, subject);
      authors.set(sha, commitAuthor);
      const seconds = Number.parseInt(at, 10);
      timestamps.set(sha, Number.isNaN(seconds) ? 0 : seconds);
    }

    const bodiesRaw = runGitLines(
      ["log", "--no-walk", "--format=%H%x00%B%x1e", ...shas],
      targetDir,
    );
    const joined = bodiesRaw.join("\n");
    for (const record of joined.split("\u001e")) {
      const trimmed = record.trim();
      if (trimmed === "") continue;
      const sep = trimmed.indexOf("\u0000");
      if (sep === -1) continue;
      bodies.set(trimmed.slice(0, sep), trimmed.slice(sep + 1).trim());
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
    const body = bodies.get(entry.commitSha) ?? "";

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
      const haystack = [subject, note, body, payload.subtaskTitle ?? ""].join("\n").toLowerCase();
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
