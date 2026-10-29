import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { inferTierFromAuthor } from "../src/telemetry/detector.js";
import {
  AnonymousCommunityPayloadSchema,
  buildAnonymousCommunityPayload,
  CUSTOM_NOTES_MARKER,
  clearTelemetry,
  detectProjectStacks,
  disableTelemetry,
  enableTelemetry,
  extractCommitDiffStats,
  extractModelFamilyCategory,
  generateTelemetryReportFile,
  getTelemetryPath,
  isTelemetryActive,
  isTelemetryGloballyDisabled,
  loadTelemetry,
  recordCommitTelemetry,
  recordReviewGateBlock,
  recordTaskFinish,
  recordTaskStart,
} from "../src/telemetry/index.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("LogNexus Telemetry & ROI Engine (v1.2.0)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lognexus-telemetry-test-"));
    execSync("git init", { cwd: tempDir, stdio: "ignore" });
    execSync('git config user.name "Test Runner"', { cwd: tempDir, stdio: "ignore" });
    execSync('git config user.email "test@example.com"', { cwd: tempDir, stdio: "ignore" });
    execSync('git config commit.gpgsign "false"', { cwd: tempDir, stdio: "ignore" });

    writeFileSync(join(tempDir, "README.md"), "# Test Repo\n", "utf8");
    execSync("git add README.md", { cwd: tempDir, stdio: "ignore" });
    execSync('git commit -m "chore: initial commit"', { cwd: tempDir, stdio: "ignore" });
  });

  afterEach(() => {
    delete process.env.DO_NOT_TRACK;
    delete process.env.LOGNEXUS_TELEMETRY_DISABLED;
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("Opt-in Security Guarantee (Zero-Tracking by Default)", () => {
    it("is inactive by default and does not create telemetry file on disk", () => {
      expect(isTelemetryActive(tempDir)).toBe(false);

      const store = loadTelemetry(tempDir);
      expect(store.mode).toBe("off");
      expect(store.consent.accepted).toBe(false);

      // Verify no telemetry file was created on read
      const telemetryPath = getTelemetryPath(tempDir);
      expect(existsSync(telemetryPath)).toBe(false);
    });

    it("ignores metric hook calls when telemetry is off", () => {
      recordTaskStart("T1", tempDir);
      recordTaskFinish("T1", tempDir);
      recordReviewGateBlock(tempDir);
      recordCommitTelemetry({ sha: "HEAD", targetDir: tempDir });

      const telemetryPath = getTelemetryPath(tempDir);
      expect(existsSync(telemetryPath)).toBe(false);
    });
  });

  describe("Consent Gate & Modes", () => {
    it("enables local telemetry without requiring network consent", () => {
      const res = enableTelemetry({ cwd: tempDir });
      expect(res.mode).toBe("local");
      expect(isTelemetryActive(tempDir)).toBe(true);

      const store = loadTelemetry(tempDir);
      expect(store.mode).toBe("local");
      expect(store.consent.accepted).toBe(false);
    });

    it("rejects retired community telemetry dispatch with a descriptive error", () => {
      expect(() => {
        enableTelemetry({ share: true, acceptTerms: true, cwd: tempDir });
      }).toThrow(/strict local-only telemetry/);

      expect(isTelemetryActive(tempDir)).toBe(false);
    });

    it("migrates a legacy community store to local mode on load", () => {
      const store = loadTelemetry(tempDir);
      store.mode = "community";
      mkdirSync(join(tempDir, ".lognexus"), { recursive: true });
      writeFileSync(getTelemetryPath(tempDir), JSON.stringify(store, null, 2), "utf8");

      const migrated = loadTelemetry(tempDir);
      expect(migrated.mode).toBe("local");
      expect(isTelemetryActive(tempDir)).toBe(true);
    });

    it("can disable and clear telemetry store cleanly", () => {
      enableTelemetry({ cwd: tempDir });
      expect(isTelemetryActive(tempDir)).toBe(true);

      disableTelemetry(tempDir);
      expect(isTelemetryActive(tempDir)).toBe(false);

      clearTelemetry(tempDir);
      const store = loadTelemetry(tempDir);
      expect(store.mode).toBe("off");
      expect(store.summary.totalCommits).toBe(0);
    });
  });

  describe("Stack Detection & Model Categorization", () => {
    it("detects Node.js and TypeScript stacks from manifests", () => {
      writeFileSync(join(tempDir, "package.json"), JSON.stringify({ name: "demo" }), "utf8");
      writeFileSync(join(tempDir, "tsconfig.json"), JSON.stringify({}), "utf8");

      const stacks = detectProjectStacks(tempDir);
      expect(stacks).toContain("nodejs");
      expect(stacks).toContain("typescript");
    });

    it("categorizes model identities into clean model families", () => {
      expect(extractModelFamilyCategory("gemini/flash (antigravity)")).toBe("gemini/flash");
      expect(extractModelFamilyCategory("gemini/pro (lead-architect)")).toBe("gemini/pro");
      expect(extractModelFamilyCategory("claude-3-5-sonnet-20241022 (lead-dev)")).toBe(
        "claude/sonnet",
      );
      expect(extractModelFamilyCategory("claude-3-5-haiku")).toBe("claude/haiku");
      expect(extractModelFamilyCategory("openai/gpt-4o (antigravity)")).toBe("openai/gpt");
      expect(extractModelFamilyCategory("deepseek/deepseek-coder")).toBe("deepseek/v3");
      expect(extractModelFamilyCategory(undefined)).toBe("unknown/other");
    });

    it("categorizes frontier agent identities", () => {
      expect(
        extractModelFamilyCategory("Gemini 4 Argon (Master Architecture & Security Orchestrator)"),
      ).toBe("gemini/argon");
      expect(extractModelFamilyCategory("Gemini 4 Carbon (Independent Reviewer)")).toBe(
        "gemini/carbon",
      );
      expect(extractModelFamilyCategory("google/gemini-3.8-flash-high (antigravity)")).toBe(
        "gemini/flash-high",
      );
      expect(extractModelFamilyCategory("google/gemini-3.8-pro (antigravity)")).toBe("gemini/pro");
      expect(extractModelFamilyCategory("moonshot/kimi-k3")).toBe("moonshot/kimi");
      expect(extractModelFamilyCategory("Kimi K3 (Moonshot AI)")).toBe("moonshot/kimi");
    });

    it("infers the routing tier of frontier agent identities", () => {
      expect(
        inferTierFromAuthor("Gemini 4 Argon (Master Architecture & Security Orchestrator)"),
      ).toBe("tier-1");
      expect(inferTierFromAuthor("Gemini 4 Carbon (Independent Reviewer)")).toBe("tier-1");
      expect(inferTierFromAuthor("google/gemini-3.8-flash-high (antigravity)")).toBe("tier-2");
      expect(inferTierFromAuthor("google/gemini-3.8-pro (antigravity)")).toBe("tier-1");
      expect(inferTierFromAuthor("deepseek/chat (kimi-code)")).toBe("tier-3");
      expect(inferTierFromAuthor("moonshot/kimi-k3")).toBe("tier-3");
      expect(inferTierFromAuthor("Kimi K3 (Moonshot AI)")).toBe("tier-3");
      expect(inferTierFromAuthor("gemini/flash-lite (antigravity)")).toBe("tier-3");
      expect(inferTierFromAuthor("")).toBeNull();
      expect(inferTierFromAuthor(null)).toBeNull();
    });

    it("detects PowerShell and Batch stacks from scripts in nested folders", () => {
      mkdirSync(join(tempDir, "scripts"), { recursive: true });
      mkdirSync(join(tempDir, "tools", "win"), { recursive: true });
      writeFileSync(join(tempDir, "scripts", "deploy.ps1"), "Write-Host 'deploy'\n", "utf8");
      writeFileSync(join(tempDir, "tools", "win", "task.cmd"), "@echo off\n", "utf8");

      const stacks = detectProjectStacks(tempDir);
      expect(stacks).toContain("powershell");
      expect(stacks).toContain("batch");
    });

    it("detects PowerShell modules and data files at the project root", () => {
      writeFileSync(join(tempDir, "Module.psm1"), "function Invoke-Thing {}\n", "utf8");
      writeFileSync(join(tempDir, "Module.psd1"), "@{ ModuleVersion = '1.0' }\n", "utf8");
      writeFileSync(join(tempDir, "build.bat"), "@echo off\n", "utf8");

      const stacks = detectProjectStacks(tempDir);
      expect(stacks).toContain("powershell");
      expect(stacks).toContain("batch");
    });

    it("ignores PowerShell and Batch scripts in ignored folders and beyond depth 2", () => {
      mkdirSync(join(tempDir, "node_modules", "pkg"), { recursive: true });
      mkdirSync(join(tempDir, "dist"), { recursive: true });
      mkdirSync(join(tempDir, ".lognexus"), { recursive: true });
      mkdirSync(join(tempDir, "a", "b", "c"), { recursive: true });

      writeFileSync(join(tempDir, "node_modules", "pkg", "hook.ps1"), "exit 0\n", "utf8");
      writeFileSync(join(tempDir, "dist", "bundle.ps1"), "exit 0\n", "utf8");
      writeFileSync(join(tempDir, ".lognexus", "tool.cmd"), "exit 0\n", "utf8");
      writeFileSync(join(tempDir, "a", "b", "c", "deep.ps1"), "exit 0\n", "utf8");

      const stacks = detectProjectStacks(tempDir);
      expect(stacks).not.toContain("powershell");
      expect(stacks).not.toContain("batch");
    });
  });

  describe("Zero-PII Metric Collection & ROI Calculation", () => {
    it("extracts diff stats strictly by file extension without paths or file names", () => {
      writeFileSync(join(tempDir, "secret_module.ts"), "const a = 1;\nconst b = 2;\n", "utf8");
      writeFileSync(join(tempDir, "config.json"), '{\n  "key": "val"\n}\n', "utf8");
      execSync("git add secret_module.ts config.json", { cwd: tempDir, stdio: "ignore" });
      execSync('git commit -m "feat: add module"', { cwd: tempDir, stdio: "ignore" });

      const sha = execSync("git rev-parse HEAD", { cwd: tempDir, encoding: "utf8" }).trim();
      const diffs = extractCommitDiffStats(sha, tempDir);

      const jsonStr = JSON.stringify(diffs);
      // Verify no filenames or filepaths are present in diff stats
      expect(jsonStr).not.toContain("secret_module");
      expect(jsonStr).not.toContain("config.json");

      const tsEntry = diffs.find((d) => d.ext === ".ts");
      expect(tsEntry?.linesAdded).toBe(2);

      const jsonEntry = diffs.find((d) => d.ext === ".json");
      expect(jsonEntry?.linesAdded).toBe(3);
    });

    it("records task durations, commits, gate blocks and computes cost savings", () => {
      enableTelemetry({ cwd: tempDir });

      recordTaskStart("T1", tempDir);
      const duration = recordTaskFinish("T1", tempDir);
      expect(duration).toBeGreaterThanOrEqual(0);

      recordReviewGateBlock(tempDir);

      writeFileSync(join(tempDir, "worker.ts"), "export const run = () => {};\n", "utf8");
      execSync("git add worker.ts", { cwd: tempDir, stdio: "ignore" });
      execSync('git commit -m "feat(#17/T1): add worker"', { cwd: tempDir, stdio: "ignore" });
      const sha = execSync("git rev-parse HEAD", { cwd: tempDir, encoding: "utf8" }).trim();

      recordCommitTelemetry({
        sha,
        author: "gemini/flash (antigravity)",
        tier: "tier-3",
        targetDir: tempDir,
      });

      const store = loadTelemetry(tempDir);
      expect(store.summary.totalCommits).toBe(1);
      expect(store.summary.totalSubtasksCompleted).toBe(1);
      expect(store.summary.reviewGateBlocksPrevented).toBe(1);
      expect(store.summary.totalLinesAdded).toBe(1);
      expect(store.models["gemini/flash"]?.commits).toBe(1);
      expect(store.extensions[".ts"]?.commits).toBe(1);

      // Verifies economic cost savings calculation:
      // Monolithic frontier baseline: 1 * $0.05 = $0.05
      // LogNexus Tier-3 actual: 1 * $0.002 = $0.002
      // Net Savings: $0.048 (96.0%)
      expect(store.summary.estimatedBaselineCostUsd).toBe(0.05);
      expect(store.summary.estimatedActualCostUsd).toBe(0.002);
      expect(store.summary.estimatedCostSavingsUsd).toBe(0.048);
      expect(store.summary.estimatedCostSavingsPct).toBe(96);
    });
  });

  describe("Report Generation & Community Payload", () => {
    it("generates markdown report with HUD tables and frontmatter", () => {
      enableTelemetry({ cwd: tempDir });

      writeFileSync(join(tempDir, "app.py"), "print('hello')\n", "utf8");
      execSync("git add app.py", { cwd: tempDir, stdio: "ignore" });
      execSync('git commit -m "feat: python script"', { cwd: tempDir, stdio: "ignore" });
      const sha = execSync("git rev-parse HEAD", { cwd: tempDir, encoding: "utf8" }).trim();

      recordCommitTelemetry({
        sha,
        author: "gemini/flash (antigravity)",
        tier: "tier-3",
        targetDir: tempDir,
      });

      const { filePath, content } = generateTelemetryReportFile(tempDir);
      expect(existsSync(filePath)).toBe(true);
      expect(content).toContain("# ⚡ LogNexus Telemetry & ROI Performance Report");
      expect(content).toContain("Executive Metrics Dashboard");
      expect(content).toContain("Multi-Model Swarm Distribution");
      expect(content).toContain("Cost Efficiency & Model-Tier ROI Evaluation");
      expect(content).toContain("`gemini/flash`");
      expect(content).toContain("`.py`");
    });

    it("confines outputPath to targetDir and rejects traversal escapes", () => {
      enableTelemetry({ cwd: tempDir });

      const nested = generateTelemetryReportFile(tempDir, join(".lognexus", "roi.md"));
      expect(nested.filePath).toBe(join(tempDir, ".lognexus", "roi.md"));
      expect(existsSync(nested.filePath)).toBe(true);

      const clamped = generateTelemetryReportFile(tempDir, join(".lognexus", "exports", "roi.md"));
      expect(clamped.filePath).toBe(join(tempDir, ".lognexus", "exports", "roi.md"));

      for (const attack of [
        "../escaped.md",
        "..\\escaped.md",
        "../../outside.md",
        "/etc/passwd",
        "C:\\Windows\\Temp\\evil.md",
        "D:\\evil.md",
      ]) {
        expect(() => generateTelemetryReportFile(tempDir, attack)).toThrow(
          /Governance violation: Path traversal detected/,
        );
      }

      expect(() => generateTelemetryReportFile(tempDir, ".")).toThrow(
        /Governance violation: Path traversal detected/,
      );
    });

    it("ends the generated report with the custom notes marker", () => {
      enableTelemetry({ cwd: tempDir });

      const { content } = generateTelemetryReportFile(tempDir);
      expect(content).toContain(CUSTOM_NOTES_MARKER);
      expect(content.trimEnd().endsWith(CUSTOM_NOTES_MARKER)).toBe(true);
    });

    it("preserves user authored custom notes across report regeneration", () => {
      enableTelemetry({ cwd: tempDir });

      const first = generateTelemetryReportFile(tempDir);
      const notes =
        "\n## 5. Team Notes\n\n- Deploy freeze until Friday.\n- Reviewed by security.\n";
      writeFileSync(first.filePath, `${first.content}${notes}`, "utf8");

      const second = generateTelemetryReportFile(tempDir);
      expect(second.content).toContain("Team Notes");
      expect(second.content).toContain("Deploy freeze until Friday.");
      expect(second.content).toContain("Reviewed by security.");

      const markerIndex = second.content.indexOf(CUSTOM_NOTES_MARKER);
      expect(second.content.indexOf("Team Notes")).toBeGreaterThan(markerIndex);

      // Notes survive a second regeneration without being duplicated.
      const third = generateTelemetryReportFile(tempDir);
      expect(third.content.split("Deploy freeze until Friday.").length - 1).toBe(1);
    });

    it("migrates custom notes from legacy v1.2.4 reports without a marker", () => {
      enableTelemetry({ cwd: tempDir });

      const { filePath } = generateTelemetryReportFile(tempDir);
      const legacyReport = [
        "# ⚡ LogNexus Telemetry & ROI Performance Report",
        "",
        "## 4. Cost Efficiency & Model-Tier ROI Evaluation",
        "",
        "Legacy metrics body.",
        "",
        "## 5. Engineering Notes",
        "",
        "- Keep the release train green.",
        "",
      ].join("\n");
      writeFileSync(filePath, legacyReport, "utf8");

      const regenerated = generateTelemetryReportFile(tempDir);
      expect(regenerated.content).toContain(CUSTOM_NOTES_MARKER);
      expect(regenerated.content).toContain("Engineering Notes");
      expect(regenerated.content).toContain("Keep the release train green.");
      expect(regenerated.content.indexOf("Engineering Notes")).toBeGreaterThan(
        regenerated.content.indexOf(CUSTOM_NOTES_MARKER),
      );
    });

    it("does not invent custom notes when the existing report has none", () => {
      enableTelemetry({ cwd: tempDir });

      const { filePath, content } = generateTelemetryReportFile(tempDir);
      const stripped = content.split(CUSTOM_NOTES_MARKER)[0].replace(/\n*$/, "\n");
      writeFileSync(filePath, stripped, "utf8");

      const regenerated = generateTelemetryReportFile(tempDir);
      expect(regenerated.content.trimEnd().endsWith(CUSTOM_NOTES_MARKER)).toBe(true);
      expect(regenerated.content).not.toContain("## 5");
    });

    it("builds a valid GDPR/CCPA compliant zero-PII local payload", () => {
      enableTelemetry({ cwd: tempDir });
      const store = loadTelemetry(tempDir);

      const payload = buildAnonymousCommunityPayload(store);
      const parsed = AnonymousCommunityPayloadSchema.safeParse(payload);
      expect(parsed.success).toBe(true);

      const rawJson = JSON.stringify(payload);
      expect(rawJson).not.toContain("Test Runner");
      expect(rawJson).not.toContain("test@example.com");
      expect(rawJson).not.toContain(tempDir);
    });
  });

  describe("Global Kill Switches", () => {
    it("respects DO_NOT_TRACK environment variable", () => {
      process.env.DO_NOT_TRACK = "1";
      expect(isTelemetryGloballyDisabled()).toBe(true);
      expect(isTelemetryActive(tempDir)).toBe(false);
    });

    it("respects LOGNEXUS_TELEMETRY_DISABLED environment variable", () => {
      process.env.LOGNEXUS_TELEMETRY_DISABLED = "true";
      expect(isTelemetryGloballyDisabled()).toBe(true);
      expect(isTelemetryActive(tempDir)).toBe(false);
    });

    it("keeps telemetry inactive under the kill switch even with a migrated legacy store", () => {
      process.env.LOGNEXUS_TELEMETRY_DISABLED = "1";
      const store = loadTelemetry(tempDir);
      store.mode = "local";
      store.consent.accepted = true;

      expect(isTelemetryActive(tempDir)).toBe(false);
    });
  });

  describe("Offline Guarantee", () => {
    const readSource = (file: string) =>
      readFileSync(join(repoRoot, "src", "telemetry", file), "utf8");

    it("contains no fetch() calls to remote endpoints in telemetry sources", () => {
      for (const file of ["collector.ts", "detector.ts", "index.ts", "report.ts", "schema.ts"]) {
        const source = readSource(file);
        expect(source).not.toMatch(/\bfetch\s*\(/);
        expect(source).not.toMatch(/https?:\/\/[^\s"'`]+/);
        expect(source).not.toMatch(/LOGNEXUS_TELEMETRY_URL/);
      }
    });

    it("exports no network dispatch helpers from the telemetry barrel", async () => {
      const barrel = await import("../src/telemetry/index.js");
      expect("dispatchCommunityTelemetry" in barrel).toBe(false);
      expect("DEFAULT_TELEMETRY_ENDPOINT" in barrel).toBe(false);
    });
  });
});
