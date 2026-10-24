import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { loadTelemetry } from "./collector.js";
import type { TelemetryStore } from "./schema.js";

export function formatTelemetryMarkdownReport(store: TelemetryStore): string {
  const sum = store.summary;
  const stacks =
    store.detectedStacks.length > 0 ? store.detectedStacks.join(", ") : "Standard / Multi-language";

  const totalLines = sum.totalLinesAdded + sum.totalLinesDeleted;

  // Language Breakdown Table
  const extRows = Object.values(store.extensions).sort(
    (a, b) => b.linesAdded + b.linesDeleted - (a.linesAdded + a.linesDeleted),
  );
  const langTable =
    extRows.length === 0
      ? "_No commit file diffs recorded yet._"
      : [
          "| Extension | Commits | Lines Added (+) | Lines Deleted (-) | Net Delta |",
          "|---|---|---|---|---|",
          ...extRows.map(
            (r) =>
              `| \`${r.ext}\` | ${r.commits} | +${r.linesAdded} | -${r.linesDeleted} | ${r.linesAdded - r.linesDeleted >= 0 ? `+${r.linesAdded - r.linesDeleted}` : r.linesAdded - r.linesDeleted} |`,
          ),
        ].join("\n");

  // Model & Tier Breakdown Table
  const modelRows = Object.values(store.models).sort((a, b) => b.commits - a.commits);
  const modelTable =
    modelRows.length === 0
      ? "_No model commit activity recorded yet._"
      : [
          "| Model Family | Operational Tier | Commits | Share (%) |",
          "|---|---|---|---|",
          ...modelRows.map((m) => {
            const share =
              sum.totalCommits > 0 ? ((m.commits / sum.totalCommits) * 100).toFixed(1) : "0.0";
            return `| \`${m.family}\` | \`${m.tier}\` | ${m.commits} | ${share}% |`;
          }),
        ].join("\n");

  return `<!-- lognexus:
kind: telemetry-report
mode: ${store.mode}
updated_at: ${store.lastUpdated}
commits: ${sum.totalCommits}
cost_savings_pct: ${sum.estimatedCostSavingsPct}%
-->

# ⚡ LogNexus Telemetry & ROI Performance Report

**Project Scope:** Local Project  
**Detected Stacks:** ${stacks}  
**Telemetry Mode:** \`${store.mode}\`  
**Generated At:** ${new Date().toISOString()}  

---

## 1. Executive Metrics Dashboard

| Metric | Measured Value | Notes |
|---|---|---|
| **Total Commits Governed** | **${sum.totalCommits}** | Captured via LogNexus atomic commit engine |
| **Lines of Code Modified** | **${totalLines.toLocaleString()} LOC** | +${sum.totalLinesAdded.toLocaleString()} / -${sum.totalLinesDeleted.toLocaleString()} lines |
| **Subtasks Completed** | **${sum.totalSubtasksCompleted}** | Explicit contract lifecycle tracked |
| **Review Gate Blocks Prevented** | **${sum.reviewGateBlocksPrevented}** | Self-approval or contract violations stopped |
| **Estimated Cost Savings** | **${sum.estimatedCostSavingsPct}%** (~$${sum.estimatedCostSavingsUsd.toFixed(2)} USD) | Compared to Monolithic Tier-1 frontier execution |

---

## 2. Stack & Language Breakdown

${langTable}

---

## 3. Multi-Model Swarm Distribution

${modelTable}

---

## 4. Cost Efficiency & Model-Tier ROI Evaluation

By delegating scoped subtasks to lightweight execution models (\`tier-3\`) while reserving frontier models for architecture and review gates (\`tier-1\`), LogNexus achieves significant token and budget optimizations:

- **Estimated Monolithic Baseline Cost:** ~$${sum.estimatedBaselineCostUsd.toFixed(3)} USD *(all commits run on frontier Tier-1)*
- **Estimated Multi-Tier LogNexus Cost:** ~$${sum.estimatedActualCostUsd.toFixed(3)} USD *(routed across Tier-1/2/3)*
- **Net Budget Saved:** **~$${sum.estimatedCostSavingsUsd.toFixed(3)} USD (${sum.estimatedCostSavingsPct}%)**

---
*Report generated automatically by **LogNexus** (\`@digital-lake/lognexus\`)*
`;
}

export function resolveConfinedOutputPath(targetDir: string, outputPath: string): string {
  const resolvedBase = resolve(targetDir);
  const resolvedOut = resolve(resolvedBase, outputPath);
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
): { filePath: string; content: string } {
  const store = loadTelemetry(targetDir);
  const content = formatTelemetryMarkdownReport(store);
  const defaultPath = join(targetDir, ".lognexus", "telemetry.md");
  const filePath = resolveConfinedOutputPath(targetDir, outputPath ?? defaultPath);

  const parentDir = join(filePath, "..");
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }

  writeFileSync(filePath, content, "utf8");
  return { filePath, content };
}
