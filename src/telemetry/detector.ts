import { execFileSync } from "node:child_process";
import { type Dirent, existsSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { validateGitReference } from "../git/safe.js";
import type { DiffCategory } from "./schema.js";

export interface DiffStatItem {
  ext: string;
  category: DiffCategory;
  linesAdded: number;
  linesDeleted: number;
}

const TEST_PATH_PREFIXES = ["tests/", "test/", "__tests__/"];

const DOC_EXTENSIONS = new Set([".md", ".mdx", ".txt", ".rst"]);

const DOC_BASENAMES = new Set(["license", "notice", "changelog", "readme"]);

const CONFIG_EXTENSIONS = new Set([
  ".json",
  ".yml",
  ".yaml",
  ".toml",
  ".ini",
  ".lock",
  ".gitignore",
  ".geminiignore",
  ".aiexclude",
  ".cursorignore",
]);

const CONFIG_PATH_PREFIXES = [
  ".github/",
  ".claude/",
  ".claude-plugin/",
  ".lognexus/",
  ".agents/",
  ".cursor/",
];

const GOVERNANCE_DOC_BASENAMES = new Set(["claude.md", "agents.md", "gemini.md"]);

/**
 * Buckets a changed file into a diff category without recording its path anywhere.
 *
 * Test lines are priced like source lines because they carry the same authoring effort,
 * while docs and config lines are priced as cheap boilerplate by the ROI estimator.
 */
export function classifyFileCategory(filePath: string): DiffCategory {
  const normalized = filePath.trim().replace(/\\/g, "/").toLowerCase();
  if (normalized === "") return "source";

  const segments = normalized.split("/");
  const base = segments[segments.length - 1] ?? "";
  const baseWithoutExt = base.includes(".") ? base.slice(0, base.lastIndexOf(".")) : base;
  const ext = base.includes(".") ? base.slice(base.lastIndexOf(".")) : "";

  if (TEST_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return "test";
  if (normalized.includes(".test.") || normalized.includes(".spec.")) return "test";

  if (DOC_EXTENSIONS.has(ext)) return "docs";
  if (normalized.startsWith("docs/")) return "docs";
  if (DOC_BASENAMES.has(base) || DOC_BASENAMES.has(baseWithoutExt)) return "docs";

  if (CONFIG_EXTENSIONS.has(ext)) return "config";
  if (CONFIG_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return "config";

  return "source";
}

/**
 * Identifies the surfaces a Tier-1 orchestrator legitimately edits without owning the
 * issue's task tier: governance markdown, templates, CI workflows and configuration.
 */
export function isGovernanceOrConfigSurface(filePath: string): boolean {
  const normalized = filePath.trim().replace(/\\/g, "/").toLowerCase();

  const category = classifyFileCategory(normalized);
  if (category === "docs" || category === "config") return true;

  return GOVERNANCE_DOC_BASENAMES.has(normalized);
}

const SHELL_STACK_EXTENSIONS: Record<string, string> = {
  ".ps1": "powershell",
  ".psm1": "powershell",
  ".psd1": "powershell",
  ".bat": "batch",
  ".cmd": "batch",
  ".lua": "lua",
  ".toc": "lua",
  ".scp": "spherescript",
};

const SHELL_SCAN_MAX_DEPTH = 2;

const SHELL_SCAN_IGNORED_DIRS = new Set([".git", "node_modules", "dist", ".lognexus"]);

/**
 * Walks the project tree up to two levels deep looking for shell scripts, so projects whose
 * PowerShell/Batch automation lives in subdirectories are still classified correctly.
 */
function detectShellStacks(targetDir: string, stacks: Set<string>, depth = 0): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(targetDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const stack = SHELL_STACK_EXTENSIONS[extname(entry.name).toLowerCase()];
    if (stack === undefined) continue;

    // Symlinks are skipped to avoid cycles and reads outside the scanned project.
    if (entry.isFile() && !entry.isSymbolicLink()) {
      stacks.add(stack);
    }
  }

  if (depth >= SHELL_SCAN_MAX_DEPTH) return;

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    if (SHELL_SCAN_IGNORED_DIRS.has(entry.name)) continue;

    detectShellStacks(join(targetDir, entry.name), stacks, depth + 1);
  }
}

export function detectProjectStacks(targetDir: string = process.cwd()): string[] {
  const stacks = new Set<string>();

  try {
    if (existsSync(join(targetDir, "package.json"))) {
      stacks.add("nodejs");
      if (existsSync(join(targetDir, "tsconfig.json"))) {
        stacks.add("typescript");
      } else {
        stacks.add("javascript");
      }
    }

    if (
      existsSync(join(targetDir, "pyproject.toml")) ||
      existsSync(join(targetDir, "requirements.txt")) ||
      existsSync(join(targetDir, "setup.py"))
    ) {
      stacks.add("python");
    }

    if (existsSync(join(targetDir, "Cargo.toml"))) {
      stacks.add("rust");
    }

    if (existsSync(join(targetDir, "go.mod"))) {
      stacks.add("go");
    }

    if (
      existsSync(join(targetDir, "pom.xml")) ||
      existsSync(join(targetDir, "build.gradle")) ||
      existsSync(join(targetDir, "build.gradle.kts"))
    ) {
      stacks.add("java");
    }

    if (existsSync(join(targetDir, "CMakeLists.txt")) || existsSync(join(targetDir, "Makefile"))) {
      stacks.add("c/cpp");
    }

    if (
      existsSync(join(targetDir, "astro.config.mjs")) ||
      existsSync(join(targetDir, "astro.config.ts")) ||
      existsSync(join(targetDir, "astro.config.js")) ||
      existsSync(join(targetDir, "astro.config.cjs"))
    ) {
      stacks.add("astro");
    }

    detectShellStacks(targetDir, stacks);
  } catch {
    // Ignore read errors
  }

  return Array.from(stacks).sort();
}

/**
 * Extracts line change metrics by extension and diff category from a Git commit SHA
 * without storing any file names or paths.
 */
export function extractCommitDiffStats(
  sha: string,
  targetDir: string = process.cwd(),
): DiffStatItem[] {
  const extensionMap = new Map<string, DiffStatItem>();

  try {
    const sanitizedSha = validateGitReference(sha);

    // `--root` makes a parentless commit report its files instead of an empty diff, so the
    // first commit of a repository is priced like every other one.
    const raw = execFileSync(
      "git",
      ["diff-tree", "--root", "--numstat", "--no-commit-id", "-r", sanitizedSha],
      {
        cwd: targetDir,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
      },
    );

    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const parts = trimmed.split(/\s+/);
      if (parts.length < 3) continue;

      const added = Number.parseInt(parts[0], 10);
      const deleted = Number.parseInt(parts[1], 10);
      const filePath = parts.slice(2).join(" ");

      // Ignore binary files where numstat outputs '-'
      const linesAdded = Number.isNaN(added) ? 0 : added;
      const linesDeleted = Number.isNaN(deleted) ? 0 : deleted;

      // Extract ONLY extension (e.g. '.ts', '.py', '.md') and category. Zero path or filename is recorded.
      const rawExt = extname(filePath).toLowerCase();
      const ext = rawExt === "" ? "(no-ext)" : rawExt;
      const category = classifyFileCategory(filePath);

      // Keyed by extension AND category so `.ts` in `src/` and `.ts` in `tests/` stay separate.
      const key = `${ext}\u0000${category}`;
      const existing: DiffStatItem = extensionMap.get(key) ?? {
        ext,
        category,
        linesAdded: 0,
        linesDeleted: 0,
      };
      existing.linesAdded += linesAdded;
      existing.linesDeleted += linesDeleted;
      extensionMap.set(key, existing);
    }
  } catch {
    // Non-git or commit without parents
  }

  return Array.from(extensionMap.values());
}

const CARBON_MARKER_PATTERN = /(?:^|[^a-z0-9])carbon(?:$|[^a-z0-9])/;
const ARGON_MARKER_PATTERN = /(?:^|[^a-z0-9])argon(?:$|[^a-z0-9])/;
const NEON_MARKER_PATTERN = /(?:^|[^a-z0-9])neon(?:$|[^a-z0-9])/;
const HYDROGEN_MARKER_PATTERN = /(?:^|[^a-z0-9])hydrogen(?:$|[^a-z0-9])/;

function isLowerAlphaNum(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 97 && code <= 122);
}

/**
 * Matches `marker` only when bounded by start/end or non-alphanumeric delimiters in O(n),
 * preventing substring false positives such as `"console"` or `"solver"` matching `"sol"`.
 */
function hasDelimitedMarker(lowerText: string, marker: string): boolean {
  let pos = 0;
  while (pos <= lowerText.length - marker.length) {
    const idx = lowerText.indexOf(marker, pos);
    if (idx === -1) return false;
    const beforeOk = idx === 0 || !isLowerAlphaNum(lowerText.charCodeAt(idx - 1));
    const afterIdx = idx + marker.length;
    const afterOk =
      afterIdx === lowerText.length || !isLowerAlphaNum(lowerText.charCodeAt(afterIdx));
    if (beforeOk && afterOk) return true;
    pos = idx + 1;
  }
  return false;
}

/**
 * Normalizes author/reviewer strings into generic model family categories (e.g. 'gemini/flash', 'claude/sonnet').
 *
 * Client qualifiers may contain spaces (`deepseek/VS Code (kimi-code)`), so the identity is
 * compacted before the slash check: `deepseek/VS Code` resolves to the `deepseek/v3` family
 * instead of the truncated `deepseek/vs` segment.
 */
export function extractModelFamilyCategory(identityStr: string | null | undefined): string {
  if (!identityStr) return "unknown/other";

  const cleaned = stripAngleBracketEmails(identityStr);
  if (cleaned === "") return "unknown/other";

  const trimmed = cleaned.trim().toLowerCase();
  const headBeforeParens = trimmed.split("(")[0].trim();

  // Explicit flagship Gemini 4 identities take precedence over generic client-role fallbacks.
  if (trimmed.includes("gemini") && CARBON_MARKER_PATTERN.test(trimmed)) return "gemini/carbon";
  if (trimmed.includes("gemini") && ARGON_MARKER_PATTERN.test(trimmed)) return "gemini/argon";
  if (
    (trimmed.includes("gemini") || trimmed.includes("antigravity")) &&
    NEON_MARKER_PATTERN.test(trimmed)
  ) {
    return "gemini/neon";
  }
  if (trimmed.includes("gemini") && HYDROGEN_MARKER_PATTERN.test(trimmed)) return "gemini/hydrogen";
  if (trimmed.includes("antigravity") && CARBON_MARKER_PATTERN.test(trimmed))
    return "gemini/carbon";
  if (trimmed.includes("antigravity") && ARGON_MARKER_PATTERN.test(trimmed)) return "gemini/argon";
  if (trimmed.includes("antigravity") && HYDROGEN_MARKER_PATTERN.test(trimmed))
    return "gemini/hydrogen";

  // Antigravity Orchestrator (Carbon/Argon/Neon) display & slug forms and Flash worker-agy forms.
  if (
    trimmed === "orchestrator (neon)" ||
    (trimmed.includes("orchestrator") && NEON_MARKER_PATTERN.test(trimmed)) ||
    trimmed.includes("gemini-pro-orchestrator-neon")
  ) {
    return "gemini/neon";
  }
  if (
    trimmed === "orchestrator (carbon)" ||
    (trimmed.includes("orchestrator") && CARBON_MARKER_PATTERN.test(trimmed)) ||
    (trimmed.includes("gemini-pro-orchestrator") &&
      !ARGON_MARKER_PATTERN.test(trimmed) &&
      !NEON_MARKER_PATTERN.test(trimmed))
  ) {
    return "gemini/carbon";
  }
  if (
    trimmed === "orchestrator (argon)" ||
    (trimmed.includes("orchestrator") && ARGON_MARKER_PATTERN.test(trimmed)) ||
    trimmed.includes("gemini-pro-orchestrator-argon")
  ) {
    return "gemini/argon";
  }
  if (trimmed.includes("gemini-flash-worker-agy") || trimmed.includes("flash-worker-agy")) {
    return "gemini/flash";
  }

  // The Antigravity orchestrator drives the plan from an isolated window; classify unnamed
  // Antigravity orchestrators as the architecture family before generic Gemini checks claim them.
  if (
    trimmed.includes("antigravity") &&
    (trimmed.includes("lead") || trimmed.includes("orchestrator") || trimmed.includes("architect"))
  ) {
    return "gemini/argon";
  }

  // Well-known model family heuristics
  if (trimmed.includes("gemini") && trimmed.includes("pro")) return "gemini/pro";
  if (trimmed.includes("gemini") && (trimmed.includes("flash-high") || trimmed.includes("high"))) {
    return "gemini/flash-high";
  }
  if (trimmed.includes("gemini") && trimmed.includes("flash")) return "gemini/flash";
  if (trimmed.includes("gemini")) return "gemini/generic";
  if (hasDelimitedMarker(trimmed, "fable")) return "claude/fable";
  if (hasDelimitedMarker(trimmed, "mythos")) return "claude/mythos";
  if (
    (trimmed.includes("claude") || trimmed.includes("anthropic/")) &&
    trimmed.includes("sonnet")
  ) {
    return "claude/sonnet";
  }
  if ((trimmed.includes("claude") || trimmed.includes("anthropic/")) && trimmed.includes("haiku")) {
    return "claude/haiku";
  }
  if ((trimmed.includes("claude") || trimmed.includes("anthropic/")) && trimmed.includes("opus")) {
    return "claude/opus";
  }
  if (hasDelimitedMarker(trimmed, "astra")) return "openai/astra";
  if (hasDelimitedMarker(trimmed, "sol")) return "openai/sol";
  if (hasDelimitedMarker(trimmed, "luna")) return "openai/luna";
  if (hasDelimitedMarker(trimmed, "gpt-oss")) return "openai/gpt-oss";
  if (hasDelimitedMarker(headBeforeParens, "codex")) return "openai/codex";
  if (hasDelimitedMarker(trimmed, "cyber")) return "openai/cyber";
  if (
    trimmed.includes("gpt") ||
    trimmed.includes("openai") ||
    hasDelimitedMarker(trimmed, "o1") ||
    hasDelimitedMarker(trimmed, "o3") ||
    hasDelimitedMarker(trimmed, "o4")
  ) {
    return "openai/gpt";
  }
  if (trimmed.includes("deepseek")) {
    if (hasDelimitedMarker(trimmed, "v4") && hasDelimitedMarker(trimmed, "pro")) {
      return "deepseek/v4-pro";
    }
    if (hasDelimitedMarker(trimmed, "v4")) {
      return "deepseek/v4";
    }
    return "deepseek/v3";
  }
  if (trimmed.includes("kimi") || trimmed.includes("moonshot")) return "moonshot/kimi";
  if (trimmed.includes("qwen")) {
    return hasDelimitedMarker(trimmed, "max") ? "qwen/max" : "qwen/coder";
  }
  if (
    trimmed.startsWith("xai/") ||
    trimmed.startsWith("x-ai/") ||
    hasDelimitedMarker(trimmed, "grok")
  ) {
    return "xai/grok";
  }
  if (
    trimmed.startsWith("zai/") ||
    trimmed.startsWith("z.ai/") ||
    trimmed.startsWith("z-ai/") ||
    hasDelimitedMarker(trimmed, "glm")
  ) {
    return "zai/glm";
  }

  // Only a `provider/model` slug survives. A bare human name — a Git `user.name` with no slash
  // and no model marker — is anonymous history, and returning its first word would publish a
  // person's name into `modelBreakdown`.
  const head = trimmed.split(/[<(]/)[0].trim();
  const compactHead = head.replace(/\s+/g, "");
  const slashMatch = compactHead.match(/^([a-z0-9_-]+\/[a-z0-9_.-]+)/i);
  if (slashMatch) {
    return slashMatch[1];
  }

  return "unknown/other";
}

export type AuthorTier = "tier-1" | "tier-2" | "tier-3";

/**
 * Strips `<email>` tags in a single linear pass so Git email domains cannot masquerade as
 * model family markers.
 */
function stripAngleBracketEmails(input: string): string {
  let result = "";
  let inAngle = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (ch === "<") {
      inAngle = true;
      result += " ";
    } else if (ch === ">") {
      inAngle = false;
      result += " ";
    } else if (!inAngle) {
      result += ch;
    }
  }
  return result.trim();
}

/**
 * Extracts the parenthetical qualifier of `Orchestrator (<qualifier>)` with balanced
 * parenthesis scanning so nested qualifiers like `Orchestrator (deepseek/VS Code (kimi-code))`
 * resolve cleanly.
 */
function extractOrchestratorQualifier(trimmedLower: string): string | null {
  if (!trimmedLower.startsWith("orchestrator")) return null;
  const afterKeyword = trimmedLower.slice("orchestrator".length);
  if (afterKeyword !== "" && !afterKeyword.startsWith("(") && !/^\s/.test(afterKeyword)) {
    return null;
  }

  const openIdx = trimmedLower.indexOf("(");
  if (openIdx === -1) return null;

  let depth = 0;
  for (let i = openIdx; i < trimmedLower.length; i += 1) {
    const ch = trimmedLower[i];
    if (ch === "(") {
      depth += 1;
    } else if (ch === ")") {
      depth -= 1;
      if (depth === 0) {
        return trimmedLower.slice(openIdx + 1, i).trim();
      }
    }
  }
  return null;
}

/**
 * Lowercases an identity, drops version numbers and folds separators into slashes, so
 * `gemini-3.8-pro`, `google/gemini-3.8-flash-high` and `Gemini 4 Argon` all compare against
 * exact slash-delimited marker boundaries without substring false positives on human names.
 */
function normalizeIdentity(identityStr: string): string {
  return identityStr
    .trim()
    .toLowerCase()
    .replace(/\d+(?:\.\d+)*/g, "")
    .replace(/[\s_.,:;()[\]{}-]+/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/{2,}/g, "/");
}

const TIER_1_MARKERS = [
  "gemini/pro",
  "gemini/argon",
  "gemini/carbon",
  "gemini/neon",
  "argon",
  "carbon",
  "neon",
  "lead/orchestrator",
  "orchestrator",
  "antigravity/lead",
  "claude/fable",
  "fable",
  "claude/mythos",
  "mythos",
  "claude/opus",
  "opus",
  "openai/astra",
  "astra",
  "openai/o1",
  "openai/o3",
  "openai/o4",
];

const TIER_3_MARKERS = ["deepseek", "kimi", "moonshot", "haiku", "luna", "qwen", "flash/lite"];

const BARE_AMBIGUOUS_TIER_3_MARKERS = new Set(["kimi", "qwen"]);

const AI_COMPANION_TOKENS = new Set([
  "moonshot",
  "code",
  "coder",
  "k2",
  "k3",
  "antigravity",
  "vscode",
  "cursor",
]);

const TIER_2_MARKERS = [
  "gemini/flash/high",
  "gemini/flash",
  "gemini/hydrogen",
  "hydrogen",
  "claude/sonnet",
  "sonnet",
  "openai/sol",
  "sol",
  "gpt-4o",
  "openai/gpt",
];

const EFFORT_SUFFIXES = [
  "-extra-high",
  "-ultrafast",
  "-xtrahigh",
  "-minimal",
  "-medium",
  "-xhigh",
  "-extra",
  "-light",
  "-high",
  "-fast",
  "-none",
  "-low",
  "-max",
] as const;

const GPT_MINI_NANO_PATTERN = /(?:^|[\s/_-])gpt[\s_-]\d+(?:\.\d+)?[\s_-](?:mini|nano)(?:$|[\s/_-])/;
const GPT_DASH_MINI_NANO_PATTERN = /(?:^|[\s/_-])gpt[\s_-]\d+-\d+[\s_-](?:mini|nano)(?:$|[\s/_-])/;
const GPT_5_PATTERN = /(?:^|[\s/_-])gpt[\s_-]5(?:\.\d+)?(?:$|[\s/_-])/;

function shouldSkipEffortSuffix(head: string, suffix: string): boolean {
  if (suffix !== "-max") return false;
  return (
    head.startsWith("qwen/") ||
    head.startsWith("qwen-") ||
    head.includes("/qwen-") ||
    head.endsWith("-codex-max")
  );
}

function matchesBoundaryMarker(
  paddedNormalized: string,
  marker: string,
  rawHead: string,
  rawTokens: Set<string>,
): boolean {
  if (!paddedNormalized.includes(`/${marker}/`)) return false;
  if (BARE_AMBIGUOUS_TIER_3_MARKERS.has(marker)) {
    return rawHead.includes("/") || [...AI_COMPANION_TOKENS].some((tok) => rawTokens.has(tok));
  }
  return true;
}

/**
 * Infers the routing tier of an author identity, so commit telemetry and the audit
 * can detect tier-1 models working outside their scope.
 */
export function inferTierFromAuthor(identityStr?: string | null): AuthorTier | null {
  if (!identityStr) return null;

  const cleaned = stripAngleBracketEmails(identityStr);
  if (cleaned === "") return null;

  const trimmedLower = cleaned.toLowerCase();
  const orchestratorQualifier = extractOrchestratorQualifier(trimmedLower);
  if (orchestratorQualifier !== null) {
    return (
      (orchestratorQualifier === "" ? null : inferTierFromAuthor(orchestratorQualifier)) ?? "tier-1"
    );
  }

  const rawHead = cleaned.split("(")[0].trim().toLowerCase();
  let head = rawHead;
  for (let i = 0; i < 2; i++) {
    const suffix = EFFORT_SUFFIXES.find(
      (candidate) => head.endsWith(candidate) && !shouldSkipEffortSuffix(head, candidate),
    );
    if (!suffix) break;
    head = head.slice(0, -suffix.length);
  }

  // Check Grok on rawHead before effort stripping so `grok-code-fast` stays tier-3.
  if (hasDelimitedMarker(rawHead, "grok")) {
    if (hasDelimitedMarker(rawHead, "mini") || hasDelimitedMarker(rawHead, "grok-code-fast")) {
      return "tier-3";
    }
    if (
      hasDelimitedMarker(head, "grok-4") ||
      hasDelimitedMarker(head, "grok-3") ||
      hasDelimitedMarker(head, "grok 4") ||
      hasDelimitedMarker(head, "grok 3")
    ) {
      return "tier-1";
    }
    return "tier-2";
  }

  if (hasDelimitedMarker(head, "glm")) {
    if (
      hasDelimitedMarker(head, "flash") ||
      hasDelimitedMarker(head, "air") ||
      hasDelimitedMarker(head, "mini") ||
      hasDelimitedMarker(head, "lite")
    ) {
      return "tier-3";
    }
    if (hasDelimitedMarker(head, "glm-5") || hasDelimitedMarker(head, "glm 5")) {
      return "tier-1";
    }
    return "tier-2";
  }

  if (head.includes("deepseek") && hasDelimitedMarker(head, "v4")) {
    if (hasDelimitedMarker(head, "flash")) {
      return "tier-3";
    }
    if (hasDelimitedMarker(head, "pro")) {
      return "tier-1";
    }
    return "tier-2";
  }

  // Tier-3 fast checks must run before Tier-1 gpt-5/o4 and generic Tier-2 openai/gpt.
  if (head.includes("flash-worker-agy") || head.includes("worker-agy")) {
    return "tier-3";
  }
  if (
    GPT_MINI_NANO_PATTERN.test(head) ||
    GPT_DASH_MINI_NANO_PATTERN.test(head) ||
    hasDelimitedMarker(head, "gpt-4o-mini") ||
    hasDelimitedMarker(head, "codex-mini") ||
    hasDelimitedMarker(head, "o4-mini") ||
    hasDelimitedMarker(head, "flash-lite") ||
    hasDelimitedMarker(head, "luna") ||
    hasDelimitedMarker(head, "haiku")
  ) {
    return "tier-3";
  }

  // Tier-1 fast checks must precede Tier-2 (e.g. astra/gpt-5 before generic openai/gpt).
  const hasO1Mini = hasDelimitedMarker(head, "o1-mini");
  const hasO3Mini = hasDelimitedMarker(head, "o3-mini");
  if (
    hasDelimitedMarker(head, "fable") ||
    hasDelimitedMarker(head, "mythos") ||
    hasDelimitedMarker(head, "astra") ||
    hasDelimitedMarker(head, "cyber") ||
    (!hasO1Mini && hasDelimitedMarker(head, "o1")) ||
    (!hasO3Mini && hasDelimitedMarker(head, "o3")) ||
    hasDelimitedMarker(head, "o4") ||
    GPT_5_PATTERN.test(head) ||
    (hasDelimitedMarker(head, "qwen") && hasDelimitedMarker(head, "max")) ||
    (hasDelimitedMarker(head, "kimi") &&
      (hasDelimitedMarker(head, "thinking") || hasDelimitedMarker(head, "pro"))) ||
    (head.includes("deepseek") &&
      (hasDelimitedMarker(head, "r1") || hasDelimitedMarker(head, "reasoner")))
  ) {
    return "tier-1";
  }

  // Tier-2 fast checks before generic normalized marker matching.
  if (
    hasO1Mini ||
    hasO3Mini ||
    hasDelimitedMarker(head, "gpt-4o") ||
    hasDelimitedMarker(head, "sol") ||
    hasDelimitedMarker(head, "gpt-oss") ||
    hasDelimitedMarker(head, "codex")
  ) {
    return "tier-2";
  }

  // Collapse slug separators so 'gemini-3.8-pro' matches the '/gemini/pro/' boundary.
  const normalized = normalizeIdentity(cleaned);
  if (normalized === "") return null;

  const paddedNormalized = `/${normalized}/`;
  const rawTokens = new Set(trimmedLower.split(/[^a-z0-9]+/).filter((token) => token !== ""));

  // tier-3 markers win over tier-2 so 'gemini/flash-lite' never escalates to tier-2
  if (
    TIER_3_MARKERS.some((marker) =>
      matchesBoundaryMarker(paddedNormalized, marker, rawHead, rawTokens),
    )
  ) {
    return "tier-3";
  }
  if (
    TIER_1_MARKERS.some((marker) =>
      matchesBoundaryMarker(paddedNormalized, marker, rawHead, rawTokens),
    )
  ) {
    return "tier-1";
  }
  if (
    TIER_2_MARKERS.some((marker) =>
      matchesBoundaryMarker(paddedNormalized, marker, rawHead, rawTokens),
    )
  ) {
    return "tier-2";
  }

  return null;
}
