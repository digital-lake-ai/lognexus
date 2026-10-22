import { existsSync, mkdirSync, writeFileSync } from "node:fs";
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
`;

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

  return result;
}
