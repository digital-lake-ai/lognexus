import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface InitResult {
  created: string[];
  skipped: string[];
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
    const routingContent = `# Model-Tier Routing Configuration

# Modes: confirm (pause and prompt) | warn (banner only) | off (silent)
routing: confirm

# Operational Tier Taxonomy (Advisory across Claude, OpenAI, Gemini, DeepSeek)
# tier-1 (Reasoning / Arch / Review): Claude Opus, OpenAI o3/GPT, Gemini Pro, DeepSeek R1
# tier-2 (Context / Triage / Discovery): Claude Sonnet, GPT-4.1, Gemini Flash/Pro (1M), DeepSeek V3
# tier-3 (Scoped Execution / Commits): Claude Haiku, GPT-4o-mini, DeepSeek Chat (V3), Gemini Flash
`;
    writeFileSync(routingPath, routingContent, "utf8");
    result.created.push(".lognexus/routing.md");
  } else {
    result.skipped.push(".lognexus/routing.md");
  }

  return result;
}
