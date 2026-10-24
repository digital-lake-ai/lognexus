import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

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

export function runDiagnostics(targetDir: string = process.cwd()): DiagnosticCheck[] {
  return [checkGit(targetDir), checkGitHubCli(), checkRulesConfig(targetDir)];
}
