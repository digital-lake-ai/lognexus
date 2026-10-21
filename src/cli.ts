#!/usr/bin/env node

import { execSync } from "node:child_process";
import { loadConfig } from "./config/loadConfig.js";
import { createProvider } from "./providers/factory.js";
import { type OperationTier, resolveTier } from "./routing/tierRouter.js";

function printHeader() {
  console.log("\n🔷 LogNexus CLI v1.0.0-alpha.0 — Digital Lake\n");
}

function redactKey(key?: string): string {
  if (!key) return "❌ (not set)";
  if (key.length <= 8) return "•••••••• (set)";
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

async function runDoctor(args: string[]) {
  printHeader();
  console.log("Running diagnostics...\n");

  const live = args.includes("--live");

  // 1. Git Check
  try {
    const gitVer = execSync("git --version", { encoding: "utf-8" }).trim();
    const isRepo = execSync("git rev-parse --is-inside-work-tree", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();
    console.log(`[PASS] Git: ${gitVer} (inside git repository: ${isRepo})`);
  } catch {
    console.log("[FAIL] Git: Git command failed or not in a git repository");
  }

  // 2. GitHub CLI Check
  try {
    const ghVer = execSync("gh --version", { encoding: "utf-8" }).split("\n")[0];
    console.log(`[PASS] GitHub CLI: ${ghVer}`);
  } catch {
    console.log("[WARN] GitHub CLI: 'gh' not found in PATH or not installed");
  }

  // 3. Load Configuration
  const config = loadConfig();
  console.log(`\n[INFO] Active Provider Strategy: ${config.provider.toUpperCase()}`);
  console.log(`  - Gemini Key:   ${redactKey(config.gemini.apiKey)}`);
  console.log(`  - Gemini Model: ${config.gemini.model}`);
  console.log(`  - DeepSeek Key: ${redactKey(config.deepseek.apiKey)}`);
  console.log(`  - DeepSeek Model: ${config.deepseek.model}`);

  // 4. Live Provider Connectivity Check (Optional)
  if (live) {
    console.log("\nTesting live API connectivity...");

    if (config.gemini.apiKey) {
      const gemini = createProvider("gemini", config);
      const health = await gemini.healthCheck();
      console.log(`  - Gemini Live: ${health.ok ? "✅ PASS" : "❌ FAIL"} — ${health.message}`);
    }

    if (config.deepseek.apiKey) {
      const deepseek = createProvider("deepseek", config);
      const health = await deepseek.healthCheck();
      console.log(`  - DeepSeek Live: ${health.ok ? "✅ PASS" : "❌ FAIL"} — ${health.message}`);
    }
  } else {
    console.log("\nTip: Pass --live to verify API keys with real connectivity checks.");
  }

  console.log("\nDiagnostic complete.\n");
}

function runRoute(args: string[]) {
  const tierArg = args[0];
  if (!tierArg || !["tier-1", "tier-2", "tier-3"].includes(tierArg)) {
    console.error("Usage: lognexus route <tier-1 | tier-2 | tier-3>");
    process.exit(1);
  }

  const tier = tierArg as OperationTier;
  const config = loadConfig();
  const assignment = resolveTier(tier, config);

  console.log(`\n🔷 LogNexus Tier Route: [${assignment.tier}]`);
  console.log(`Provider: ${assignment.provider.id}`);
  console.log(`Model:    ${assignment.model}`);
  console.log(`Purpose:  ${assignment.description}\n`);
}

function runHelp() {
  printHeader();
  console.log("Usage: lognexus <command> [options]\n");
  console.log("Commands:");
  console.log("  doctor [--live]     Run environment and credentials diagnostic");
  console.log(
    "  route <tier>        Resolve assigned model/provider for a tier (tier-1, tier-2, tier-3)",
  );
  console.log("  config              Display sanitized configuration");
  console.log("  help                Show this help message\n");
}

async function main() {
  const command = process.argv[2] || "help";
  const args = process.argv.slice(3);

  switch (command) {
    case "doctor":
      await runDoctor(args);
      break;
    case "route":
      runRoute(args);
      break;
    case "config":
      printHeader();
      console.log(
        JSON.stringify(
          {
            ...loadConfig(),
            gemini: { ...loadConfig().gemini, apiKey: redactKey(loadConfig().gemini.apiKey) },
            deepseek: { ...loadConfig().deepseek, apiKey: redactKey(loadConfig().deepseek.apiKey) },
          },
          null,
          2,
        ),
      );
      break;
    default:
      runHelp();
      break;
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
