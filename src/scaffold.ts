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
# tier-1 (Reasoning / Arch / Review Gate): Gemini 1.5/2.0 Pro, Google Antigravity, Claude 3.5/3.7 Sonnet, OpenAI o3/o1, DeepSeek R1
# tier-2 (Orchestration / Large Context >500 lines): Gemini 1.5 Pro (2M), Claude Sonnet, Kimi K2.7 Code
# tier-3 (Scoped Execution / Focused Modules <500 lines): Gemini 2.0/1.5 Flash, DeepSeek V3, Kimi K2.7 Code, Claude Haiku, GPT-4o-mini

# Context-Window Topology & Multi-File Delegation Thresholds
# max_direct_inspect_files: 4
# max_subtask_files: 6
# max_subtask_loc: 1200
# topology_isolated_subagent (Antigravity): Delegate >4 file reads to research/flash subagents (zero orchestrator token cost)
# topology_shared_window (VS Code / Kimi Code): Use file-pointer handoff (.lognexus/handoff.md) and ensure target model contextWindow >= active model contextWindow
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

export function initProject(targetDir: string = process.cwd()): InitResult {
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

  return result;
}
