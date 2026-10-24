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
