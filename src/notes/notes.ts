import { execSync } from "node:child_process";

export const DEFAULT_NOTES_REF = "refs/notes/lognexus";

export interface NoteOptions {
  ref?: string;
  cwd?: string;
}

export function attachNote(
  content: string,
  commitRef: string = "HEAD",
  options: NoteOptions = {},
): void {
  const ref = options.ref ?? DEFAULT_NOTES_REF;
  const cwd = options.cwd ?? process.cwd();

  // Pass note content via stdin (-F -) for 100% reliable cross-platform escaping
  execSync(`git notes --ref="${ref}" add -f -F - ${commitRef}`, {
    input: content,
    cwd,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

export function getNote(commitRef: string = "HEAD", options: NoteOptions = {}): string | null {
  const ref = options.ref ?? DEFAULT_NOTES_REF;
  const cwd = options.cwd ?? process.cwd();

  try {
    const output = execSync(`git notes --ref="${ref}" show ${commitRef}`, {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return output.trim();
  } catch {
    return null;
  }
}

export function listNotes(
  options: NoteOptions = {},
): Array<{ commitSha: string; noteBlob: string }> {
  const ref = options.ref ?? DEFAULT_NOTES_REF;
  const cwd = options.cwd ?? process.cwd();

  try {
    const raw = execSync(`git notes --ref="${ref}" list`, {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
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
  const ref = options.ref ?? DEFAULT_NOTES_REF;
  const cwd = options.cwd ?? process.cwd();

  try {
    execSync(`git push ${remote} ${ref}`, {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

export function fetchNotes(remote: string = "origin", options: NoteOptions = {}): boolean {
  const ref = options.ref ?? DEFAULT_NOTES_REF;
  const cwd = options.cwd ?? process.cwd();

  try {
    execSync(`git fetch ${remote} ${ref}:${ref}`, {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}
