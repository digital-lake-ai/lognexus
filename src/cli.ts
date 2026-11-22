#!/usr/bin/env node

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { auditBranch, formatAuditResult } from "./audit/audit.js";
import { executeAtomicCommit, type ParsedCommitArgs, parseCommitArgs } from "./commit.js";
import { runDiagnostics } from "./doctor.js";
import { startMcpServer } from "./mcp/server.js";
import { attachCurrentStateToCommit } from "./notes/attach.js";
import {
  exportNotesJsonl,
  fetchNotes,
  getNote,
  listNotes,
  pushNotes,
  searchNotesMemory,
} from "./notes/notes.js";
import { initProject } from "./scaffold.js";
import {
  generateContextHandoff,
  renderCompactDispatchPrompt,
  renderContextHandoff,
  writeContextHandoffFile,
} from "./state/handoff.js";
import {
  clearState,
  finishSubtask,
  loadState,
  type ParsedSetTaskArgs,
  parseSetTaskArgs,
  setSubtask,
} from "./state/manager.js";
import { syncStateFromGit } from "./state/sync.js";
import { getProjectStatus } from "./status.js";
import {
  aggregateBenchmarkCohort,
  exportTelemetrySnapshot,
  formatCohortMarkdownReport,
  generateCohortBenchmarkReportFile,
} from "./telemetry/benchmark.js";
import {
  buildAnonymousDiagnosticPayload,
  clearTelemetry,
  declineTelemetry,
  disableTelemetry,
  enableTelemetry,
  getTelemetryConsentState,
  isTelemetryGloballyDisabled,
  LOCAL_ONLY_TELEMETRY_ERROR,
  loadTelemetry,
  type ScopedTelemetryFilter,
  syncTelemetryFromGitNotes,
} from "./telemetry/collector.js";
import { isAgentEnvironment, maybePromptTelemetryConsent } from "./telemetry/consent-prompt.js";
import { generateTelemetryReportFile } from "./telemetry/report.js";
import { TELEMETRY_POLICY_VERSION } from "./telemetry/schema.js";
import { getJourneyTimeline } from "./timeline/timeline.js";
import {
  acceptTerms,
  checkUpdateGate,
  formatUpdateGateResult,
  readTermsConsent,
  UPGRADE_COMMAND,
} from "./update/gate.js";

function getCliDir(): string {
  return dirname(fileURLToPath(import.meta.url));
}

export { type ParsedCommitArgs, parseCommitArgs } from "./commit.js";

export function getCliVersion(): string {
  try {
    const pkgPath = join(getCliDir(), "..", "package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      if (pkg.version) return pkg.version;
    }
  } catch {
    // fallback
  }
  return "1.5.0";
}

function printHeader() {
  console.log("\n🔷 LogNexus CLI — Digital Lake");
  console.log("   The Universal Git-Powered Context & Rules Framework for Native AI Agents\n");
}

const STARTUP_GATE_EXEMPT_COMMANDS = new Set([
  "mcp",
  "terms",
  "version",
  "help",
  "--help",
  "-h",
  "--version",
  "-v",
]);

/**
 * Runs the non-interactive startup gate. The MCP transport is exempt because stdout
 * carries JSON-RPC frames there, and the gate is also skipped for `mcp`, `terms`,
 * `version`, and `help` aliases so an operator can always inspect or clear a block.
 */
function runStartupGate(command: string | undefined): void {
  if (command !== undefined && STARTUP_GATE_EXEMPT_COMMANDS.has(command)) return;

  const result = checkUpdateGate({ currentVersion: getCliVersion() });
  const notice = formatUpdateGateResult(result);

  if (result.blocked) {
    console.error(`${notice}\n`);
    process.exit(1);
  }

  if (notice !== "") {
    console.error(`${notice}\n`);
  }
}

async function handleTerms(args: string[]): Promise<void> {
  const accept = args.includes("--accept");
  printHeader();

  if (accept) {
    const termsVersion = readLocalTermsVersion();
    const consent = acceptTerms(termsVersion);
    console.log(`[OK] Terms '${consent.acceptedVersion}' accepted at ${consent.acceptedAt}.\n`);
    return;
  }

  const consent = readTermsConsent();
  const termsVersion = readLocalTermsVersion();
  const status = consent.acceptedVersion === termsVersion ? "Accepted" : "Pending";

  console.log("Legal Terms Status:\n");
  console.log(`  Terms Version:    ${termsVersion || "(not declared)"}`);
  console.log(`  Accepted Version: ${consent.acceptedVersion ?? "(none)"}`);
  console.log(`  Accepted At:      ${consent.acceptedAt ?? "(never)"}`);
  console.log(`  Consent Status:   ${status}`);
  console.log(`  Upgrade Command:  ${UPGRADE_COMMAND}\n`);
}

function readLocalTermsVersion(): string {
  try {
    const pkgPath = join(getCliDir(), "..", "package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      const version = pkg?.lognexusPolicy?.termsVersion;
      if (typeof version === "string") return version;
    }
  } catch {
    // fall through to the empty default
  }
  return "";
}

function printUsage() {
  printHeader();
  console.log(`Usage:
  lognexus <command> [subcommand] [options]

Commands:
  init         Scaffold .lognexus/ configuration and rules in current repository
               (--protect-tokens) also writes multi-model token-ignore files
               (--enable-telemetry | --no-telemetry | --disable-telemetry) set local telemetry choice
  doctor [--mcp]  Check Git, GitHub CLI, rules/policy health, and optional --mcp client configs
  status       Inspect current branch, active issue, and recommended tier
  commit       Atomic commit with trailers, contract validation, and Git Note
  state        Manage persistent agent state (.lognexus/state.json)
  note         Manage Git Notes under refs/notes/lognexus (git-ai standard)
  timeline     Reconstruct the branch Journey Timeline and draft a PR body
  audit        Audit commit conventions, authorship trailers and review gate
  handoff      Generate .lognexus/handoff.md with the full cycle context (--json)
  telemetry    Opt-in performance monitoring, stack profiler and ROI report
  mcp          Start the LogNexus MCP server (stdio JSON-RPC 2.0) for native AI agents
  terms        Inspect or accept the LogNexus legal terms (--accept, --status)
  version, -v  Display the version of LogNexus
  help, -h     Display this help message

Telemetry Subcommands:
  lognexus telemetry [status]       Show current telemetry mode and project metrics
  lognexus telemetry enable         Enable local telemetry (zero network calls, strictly local storage)
  lognexus telemetry report [-o f] [--issue <id>] [--since <iso>] [--branch <ref>]
                                    Generate .lognexus/telemetry.md report with ROI metrics
  lognexus telemetry inspect [--issue <id>] [--since <iso>] [--branch <ref>]
                                    Print the Zero-PII payload, optionally scoped
  lognexus telemetry snapshot [-o f] [--issue <id>] [--since <iso>] [--branch <ref>]
                                    Write a Zero-PII .lognexus/snapshot-v2.json, never uploaded
  lognexus telemetry benchmark <paths...> [-o f] [--json]
                                    Aggregate exported snapshots into a cohort benchmark
  lognexus telemetry disable        Disable all telemetry immediately
  lognexus telemetry clear          Reset local telemetry store

Commit Command:
  lognexus commit -m "<msg>" [options]
  lognexus commit -F <file> [options]
    -m, --message "<msg>"           Commit message (e.g. feat(#15/T1): add feature)
    -F, --file <file>               Read commit message from file
    --author "<identity>"           Author trailer (e.g. gemini/flash (antigravity))
    --reviewer "<identity>"         Optional reviewer trailer (e.g. gemini/pro)
    --finish-task                   Mark active subtask as completed in state
    --stage-allowed                 Stage only working-tree files inside the active contract
    --allow-empty                   Allow creating empty commits
    --tier <tier-1|tier-2|tier-3>   Override the routing tier (defaults to the author tier)
    --escalated                     Acknowledge a tier-1 author working on a tier-3 subtask
    --swarm-workers <n>             Number of active swarm workers cooperating on subtask
    --swarm-posts <n>               Total swarm board posts coordinated for subtask

State Subcommands:
  lognexus state [show]             Display current active issue and task state
  lognexus state sync               Sync state from current Git branch & GitHub
  lognexus state set-task <id> [t]  Set active subtask (e.g. lognexus state set-task T1 "Add schema")
                                    [--assignee "<identity>"] [--tier <tier-1|tier-2|tier-3>]
                                    [--isolation <subagent|swarm|worktree|branch|shared>]
                                    [--swarm-workers <n>] [--swarm-posts <n>]
                                    [--allowed <csv>] [--forbidden <csv>]
                                    [--budget <none|low|medium|high>] [--verify "<cmd>"]
  lognexus state finish-task <id>   Mark subtask as completed (e.g. lognexus state finish-task T1)
  lognexus state clear              Reset persistent state to empty

Note Subcommands:
  lognexus note [show] [commit]     Display LogNexus Git Note for commit (default: HEAD)
  lognexus note attach [commit]     Attach current session state as Git Note to commit
                                    [--swarm-workers <n>] [--swarm-posts <n>]
  lognexus note export [--since <ref>] [--issue <id>] [-o|--output <path>]
                                    Export Git Notes as local JSONL
  lognexus note list                List all commits with LogNexus Git Notes
  lognexus note search [query]      Recall past decisions stored in refs/notes/lognexus
                                    [--file <path>] [--author <model>] [--issue <num>]
                                    [--limit <n>] [--json] (strictly local, 0 network calls)
  lognexus note push [remote]       Push refs/notes/lognexus to remote (default: origin)
  lognexus note fetch [remote]      Fetch refs/notes/lognexus from remote

Timeline & Audit:
  lognexus timeline [base] [flags]  Print the Journey Timeline of the branch vs. base branch
    --json                          Emit the full JourneyTimelineResult JSON (no banner)
    --pr-body                       Emit the ready-to-use PR body draft
  lognexus audit [base]             Audit commit format, Authored-by trailer, Git Notes,
                                    subtask file contracts and reviewer separation
                                    (exits with code 1 on errors)

Context Handoff:
  lognexus handoff                  Write .lognexus/handoff.md and print the cycle handoff
    --json                          Emit the ContextHandoff JSON (no banner)
    --prompt                        Render the compact dispatch prompt for the next agent

MCP Server:
  lognexus mcp                      Start MCP server on stdio (JSON-RPC 2.0) for Claude Code,
                                    Cursor, VS Code, Antigravity or any MCP-compatible client
  Tools:     lognexus_status, lognexus_state_get, lognexus_state_sync, lognexus_state_set_task,
             lognexus_state_finish_task, lognexus_state_clear, lognexus_commit,
             lognexus_note_show, lognexus_note_attach, lognexus_timeline, lognexus_audit,
             lognexus_telemetry
  Resources: lognexus://state, lognexus://routing, lognexus://handoff
  Prompts:   lognexus-plan, lognexus-review

Examples:
  npx @digital-lake/lognexus init
  npx @digital-lake/lognexus state sync
  npx @digital-lake/lognexus note attach HEAD
  npx @digital-lake/lognexus note show HEAD
  npx @digital-lake/lognexus timeline main --pr-body
  npx @digital-lake/lognexus audit main
  npx @digital-lake/lognexus mcp
`);
}

async function handleInit(args: string[] = []) {
  printHeader();

  let protectTokens = false;
  let enableTelemetryFlag = false;
  let disableTelemetryFlag = false;

  for (const arg of args) {
    if (arg === "--protect-tokens") {
      protectTokens = true;
    } else if (arg === "--enable-telemetry") {
      enableTelemetryFlag = true;
    } else if (arg === "--no-telemetry" || arg === "--disable-telemetry") {
      disableTelemetryFlag = true;
    } else if (arg.startsWith("-")) {
      console.error(`[ERROR] Unknown init option: ${arg}\n`);
      printUsage();
      process.exit(1);
    }
  }

  if (enableTelemetryFlag && disableTelemetryFlag) {
    console.error(
      "[ERROR] Cannot combine --enable-telemetry with --no-telemetry or --disable-telemetry.\n",
    );
    process.exit(1);
  }

  console.log("Initializing LogNexus in current repository...\n");
  const cwd = process.cwd();
  const res = initProject(cwd, { protectTokens });

  if (res.created.length > 0) {
    console.log("Created files:");
    for (const f of res.created) {
      console.log(`  [+] ${f}`);
    }
  }

  if (res.skipped.length > 0) {
    console.log("Existing files (skipped):");
    for (const f of res.skipped) {
      console.log(`  [.] ${f}`);
    }
  }

  if (enableTelemetryFlag) {
    if (isAgentEnvironment()) {
      process.stderr.write(
        "Confirm telemetry opt-in from an interactive human terminal (automated agent sealing is disabled).\n",
      );
    } else {
      enableTelemetry({ cwd, acceptTerms: true });
    }
  } else if (disableTelemetryFlag) {
    declineTelemetry(cwd);
  } else {
    await maybePromptTelemetryConsent({
      command: "init",
      args,
      targetDir: cwd,
    });
  }

  console.log("\nNext Steps:");
  console.log("  • Claude Code / Cursor / Codex / Antigravity / Gemini / Kimi: use /lognexus plan");
  console.log("  • Configure model tiers in .lognexus/routing.md");
  console.log(
    "  • Tip: install locally with 'npm i -D @digital-lake/lognexus' for instant execution (~0.15s)",
  );
  console.log("  • Verify environment anytime with: npx @digital-lake/lognexus doctor\n");
  if (!protectTokens) {
    console.log(
      "  • Optional: re-run with --protect-tokens to ignore bulky lockfiles & vendor dirs in every AI client\n",
    );
  }
}

async function handleDoctor(args: string[] = []) {
  let mcp = false;

  for (const arg of args) {
    if (arg === "--mcp") {
      mcp = true;
    } else if (arg.startsWith("-")) {
      console.error(`[ERROR] Unknown doctor option: ${arg}\n`);
      printUsage();
      process.exitCode = 1;
      return;
    }
  }

  printHeader();
  console.log("Running diagnostics...\n");
  const checks = runDiagnostics(process.cwd(), { mcp });

  for (const c of checks) {
    const tag = c.status === "pass" ? "[PASS]" : c.status === "warn" ? "[WARN]" : "[FAIL]";
    console.log(`${tag} ${c.name}: ${c.message}`);
  }

  console.log("\nDiagnostic complete.\n");

  if (mcp && checks.some((check) => check.status === "fail")) {
    process.exitCode = 1;
  }
}

export async function handleStatus(targetDir: string = process.cwd()) {
  printHeader();
  const st = getProjectStatus(targetDir);

  console.log(`Git Repository:     ${st.isInsideGit ? "Yes" : "No"}`);
  console.log(`Current Branch:     ${st.branch}`);
  console.log(
    `Project Version:    ${st.projectVersion ? `${st.projectVersion} (${st.publishedReleases} release(s) published)` : "(no manifest detected)"}`,
  );
  console.log(`Active Issue:       ${st.activeIssue ?? "(none — on base branch)"}`);
  console.log(`Rules Routing Mode: ${st.routingMode}`);
  console.log(`Ecosystem Profile:  ${st.ecosystemProfile}`);
  console.log(`Review Gate Mode:   ${st.reviewGateMode}`);
  console.log(`Recommended Tier:   ${st.recommendedTier}`);
  if (st.scopeDrift.detected) {
    console.log(
      `Scope Drift:        [SCOPE DRIFT DETECTED] ${st.scopeDrift.unauthorizedFiles.join(", ")}`,
    );
  } else if (st.scopeDrift.allowedFiles.length > 0) {
    console.log(
      `Scope Drift:        [PASS] (${st.scopeDrift.allowedFiles.length} allowed file(s))`,
    );
  }
  console.log("");
}

export async function handleState(args: string[], targetDir: string = process.cwd()) {
  const sub = args[0]?.toLowerCase() || "show";

  switch (sub) {
    case "show": {
      printHeader();
      const state = loadState(targetDir);
      console.log("Persistent Agent State (.lognexus/state.json):\n");

      if (state.activeIssue) {
        console.log(`Active Issue:      #${state.activeIssue.id} — ${state.activeIssue.title}`);
        console.log(`Branch:            ${state.activeIssue.branch}`);
        console.log(`Phase:             ${state.activeIssue.phase}`);
        console.log(`Tier:              ${state.activeIssue.tier}`);
        console.log(`Readiness:         ${state.activeIssue.readiness}`);
      } else {
        console.log("Active Issue:      (none)");
      }

      console.log("");
      if (state.currentSubtask) {
        console.log(
          `Current Subtask:   ${state.currentSubtask.id} (${state.currentSubtask.status})`,
        );
        if (state.currentSubtask.title) {
          console.log(`  Title:           ${state.currentSubtask.title}`);
        }
        if (state.currentSubtask.contract) {
          if (state.currentSubtask.contract.assignee) {
            console.log(`  Assigned Agent:  ${state.currentSubtask.contract.assignee}`);
          }
          if (state.currentSubtask.contract.isolation) {
            console.log(`  Isolation Mode:  ${state.currentSubtask.contract.isolation}`);
          }
          if (
            state.currentSubtask.contract.swarmWorkers !== undefined ||
            state.currentSubtask.contract.swarmPosts !== undefined
          ) {
            console.log(
              `  Swarm Metrics:   ${state.currentSubtask.contract.swarmWorkers ?? 0} worker(s), ${state.currentSubtask.contract.swarmPosts ?? 0} post(s)`,
            );
          }
          console.log(
            `  Allowed Files:   ${state.currentSubtask.contract.allowedFiles.join(", ") || "(all)"}`,
          );
          console.log(`  Decision Budget: ${state.currentSubtask.contract.decisionBudget}`);
          if (state.currentSubtask.contract.verificationCmd) {
            console.log(`  Verify Command:  ${state.currentSubtask.contract.verificationCmd}`);
          }
        }
      } else {
        console.log("Current Subtask:   (none)");
      }

      console.log(
        `Completed Tasks:   ${state.completedSubtasks.length > 0 ? state.completedSubtasks.join(", ") : "(none)"}`,
      );
      console.log(`Last Synchronized: ${state.lastSync}\n`);
      break;
    }

    case "sync": {
      printHeader();
      console.log("Synchronizing state from current Git branch and GitHub...\n");
      const synced = syncStateFromGit(targetDir);
      if (synced.activeIssue) {
        console.log(
          `[OK] Synchronized with Issue #${synced.activeIssue.id} (${synced.activeIssue.title})`,
        );
        console.log(`     Branch: ${synced.activeIssue.branch}`);
      } else {
        console.log("[OK] Synchronized. No active issue detected on current branch.");
      }
      console.log("");
      break;
    }

    case "set-task": {
      if (!args[1]) {
        console.error(
          "Error: Subtask ID is required (e.g. lognexus state set-task T1 'Add schema')\n",
        );
        process.exit(1);
      }
      let parsed: ParsedSetTaskArgs;
      try {
        parsed = parseSetTaskArgs(args.slice(1));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${msg}\n`);
        process.exit(1);
      }
      printHeader();
      setSubtask(parsed.taskId, parsed.title, parsed.contract, targetDir, { tier: parsed.tier });
      console.log(
        `[OK] Active subtask set to: ${parsed.taskId}${parsed.title ? ` — ${parsed.title}` : ""}\n`,
      );
      break;
    }

    case "finish-task": {
      const taskId = args[1];
      if (!taskId) {
        console.error("Error: Subtask ID is required (e.g. lognexus state finish-task T1)\n");
        process.exit(1);
      }
      printHeader();
      finishSubtask(taskId, targetDir);
      console.log(`[OK] Subtask ${taskId} marked as completed.\n`);
      break;
    }

    case "clear": {
      printHeader();
      clearState(targetDir);
      console.log("[OK] Persistent state cleared.\n");
      break;
    }

    default:
      console.error(`Unknown state subcommand: ${sub}\n`);
      printUsage();
      process.exit(1);
  }
}

async function handleNote(args: string[]) {
  const sub = args[0]?.toLowerCase() || "show";

  switch (sub) {
    case "show": {
      const commit = args[1] || "HEAD";
      printHeader();
      const note = getNote(commit);
      if (note) {
        console.log(`Git Note for commit [${commit}] (refs/notes/lognexus):\n`);
        console.log(note);
      } else {
        console.log(`No LogNexus note found attached to commit [${commit}].`);
        console.log("Tip: Run 'lognexus note attach' to attach current state to this commit.");
      }
      console.log("");
      break;
    }

    case "attach": {
      let commit = "HEAD";
      let swarmWorkers: number | undefined;
      let swarmPosts: number | undefined;
      for (let i = 1; i < args.length; i++) {
        const arg = args[i];
        if (arg === "--swarm-workers") {
          const val = args[++i];
          if (!val || !/^\d+$/.test(val)) {
            console.error("Error: --swarm-workers must be a non-negative integer.\n");
            process.exit(1);
          }
          swarmWorkers = Number.parseInt(val, 10);
        } else if (arg === "--swarm-posts") {
          const val = args[++i];
          if (!val || !/^\d+$/.test(val)) {
            console.error("Error: --swarm-posts must be a non-negative integer.\n");
            process.exit(1);
          }
          swarmPosts = Number.parseInt(val, 10);
        } else if (arg.startsWith("-")) {
          console.error(`Unknown option for note attach: ${arg}\n`);
          printUsage();
          process.exit(1);
        } else {
          commit = arg;
        }
      }

      printHeader();
      const payload = attachCurrentStateToCommit(commit, { swarmWorkers, swarmPosts });
      console.log(`[OK] Attached LogNexus note to commit [${commit}] (refs/notes/lognexus):`);
      console.log(
        `     Issue:   ${payload.issue ? `#${payload.issue.id} — ${payload.issue.title}` : "(none)"}`,
      );
      console.log(
        `     Subtask: ${payload.subtask ? `${payload.subtask.id} (${payload.subtask.title})` : "(none)"}`,
      );
      console.log(`     Tier:    ${payload.tier}\n`);
      break;
    }

    case "list": {
      printHeader();
      const notes = listNotes();
      console.log(`LogNexus Notes (refs/notes/lognexus) — ${notes.length} note(s):\n`);
      if (notes.length === 0) {
        console.log("No notes recorded yet.");
      } else {
        for (const n of notes) {
          console.log(`  • Commit: ${n.commitSha} (blob: ${n.noteBlob})`);
        }
      }
      console.log("");
      break;
    }

    case "search": {
      const positional: string[] = [];
      let file: string | undefined;
      let author: string | undefined;
      let issue: number | undefined;
      let limit: number | undefined;
      let asJson = false;

      for (let index = 1; index < args.length; index += 1) {
        const arg = args[index];
        switch (arg) {
          case "--json":
            asJson = true;
            break;
          case "--file":
          case "--author":
          case "--issue":
          case "--limit": {
            const value = args[index + 1];
            if (value === undefined || value.startsWith("--")) {
              console.error(`Missing value for '${arg}'.\n`);
              process.exit(1);
            }
            if (arg === "--file") file = value;
            else if (arg === "--author") author = value;
            else if (arg === "--issue") {
              const parsed = Number.parseInt(value, 10);
              if (Number.isNaN(parsed)) {
                console.error(`Invalid --issue value '${value}': expected a number.\n`);
                process.exit(1);
              }
              issue = parsed;
            } else {
              const parsed = Number.parseInt(value, 10);
              if (Number.isNaN(parsed) || parsed <= 0) {
                console.error(`Invalid --limit value '${value}': expected a positive number.\n`);
                process.exit(1);
              }
              limit = parsed;
            }
            index += 1;
            break;
          }
          default:
            if (arg.startsWith("--")) {
              console.error(`Unknown option for note search: ${arg}\n`);
              printUsage();
              process.exit(1);
            }
            positional.push(arg);
        }
      }

      const query = positional.join(" ").trim();
      const results = searchNotesMemory(process.cwd(), { query, file, author, issue, limit });

      if (asJson) {
        console.log(JSON.stringify(results, null, 2));
        break;
      }

      printHeader();
      const filterSummary = [
        query !== "" ? `query="${query}"` : null,
        file ? `file=${file}` : null,
        author ? `author=${author}` : null,
        issue !== undefined ? `issue=#${issue}` : null,
      ].filter((part): part is string => part !== null);

      console.log(
        `Memory Recall (refs/notes/lognexus) — ${results.length} match(es)${
          filterSummary.length > 0 ? ` for ${filterSummary.join(", ")}` : ""
        }:\n`,
      );

      if (results.length === 0) {
        console.log("No LogNexus note matches this filter.");
        console.log("Tip: run 'lognexus note list' to inspect every recorded note.\n");
        break;
      }

      for (const result of results) {
        console.log(`  • [${result.shortSha}] ${result.subject}`);
        const provenance = [
          result.issueId !== null ? `issue #${result.issueId}` : null,
          result.subtaskId ?? null,
          result.tier,
          result.author !== "" ? `by ${result.author}` : null,
        ].filter((part): part is string => part !== null);
        if (provenance.length > 0) {
          console.log(`      ${provenance.join(" · ")}`);
        }
        if (result.subtaskTitle) {
          console.log(`      ${result.subtaskTitle}`);
        }
        if (result.files.length > 0) {
          const shown = result.files.slice(0, 5).join(", ");
          const extra = result.files.length > 5 ? ` (+${result.files.length - 5} more)` : "";
          console.log(`      files: ${shown}${extra}`);
        }
      }
      console.log("");
      break;
    }

    case "push": {
      const remote = args[1] || "origin";
      printHeader();
      console.log(`Pushing refs/notes/lognexus to ${remote}...`);
      const ok = pushNotes(remote);
      if (ok) {
        console.log(`[OK] Notes pushed to ${remote} successfully.\n`);
      } else {
        console.error(`[FAIL] Could not push notes to ${remote}.\n`);
      }
      break;
    }

    case "fetch": {
      const remote = args[1] || "origin";
      printHeader();
      console.log(`Fetching refs/notes/lognexus from ${remote}...`);
      const ok = fetchNotes(remote);
      if (ok) {
        console.log(`[OK] Notes fetched from ${remote} successfully.\n`);
      } else {
        console.error(`[FAIL] Could not fetch notes from ${remote}.\n`);
      }
      break;
    }

    case "export": {
      let since: string | undefined;
      let issue: string | undefined;
      let outputPath: string | undefined;

      for (let i = 1; i < args.length; i += 1) {
        const arg = args[i];
        if (arg === "--help" || arg === "-h") {
          printUsage();
          return;
        }
        if (arg === "--since" || arg === "--issue" || arg === "-o" || arg === "--output") {
          const val = args[i + 1];
          if (val === undefined || val.startsWith("-")) {
            console.error(`Missing value for '${arg}'.\n`);
            printUsage();
            process.exitCode = 1;
            return;
          }
          if (arg === "--since") since = val;
          else if (arg === "--issue") issue = val;
          else outputPath = val;
          i += 1;
        } else if (arg.startsWith("-")) {
          console.error(`[ERROR] Unknown note export option: ${arg}\n`);
          printUsage();
          process.exitCode = 1;
          return;
        } else {
          console.error(`[ERROR] Unknown argument for note export: ${arg}\n`);
          printUsage();
          process.exitCode = 1;
          return;
        }
      }

      try {
        const result = exportNotesJsonl(process.cwd(), { since, issue, outputPath });
        if (outputPath) {
          console.log(`[OK] Exported ${result.count} Git Note(s) to ${outputPath}\n`);
        } else {
          process.stdout.write(result.jsonl);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[ERROR] Note export failed: ${msg}\n`);
        process.exitCode = 1;
        return;
      }
      break;
    }

    default:
      console.error(`Unknown note subcommand: ${sub}\n`);
      printUsage();
      process.exit(1);
  }
}

async function handleHandoff(args: string[]) {
  const flags = args.filter((arg) => arg.startsWith("-"));
  const known = ["--json", "--prompt", "--compact-prompt"];
  const unknown = flags.filter((flag) => !known.includes(flag));
  if (unknown.length > 0) {
    console.error(`Unknown option(s) for handoff: ${unknown.join(", ")}\n`);
    printUsage();
    process.exit(1);
  }

  if (flags.includes("--prompt") || flags.includes("--compact-prompt")) {
    const handoff = writeContextHandoffFile();
    console.log(renderCompactDispatchPrompt(handoff));
    return;
  }

  const asJson = flags.includes("--json");
  if (asJson) {
    const handoff = generateContextHandoff();
    writeContextHandoffFile();
    console.log(JSON.stringify(handoff, null, 2));
    return;
  }

  const handoff = writeContextHandoffFile();
  printHeader();
  console.log(renderContextHandoff(handoff));
}

async function handleTimeline(args: string[]) {
  const flags = args.filter((arg) => arg.startsWith("-"));
  const positional = args.filter((arg) => !arg.startsWith("-"));
  const baseBranch = positional[0] || "main";

  const known = ["--json", "--pr-body"];
  const unknown = flags.filter((flag) => !known.includes(flag));
  if (unknown.length > 0) {
    console.error(`Unknown option(s) for timeline: ${unknown.join(", ")}\n`);
    printUsage();
    process.exit(1);
  }

  const asJson = flags.includes("--json");
  const asPrBody = flags.includes("--pr-body");
  const timeline = getJourneyTimeline(baseBranch);

  // --json / --pr-body are machine-consumable: keep stdout free of banners.
  if (asJson) {
    console.log(JSON.stringify(timeline, null, 2));
    return;
  }
  if (asPrBody) {
    console.log(timeline.prBodyDraft);
    return;
  }

  printHeader();
  console.log(`Branch:      ${timeline.branch}`);
  console.log(`Base Branch: ${timeline.baseBranch}`);
  console.log(`Commits:     ${timeline.commitCount}\n`);

  if (timeline.commitCount === 0) {
    console.log("No commits ahead of the base branch.\n");
    return;
  }

  console.log(timeline.markdownTable);
  console.log("");
}

async function handleAudit(args: string[]) {
  const baseBranch = args.find((arg) => !arg.startsWith("-")) || "main";
  const result = auditBranch(baseBranch);

  printHeader();
  console.log(`Auditing ${result.commitCount} commit(s) against base branch '${baseBranch}'...\n`);

  if (result.passed && result.violations.length === 0) {
    console.log(`${formatAuditResult(result)}\n`);
    return;
  }

  for (const violation of result.violations) {
    const tag = violation.severity === "error" ? "[ERROR]" : "[WARN] ";
    console.log(`${tag} ${violation.shortSha} ${violation.rule}: ${violation.message}`);
  }

  console.log(
    `\n${result.summary.errors} error(s), ${result.summary.warnings} warning(s) — ${result.passed ? "[PASS] No blocking violations" : "[FAIL] Review gate blocked"}\n`,
  );

  if (!result.passed) {
    process.exit(1);
  }
}

async function handleCommit(args: string[]) {
  let parsed: ParsedCommitArgs;
  try {
    parsed = parseCommitArgs(args);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${msg}\n`);
    printUsage();
    process.exit(1);
  }

  if (!parsed.message) {
    console.error(
      "Error: Commit message is required (e.g. lognexus commit -m 'feat(#15/T1): add feature' or -F <file>)\n",
    );
    printUsage();
    process.exit(1);
  }

  printHeader();
  try {
    const res = executeAtomicCommit({
      message: parsed.message,
      author: parsed.author,
      reviewer: parsed.reviewer,
      finishTask: parsed.finishTask,
      allowEmpty: parsed.allowEmpty,
      tier: parsed.tier,
      escalated: parsed.escalated,
      stageAllowed: parsed.stageAllowed,
      swarmWorkers: parsed.swarmWorkers,
      swarmPosts: parsed.swarmPosts,
    });

    console.log(`[OK] Committed [${res.shortSha}] ${res.subject}`);
    console.log(`     Authored-by: ${res.author}`);
    if (res.reviewer) {
      console.log(`     Reviewed-by: ${res.reviewer}`);
    }
    if (res.subtaskCompleted) {
      console.log(`     Subtask:     ${res.subtaskCompleted} (marked completed)`);
    }
    console.log("     Git Note:    Attached to HEAD (refs/notes/lognexus)\n");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[FAIL] Commit failed: ${msg}\n`);
    process.exit(1);
  }
}

interface ParsedTelemetryFlags {
  filter: ScopedTelemetryFilter;
  outputPath?: string;
  positionals: string[];
  json: boolean;
}

/**
 * Parses the scoping flags shared by `telemetry inspect`, `report` and `snapshot`.
 *
 * A missing flag value or an unrecognised `-` prefixed argument aborts instead of being
 * silently ignored, so a scoped command can never fall back to the whole history unnoticed.
 */
function parseTelemetryScopeFlags(args: string[], allowPositionals = false): ParsedTelemetryFlags {
  const filter: ScopedTelemetryFilter = {};
  const positionals: string[] = [];
  let outputPath: string | undefined;
  let json = false;

  const readValue = (flag: string, index: number): string => {
    const value = args[index + 1];
    if (value === undefined || value.startsWith("-") || value.trim() === "") {
      console.error(`[FAIL] ${flag} requires a value.\n`);
      process.exit(1);
    }
    return value;
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--issue") {
      filter.issue = readValue("--issue", index);
      index += 1;
    } else if (arg === "--since") {
      filter.since = readValue("--since", index);
      index += 1;
    } else if (arg === "--branch") {
      filter.branch = readValue("--branch", index);
      index += 1;
    } else if (arg === "--output" || arg === "-o") {
      outputPath = readValue(arg, index);
      index += 1;
    } else if (arg === "--json") {
      json = true;
    } else if (arg.startsWith("-")) {
      console.error(`[FAIL] Unknown telemetry flag: ${arg}\n`);
      process.exit(1);
    } else if (allowPositionals) {
      positionals.push(arg);
    } else {
      console.error(`[FAIL] Unexpected telemetry argument: ${arg}\n`);
      process.exit(1);
    }
  }

  return { filter, outputPath, positionals, json };
}

function hasFilterScope(filter: ScopedTelemetryFilter): boolean {
  return filter.issue !== undefined || filter.since !== undefined || filter.branch !== undefined;
}

async function handleTelemetry(args: string[]) {
  const sub = args[0]?.toLowerCase() || "status";

  switch (sub) {
    case "status": {
      printHeader();
      const cwd = process.cwd();
      const store = loadTelemetry(cwd);
      const consentState = getTelemetryConsentState(cwd);
      const globallyDisabled = isTelemetryGloballyDisabled();

      let consentLabel: string;
      switch (consentState) {
        case "accepted":
          consentLabel = `Accepted (v${TELEMETRY_POLICY_VERSION} — Local Only)`;
          break;
        case "declined":
          consentLabel = `Declined (v${TELEMETRY_POLICY_VERSION})`;
          break;
        case "outdated":
          consentLabel = `Paused — Re-consent Required (v${store.consent.policyVersion} -> v${TELEMETRY_POLICY_VERSION})`;
          break;
        default:
          consentLabel = "Unanswered (Off)";
          break;
      }

      console.log("LogNexus Telemetry Status:\n");
      console.log(
        `  Globally Disabled (DO_NOT_TRACK): ${globallyDisabled ? "Yes (Forced OFF)" : "No"}`,
      );
      console.log(`  Operating Mode:                   ${store.mode.toUpperCase()}`);
      console.log(`  Anonymous Project ID:             ${store.anonymousProjectId}`);
      console.log(`  Policy Consent:                   ${consentLabel}`);
      if (store.consent.acceptedAt) {
        console.log(`  Consent Recorded At:              ${store.consent.acceptedAt}`);
      }
      if (store.consent.declinedAt) {
        console.log(`  Consent Declined At:              ${store.consent.declinedAt}`);
      }
      console.log(
        `  Detected Stacks:                  ${store.detectedStacks.join(", ") || "(none)"}`,
      );
      console.log(`  Total Commits Monitored:          ${store.summary.totalCommits}`);
      if (store.summary.swarmCommits > 0) {
        console.log(
          `  Swarm Commits:                    ${store.summary.swarmCommits} (${store.summary.totalSwarmPosts} board posts, peak ${store.summary.maxSwarmWorkers} workers)`,
        );
      }
      console.log(
        `  Estimated Cost Savings:           ${store.summary.estimatedCostSavingsPct}%\n`,
      );
      break;
    }

    case "enable": {
      printHeader();
      const share = args.includes("--share");
      const acceptTerms = args.includes("--accept-terms");

      if (share || acceptTerms) {
        console.error(`[FAIL] ${LOCAL_ONLY_TELEMETRY_ERROR}\n`);
        process.exit(1);
      }

      if (isAgentEnvironment()) {
        process.stderr.write(
          "Confirm telemetry opt-in from an interactive human terminal (automated agent sealing is disabled).\n",
        );
        process.exit(1);
      }

      try {
        enableTelemetry({ cwd: process.cwd(), acceptTerms: true });
        console.log("[OK] Telemetry enabled in LOCAL mode.");
        console.log("     Metrics are stored strictly locally in .lognexus/telemetry.json.");
        console.log(
          "     Zero network calls are made. Run 'lognexus telemetry report' to generate a report.\n",
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[FAIL] ${msg}\n`);
        process.exit(1);
      }
      break;
    }

    case "disable": {
      printHeader();
      disableTelemetry();
      console.log("[OK] Telemetry disabled. Zero metrics will be recorded or transmitted.\n");
      break;
    }

    case "inspect": {
      printHeader();
      const { filter } = parseTelemetryScopeFlags(args.slice(1));
      const store = hasFilterScope(filter)
        ? syncTelemetryFromGitNotes(process.cwd(), filter)
        : loadTelemetry();
      const payload = buildAnonymousDiagnosticPayload(store, filter);
      if (hasFilterScope(filter)) {
        const scope = [
          filter.issue === undefined ? null : `issue=${String(filter.issue)}`,
          filter.since === undefined ? null : `since=${filter.since}`,
          filter.branch === undefined ? null : `branch=${filter.branch}`,
        ]
          .filter((part): part is string => part !== null)
          .join(", ");
        console.log(`Scoped view (in-memory only, the store is not rewritten): ${scope}\n`);
      }
      console.log("Anonymous Telemetry Payload (Zero-PII Audit):\n");
      console.log(JSON.stringify(payload, null, 2));
      console.log(
        "\nNote: No code, file paths, file names, commit messages, or identities are included.\n",
      );
      break;
    }

    case "report": {
      printHeader();
      const { filter, outputPath } = parseTelemetryScopeFlags(args.slice(1));
      const res = generateTelemetryReportFile(process.cwd(), outputPath, filter);
      console.log("[OK] Telemetry & ROI Performance Report generated:");
      console.log(`     Output file: ${res.filePath}`);
      console.log(
        "     Sharing is opt-in: nothing is uploaded. Review the file, then publish it yourself with",
      );
      console.log("     'gh issue create --template diagnostic-report.yml --body-file <file>'.\n");
      console.log(res.content);
      break;
    }

    case "snapshot": {
      printHeader();
      const { filter, outputPath } = parseTelemetryScopeFlags(args.slice(1));
      try {
        const res = exportTelemetrySnapshot(process.cwd(), outputPath, filter);
        console.log("[OK] Zero-PII diagnostic snapshot exported:");
        console.log(`     Output file: ${res.filePath}`);
        console.log(`     Anonymous Project ID: ${res.payload.anonymousProjectId}`);
        console.log(`     Schema version: ${res.payload.schemaVersion}`);
        console.log("     Scope contains no code, paths, remotes or identities.");
        console.log(
          "     Nothing was uploaded. Share the file yourself, or aggregate it with 'lognexus telemetry benchmark'.\n",
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[FAIL] Snapshot export aborted: ${msg}\n`);
        process.exit(1);
      }
      break;
    }

    case "benchmark": {
      const { outputPath, positionals, json } = parseTelemetryScopeFlags(args.slice(1), true);
      if (positionals.length === 0) {
        console.error(
          "[FAIL] telemetry benchmark requires at least one snapshot file or directory.\n",
        );
        console.error(
          "       Run 'lognexus telemetry snapshot' first, then pass its output path.\n",
        );
        process.exit(1);
      }

      try {
        if (outputPath !== undefined) {
          const res = generateCohortBenchmarkReportFile(positionals, outputPath, process.cwd());
          console.log("[OK] Cohort benchmark report generated:");
          console.log(`     Output file: ${res.filePath}`);
          console.log(`     Projects aggregated: ${res.cohort.cohortSize}`);
          console.log(`     Commits aggregated:  ${res.cohort.totals.commits}\n`);
          if (json) console.log(JSON.stringify(res.cohort, null, 2));
          break;
        }

        const cohort = aggregateBenchmarkCohort(positionals, process.cwd());
        if (json) {
          console.log(JSON.stringify(cohort, null, 2));
        } else {
          printHeader();
          console.log(formatCohortMarkdownReport(cohort));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[FAIL] Cohort benchmark aborted: ${msg}\n`);
        process.exit(1);
      }
      break;
    }

    case "clear": {
      printHeader();
      clearTelemetry();
      console.log("[OK] Local telemetry store cleared and reset.\n");
      break;
    }

    default:
      console.error(`Unknown telemetry subcommand: ${sub}\n`);
      printUsage();
      process.exit(1);
  }
}

const VALUE_TAKING_FLAGS = new Set([
  "-m",
  "--message",
  "-F",
  "--file",
  "--author",
  "--reviewer",
  "--title",
  "--allowed",
  "--forbidden",
  "--budget",
  "--verify",
  "-o",
  "--output",
  "--issue",
  "--since",
  "--branch",
  "--tier",
  "--isolation",
  "--assignee",
  "--swarm-workers",
  "--swarm-posts",
  "--limit",
]);

/**
 * Detects standalone `--help` / `-h` flags linearly while skipping values consumed
 * by value-taking flags (so `commit -m "--help"` is treated as a commit message)
 * and stopping at the `--` end-of-options marker.
 */
export function hasStandaloneHelpFlag(args: readonly string[]): boolean {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--") {
      return false;
    }
    if (arg === "--help" || arg === "-h") {
      return true;
    }
    if (VALUE_TAKING_FLAGS.has(arg)) {
      i += 1;
    }
  }
  return false;
}

export async function main(args: string[] = process.argv.slice(2)): Promise<number> {
  const command = args[0]?.toLowerCase();

  if (command !== "mcp" && hasStandaloneHelpFlag(args)) {
    printUsage();
    return 0;
  }

  runStartupGate(command);

  switch (command) {
    case "commit":
      await handleCommit(args.slice(1));
      break;
    case "telemetry":
      await handleTelemetry(args.slice(1));
      break;
    case "init":
      await handleInit(args.slice(1));
      break;
    case "doctor":
      await maybePromptTelemetryConsent({
        command,
        args: args.slice(1),
        targetDir: process.cwd(),
      });
      await handleDoctor(args.slice(1));
      break;
    case "status":
      await maybePromptTelemetryConsent({
        command,
        args: args.slice(1),
        targetDir: process.cwd(),
      });
      await handleStatus();
      break;
    case "state":
      await handleState(args.slice(1));
      break;
    case "note":
      await handleNote(args.slice(1));
      break;
    case "timeline":
      await handleTimeline(args.slice(1));
      break;
    case "audit":
      await handleAudit(args.slice(1));
      break;
    case "handoff":
      await handleHandoff(args.slice(1));
      break;
    case "terms":
      await handleTerms(args.slice(1));
      break;
    case "mcp":
      // stdout is reserved for JSON-RPC frames: never print the banner here.
      await startMcpServer();
      break;
    case "version":
    case "--version":
    case "-v":
      console.log(getCliVersion());
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printUsage();
      break;
    default:
      console.error(`Unknown command: ${command}\n`);
      printUsage();
      process.exit(1);
  }

  return 0;
}

/**
 * True only when this module is the process entrypoint.
 *
 * Importing `src/cli.ts` (from `src/index.ts`, Vitest or a third-party library) must
 * not run `main()`: spawning the sync so pulls in npm, git and filesystem side effects.
 */
export function isDirectCliExecution(argv1: string | undefined = process.argv[1]): boolean {
  if (!argv1) return false;

  try {
    if (realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(argv1))) {
      return true;
    }
  } catch {
    // Unresolvable path (virtual FS, deleted shim): fall through to the name heuristic.
  }

  return /(?:^|[\\/])(?:cli\.[cm]?[jt]s|lognexus(?:\.cmd|\.ps1|\.exe)?)$/i.test(argv1);
}

if (isDirectCliExecution()) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
