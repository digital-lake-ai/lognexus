import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import {
  buildAnonymousDiagnosticPayload,
  loadTelemetry,
  type ScopedTelemetryFilter,
  saveTelemetry,
  syncTelemetryFromGitNotes,
} from "./collector.js";
import { resolveConfinedOutputPath } from "./report.js";
import {
  type AnonymousDiagnosticPayload,
  AnonymousDiagnosticPayloadSchema,
  COHORT_MEDIANS_DEFAULT,
  COHORT_TOTALS_DEFAULT,
  type CohortBenchmark,
  CohortBenchmarkSchema,
} from "./schema.js";

const URL_SCHEMES = ["http", "https", "ftp", "ssh", "git"];

const HOME_ROOT_MARKERS = ["/Users/", "/home/", "/etc/", "/root/", "/var/"];

/** Character codes for the drive-path scan: `:`, `/` and `\`. */
const COLON_CODE = 58;
const SLASH_CODE = 47;
const BACKSLASH_CODE = 92;

const TOKEN_SEPARATORS = new Set([
  " ",
  "\t",
  "\n",
  "\r",
  '"',
  "'",
  ",",
  "{",
  "}",
  "[",
  "]",
  "(",
  ")",
]);

const MIN_FORBIDDEN_TOKEN_LENGTH = 3;

/**
 * Leaf values whose vocabulary is fixed by the schema, so they can never carry a repository
 * name. Property *keys* are never inspected — only the values listed here are skipped.
 */
const TRUSTED_LEAF_PATHS = new Set([
  "schemaVersion",
  "consent.policyVersion",
  "consent.acceptedAt",
  "consent.declinedAt",
  "environment.os",
  "environment.nodeVersion",
  "environment.lognexusVersion",
  "generatedAt",
  "dispatchedAt",
]);

/** Fixed prefixes that make a `modelBreakdown` family a known vocabulary entry. */
const CANONICAL_MODEL_FAMILIES = [
  "gemini/",
  "claude/",
  "deepseek/",
  "openai/",
  "moonshot/",
  "qwen/",
  "xai/",
  "zai/",
];

const UNKNOWN_MODEL_FAMILY = "unknown/other";

const BENCHMARK_SCAN_IGNORED_DIRS = new Set([".git", "node_modules", ".lognexus"]);

const DEFAULT_SNAPSHOT_NAME = "snapshot-v2.json";

/** Raised when a snapshot would publish a local path, address or private identifier. */
export class ZeroPiiViolationError extends Error {
  constructor(reason: string) {
    super(`Governance violation: zero-PII guarantee breached — ${reason}.`);
    this.name = "ZeroPiiViolationError";
  }
}

/**
 * Confines an exported snapshot to the scanned project.
 *
 * A cohort is built by collecting snapshots from several repositories, and each of them is
 * written by the repository it describes: an exporter that could write anywhere would let a
 * single repository plant data into another project's directory.
 */
function confineSnapshotPath(targetDir: string, outputPath: string): string {
  const resolvedOut = resolveConfinedOutputPath(targetDir, outputPath);
  const resolvedBase = resolve(targetDir);
  if (!existsSync(resolvedBase)) {
    throw new Error(
      `Governance violation: Cannot export a telemetry snapshot from "${resolvedBase}" — the directory does not exist.`,
    );
  }
  return resolvedOut;
}

/**
 * Rejects Windows drive paths, Unix home/system roots, URL literals, email-shaped tokens and
 * any caller-supplied private token (such as the repository name).
 *
 * Every check is a single linear pass over the text — no nested quantifiers and no
 * backtracking — so an adversarial 50k-character payload cannot trigger polynomial ReDoS.
 *
 * The forbidden-token scan is JSON-aware: only untrusted *values* are searched, never property
 * keys and never the fixed schema vocabulary. A payload is written by this project, so its keys
 * (`lognexusVersion`, `docsLinesAdded`) and its enum values (`nodejs`, `source`) are not
 * disclosure — and treating them as such made `telemetry snapshot` abort inside any checkout
 * whose folder happened to be named like a key.
 */
export function assertZeroPiiLeakage(serialized: string, forbiddenTokens: string[] = []): void {
  if (containsDrivePath(serialized)) {
    throw new ZeroPiiViolationError("the payload contains an absolute drive path");
  }

  const lowered = serialized.toLowerCase();

  for (const marker of HOME_ROOT_MARKERS) {
    if (lowered.includes(marker.toLowerCase())) {
      throw new ZeroPiiViolationError("the payload contains an absolute system path");
    }
  }

  const schemeSeparator = lowered.indexOf("://");
  if (schemeSeparator !== -1) {
    const prefix = lowered.slice(0, schemeSeparator);
    let schemeStart = prefix.length;
    while (schemeStart > 0 && isSchemeCharacter(prefix.charCodeAt(schemeStart - 1))) {
      schemeStart -= 1;
    }
    const scheme = prefix.slice(schemeStart);
    if (scheme === "" || URL_SCHEMES.includes(scheme)) {
      throw new ZeroPiiViolationError("the payload contains a URL literal");
    }
  }

  const tokens = splitTokens(serialized);
  for (const token of tokens) {
    if (token.includes("@") && looksLikeEmail(token)) {
      throw new ZeroPiiViolationError("the payload contains an email-shaped token");
    }
  }

  const candidates: string[] = [];
  for (const forbidden of forbiddenTokens) {
    const candidate = forbidden.trim().toLowerCase();
    if (candidate.length < MIN_FORBIDDEN_TOKEN_LENGTH) continue;
    candidates.push(candidate);
  }
  if (candidates.length === 0) return;

  const untrusted = collectUntrustedLeafValues(serialized);
  if (untrusted === null) {
    // A payload that is not valid JSON cannot be walked, so fall back to the whole document.
    for (const candidate of candidates) {
      if (lowered.includes(candidate)) {
        throw new ZeroPiiViolationError("the payload mentions a private project identifier");
      }
    }
    return;
  }

  for (const leaf of untrusted) {
    const loweredLeaf = leaf.toLowerCase();
    for (const candidate of candidates) {
      if (loweredLeaf.includes(candidate)) {
        throw new ZeroPiiViolationError("the payload mentions a private project identifier");
      }
    }
  }
}

/**
 * Detects `<letter>:\` or `<letter>:/` only where the drive letter starts a token.
 *
 * A bare `[A-Za-z]:[\\/]` pattern would also match the tail of any scheme literal, so every
 * address in the corpus would be reported as a local path and the real URL check would never
 * fire. The scan is linear: one bounds-checked pass, no backtracking.
 */
function containsDrivePath(value: string): boolean {
  for (let index = 0; index < value.length - 2; index += 1) {
    const code = value.charCodeAt(index);
    const isLetter = (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
    if (!isLetter) continue;
    if (value.charCodeAt(index + 1) !== COLON_CODE) continue;

    const separator = value.charCodeAt(index + 2);
    if (separator !== SLASH_CODE && separator !== BACKSLASH_CODE) continue;

    if (index === 0) return true;
    if (isTokenBoundary(value.charCodeAt(index - 1))) return true;
  }
  return false;
}

function isTokenBoundary(code: number): boolean {
  if (code === 32 || code === 9 || code === 10 || code === 13) return true;
  if (code === 34 || code === 39 || code === 96) return true;
  return code === 123 || code === 91 || code === 40 || code === 60 || code === 61 || code === 44;
}

function isSchemeCharacter(code: number): boolean {
  return (
    (code >= 97 && code <= 122) ||
    (code >= 48 && code <= 57) ||
    code === 43 ||
    code === 45 ||
    code === 46
  );
}

function splitTokens(value: string): string[] {
  const tokens: string[] = [];
  let current = "";
  for (const character of value) {
    if (TOKEN_SEPARATORS.has(character)) {
      if (current !== "") tokens.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  if (current !== "") tokens.push(current);
  return tokens;
}

function looksLikeEmail(token: string): boolean {
  const at = token.indexOf("@");
  if (at <= 0) return false;

  const domain = token.slice(at + 1);
  if (domain === "") return false;
  if (domain.includes("/") || domain.includes("@")) return false;

  return domain.slice(1).includes(".");
}

/** True when `path` is a fixed schema leaf, matched as whole segments and never as a prefix. */
function isTrustedLeafPath(path: string): boolean {
  if (TRUSTED_LEAF_PATHS.has(path)) return true;

  if (path.startsWith("environment.detectedStacks[")) return true;
  if (path.startsWith("languageBreakdown[") && path.endsWith("].category")) return true;
  if (path.startsWith("modelBreakdown[") && path.endsWith("].tier")) return true;

  return false;
}

/** True when a `modelBreakdown` family belongs to the closed, published vocabulary. */
function isCanonicalModelFamily(path: string, value: string): boolean {
  if (!path.startsWith("modelBreakdown[") || !path.endsWith("].family")) return false;

  const loweredValue = value.trim().toLowerCase();
  if (loweredValue === UNKNOWN_MODEL_FAMILY) return true;

  for (const prefix of CANONICAL_MODEL_FAMILIES) {
    if (loweredValue.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Walks a JSON document and returns every leaf string whose content could disclose a private
 * identifier, or `null` when the input is not valid JSON.
 *
 * Keys are skipped by construction: only values are collected. The walk is a single scan in
 * array order with an explicit stack, so a deeply nested adversarial document cannot overflow
 * the call stack and no check backtracks.
 */
function collectUntrustedLeafValues(serialized: string): string[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return null;
  }

  const leaves: string[] = [];
  const stack: Array<{ value: unknown; path: string }> = [{ value: parsed, path: "" }];

  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) break;
    const { value, path } = frame;

    if (typeof value === "string") {
      if (isTrustedLeafPath(path)) continue;
      if (isCanonicalModelFamily(path, value)) continue;
      leaves.push(value);
      continue;
    }

    if (Array.isArray(value)) {
      for (let index = value.length - 1; index >= 0; index -= 1) {
        stack.push({ value: value[index], path: `${path}[${index}]` });
      }
      continue;
    }

    if (value !== null && typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>);
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const [key, child] = entries[index];
        stack.push({ value: child, path: path === "" ? key : `${path}.${key}` });
      }
    }
  }

  return leaves;
}

/**
 * Records the anonymous project id without touching the metrics.
 *
 * Persisting the whole store here would write a full local recording behind the operator's
 * back; only the random UUID is durably relevant to snapshot export.
 */
function saveTelemetryIdentity(targetDir: string, anonymousProjectId: string): void {
  const store = loadTelemetry(targetDir);
  if (store.anonymousProjectId === anonymousProjectId) return;

  store.anonymousProjectId = anonymousProjectId;
  saveTelemetry(store, targetDir);
}

/**
 * Writes a validated, zero-PII diagnostic snapshot of the scanned history.
 *
 * The snapshot is confined to the target directory and sanitised before it ever reaches
 * disk, so an exported file is safe to hand to another machine unmodified.
 */
export function exportTelemetrySnapshot(
  targetDir: string = process.cwd(),
  outputPath?: string,
  filter?: ScopedTelemetryFilter,
): { filePath: string; payload: AnonymousDiagnosticPayload } {
  const store = syncTelemetryFromGitNotes(targetDir, filter);
  const payload = AnonymousDiagnosticPayloadSchema.parse(
    buildAnonymousDiagnosticPayload(store, filter),
  );

  // Pin the identity so a later export of the same repository is recognisable, and so a cohort
  // can deduplicate two snapshots instead of counting one repository twice.
  saveTelemetryIdentity(targetDir, store.anonymousProjectId);

  const resolvedOut = confineSnapshotPath(
    targetDir,
    outputPath ?? join(".lognexus", DEFAULT_SNAPSHOT_NAME),
  );

  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  assertZeroPiiLeakage(serialized, [basename(resolve(targetDir))]);

  mkdirSync(dirname(resolvedOut), { recursive: true });
  writeFileSync(resolvedOut, serialized, "utf8");

  return { filePath: resolvedOut, payload };
}

/** Collects every `.json` snapshot below the given files and directories. */
function collectSnapshotFiles(inputs: string[], cwd: string): string[] {
  const files: string[] = [];
  const visited = new Set<string>();

  const walk = (absolutePath: string): void => {
    if (visited.has(absolutePath)) return;
    visited.add(absolutePath);

    if (!existsSync(absolutePath)) return;

    const stats = statSync(absolutePath);
    if (stats.isDirectory()) {
      if (BENCHMARK_SCAN_IGNORED_DIRS.has(basename(absolutePath))) return;
      for (const entry of readdirSync(absolutePath)) {
        walk(join(absolutePath, entry));
      }
      return;
    }

    if (stats.isFile() && extname(absolutePath).toLowerCase() === ".json") {
      files.push(absolutePath);
    }
  };

  for (const input of inputs) {
    walk(resolve(cwd, input));
  }

  return files;
}

function readSnapshot(filePath: string): AnonymousDiagnosticPayload | null {
  try {
    const parsed = AnonymousDiagnosticPayloadSchema.safeParse(
      JSON.parse(readFileSync(filePath, "utf8")),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const raw = sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
  return Number(raw.toFixed(2));
}

function round6(value: number): number {
  return Number(value.toFixed(6));
}

/**
 * Builds a multi-repository cohort benchmark from exported snapshots.
 *
 * Snapshots are deduplicated per anonymous project — the newest `generatedAt` wins — so an
 * operator can point the aggregator at an over-collected directory without skewing totals.
 */
export function aggregateBenchmarkCohort(
  inputs: string[],
  cwd: string = process.cwd(),
): CohortBenchmark {
  const newestById = new Map<string, AnonymousDiagnosticPayload>();

  for (const filePath of collectSnapshotFiles(inputs, cwd)) {
    const payload = readSnapshot(filePath);
    if (payload === null) continue;

    const existing = newestById.get(payload.anonymousProjectId);
    if (existing === undefined || payload.generatedAt > existing.generatedAt) {
      newestById.set(payload.anonymousProjectId, payload);
    }
  }

  const payloads = [...newestById.values()];
  const totals = { ...COHORT_TOTALS_DEFAULT };

  for (const payload of payloads) {
    const summary = payload.summary;
    totals.commits += summary.totalCommits;
    totals.sourceLinesAdded += summary.sourceLinesAdded;
    totals.testLinesAdded += summary.testLinesAdded;
    totals.docsLinesAdded += summary.docsLinesAdded;
    totals.configLinesAdded += summary.configLinesAdded;
    totals.totalLinesAdded += summary.totalLinesAdded;
    totals.totalLinesDeleted += summary.totalLinesDeleted;
    totals.baselineCostUsd = round6(totals.baselineCostUsd + summary.estimatedBaselineCostUsd);
    totals.actualCostUsd = round6(totals.actualCostUsd + summary.estimatedActualCostUsd);
    totals.costSavingsUsd = round6(totals.costSavingsUsd + summary.estimatedCostSavingsUsd);
    totals.baselineTokens += summary.estimatedBaselineTokens;
    totals.actualTokens += summary.estimatedActualTokens;
    totals.tokensSaved += summary.estimatedTokensSaved;
    totals.escalatedCommits += summary.escalatedCommits;
    totals.reworkCommits += summary.reworkCommits;
    totals.swarmCommits += summary.swarmCommits ?? 0;
    totals.totalSwarmPosts += summary.totalSwarmPosts ?? 0;
    totals.maxSwarmWorkers = Math.max(totals.maxSwarmWorkers ?? 0, summary.maxSwarmWorkers ?? 0);
  }

  totals.weightedCostSavingsPct =
    totals.baselineCostUsd > 0
      ? Number(((totals.costSavingsUsd / totals.baselineCostUsd) * 100).toFixed(1))
      : 0;

  const medians = { ...COHORT_MEDIANS_DEFAULT };
  medians.costSavingsPct = medianOf(payloads.map((p) => p.summary.estimatedCostSavingsPct));
  medians.gitNotesCoveragePct = medianOf(payloads.map((p) => p.summary.gitNotesCoveragePct));
  medians.contractCompliancePct = medianOf(payloads.map((p) => p.summary.contractCompliancePct));
  medians.reworkRatioPct = medianOf(payloads.map((p) => p.summary.reworkRatioPct));
  medians.commitCadenceSec = medianOf(payloads.map((p) => p.summary.medianCommitCadenceSec));

  const tierDistribution: CohortBenchmark["tierDistribution"] = {
    "tier-1": 0,
    "tier-2": 0,
    "tier-3": 0,
  };
  const stackDistribution: Record<string, number> = {};
  const modelDistribution: CohortBenchmark["modelDistribution"] = {};

  for (const payload of payloads) {
    for (const [tier, commits] of Object.entries(payload.summary.tierCommits)) {
      if (tier === "tier-1" || tier === "tier-2" || tier === "tier-3") {
        tierDistribution[tier] += commits;
      }
    }

    for (const stack of payload.environment.detectedStacks) {
      stackDistribution[stack] = (stackDistribution[stack] ?? 0) + 1;
    }

    for (const model of payload.modelBreakdown) {
      const existing = modelDistribution[model.family] ?? {
        tier: model.tier,
        commits: 0,
        sourceLinesAdded: 0,
        docsLinesAdded: 0,
        estimatedCostUsd: 0,
      };
      existing.commits += model.commits;
      existing.sourceLinesAdded += model.sourceLinesAdded;
      existing.docsLinesAdded += model.docsLinesAdded;
      existing.estimatedCostUsd = round6(existing.estimatedCostUsd + model.estimatedCostUsd);
      modelDistribution[model.family] = existing;
    }
  }

  return CohortBenchmarkSchema.parse({
    schemaVersion: "2.0.0",
    generatedAt: new Date().toISOString(),
    cohortSize: payloads.length,
    projectIds: payloads.map((p) => p.anonymousProjectId),
    totals,
    medians,
    tierDistribution,
    stackDistribution,
    modelDistribution,
  });
}

function formatUsd(value: number): string {
  return `$${value.toFixed(4)}`;
}

/**
 * Renders the cohort benchmark as English Markdown.
 *
 * The report names stacks, tiers and model families only — never a repository — so it can be
 * shared publicly as-is.
 */
export function formatCohortMarkdownReport(cohort: CohortBenchmark): string {
  const lines: string[] = [
    "# LogNexus Multi-Repo Cohort Benchmark Report",
    "",
    `Generated: ${cohort.generatedAt}`,
    `Cohort size: ${cohort.cohortSize} anonymous project(s)`,
    "",
    "## Cohort Totals",
    "",
    "| Metric | Value |",
    "| :--- | ---: |",
    `| Commits | ${cohort.totals.commits} |`,
    `| Source lines added | ${cohort.totals.sourceLinesAdded} |`,
    `| Test lines added | ${cohort.totals.testLinesAdded} |`,
    `| Documentation lines added | ${cohort.totals.docsLinesAdded} |`,
    `| Configuration lines added | ${cohort.totals.configLinesAdded} |`,
    `| Lines added / deleted | ${cohort.totals.totalLinesAdded} / ${cohort.totals.totalLinesDeleted} |`,
    `| Frontier baseline cost | ${formatUsd(cohort.totals.baselineCostUsd)} |`,
    `| Actual cost | ${formatUsd(cohort.totals.actualCostUsd)} |`,
    `| Cost savings | ${formatUsd(cohort.totals.costSavingsUsd)} (${cohort.totals.weightedCostSavingsPct}% weighted) |`,
    `| Tokens saved | ${cohort.totals.tokensSaved} |`,
    ...(cohort.totals.swarmCommits > 0
      ? [
          `| Swarm commits | ${cohort.totals.swarmCommits} |`,
          `| Swarm board posts | ${cohort.totals.totalSwarmPosts} |`,
          `| Peak swarm workers | ${cohort.totals.maxSwarmWorkers} |`,
        ]
      : []),
    "",
    "## Statistical Medians",
    "",
    "| Metric | Median |",
    "| :--- | ---: |",
    `| Cost savings | ${cohort.medians.costSavingsPct}% |`,
    `| Git-notes coverage | ${cohort.medians.gitNotesCoveragePct}% |`,
    `| Contract compliance | ${cohort.medians.contractCompliancePct}% |`,
    `| Rework ratio | ${cohort.medians.reworkRatioPct}% |`,
    `| Commit cadence | ${cohort.medians.commitCadenceSec}s |`,
    "",
    "## Stack Coverage",
    "",
  ];

  const stacks = Object.entries(cohort.stackDistribution).sort((a, b) => b[1] - a[1]);
  if (stacks.length === 0) {
    lines.push("_No detected stacks in this cohort._");
  } else {
    lines.push("| Stack | Projects |", "| :--- | ---: |");
    for (const [stack, count] of stacks) {
      lines.push(`| ${stack} | ${count} |`);
    }
  }

  lines.push(
    "",
    "## Tier Distribution",
    "",
    "| Tier | Commits |",
    "| :--- | ---: |",
    `| tier-1 | ${cohort.tierDistribution["tier-1"]} |`,
    `| tier-2 | ${cohort.tierDistribution["tier-2"]} |`,
    `| tier-3 | ${cohort.tierDistribution["tier-3"]} |`,
    "",
    "## Model Efficiency Matrix",
    "",
  );

  const models = Object.entries(cohort.modelDistribution).sort(
    (a, b) => b[1].commits - a[1].commits,
  );
  if (models.length === 0) {
    lines.push("_No model activity in this cohort._");
  } else {
    lines.push(
      "| Model family | Tier | Commits | Source LOC | Docs/Config LOC | Estimated cost |",
      "| :--- | :--- | ---: | ---: | ---: | ---: |",
    );
    for (const [family, entry] of models) {
      lines.push(
        `| ${family} | ${entry.tier} | ${entry.commits} | ${entry.sourceLinesAdded} | ${entry.docsLinesAdded} | ${formatUsd(entry.estimatedCostUsd)} |`,
      );
    }
  }

  lines.push("", "");

  return lines.join("\n");
}

/** Aggregates the given snapshots and writes the Markdown cohort report inside `cwd`. */
export function generateCohortBenchmarkReportFile(
  inputs: string[],
  outputPath: string,
  cwd: string = process.cwd(),
): { filePath: string; cohort: CohortBenchmark; content: string } {
  const cohort = aggregateBenchmarkCohort(inputs, cwd);
  const content = formatCohortMarkdownReport(cohort);
  const filePath = resolveConfinedOutputPath(cwd, outputPath);

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, "utf8");

  return { filePath, cohort, content };
}
