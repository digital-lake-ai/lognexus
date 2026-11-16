import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { type ScopedTelemetryFilter, syncTelemetryFromGitNotes } from "./collector.js";
import type { TelemetryStore } from "./schema.js";

export const CUSTOM_NOTES_MARKER = "<!-- lognexus:custom-notes -->";

const LEGACY_CUSTOM_NOTES_PATTERN = /\n(##\s+6\b[\s\S]*)$/;

function formatSeconds(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds));
  if (safe === 0) return "0s";

  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (hours === 0 && seconds > 0) parts.push(`${seconds}s`);
  return parts.length > 0 ? parts.join(" ") : "0s";
}

function describeScope(filter: ScopedTelemetryFilter | undefined): string | null {
  if (filter === undefined) return null;

  const parts: string[] = [];
  if (filter.issue !== undefined) parts.push(`issue \`${String(filter.issue)}\``);
  if (filter.since !== undefined) parts.push(`since \`${filter.since}\``);
  if (filter.branch !== undefined) parts.push(`branch \`${filter.branch}\``);
  return parts.length === 0 ? null : parts.join(" · ");
}

export function formatTelemetryMarkdownReport(
  store: TelemetryStore,
  filter?: ScopedTelemetryFilter,
): string {
  const sum = store.summary;
  const stacks =
    store.detectedStacks.length > 0 ? store.detectedStacks.join(", ") : "Standard / Multi-language";

  const totalLines = sum.totalLinesAdded + sum.totalLinesDeleted;
  const scopeLine = describeScope(filter);

  // Language Breakdown Table
  const extRows = Object.values(store.extensions).sort(
    (a, b) => b.linesAdded + b.linesDeleted - (a.linesAdded + a.linesDeleted),
  );
  const langTable =
    extRows.length === 0
      ? "_No commit file diffs recorded yet._"
      : [
          "| Extension | Category | Commits | Lines Added (+) | Lines Deleted (-) | Net Delta |",
          "|---|---|---|---|---|---|",
          ...extRows.map(
            (r) =>
              `| \`${r.ext}\` | \`${r.category}\` | ${r.commits} | +${r.linesAdded} | -${r.linesDeleted} | ${r.linesAdded - r.linesDeleted >= 0 ? `+${r.linesAdded - r.linesDeleted}` : r.linesAdded - r.linesDeleted} |`,
          ),
        ].join("\n");

  // Model & Tier Breakdown Table
  const modelRows = Object.values(store.models).sort((a, b) => b.commits - a.commits);
  const modelTable =
    modelRows.length === 0
      ? "_No model commit activity recorded yet._"
      : [
          "| Model Family | Operational Tier | Commits | Share (%) | Est. Tokens | Est. Cost (USD) |",
          "|---|---|---|---|---|---|",
          ...modelRows.map((m) => {
            const share =
              sum.totalCommits > 0 ? ((m.commits / sum.totalCommits) * 100).toFixed(1) : "0.0";
            const tokens = m.estimatedInputTokens + m.estimatedOutputTokens;
            return `| \`${m.family}\` | \`${m.tier}\` | ${m.commits} | ${share}% | ${tokens.toLocaleString()} | $${m.estimatedCostUsd.toFixed(4)} |`;
          }),
        ].join("\n");

  const tierCommits = sum.tierCommits;
  const tierLine = `\`tier-1\`: ${tierCommits["tier-1"]} · \`tier-2\`: ${tierCommits["tier-2"]} · \`tier-3\`: ${tierCommits["tier-3"]}`;

  return `<!-- lognexus:
kind: telemetry-report
schema_version: ${store.schemaVersion}
mode: ${store.mode}
anonymous_project_id: ${store.anonymousProjectId}
updated_at: ${store.lastUpdated}
commits: ${sum.totalCommits}
cost_savings_pct: ${sum.estimatedCostSavingsPct}%
-->

# ⚡ LogNexus Telemetry & ROI Performance Report

**Anonymous Project ID:** \`${store.anonymousProjectId}\` *(local repository name & paths are strictly private and omitted)*  
**Project Scope:** Local Project  
**Detected Stacks:** ${stacks}  
**Telemetry Mode:** \`${store.mode}\`  
${scopeLine === null ? "" : `**Report Scope:** ${scopeLine} *(in-memory projection — the local store was not modified)*  \n`}**Generated At:** ${new Date().toISOString()}  

---

## 1. Executive Metrics Dashboard

| Metric | Measured Value | Notes |
|---|---|---|
| **Total Commits Governed** | **${sum.totalCommits}** | Captured via LogNexus atomic commit engine |
| **Lines of Code Modified** | **${totalLines.toLocaleString()} LOC** | +${sum.totalLinesAdded.toLocaleString()} / -${sum.totalLinesDeleted.toLocaleString()} lines |
| **Source / Test LOC Added** | **${sum.sourceLinesAdded.toLocaleString()} / ${sum.testLinesAdded.toLocaleString()}** | Priced at the source rate (same authoring effort) |
| **Docs / Config LOC Added** | **${sum.docsLinesAdded.toLocaleString()} / ${sum.configLinesAdded.toLocaleString()}** | Priced at the documentation rate |
| **Subtasks Completed** | **${sum.totalSubtasksCompleted}** | Explicit contract lifecycle tracked |
| **Review Gate Blocks Prevented** | **${sum.reviewGateBlocksPrevented}** | Self-approval or contract violations stopped |
| **Active Development Span** | **${formatSeconds(sum.activeDevelopmentSpanSec)}** | Elapsed time between first and last governed commit |
| **Median Commit Cadence** | **${formatSeconds(sum.medianCommitCadenceSec)}** | Median gap between consecutive governed commits |
| **Git Notes Coverage** | **${sum.gitNotesCoveragePct}%** | Share of commits carrying a LogNexus Git Note |
| **Contract Compliance** | **${sum.contractCompliancePct}%** | ${sum.contractedCommits} contracted commit(s) checked against \`allowedFiles\` (excluding ephemeral paths) |
| **Tier Escalations** | **${sum.escalatedCommits}** | Commits explicitly escalated above their subtask tier |
| **Rework Ratio** | **${sum.reworkRatioPct}%** | ${sum.reworkCommits} \`fix(...)\` / \`revert(...)\` commit(s) |
| **Estimated Cost Savings** | **${sum.estimatedCostSavingsPct}%** (~$${sum.estimatedCostSavingsUsd.toFixed(2)} USD) | Compared to Monolithic Tier-1 frontier execution |

---

## 2. Codebase Composition & Diff Breakdown

${langTable}

---

## 3. Multi-Model Swarm Distribution

**Tier Commits:** ${tierLine}

${modelTable}

---

## 4. Cost Efficiency & Model-Tier ROI Evaluation

By delegating scoped subtasks to lightweight execution models (\`tier-3\`) while reserving frontier models for architecture and review gates (\`tier-1\`), LogNexus achieves significant token and budget optimizations. Pricing is LOC-weighted: every tier charges a fixed per-commit base plus a per-line rate, so a large refactor is never under-priced and documentation churn stays cheap.

- **Estimated Monolithic Baseline Cost:** ~$${sum.estimatedBaselineCostUsd.toFixed(3)} USD *(all commits run on frontier Tier-1)*
- **Estimated Multi-Tier LogNexus Cost:** ~$${sum.estimatedActualCostUsd.toFixed(3)} USD *(routed across Tier-1/2/3)*
- **Net Budget Saved:** **~$${sum.estimatedCostSavingsUsd.toFixed(3)} USD (${sum.estimatedCostSavingsPct}%)**
- **Estimated Baseline Tokens:** ${sum.estimatedBaselineTokens.toLocaleString()} *(Monolithic Tier-1)*
- **Estimated LogNexus Tokens:** ${sum.estimatedActualTokens.toLocaleString()} *(Multi-Tier)*
- **Tokens Saved:** **${sum.estimatedTokensSaved.toLocaleString()}**

---

## 5. Opt-in Diagnostic Sharing (100% Local-First)

Sharing is **never automatic**. LogNexus makes no network calls, contains no endpoint, and uploads nothing. If — and only if — you decide that a maintainer should see this report, you can publish it yourself with the GitHub CLI after a manual review:

1. Re-read this file and confirm that only your **Anonymous Project ID** (\`${store.anonymousProjectId}\`) appears — never add your repository name, project name, paths, remotes, or branch names.
2. Confirm you are not pasting source code, commit messages, or credentials.
3. Open the issue from the repository root you are already authenticated against:
\`\`\`bash
gh issue create \\
  --template diagnostic-report.yml \\
  --title "diagnostic: <one-line summary>" \\
  --body-file .lognexus/telemetry.md
\`\`\`
4. Keep the local copy in version control only if it contains nothing private; otherwise delete it after submitting.

\`gh issue create\` runs under **your** GitHub credentials and is executed by **you**. LogNexus only prints this guidance; it never invokes a network client on your behalf.

---
*Report generated automatically by **LogNexus** (\`@digital-lake/lognexus\`)*

${CUSTOM_NOTES_MARKER}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Redacts the local repository folder name and absolute filesystem paths from custom
 * notes so regenerating `.lognexus/telemetry.md` never leaks private project names
 * if the user later shares the report in a GitHub Issue.
 */
export function redactLocalProjectMetadata(
  text: string,
  targetDir: string = process.cwd(),
  anonymousProjectId = "anonymous-project",
): string {
  if (text === "") return "";

  const resolvedBase = resolve(targetDir);
  const posixBase = resolvedBase.replace(/\\/g, "/");
  const repoName = basename(resolvedBase);

  let sanitized = text.split(resolvedBase).join("<redacted-path>");
  sanitized = sanitized.split(posixBase).join("<redacted-path>");

  if (repoName.length >= 3) {
    const repoPattern = new RegExp(`\\b${escapeRegExp(repoName)}\\b`, "gi");
    sanitized = sanitized.replace(repoPattern, anonymousProjectId);
  }

  return sanitized;
}

function extractCustomNotes(existingContent: string | null): string {
  if (existingContent === null) return "";

  const markerIndex = existingContent.indexOf(CUSTOM_NOTES_MARKER);
  if (markerIndex !== -1) {
    return existingContent.slice(markerIndex + CUSTOM_NOTES_MARKER.length);
  }

  const legacy = existingContent.match(LEGACY_CUSTOM_NOTES_PATTERN);
  return legacy ? `\n${legacy[1]}` : "";
}

function readPreviousReport(filePath: string): string | null {
  if (!existsSync(filePath)) return null;

  try {
    return readFileSync(filePath, "utf8");
  } catch {
    // An unreadable previous report must never block report regeneration.
    return null;
  }
}

export function resolveConfinedOutputPath(targetDir: string, outputPath: string): string {
  const normalizedInput =
    process.platform === "win32" ? outputPath : outputPath.replace(/\\/g, "/");

  if (process.platform !== "win32" && /^[a-zA-Z]:/.test(normalizedInput)) {
    throw new Error(
      `Governance violation: Path traversal detected in output path "${outputPath}". ` +
        `Reports must be written inside ${resolve(targetDir)}.`,
    );
  }

  const resolvedBase = resolve(targetDir);
  const resolvedOut = resolve(resolvedBase, normalizedInput);
  const rel = relative(resolvedBase, resolvedOut);

  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(
      `Governance violation: Path traversal detected in output path "${outputPath}". ` +
        `Reports must be written inside ${resolvedBase}.`,
    );
  }

  return resolvedOut;
}

export function generateTelemetryReportFile(
  targetDir: string = process.cwd(),
  outputPath?: string,
  filter?: ScopedTelemetryFilter,
): { filePath: string; content: string } {
  const store = syncTelemetryFromGitNotes(targetDir, filter);
  const content = formatTelemetryMarkdownReport(store, filter);
  const defaultPath = join(targetDir, ".lognexus", "telemetry.md");
  const filePath = resolveConfinedOutputPath(targetDir, outputPath ?? defaultPath);

  const parentDir = join(filePath, "..");
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }

  const rawCustomNotes = extractCustomNotes(readPreviousReport(filePath));
  const customNotes = redactLocalProjectMetadata(
    rawCustomNotes,
    targetDir,
    store.anonymousProjectId,
  );
  const rendered = `${content}${customNotes}`;

  writeFileSync(filePath, rendered, "utf8");
  return { filePath, content: rendered };
}
