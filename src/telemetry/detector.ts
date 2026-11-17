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

/**
 * Normalizes author/reviewer strings into generic model family categories (e.g. 'gemini/flash', 'claude/sonnet').
 *
 * Client qualifiers may contain spaces (`deepseek/VS Code (kimi-code)`), so the identity is
 * compacted before the slash check: `deepseek/VS Code` resolves to the `deepseek/v3` family
 * instead of the truncated `deepseek/vs` segment.
 */
export function extractModelFamilyCategory(identityStr: string | null | undefined): string {
  if (!identityStr) return "unknown/other";

  const trimmed = identityStr.trim().toLowerCase();

  // Explicit flagship Gemini 4 identities take precedence over generic client-role fallbacks.
  if (trimmed.includes("gemini") && trimmed.includes("carbon")) return "gemini/carbon";
  if (trimmed.includes("gemini") && trimmed.includes("argon")) return "gemini/argon";
  if (trimmed.includes("gemini") && trimmed.includes("hydrogen")) return "gemini/hydrogen";
  if (trimmed.includes("antigravity") && trimmed.includes("carbon")) return "gemini/carbon";
  if (trimmed.includes("antigravity") && trimmed.includes("argon")) return "gemini/argon";
  if (trimmed.includes("antigravity") && trimmed.includes("hydrogen")) return "gemini/hydrogen";

  // Antigravity Orchestrator (Carbon/Argon) display & slug forms and Flash worker-agy forms.
  if (
    trimmed === "orchestrator (carbon)" ||
    (trimmed.includes("orchestrator") && trimmed.includes("carbon")) ||
    (trimmed.includes("gemini-pro-orchestrator") && !trimmed.includes("argon"))
  ) {
    return "gemini/carbon";
  }
  if (
    trimmed === "orchestrator (argon)" ||
    (trimmed.includes("orchestrator") && trimmed.includes("argon")) ||
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
  if (trimmed.includes("claude") && trimmed.includes("sonnet")) return "claude/sonnet";
  if (trimmed.includes("claude") && trimmed.includes("haiku")) return "claude/haiku";
  if (trimmed.includes("claude") && trimmed.includes("opus")) return "claude/opus";
  if (
    trimmed.includes("gpt") ||
    trimmed.includes("openai") ||
    trimmed.includes("o1") ||
    trimmed.includes("o3")
  ) {
    return "openai/gpt";
  }
  if (trimmed.includes("deepseek")) {
    return "deepseek/v3";
  }
  if (trimmed.includes("kimi") || trimmed.includes("moonshot")) return "moonshot/kimi";
  if (trimmed.includes("qwen")) return "qwen/coder";

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
 * Lowercases an identity, drops version numbers and folds slug separators into
 * slashes, so `gemini-3.8-pro`, `google/gemini-3.8-flash-high` and `Gemini 4 Argon`
 * all compare against the same marker vocabulary. Trailing free text is untouched.
 */
function normalizeIdentity(identityStr: string): string {
  return identityStr
    .trim()
    .toLowerCase()
    .replace(/\d+(?:\.\d+)*/g, "")
    .replace(/[\s_-]+/g, "/")
    .replace(/\/{2,}/g, "/");
}

const TIER_1_MARKERS = [
  "gemini/pro",
  "gemini/argon",
  "gemini/carbon",
  "argon",
  "carbon",
  "lead/orchestrator",
  "orchestrator",
  "antigravity/lead",
  "claude/opus",
  "opus",
  "openai/o1",
  "openai/o3",
  "/o1",
  "/o3",
];

const TIER_3_MARKERS = ["deepseek", "kimi", "moonshot", "haiku", "qwen", "flash/lite"];

const TIER_2_MARKERS = [
  "gemini/flash/high",
  "gemini/flash",
  "gemini/hydrogen",
  "hydrogen",
  "claude/sonnet",
  "sonnet",
  "gpt-4o",
  "openai/gpt",
];

const EFFORT_SUFFIXES = [
  "-extra-high",
  "-xtrahigh",
  "-xhigh",
  "-minimal",
  "-medium",
  "-high",
  "-low",
  "-none",
] as const;

/**
 * Infers the routing tier of an author identity, so commit telemetry and the audit
 * can detect tier-1 models working outside their scope.
 */
export function inferTierFromAuthor(identityStr?: string | null): AuthorTier | null {
  if (!identityStr) return null;

  let head = identityStr.split("(")[0].trim().toLowerCase();
  for (let i = 0; i < 2; i++) {
    const suffix = EFFORT_SUFFIXES.find((candidate) => head.endsWith(candidate));
    if (!suffix) break;
    head = head.slice(0, -suffix.length);
  }

  if (head.includes("flash-worker-agy") || head.includes("worker-agy")) {
    return "tier-3";
  }
  if (/(?:^|[/_-])(?:gpt-4o-mini|flash-lite)(?:$|[/_-])/.test(head)) {
    return "tier-3";
  }
  if (/(?:^|[/_-])(?:o1-mini|o3-mini|o4-mini)(?:$|[/_-])/.test(head)) {
    return "tier-2";
  }
  if (/(?:^|[/_-])(?:o1|o3|o4|gpt-5(?:\.\d+)?)(?:$|[/_-])/.test(head)) {
    return "tier-1";
  }
  if (head.includes("deepseek") && /(?:^|[/_-])(?:r1|reasoner)(?:$|[/_-])/.test(head)) {
    return "tier-1";
  }

  // Collapse slug separators so 'gemini-3.8-pro' matches the 'gemini/pro' marker.
  const normalized = normalizeIdentity(identityStr);
  if (normalized === "") return null;

  // tier-3 markers win over tier-2 so 'gemini/flash-lite' never escalates to tier-2
  if (TIER_3_MARKERS.some((marker) => normalized.includes(marker))) return "tier-3";
  if (TIER_1_MARKERS.some((marker) => normalized.includes(marker))) return "tier-1";
  if (TIER_2_MARKERS.some((marker) => normalized.includes(marker))) return "tier-2";

  return null;
}
