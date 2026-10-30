import { execFileSync } from "node:child_process";

const SAFE_REFERENCE_PATTERN = /^[a-zA-Z0-9._/-]+$/;

function rejection(ref: string, reason: string): Error {
  return new Error(
    `Governance violation: Invalid or unsafe Git reference provided: "${ref}" (${reason})`,
  );
}

/**
 * Single source of truth for validating any user-supplied Git reference before it
 * reaches a child process. Rejects everything `git check-ref-format` rejects, plus
 * leading dashes, so no argument can ever be interpreted as a flag.
 */
export function validateGitReference(ref: string): string {
  const sanitized = ref.trim();

  if (sanitized === "") throw rejection(ref, "empty reference");
  if (!SAFE_REFERENCE_PATTERN.test(sanitized)) throw rejection(ref, "illegal characters");
  if (sanitized.startsWith("-")) throw rejection(ref, "leading dash");
  if (sanitized.includes("..")) throw rejection(ref, "revision range operator");
  if (sanitized.includes("@{")) throw rejection(ref, "reflog operator");
  if (sanitized.includes("//")) throw rejection(ref, "consecutive slashes");
  if (sanitized.endsWith("/")) throw rejection(ref, "trailing slash");
  if (sanitized.endsWith(".lock")) throw rejection(ref, "reserved .lock suffix");
  if (sanitized.endsWith(".")) throw rejection(ref, "trailing dot");

  return sanitized;
}

/**
 * Resolves candidate base branches (main, master) safely checking existence
 * without exposing raw child_process execution outside the safe git module.
 */
export function detectBaseBranch(targetDir: string): string {
  for (const candidate of ["main", "master"]) {
    try {
      execFileSync("git", ["rev-parse", "--verify", "--quiet", `${candidate}^{commit}`], {
        cwd: targetDir,
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
      });
      return candidate;
    } catch {
      // Candidate branch does not exist in this repository.
    }
  }

  return "main";
}

/**
 * Reads the published `lognexusPolicy` block for a package from the npm registry.
 *
 * The lookup goes through `npm view` rather than an HTTP client to keep the whole
 * codebase free of `fetch()`. It is best-effort by design: a missing npm binary, no
 * network, a timeout or a malformed payload all collapse to `null`, so a startup
 * check can never block on the registry.
 */
export function fetchNpmPackagePolicy(
  packageName: string,
  targetDir: string = process.cwd(),
): NpmPackagePolicy | null {
  if (packageName.trim() === "") return null;

  try {
    const raw = execFileSync("npm", ["view", packageName, "version", "lognexusPolicy", "--json"], {
      cwd: targetDir,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      timeout: 2500,
    });

    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;

    const record = parsed as Record<string, unknown>;
    const version = typeof record.version === "string" ? record.version : null;
    const policy = record.lognexusPolicy;

    if (version === null) return null;

    return {
      version,
      lognexusPolicy:
        policy !== null && typeof policy === "object" && !Array.isArray(policy)
          ? (policy as NpmPackagePolicy["lognexusPolicy"])
          : null,
    };
  } catch {
    // Offline, npm missing, timeout or unexpected payload: silently skip the check.
    return null;
  }
}

export interface NpmPackagePolicy {
  version: string;
  lognexusPolicy: {
    minCriticalVersion?: string;
    termsVersion?: string;
    requiresTermsAcceptance?: boolean;
  } | null;
}

/**
 * Rejects refs that live under `refs/notes/`. Notes are metadata, not ancestry:
 * using one as a base branch would diff a commit against a note tree.
 */
export function rejectNotesReference(ref: string, field = "reference"): string {
  const safeRef = validateGitReference(ref);

  if (safeRef === "refs/notes" || safeRef.startsWith("refs/notes/")) {
    throw new Error(
      `Governance violation: ${field} cannot point at a Git Notes ref ("${ref}"). ` +
        "Notes store metadata, not commit ancestry — use a branch or a commit SHA.",
    );
  }

  return safeRef;
}

/**
 * Resolves a validated reference to a concrete commit object. Fails closed: a ref
 * that does not exist, or that names a tree/blob/tag object instead of a commit,
 * is rejected rather than silently falling back to another revision.
 */
export function verifyCommitish(ref: string, cwd: string): string {
  const safeRef = validateGitReference(ref);

  try {
    const resolved = execFileSync(
      "git",
      ["rev-parse", "--verify", "--quiet", `${safeRef}^{commit}`],
      { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], shell: false },
    ).trim();

    if (resolved === "") {
      throw new Error("empty resolution");
    }

    return resolved;
  } catch {
    throw new Error(
      `Governance violation: Git reference "${safeRef}" does not resolve to a commit in ${cwd}.`,
    );
  }
}
