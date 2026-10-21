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

# Operational Tier Assignments (Native IDE Clients)
# tier-1 (Reasoning): Gemini in Google Antigravity / DeepSeek Reasoner
# tier-2 (Context):   Gemini (1M tokens) in Google Antigravity
# tier-3 (Execution): DeepSeek in Kimi Code / Cursor
`;
    writeFileSync(routingPath, routingContent, "utf8");
    result.created.push(".lognexus/routing.md");
  } else {
    result.skipped.push(".lognexus/routing.md");
  }

  return result;
}
