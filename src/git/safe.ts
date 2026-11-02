import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

const SAFE_REFERENCE_PATTERN = /^[a-zA-Z0-9._/-]+$/;
const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const JS_SCRIPT_PATTERN = /\.(?:c|m)?js$/i;

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
 * Locates the real npm entrypoint script so the update gate can be spawned without
 * relying on a shell.
 *
 * On Windows `npm` is a `.cmd` shim, and `execFileSync("npm", ..., { shell: false })`
 * fails with ENOENT because Node cannot execute a batch file directly. Resolving
 * `npm-cli.js` and running it through the current Node binary keeps `shell: false`
 * viable on every platform.
 */
export function resolveNpmCliScript(
  execPath: string = process.execPath,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const npmExecPath = env.npm_execpath;
  if (npmExecPath && JS_SCRIPT_PATTERN.test(npmExecPath) && existsSync(npmExecPath)) {
    return npmExecPath;
  }

  const execDir = dirname(execPath);
  const candidates = [
    // Standard Windows / nvm-windows / fnm layout.
    join(execDir, "node_modules", "npm", "bin", "npm-cli.js"),
    // Standard Unix / macOS / Linux layout.
    join(execDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

/**
 * Reads the published `lognexusPolicy` block for a package from the npm registry.
 *
 * The lookup goes through `npm view` rather than an HTTP client to keep the whole
 * codebase free of `fetch()`. It is best-effort by design: a missing npm binary, no
 * network, a timeout or a malformed payload all collapse to `null`, so a startup
 * check can never block on the registry.
 *
 * `timeoutMsOrCwd` accepts a millisecond budget or, for backward compatibility, the
 * working directory callers used to pass — the lookup no longer runs in that directory.
 */
export function fetchNpmPackagePolicy(
  packageName: string,
  timeoutMsOrCwd: number | string = 2500,
): NpmPackagePolicy | null {
  if (!PACKAGE_NAME_PATTERN.test(packageName)) return null;

  const timeoutMs = typeof timeoutMsOrCwd === "number" ? timeoutMsOrCwd : 2500;
  const npmCli = resolveNpmCliScript();
  const args = ["view", packageName, "version", "lognexusPolicy", "--json"];

  try {
    const raw =
      npmCli !== null
        ? execFileSync(process.execPath, [npmCli, ...args], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
            shell: false,
            timeout: timeoutMs,
          })
        : execFileSync("npm", args, {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
            shell: false,
            timeout: timeoutMs,
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
