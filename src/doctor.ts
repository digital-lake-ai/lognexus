import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { countPublishedReleases, detectHostProjectVersion, getScopeDrift } from "./status.js";

export interface DiagnosticCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
}

export function checkGit(targetDir: string = process.cwd()): DiagnosticCheck {
  try {
    const version = execFileSync("git", ["--version"], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    }).trim();
    let insideRepo = false;
    try {
      const isInside = execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
        cwd: targetDir,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
      }).trim();
      insideRepo = isInside === "true";
    } catch {
      insideRepo = false;
    }

    if (!insideRepo) {
      return {
        name: "Git Repository",
        status: "warn",
        message: `${version} (current directory is not a Git repository)`,
      };
    }

    return {
      name: "Git",
      status: "pass",
      message: `${version} (inside Git repository)`,
    };
  } catch {
    return {
      name: "Git",
      status: "fail",
      message: "Git is not installed or not available in PATH",
    };
  }
}

export function checkGitHubCli(): DiagnosticCheck {
  try {
    const version = execFileSync("gh", ["--version"], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    })
      .split("\n")[0]
      .trim();

    try {
      execFileSync("gh", ["auth", "status"], {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
      });
      return {
        name: "GitHub CLI",
        status: "pass",
        message: `${version} (authenticated)`,
      };
    } catch {
      return {
        name: "GitHub CLI",
        status: "warn",
        message: `${version} (installed, but not authenticated — run 'gh auth login')`,
      };
    }
  } catch {
    return {
      name: "GitHub CLI",
      status: "warn",
      message: "GitHub CLI (gh) not found in PATH — required for issue & PR automation",
    };
  }
}

export function checkRulesConfig(targetDir: string = process.cwd()): DiagnosticCheck {
  const lognexusDir = join(targetDir, ".lognexus");
  const shiplogDir = join(targetDir, ".shiplog");

  if (existsSync(lognexusDir)) {
    const routingFile = join(lognexusDir, "routing.md");
    if (existsSync(routingFile)) {
      const content = readFileSync(routingFile, "utf8");
      const match = content.match(/routing:\s*(confirm|warn|off)/i);
      const mode = match ? match[1].toLowerCase() : "unknown";
      return {
        name: "LogNexus Rules",
        status: "pass",
        message: `Found .lognexus/ (routing mode: ${mode})`,
      };
    }
    return {
      name: "LogNexus Rules",
      status: "warn",
      message: "Found .lognexus/ directory, but routing.md is missing (run 'lognexus init')",
    };
  }

  if (existsSync(shiplogDir)) {
    return {
      name: "LogNexus Rules",
      status: "warn",
      message: "Found legacy .shiplog/ directory — run 'lognexus init' to scaffold .lognexus/",
    };
  }

  return {
    name: "LogNexus Rules",
    status: "warn",
    message:
      "No .lognexus/ directory found in current project (run 'npx @digital-lake/lognexus init')",
  };
}

export function checkScopeDrift(targetDir: string = process.cwd()): DiagnosticCheck {
  const drift = getScopeDrift(targetDir);

  if (drift.allowedFiles.length === 0) {
    return {
      name: "Scope Drift Guard",
      status: "pass",
      message: "No contracted subtask is active — nothing to compare against",
    };
  }

  if (!drift.detected) {
    return {
      name: "Scope Drift Guard",
      status: "pass",
      message: `${drift.allowedFiles.length} allowed file(s) — working tree matches the contract`,
    };
  }

  return {
    name: "Scope Drift Guard",
    status: "warn",
    message: `${drift.unauthorizedFiles.length} file(s) changed outside the contract: ${drift.unauthorizedFiles.join(", ")}`,
  };
}

/**
 * Reads the number of commits reachable from HEAD; `0` before the first commit.
 */
function countCommits(targetDir: string): number {
  try {
    const output = execFileSync("git", ["rev-list", "--count", "HEAD"], {
      cwd: targetDir,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    }).trim();
    const count = Number.parseInt(output, 10);
    return Number.isFinite(count) ? count : 0;
  } catch {
    return 0;
  }
}

/**
 * Flags the `npm init -y` bootstrap default: a manifest that already declares
 * `1.0.0` while the repository has published no release and barely any history.
 * Such a repository has claimed its first stable milestone before shipping anything.
 */
export function checkVersionMaturity(targetDir: string = process.cwd()): DiagnosticCheck {
  const version = detectHostProjectVersion(targetDir);

  if (version === null) {
    return {
      name: "Version Maturity",
      status: "pass",
      message: "No package manifest detected — version check skipped",
    };
  }

  const releases = countPublishedReleases(targetDir);
  const commitCount = countCommits(targetDir);

  if (version === "1.0.0" && releases === 0 && commitCount <= 5) {
    return {
      name: "Version Maturity",
      status: "warn",
      message:
        'package manifest declares "1.0.0" with 0 published releases (typical npm init -y default) — consider starting at "0.1.0" during initial bootstrap and bumping only on PR merge (--no-ff)',
    };
  }

  return {
    name: "Version Maturity",
    status: "pass",
    message: `Manifest version ${version} (${releases} release(s) published)`,
  };
}

export function runDiagnostics(targetDir: string = process.cwd()): DiagnosticCheck[] {
  return [
    checkGit(targetDir),
    checkGitHubCli(),
    checkRulesConfig(targetDir),
    checkScopeDrift(targetDir),
    checkVersionMaturity(targetDir),
  ];
}
