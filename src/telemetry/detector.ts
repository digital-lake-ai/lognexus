import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { extname, join } from "node:path";
import { validateGitReference } from "../git/safe.js";

export interface DiffStatItem {
  ext: string;
  linesAdded: number;
  linesDeleted: number;
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
  } catch {
    // Ignore read errors
  }

  return Array.from(stacks).sort();
}

/**
 * Extracts line change metrics by extension from a Git commit SHA without storing any file names or paths.
 */
export function extractCommitDiffStats(
  sha: string,
  targetDir: string = process.cwd(),
): DiffStatItem[] {
  const extensionMap = new Map<string, { linesAdded: number; linesDeleted: number }>();

  try {
    const sanitizedSha = validateGitReference(sha);

    const raw = execFileSync(
      "git",
      ["diff-tree", "--numstat", "--no-commit-id", "-r", sanitizedSha],
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

      // Extract ONLY extension (e.g. '.ts', '.py', '.md'). Zero path or filename is recorded.
      const rawExt = extname(filePath).toLowerCase();
      const ext = rawExt === "" ? "(no-ext)" : rawExt;

      const existing = extensionMap.get(ext) ?? { linesAdded: 0, linesDeleted: 0 };
      existing.linesAdded += linesAdded;
      existing.linesDeleted += linesDeleted;
      extensionMap.set(ext, existing);
    }
  } catch {
    // Non-git or commit without parents
  }

  return Array.from(extensionMap.entries()).map(([ext, stats]) => ({
    ext,
    linesAdded: stats.linesAdded,
    linesDeleted: stats.linesDeleted,
  }));
}

/**
 * Normalizes author/reviewer strings into generic model family categories (e.g. 'gemini/flash', 'claude/sonnet').
 */
export function extractModelFamilyCategory(identityStr: string | null | undefined): string {
  if (!identityStr) return "unknown/other";

  const trimmed = identityStr.trim().toLowerCase();

  // Well-known model family heuristics
  if (trimmed.includes("gemini") && trimmed.includes("flash")) return "gemini/flash";
  if (trimmed.includes("gemini") && trimmed.includes("pro")) return "gemini/pro";
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
  if (trimmed.includes("deepseek")) return "deepseek/v3";
  if (trimmed.includes("kimi") || trimmed.includes("moonshot")) return "moonshot/kimi";
  if (trimmed.includes("qwen")) return "qwen/coder";

  const slashMatch = trimmed.match(/^([a-z0-9_-]+\/[a-z0-9_.-]+)/i);
  if (slashMatch) {
    return slashMatch[1];
  }

  const firstWord = trimmed.split(/\s+/)[0];
  return firstWord || "unknown/other";
}
