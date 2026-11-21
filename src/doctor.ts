import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, posix } from "node:path";
import { loadAuditPolicy } from "./audit/policy.js";
import { resolveRoutingProfile } from "./routing/profile.js";
import {
  countPublishedReleases,
  detectHostProjectVersion,
  detectProjectManifestVersions,
  getScopeDrift,
} from "./status.js";

export interface DiagnosticCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
}

export interface DoctorOptions {
  mcp?: boolean;
  platform?: NodeJS.Platform;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
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

  if (existsSync(lognexusDir)) {
    const auditPolicy = loadAuditPolicy(targetDir);
    if (auditPolicy.exists && !auditPolicy.valid) {
      return {
        name: "LogNexus Rules",
        status: "fail",
        message: `Invalid .lognexus/policy.json: ${auditPolicy.errors.join("; ")}`,
      };
    }

    const policySuffix = auditPolicy.exists ? `, policy: ${auditPolicy.profile}` : "";
    const profile = resolveRoutingProfile(targetDir);
    if (profile.hasRoutingFile) {
      if (profile.warnings.length > 0) {
        return {
          name: "LogNexus Rules",
          status: "warn",
          message: `Found .lognexus/routing.md (routing mode: ${profile.routingMode}, orchestration: ${profile.orchestrationMode}, review_gate: ${profile.effectiveReviewGate})${policySuffix} — warning(s): ${profile.warnings.join("; ")}`,
        };
      }
      return {
        name: "LogNexus Rules",
        status: "pass",
        message: `Found .lognexus/ (routing mode: ${profile.routingMode}, orchestration: ${profile.orchestrationMode}, review_gate: ${profile.effectiveReviewGate})${policySuffix}`,
      };
    }
    return {
      name: "LogNexus Rules",
      status: "warn",
      message: `Found .lognexus/ directory, but routing.md is missing (run 'lognexus init')${policySuffix}`,
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
  const manifests = detectProjectManifestVersions(targetDir);
  const distinct = new Set(manifests.map((entry) => entry.version));

  if (distinct.size > 1) {
    return {
      name: "Version Maturity",
      status: "warn",
      message: `Software version drift across manifests (${manifests.map((m) => `${m.path}=${m.version}`).join(", ")}) — keep manifests synchronized and separate Software Version (e.g. 0.1.0) from Document Revision (e.g. rev. 1.3)`,
    };
  }

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

export function checkAgentEcosystem(targetDir: string = process.cwd()): DiagnosticCheck {
  const profile = resolveRoutingProfile(targetDir);
  return {
    name: "Agent Ecosystem",
    status: "pass",
    message: `Profile: ${profile.ecosystems.profileLabel} · review_gate: ${profile.effectiveReviewGate}`,
  };
}

interface McpCandidateFile {
  label: string;
  path: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizedBasename(value: string): string {
  const forwardSlashed = value.trim().replace(/\\/g, "/");
  return posix.basename(forwardSlashed).toLowerCase();
}

function resolveClaudeDesktopConfigPath(
  platform: NodeJS.Platform,
  home: string,
  env: NodeJS.ProcessEnv,
): string {
  if (platform === "darwin") {
    return join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  if (platform === "win32") {
    const appData =
      env.APPDATA && env.APPDATA.trim() !== "" ? env.APPDATA : join(home, "AppData", "Roaming");
    return join(appData, "Claude", "claude_desktop_config.json");
  }
  const xdgConfig =
    env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.trim() !== ""
      ? env.XDG_CONFIG_HOME
      : join(home, ".config");
  return join(xdgConfig, "Claude", "claude_desktop_config.json");
}

function matchesNpmPackageArg(arg: string): boolean {
  const normalized = arg.trim().toLowerCase();
  return (
    normalized === "@digital-lake/lognexus" || normalized.startsWith("@digital-lake/lognexus@")
  );
}

function matchesPyPiPackageArg(arg: string): boolean {
  const normalized = arg.trim().toLowerCase();
  return (
    normalized === "lognexus-mcp" ||
    normalized.startsWith("lognexus-mcp@") ||
    normalized.startsWith("lognexus-mcp==")
  );
}

function isLogNexusServerEntry(serverName: string, entry: unknown): boolean {
  if (serverName.toLowerCase().includes("lognexus")) {
    return true;
  }
  if (!isPlainObject(entry)) {
    return false;
  }

  if (typeof entry.command === "string") {
    const lowerCmd = entry.command.toLowerCase();
    const base = normalizedBasename(entry.command);
    if (
      lowerCmd.includes("@digital-lake/lognexus") ||
      lowerCmd.includes("lognexus-mcp") ||
      lowerCmd.includes("lognexus_mcp") ||
      base === "lognexus" ||
      base === "lognexus.cmd" ||
      base === "lognexus.exe" ||
      base === "lognexus-mcp" ||
      base === "lognexus-mcp.exe"
    ) {
      return true;
    }
  }

  if (Array.isArray(entry.args)) {
    for (const arg of entry.args) {
      if (typeof arg !== "string") continue;
      const lowerArg = arg.toLowerCase();
      const base = normalizedBasename(arg);
      if (
        lowerArg.includes("@digital-lake/lognexus") ||
        lowerArg.includes("lognexus-mcp") ||
        lowerArg.includes("lognexus_mcp") ||
        base === "lognexus" ||
        base === "lognexus.cmd"
      ) {
        return true;
      }
    }
  }

  return false;
}

function validateLogNexusServerEntry(
  candidateLabel: string,
  serverName: string,
  entry: unknown,
): { valid: true; launcher: string } | { valid: false; error: string } {
  if (!isPlainObject(entry)) {
    return {
      valid: false,
      error: `${candidateLabel} (${serverName}): server entry must be an object`,
    };
  }

  if (typeof entry.command !== "string" || entry.command.trim() === "") {
    return {
      valid: false,
      error: `${candidateLabel} (${serverName}): missing or empty "command"`,
    };
  }

  if (entry.args !== undefined) {
    if (!Array.isArray(entry.args) || !entry.args.every((item) => typeof item === "string")) {
      return {
        valid: false,
        error: `${candidateLabel} (${serverName}): "args" must be an array of strings`,
      };
    }
  }

  const command = entry.command.trim();
  const baseCmd = normalizedBasename(command);
  const args: string[] = Array.isArray(entry.args) ? entry.args : [];

  if (baseCmd === "npx" || baseCmd === "npx.cmd" || baseCmd === "bunx" || baseCmd === "pnpm") {
    const hasPkg = args.some(matchesNpmPackageArg);
    const hasMcp = args.includes("mcp");
    if (hasPkg && hasMcp) {
      return { valid: true, launcher: `${candidateLabel} (${baseCmd} @digital-lake/lognexus mcp)` };
    }
    if (hasPkg && !hasMcp) {
      return {
        valid: false,
        error: `${candidateLabel} (${serverName}): missing "mcp" subcommand argument for ${baseCmd} @digital-lake/lognexus`,
      };
    }
  }

  if (baseCmd === "lognexus" || baseCmd === "lognexus.cmd") {
    if (args.includes("mcp")) {
      return { valid: true, launcher: `${candidateLabel} (${baseCmd} mcp)` };
    }
    return {
      valid: false,
      error: `${candidateLabel} (${serverName}): missing "mcp" subcommand argument for ${baseCmd}`,
    };
  }

  if (baseCmd === "node" || baseCmd === "node.exe") {
    const firstArg = args[0];
    const hasCliEntry =
      typeof firstArg === "string" &&
      (normalizedBasename(firstArg) === "cli.js" || firstArg.toLowerCase().includes("cli.js"));
    if (hasCliEntry && args.includes("mcp")) {
      return { valid: true, launcher: `${candidateLabel} (${baseCmd} cli.js mcp)` };
    }
  }

  if (baseCmd === "uvx" || baseCmd === "uvx.exe" || baseCmd === "pipx") {
    if (args.some(matchesPyPiPackageArg)) {
      return { valid: true, launcher: `${candidateLabel} (${baseCmd} lognexus-mcp)` };
    }
  }

  if (baseCmd === "lognexus-mcp" || baseCmd === "lognexus-mcp.exe") {
    return { valid: true, launcher: `${candidateLabel} (${baseCmd})` };
  }

  if (
    baseCmd === "python" ||
    baseCmd === "python.exe" ||
    baseCmd === "python3" ||
    baseCmd === "python3.exe" ||
    baseCmd === "py" ||
    baseCmd === "py.exe"
  ) {
    const mIdx = args.indexOf("-m");
    if (mIdx !== -1 && args[mIdx + 1] === "lognexus_mcp") {
      return { valid: true, launcher: `${candidateLabel} (${baseCmd} -m lognexus_mcp)` };
    }
  }

  return {
    valid: false,
    error: `${candidateLabel} (${serverName}): invalid LogNexus MCP command "${command} ${args.join(" ")}". Expected e.g. "npx -y @digital-lake/lognexus mcp" or "uvx lognexus-mcp"`,
  };
}

/**
 * Inspects Claude Desktop, Cursor, VS Code, and workspace MCP client configs
 * without modifying any file on disk.
 */
export function checkMcpClientConfigs(
  targetDir: string = process.cwd(),
  options: DoctorOptions = {},
): DiagnosticCheck {
  const platform = options.platform ?? process.platform;
  const home = options.homeDir ?? homedir();
  const env = options.env ?? process.env;

  const candidates: McpCandidateFile[] = [
    { label: "Claude Desktop", path: resolveClaudeDesktopConfigPath(platform, home, env) },
    { label: "Cursor", path: join(targetDir, ".cursor", "mcp.json") },
    { label: "VS Code", path: join(targetDir, ".vscode", "mcp.json") },
    { label: "Workspace", path: join(targetDir, ".mcp.json") },
  ];

  const failures: string[] = [];
  const validEntries: string[] = [];

  for (const candidate of candidates) {
    if (!existsSync(candidate.path)) {
      continue;
    }

    let parsed: unknown;
    try {
      const raw = readFileSync(candidate.path, "utf8");
      parsed = JSON.parse(raw);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      failures.push(`${candidate.label} (${candidate.path}): invalid JSON (${msg})`);
      continue;
    }

    if (!isPlainObject(parsed)) {
      failures.push(`${candidate.label} (${candidate.path}): config root must be a JSON object`);
      continue;
    }

    const serverMaps: Record<string, unknown>[] = [];
    for (const key of ["mcpServers", "servers"] as const) {
      if (Object.hasOwn(parsed, key) && parsed[key] !== undefined) {
        if (!isPlainObject(parsed[key])) {
          failures.push(`${candidate.label} (${candidate.path}): "${key}" must be an object`);
        } else {
          serverMaps.push(parsed[key]);
        }
      }
    }

    for (const serverMap of serverMaps) {
      for (const [serverName, entry] of Object.entries(serverMap)) {
        if (!isLogNexusServerEntry(serverName, entry)) {
          continue;
        }
        const check = validateLogNexusServerEntry(candidate.label, serverName, entry);
        if (check.valid) {
          validEntries.push(check.launcher);
        } else {
          failures.push(check.error);
        }
      }
    }
  }

  if (failures.length > 0) {
    return {
      name: "MCP Client Configs",
      status: "fail",
      message: failures.join("; "),
    };
  }

  if (validEntries.length >= 1) {
    return {
      name: "MCP Client Configs",
      status: "pass",
      message: `Verified ${validEntries.length} LogNexus MCP config(s): ${validEntries.join(", ")}`,
    };
  }

  return {
    name: "MCP Client Configs",
    status: "warn",
    message:
      "No LogNexus MCP server config found — configure 'npx -y @digital-lake/lognexus mcp' or 'uvx lognexus-mcp'",
  };
}

export function runDiagnostics(
  targetDir: string = process.cwd(),
  options?: DoctorOptions,
): DiagnosticCheck[] {
  const checks = [
    checkGit(targetDir),
    checkGitHubCli(),
    checkRulesConfig(targetDir),
    checkScopeDrift(targetDir),
    checkVersionMaturity(targetDir),
    checkAgentEcosystem(targetDir),
  ];

  if (options?.mcp === true) {
    checks.push(checkMcpClientConfigs(targetDir, options));
  }

  return checks;
}
