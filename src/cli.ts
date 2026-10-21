#!/usr/bin/env node

import { runDiagnostics } from "./doctor.js";
import { initProject } from "./scaffold.js";
import { clearState, finishSubtask, loadState, setSubtask } from "./state/manager.js";
import { syncStateFromGit } from "./state/sync.js";
import { getProjectStatus } from "./status.js";

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
  state        Manage persistent agent state (.lognexus/state.json)
  help         Display this help message

State Subcommands:
  lognexus state [show]             Display current active issue and task state
  lognexus state sync               Sync state from current Git branch & GitHub
  lognexus state set-task <id> [t]  Set active subtask (e.g. lognexus state set-task T1 "Add schema")
  lognexus state finish-task <id>   Mark subtask as completed (e.g. lognexus state finish-task T1)
  lognexus state clear              Reset persistent state to empty

Examples:
  npx @digital-lake/lognexus init
  npx @digital-lake/lognexus state sync
  npx @digital-lake/lognexus state show
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
  console.log("  • Claude Code / Cursor / Codex / Antigravity / Kimi: use /lognexus plan");
  console.log("  • Configure model tiers in .lognexus/routing.md");
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
      const taskId = args[1];
      const title = args.slice(2).join(" ");
      if (!taskId) {
        console.error(
          "Error: Subtask ID is required (e.g. lognexus state set-task T1 'Add schema')\n",
        );
        process.exit(1);
      }
      printHeader();
      setSubtask(taskId, title);
      console.log(`[OK] Active subtask set to: ${taskId}${title ? ` — ${title}` : ""}\n`);
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

async function main() {
  const args = process.argv.slice(2);
  const command = args[0]?.toLowerCase();

  switch (command) {
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
