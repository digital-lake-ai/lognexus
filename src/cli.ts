#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { auditBranch, formatAuditResult } from "./audit/audit.js";
import { executeAtomicCommit, type ParsedCommitArgs, parseCommitArgs } from "./commit.js";
import { runDiagnostics } from "./doctor.js";
import { startMcpServer } from "./mcp/server.js";
import { attachCurrentStateToCommit } from "./notes/attach.js";
import { fetchNotes, getNote, listNotes, pushNotes } from "./notes/notes.js";
import { initProject } from "./scaffold.js";
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
  buildAnonymousCommunityPayload,
  clearTelemetry,
  disableTelemetry,
  enableTelemetry,
  isTelemetryGloballyDisabled,
  loadTelemetry,
} from "./telemetry/collector.js";
import { generateTelemetryReportFile } from "./telemetry/report.js";
import { getJourneyTimeline } from "./timeline/timeline.js";

const __cliDir = dirname(fileURLToPath(import.meta.url));

export { type ParsedCommitArgs, parseCommitArgs } from "./commit.js";

export function getCliVersion(): string {
  try {
    const pkgPath = join(__cliDir, "..", "package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      if (pkg.version) return pkg.version;
    }
  } catch {
    // fallback
  }
  return "1.2.4";
}

function printHeader() {
  console.log("\n🔷 LogNexus CLI — Digital Lake");
  console.log("   The Universal Git-Powered Context & Rules Framework for Native AI Agents\n");
}

function printUsage() {
  printHeader();
  console.log(`Usage:
  lognexus <command> [subcommand] [options]

Commands:
  init         Scaffold .lognexus/ configuration and rules in current repository
  doctor       Check Git, GitHub CLI authentication, and repository rules health
  status       Inspect current branch, active issue, and recommended tier
  commit       Atomic commit with trailers, contract validation, and Git Note
  state        Manage persistent agent state (.lognexus/state.json)
  note         Manage Git Notes under refs/notes/lognexus (git-ai standard)
  timeline     Reconstruct the branch Journey Timeline and draft a PR body
  audit        Audit commit conventions, authorship trailers and review gate
  telemetry    Opt-in performance monitoring, stack profiler and ROI report
  mcp          Start the LogNexus MCP server (stdio JSON-RPC 2.0) for native AI agents
  version, -v  Display the version of LogNexus
  help, -h     Display this help message

Telemetry Subcommands:
  lognexus telemetry [status]       Show current telemetry mode and project metrics
  lognexus telemetry enable         Enable local telemetry (zero network calls)
  lognexus telemetry enable --share --accept-terms
                                    Enable anonymous community telemetry (GDPR opt-in)
  lognexus telemetry inspect        Inspect the exact Zero-PII payload before sending
  lognexus telemetry report [-o f]  Generate .lognexus/telemetry.md report with ROI metrics
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
    --allow-empty                   Allow creating empty commits
    --tier <tier-1|tier-2|tier-3>   Override the routing tier (defaults to the author tier)
    --escalated                     Acknowledge a tier-1 author working on a tier-3 subtask

State Subcommands:
  lognexus state [show]             Display current active issue and task state
  lognexus state sync               Sync state from current Git branch & GitHub
  lognexus state set-task <id> [t]  Set active subtask (e.g. lognexus state set-task T1 "Add schema")
  lognexus state finish-task <id>   Mark subtask as completed (e.g. lognexus state finish-task T1)
  lognexus state clear              Reset persistent state to empty

Note Subcommands:
  lognexus note [show] [commit]     Display LogNexus Git Note for commit (default: HEAD)
  lognexus note attach [commit]     Attach current session state as Git Note to commit
  lognexus note list                List all commits with LogNexus Git Notes
  lognexus note push [remote]       Push refs/notes/lognexus to remote (default: origin)
  lognexus note fetch [remote]      Fetch refs/notes/lognexus from remote

Timeline & Audit:
  lognexus timeline [base] [flags]  Print the Journey Timeline of the branch vs. base branch
    --json                          Emit the full JourneyTimelineResult JSON (no banner)
    --pr-body                       Emit the ready-to-use PR body draft
  lognexus audit [base]             Audit commit format, Authored-by trailer, Git Notes,
                                    subtask file contracts and reviewer separation
                                    (exits with code 1 on errors)

MCP Server:
  lognexus mcp                      Start MCP server on stdio (JSON-RPC 2.0) for Claude Code,
                                    Cursor, VS Code, Antigravity or any MCP-compatible client
  Tools:     lognexus_status, lognexus_state_get, lognexus_state_sync, lognexus_state_set_task,
             lognexus_state_finish_task, lognexus_state_clear, lognexus_note_show,
             lognexus_note_attach, lognexus_timeline, lognexus_audit
  Resources: lognexus://state, lognexus://routing
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

async function handleInit() {
  printHeader();
  console.log("Initializing LogNexus in current repository...\n");
  const res = initProject();

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

  console.log("\nNext Steps:");
  console.log("  • Claude Code / Cursor / Codex / Antigravity / Gemini / Kimi: use /lognexus plan");
  console.log("  • Configure model tiers in .lognexus/routing.md");
  console.log(
    "  • Tip: install locally with 'npm i -D @digital-lake/lognexus' for instant execution (~0.15s)",
  );
  console.log("  • Verify environment anytime with: npx @digital-lake/lognexus doctor\n");
}

async function handleDoctor() {
  printHeader();
  console.log("Running diagnostics...\n");
  const checks = runDiagnostics();

  for (const c of checks) {
    const tag = c.status === "pass" ? "[PASS]" : c.status === "warn" ? "[WARN]" : "[FAIL]";
    console.log(`${tag} ${c.name}: ${c.message}`);
  }

  console.log("\nDiagnostic complete.\n");
}

async function handleStatus() {
  printHeader();
  const st = getProjectStatus();

  console.log(`Git Repository:     ${st.isInsideGit ? "Yes" : "No"}`);
  console.log(`Current Branch:     ${st.branch}`);
  console.log(`Active Issue:       ${st.activeIssue ?? "(none — on base branch)"}`);
  console.log(`Rules Routing Mode: ${st.routingMode}`);
  console.log(`Recommended Tier:   ${st.recommendedTier}\n`);
}

async function handleState(args: string[]) {
  const sub = args[0]?.toLowerCase() || "show";

  switch (sub) {
    case "show": {
      printHeader();
      const state = loadState();
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
      const synced = syncStateFromGit();
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
      setSubtask(parsed.taskId, parsed.title, parsed.contract, undefined, { tier: parsed.tier });
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
      finishSubtask(taskId);
      console.log(`[OK] Subtask ${taskId} marked as completed.\n`);
      break;
    }

    case "clear": {
      printHeader();
      clearState();
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
      const commit = args[1] || "HEAD";
      printHeader();
      const payload = attachCurrentStateToCommit(commit);
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

    default:
      console.error(`Unknown note subcommand: ${sub}\n`);
      printUsage();
      process.exit(1);
  }
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

async function handleTelemetry(args: string[]) {
  const sub = args[0]?.toLowerCase() || "status";

  switch (sub) {
    case "status": {
      printHeader();
      const store = loadTelemetry();
      const globallyDisabled = isTelemetryGloballyDisabled();
      console.log("LogNexus Telemetry Status:\n");
      console.log(
        `  Globally Disabled (DO_NOT_TRACK): ${globallyDisabled ? "Yes (Forced OFF)" : "No"}`,
      );
      console.log(`  Operating Mode:                   ${store.mode.toUpperCase()}`);
      console.log(`  Anonymous Project ID:             ${store.anonymousProjectId}`);
      console.log(
        `  Community Consent:                ${store.consent.accepted ? "Accepted (Shared)" : "No (Local Only)"}`,
      );
      if (store.consent.acceptedAt) {
        console.log(`  Consent Recorded At:              ${store.consent.acceptedAt}`);
      }
      console.log(
        `  Detected Stacks:                  ${store.detectedStacks.join(", ") || "(none)"}`,
      );
      console.log(`  Total Commits Monitored:          ${store.summary.totalCommits}`);
      console.log(
        `  Estimated Cost Savings:           ${store.summary.estimatedCostSavingsPct}%\n`,
      );
      break;
    }

    case "enable": {
      printHeader();
      const share = args.includes("--share");
      const acceptTerms = args.includes("--accept-terms");

      try {
        const res = enableTelemetry({ share, acceptTerms });
        if (res.mode === "community") {
          console.log("[OK] Telemetry enabled in COMMUNITY mode.");
          console.log(
            "     Terms accepted. Anonymous non-sensitive metrics will help mature MCP & routing.",
          );
          console.log("     Full policy & payload schema: docs/TELEMETRY_PRIVACY.md\n");
        } else {
          console.log("[OK] Telemetry enabled in LOCAL mode.");
          console.log("     Metrics are stored strictly locally in .lognexus/telemetry.json.");
          console.log(
            "     Zero network calls are made. Run 'lognexus telemetry report' to generate a report.\n",
          );
        }
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
      const store = loadTelemetry();
      const payload = buildAnonymousCommunityPayload(store);
      console.log("Anonymous Telemetry Payload (Zero-PII Audit):\n");
      console.log(JSON.stringify(payload, null, 2));
      console.log(
        "\nNote: No code, file paths, file names, commit messages, or identities are included.\n",
      );
      break;
    }

    case "report": {
      printHeader();
      let outputPath: string | undefined;
      const outIdx = args.findIndex((a) => a === "--output" || a === "-o");
      if (outIdx !== -1 && args[outIdx + 1]) {
        outputPath = args[outIdx + 1];
      }
      const res = generateTelemetryReportFile(process.cwd(), outputPath);
      console.log("[OK] Telemetry & ROI Performance Report generated:");
      console.log(`     Output file: ${res.filePath}\n`);
      console.log(res.content);
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

async function main() {
  const args = process.argv.slice(2);
  const command = args[0]?.toLowerCase();

  switch (command) {
    case "commit":
      await handleCommit(args.slice(1));
      break;
    case "telemetry":
      await handleTelemetry(args.slice(1));
      break;
    case "init":
      await handleInit();
      break;
    case "doctor":
      await handleDoctor();
      break;
    case "status":
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
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
