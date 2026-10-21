#!/usr/bin/env node

import { runDiagnostics } from "./doctor.js";
import { initProject } from "./scaffold.js";
import { getProjectStatus } from "./status.js";

function printHeader() {
  console.log("\n🔷 LogNexus CLI — Digital Lake");
  console.log("   The Git-Powered Context & Rules Framework for Native AI Agents\n");
}

function printUsage() {
  printHeader();
  console.log(`Usage:
  lognexus <command> [options]

Commands:
  init         Scaffold .lognexus/ configuration and rules in current repository
  doctor       Check Git, GitHub CLI authentication, and repository rules health
  status       Inspect current branch, active issue, and recommended tier
  help         Display this help message

Examples:
  npx @digital-lake/lognexus init
  npx @digital-lake/lognexus doctor
  npx @digital-lake/lognexus status
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
