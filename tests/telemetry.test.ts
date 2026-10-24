import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AnonymousCommunityPayloadSchema,
  buildAnonymousCommunityPayload,
  clearTelemetry,
  detectProjectStacks,
  disableTelemetry,
  dispatchCommunityTelemetry,
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

    it("rejects community telemetry without explicit terms acceptance", () => {
      expect(() => {
        enableTelemetry({ share: true, acceptTerms: false, cwd: tempDir });
      }).toThrow(/--accept-terms/);
    });

    it("enables community telemetry when explicit terms are accepted", () => {
      const res = enableTelemetry({ share: true, acceptTerms: true, cwd: tempDir });
      expect(res.mode).toBe("community");
      expect(isTelemetryActive(tempDir)).toBe(true);

      const store = loadTelemetry(tempDir);
      expect(store.mode).toBe("community");
      expect(store.consent.accepted).toBe(true);
      expect(typeof store.consent.acceptedAt).toBe("string");
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

    it("builds a valid GDPR/CCPA compliant anonymous community payload", () => {
      enableTelemetry({ share: true, acceptTerms: true, cwd: tempDir });
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

    it("does not dispatch community telemetry when globally disabled", async () => {
      process.env.LOGNEXUS_TELEMETRY_DISABLED = "1";
      const store = loadTelemetry(tempDir);
      store.mode = "community";
      store.consent.accepted = true;

      const sent = await dispatchCommunityTelemetry(store);
      expect(sent).toBe(false);
    });
  });
});
