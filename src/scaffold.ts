import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface InitResult {
  created: string[];
  skipped: string[];
}

export const DEFAULT_ROUTING_TEMPLATE = `# Model-Tier Routing Configuration

# Modes: confirm (pause and prompt) | warn (banner only) | off (silent)
routing: confirm

# Operational Tier Taxonomy (Empirical recommendations across Gemini, Claude, OpenAI, DeepSeek, Kimi)
# tier-1 (Reasoning / Arch / Review Gate): Gemini 4 Carbon, Gemini 4 Argon, Claude Opus, OpenAI o3/o1, DeepSeek R1
# tier-2 (Orchestration / Large Context >500 lines): Gemini 3.8 Flash High / Pro (1M), Claude Sonnet, Kimi K3 / K2.7 Code
# tier-3 (Scoped Execution / Focused Modules <500 lines): Gemini Flash, DeepSeek V3 (Chat), Kimi Code, Claude Haiku, GPT-4o-mini

# Native Assistant Autonomy & Contract Execution Governance
# max_subtask_files: 6
# max_subtask_loc: 1200
# assistant_autonomy: Operate freely with native IDE/assistant capabilities during conversation, analysis, and exploration
# contract_governance: When executing an active subtask contract (.lognexus/state.json), strictly obey allowedFiles, forbiddenFiles, decisionBudget, and verificationCmd
`;

/** Ephemeral runtime state written by the framework itself. */
export const LOGNEXUS_GITIGNORE_ENTRIES = [
  ".lognexus/state.json",
  ".lognexus/state.json.bak",
  ".lognexus/handoff.md",
  ".lognexus/telemetry.json",
  ".lognexus/update-check.json",
  ".lognexus/terms-consent.json",
] as const;

const GITIGNORE_HEADER = "# LogNexus ephemeral runtime state";

export interface InitOptions {
  protectTokens?: boolean;
}

export const TOKEN_SHIELD_PATTERNS = [
  "# LogNexus Multi-Model Token Shield — prevent accidental token burn on lockfiles & build outputs",
  "node_modules/",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "Cargo.lock",
  "poetry.lock",
  "uv.lock",
  ".venv/",
  "venv/",
  "__pycache__/",
  "dist/",
  "dist-pypi/",
  "build/",
  "coverage/",
  ".next/",
  "target/",
  ".lognexus/*.json",
] as const;

export const CLAUDE_DENY_RULES = [
  "Read(./node_modules/**)",
  "Read(./package-lock.json)",
  "Grep(./package-lock.json)",
  "Read(./pnpm-lock.yaml)",
  "Read(./yarn.lock)",
  "Read(./Cargo.lock)",
  "Read(./poetry.lock)",
  "Read(./uv.lock)",
  "Read(./dist/**)",
  "Read(./build/**)",
  "Read(./coverage/**)",
] as const;

function ensureGitignore(targetDir: string, result: InitResult): void {
  const gitignorePath = join(targetDir, ".gitignore");

  if (!existsSync(gitignorePath)) {
    writeFileSync(
      gitignorePath,
      `${GITIGNORE_HEADER}\n${LOGNEXUS_GITIGNORE_ENTRIES.join("\n")}\n`,
      "utf8",
    );
    result.created.push(".gitignore");
    return;
  }

  const existing = readFileSync(gitignorePath, "utf8");
  const present = new Set(existing.split(/\r?\n/).map((line) => line.trim()));
  const missing = LOGNEXUS_GITIGNORE_ENTRIES.filter((entry) => !present.has(entry));
  if (missing.length === 0) {
    result.skipped.push(".gitignore");
    return;
  }

  const prefix = existing.endsWith("\n") || existing === "" ? "" : "\n";
  writeFileSync(gitignorePath, `${existing}${prefix}${missing.join("\n")}\n`, "utf8");
  result.created.push(".gitignore");
}

/**
 * Merges the token shield patterns into an ignore file, creating it when absent.
 * Only non-comment entries are compared so the header never counts as a duplicate.
 */
function ensureIgnoreFile(targetDir: string, fileName: string, result: InitResult): void {
  const ignorePath = join(targetDir, fileName);
  const entries = TOKEN_SHIELD_PATTERNS.filter((line) => !line.startsWith("#"));

  if (!existsSync(ignorePath)) {
    writeFileSync(ignorePath, `${TOKEN_SHIELD_PATTERNS.join("\n")}\n`, "utf8");
    result.created.push(fileName);
    return;
  }

  const existing = readFileSync(ignorePath, "utf8");
  const present = new Set(existing.split(/\r?\n/).map((line) => line.trim()));
  const missing = entries.filter((entry) => !present.has(entry));
  if (missing.length === 0) {
    result.skipped.push(fileName);
    return;
  }

  const prefix = existing.endsWith("\n") || existing === "" ? "" : "\n";
  writeFileSync(ignorePath, `${existing}${prefix}${missing.join("\n")}\n`, "utf8");
  result.created.push(fileName);
}

interface ClaudePermissions {
  allow?: unknown;
  ask?: unknown;
  deny?: unknown;
  [key: string]: unknown;
}

interface ClaudeSettings {
  permissions?: ClaudePermissions;
  [key: string]: unknown;
}

function mergeDenyRules(settings: ClaudeSettings): string[] {
  const permissions = settings.permissions ?? {};
  const existing = Array.isArray(permissions.deny) ? (permissions.deny as unknown[]) : [];
  const merged = [...existing];
  for (const rule of CLAUDE_DENY_RULES) {
    if (!merged.includes(rule)) merged.push(rule);
  }
  return merged.map(String);
}

/** Adds read-deny rules for lockfiles and build output to `.claude/settings.json`. */
function ensureClaudeDenySettings(targetDir: string, result: InitResult): void {
  const claudeDir = join(targetDir, ".claude");
  const settingsPath = join(claudeDir, "settings.json");
  const relativePath = ".claude/settings.json";

  if (!existsSync(settingsPath)) {
    mkdirSync(claudeDir, { recursive: true });
    const payload = { permissions: { deny: [...CLAUDE_DENY_RULES] } };
    writeFileSync(
      settingsPath,
      `${JSON.stringify(payload, null, 2)}
`,
      "utf8",
    );
    result.created.push(relativePath);
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch {
    result.skipped.push(relativePath);
    return;
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    result.skipped.push(relativePath);
    return;
  }

  const settings = parsed as ClaudeSettings;
  const deny = mergeDenyRules(settings);
  const current = settings.permissions?.deny;
  const alreadyPresent = Array.isArray(current) && deny.length === current.length;
  if (alreadyPresent) {
    result.skipped.push(relativePath);
    return;
  }

  const permissions: ClaudePermissions = { ...(settings.permissions ?? {}), deny };
  const next: ClaudeSettings = { ...settings, permissions };
  writeFileSync(
    settingsPath,
    `${JSON.stringify(next, null, 2)}
`,
    "utf8",
  );
  result.created.push(relativePath);
}

function anyExists(targetDir: string, names: readonly string[]): boolean {
  return names.some((name) => existsSync(join(targetDir, name)));
}

/**
 * Detects which agent ecosystems the repository already uses and scaffolds only the
 * matching exclusion files. A greenfield repository gets the universal core so the
 * protection is in place before any agent marker appears.
 */
function scaffoldTokenShield(targetDir: string, result: InitResult): void {
  const gemini = anyExists(targetDir, [
    ".gemini",
    "GEMINI.md",
    ".agents",
    ".geminiignore",
    ".aiexclude",
  ]);
  const claude = anyExists(targetDir, [".claude", ".claude-plugin", "CLAUDE.md"]);
  const cursor = anyExists(targetDir, [".cursor", ".cursorrules", ".cursorignore"]);
  const roo = anyExists(targetDir, [".roo", ".rooignore"]);
  const windsurf = anyExists(targetDir, [".windsurf", ".codeiumignore"]);
  const aider = anyExists(targetDir, [".aiderignore", ".aider.conf.yml"]);
  const detected = gemini || claude || cursor || roo || windsurf || aider;

  if (gemini || !detected) {
    ensureIgnoreFile(targetDir, ".geminiignore", result);
    ensureIgnoreFile(targetDir, ".aiexclude", result);
  }
  if (claude || !detected) ensureClaudeDenySettings(targetDir, result);
  if (cursor || !detected) ensureIgnoreFile(targetDir, ".cursorignore", result);
  if (roo) ensureIgnoreFile(targetDir, ".rooignore", result);
  if (windsurf) ensureIgnoreFile(targetDir, ".codeiumignore", result);
  if (aider) ensureIgnoreFile(targetDir, ".aiderignore", result);
}

export function initProject(
  targetDir: string = process.cwd(),
  options: InitOptions = {},
): InitResult {
  const result: InitResult = { created: [], skipped: [] };
  const lognexusDir = join(targetDir, ".lognexus");

  if (!existsSync(lognexusDir)) {
    mkdirSync(lognexusDir, { recursive: true });
    result.created.push(".lognexus/");
  } else {
    result.skipped.push(".lognexus/");
  }

  const routingPath = join(lognexusDir, "routing.md");
  if (!existsSync(routingPath)) {
    writeFileSync(routingPath, DEFAULT_ROUTING_TEMPLATE, "utf8");
    result.created.push(".lognexus/routing.md");
  } else {
    result.skipped.push(".lognexus/routing.md");
  }

  ensureGitignore(targetDir, result);

  if (options.protectTokens === true) {
    scaffoldTokenShield(targetDir, result);
  }

  return result;
}
