import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface ProjectStatus {
  branch: string;
  isInsideGit: boolean;
  activeIssue: string | null;
  routingMode: string;
  recommendedTier: string;
}

export function getProjectStatus(targetDir: string = process.cwd()): ProjectStatus {
  let isInsideGit = false;
  let branch = "detached";

  try {
    const inside = execSync("git rev-parse --is-inside-work-tree", {
      cwd: targetDir,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    isInsideGit = inside === "true";

    if (isInsideGit) {
      branch =
        execSync("git branch --show-current", {
          cwd: targetDir,
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
        }).trim() || "detached";
    }
  } catch {
    isInsideGit = false;
  }

  let activeIssue: string | null = null;
  const match = branch.match(/issue\/(\d+)/i);
  if (match) {
    activeIssue = `#${match[1]}`;
  }

  let routingMode = "not configured";
  const routingFile = join(targetDir, ".lognexus", "routing.md");
  if (existsSync(routingFile)) {
    const content = readFileSync(routingFile, "utf8");
    const m = content.match(/routing:\s*(confirm|warn|off)/i);
    if (m) routingMode = m[1].toLowerCase();
  }

  let recommendedTier =
    "tier-1 (Reasoning / Planning: Claude Opus, OpenAI o3, Gemini Pro, DeepSeek R1)";
  if (activeIssue) {
    recommendedTier =
      "tier-3 (Scoped Execution: Claude Haiku, GPT-4o-mini, DeepSeek Chat, Gemini Flash)";
  }

  return {
    branch,
    isInsideGit,
    activeIssue,
    routingMode,
    recommendedTier,
  };
}
