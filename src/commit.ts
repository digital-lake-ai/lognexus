import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkSelfApproval } from "./audit/audit.js";
import { attachCurrentStateToCommit } from "./notes/attach.js";
import { finishSubtask, loadState } from "./state/manager.js";
import { recordCommitTelemetry, recordReviewGateBlock } from "./telemetry/collector.js";

export interface CommitOptions {
  message: string;
  author?: string;
  reviewer?: string;
  finishTask?: boolean;
  targetDir?: string;
  allowEmpty?: boolean;
  allowDirectMain?: boolean;
}

export interface ParsedCommitArgs {
  message?: string;
  author?: string;
  reviewer?: string;
  finishTask: boolean;
  allowEmpty: boolean;
  allowDirectMain: boolean;
}

export function parseCommitArgs(args: string[]): ParsedCommitArgs {
  let message: string | undefined;
  let author: string | undefined;
  let reviewer: string | undefined;
  let finishTask = false;
  let allowEmpty = false;
  let allowDirectMain = false;

  const isFlag = (token: string | undefined): boolean => {
    if (!token) return false;
    return token.startsWith("--") || token === "-F" || token === "-m";
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-m" || arg === "--message") {
      const parts: string[] = [];
      while (i + 1 < args.length && !isFlag(args[i + 1])) {
        parts.push(args[++i]);
      }
      const val = parts.join(" ").trim();
      message = val.length > 0 ? val : undefined;
    } else if (arg === "-F" || arg === "--file") {
      const filePath = args[++i];
      if (!filePath) {
        throw new Error("Flag -F / --file requires a file path argument.");
      }
      if (!existsSync(filePath)) {
        throw new Error(`Commit message file not found: '${filePath}'`);
      }
      const content = readFileSync(filePath, "utf8").trim();
      message = content.length > 0 ? content : undefined;
    } else if (arg === "--author") {
      const parts: string[] = [];
      while (i + 1 < args.length && !isFlag(args[i + 1])) {
        parts.push(args[++i]);
      }
      const val = parts.join(" ").trim();
      author = val.length > 0 ? val : undefined;
    } else if (arg === "--reviewer") {
      const parts: string[] = [];
      while (i + 1 < args.length && !isFlag(args[i + 1])) {
        parts.push(args[++i]);
      }
      const val = parts.join(" ").trim();
      reviewer = val.length > 0 ? val : undefined;
    } else if (arg === "--finish-task") {
      finishTask = true;
    } else if (arg === "--allow-empty") {
      allowEmpty = true;
    } else if (arg === "--allow-direct-main") {
      allowDirectMain = true;
    }
  }

  return {
    message,
    author,
    reviewer,
    finishTask,
    allowEmpty,
    allowDirectMain,
  };
}

export interface CommitResult {
  sha: string;
  shortSha: string;
  subject: string;
  author: string;
  reviewer: string | null;
  subtaskCompleted: string | null;
  noteAttached: boolean;
}

function runGit(command: string, cwd: string): string {
  return execSync(`git ${command}`, {
    cwd,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

function matchesPath(file: string, rule: string): boolean {
  if (rule === "") return false;
  if (rule.endsWith("/")) return file.startsWith(rule);
  if (rule.includes("*")) {
    const pattern = new RegExp(
      `^${rule
        .split("*")
        .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*")}$`,
    );
    return pattern.test(file);
  }
  return file === rule;
}

export function executeAtomicCommit(options: CommitOptions): CommitResult {
  const cwd = options.targetDir ?? process.cwd();
  const trimmedMessage = options.message?.trim();

  if (!trimmedMessage) {
    throw new Error("Commit message cannot be empty.");
  }

  // 1. Branch governance guard: forbid direct commits on main / master
  let currentBranch = "";
  try {
    currentBranch = runGit("branch --show-current", cwd);
  } catch {
    // Non-git or detached HEAD
  }

  const PROTECTED_BRANCHES = new Set(["main", "master"]);
  if (PROTECTED_BRANCHES.has(currentBranch) && !options.allowDirectMain) {
    recordReviewGateBlock(cwd);
    throw new Error(
      `Governance violation: Direct commits on protected branch '${currentBranch}' are strictly forbidden. Switch to a scoped branch first: git checkout -b issue/<id>-<slug>`,
    );
  }

  // 2. Resolve author and reviewer
  let author = options.author?.trim();
  if (!author) {
    author = process.env.LOGNEXUS_AUTHOR?.trim();
  }
  if (!author) {
    try {
      const name = runGit("config user.name", cwd);
      const email = runGit("config user.email", cwd);
      author = `${name || "unknown"} (${email || "local"})`;
    } catch {
      author = "agent/unknown (lognexus)";
    }
  }

  const reviewer = options.reviewer?.trim() || null;

  // 2. Pre-flight check: review gate separation
  if (author && reviewer) {
    const check = checkSelfApproval(author, reviewer);
    if (check.isSelfApproval) {
      recordReviewGateBlock(cwd);
      throw new Error(`Review-gate separation violation: ${check.message}`);
    }
  }

  // 3. Pre-flight check: subtask contract file constraints against staged changes
  const state = loadState(cwd);
  if (state.currentSubtask?.contract) {
    const contract = state.currentSubtask.contract;
    const allowed = (contract.allowedFiles ?? []).map(normalizePath);
    const forbidden = (contract.forbiddenFiles ?? []).map(normalizePath);

    let stagedFiles: string[] = [];
    try {
      const output = runGit("diff --cached --name-only", cwd);
      stagedFiles = output
        .replace(/\r\n/g, "\n")
        .split("\n")
        .map(normalizePath)
        .filter((f) => f !== "");
    } catch {
      // not in git or nothing staged
    }

    const forbiddenTouched = stagedFiles.filter((file) =>
      forbidden.some((rule) => matchesPath(file, rule)),
    );
    if (forbiddenTouched.length > 0) {
      recordReviewGateBlock(cwd);
      throw new Error(
        `Contract violation: staged file(s) touch forbidden set: ${forbiddenTouched.join(", ")}`,
      );
    }

    if (allowed.length > 0) {
      const outsideTouched = stagedFiles.filter(
        (file) => !allowed.some((rule) => matchesPath(file, rule)),
      );
      if (outsideTouched.length > 0) {
        recordReviewGateBlock(cwd);
        throw new Error(
          `Contract violation: staged file(s) are outside the allowed set: ${outsideTouched.join(", ")}`,
        );
      }
    }
  }

  // 4. Construct complete commit message with trailers
  let fullMessage = trimmedMessage;
  const hasAuthorTrailer = /^\s*Authored-by:/im.test(fullMessage);
  const hasReviewerTrailer = /^\s*Reviewed-by:/im.test(fullMessage);

  const trailers: string[] = [];
  if (!hasAuthorTrailer && author) {
    trailers.push(`Authored-by: ${author}`);
  }
  if (!hasReviewerTrailer && reviewer) {
    trailers.push(`Reviewed-by: ${reviewer}`);
  }

  if (trailers.length > 0) {
    fullMessage = `${fullMessage}\n\n${trailers.join("\n")}\n`;
  }

  // 5. Commit using temp message file for safe cross-platform escaping
  const tempDir = mkdtempSync(join(tmpdir(), "lognexus-commit-"));
  const tempMsgFile = join(tempDir, "COMMIT_MSG.txt");
  writeFileSync(tempMsgFile, fullMessage, "utf8");

  try {
    const emptyFlag = options.allowEmpty ? "--allow-empty" : "";
    runGit(`commit -F "${tempMsgFile}" ${emptyFlag}`.trim(), cwd);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  // 6. Read commit metadata
  const sha = runGit("rev-parse HEAD", cwd);
  const shortSha = runGit("rev-parse --short HEAD", cwd);
  const subject = runGit("log -1 --format=%s HEAD", cwd);

  // 7. If finishTask requested, mark subtask completed
  let subtaskCompleted: string | null = null;
  if (options.finishTask && state.currentSubtask) {
    subtaskCompleted = state.currentSubtask.id;
    finishSubtask(subtaskCompleted, cwd);
  }

  // 8. Attach current state Git Note (with completed status preserved)
  attachCurrentStateToCommit("HEAD", { cwd });

  // 9. Passive telemetry hook (only active if user opted in)
  recordCommitTelemetry({
    sha,
    author,
    tier: state.activeIssue?.tier ?? "tier-3",
    targetDir: cwd,
  });

  return {
    sha,
    shortSha,
    subject,
    author,
    reviewer,
    subtaskCompleted,
    noteAttached: true,
  };
}
