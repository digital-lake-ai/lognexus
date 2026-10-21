import { execSync } from "node:child_process";
import { loadState, saveState } from "./manager.js";
import type { ActiveIssueState, LognexusState } from "./schema.js";

export function getBranchName(targetDir: string = process.cwd()): string | null {
  try {
    const branch = execSync("git branch --show-current", {
      cwd: targetDir,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return branch || null;
  } catch {
    return null;
  }
}

export function fetchIssueMeta(
  issueId: number,
  targetDir: string = process.cwd(),
): { title: string; readiness: ActiveIssueState["readiness"] } | null {
  try {
    const raw = execSync(`gh issue view ${issueId} --json title,state,labels`, {
      cwd: targetDir,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const parsed = JSON.parse(raw);
    const title = parsed.title ?? "";

    let readiness: ActiveIssueState["readiness"] = "ready";
    const labels: Array<{ name: string }> = parsed.labels ?? [];
    const labelNames = labels.map((l) => l.name);

    if (labelNames.includes("lognexus/needs-review")) {
      readiness = "in-review";
    } else if (labelNames.includes("lognexus/in-progress")) {
      readiness = "ready";
    } else if (labelNames.includes("lognexus/blocker")) {
      readiness = "blocked";
    }

    return { title, readiness };
  } catch {
    return null;
  }
}

export function syncStateFromGit(targetDir: string = process.cwd()): LognexusState {
  const state = loadState(targetDir);
  const branch = getBranchName(targetDir);

  if (!branch || branch === "main" || branch === "master") {
    state.activeIssue = null;
    state.currentSubtask = null;
    saveState(state, targetDir);
    return state;
  }

  const match = branch.match(/issue\/(\d+)(?:-(.*))?/i);
  if (match) {
    const issueId = Number.parseInt(match[1], 10);
    const slug = match[2] ? match[2].replace(/-/g, " ") : `Issue #${issueId}`;

    let title = slug;
    let readiness: ActiveIssueState["readiness"] = "ready";

    const remoteMeta = fetchIssueMeta(issueId, targetDir);
    if (remoteMeta) {
      if (remoteMeta.title) title = remoteMeta.title;
      readiness = remoteMeta.readiness;
    }

    state.activeIssue = {
      id: issueId,
      title,
      branch,
      phase: "commit",
      tier: "tier-3",
      readiness,
    };
  } else {
    state.activeIssue = null;
  }

  saveState(state, targetDir);
  return state;
}
