import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { attachCurrentStateToCommit } from "../src/index.js";
import {
  classifyFileCategory,
  inferTierFromAuthor,
  isGovernanceOrConfigSurface,
} from "../src/telemetry/detector.js";
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
  formatTelemetryMarkdownReport,
  generateTelemetryReportFile,
  getTelemetryPath,
  isTelemetryActive,
  isTelemetryGloballyDisabled,
  loadTelemetry,
  recordCommitTelemetry,
  recordReviewGateBlock,
  recordTaskFinish,
  recordTaskStart,
  redactLocalProjectMetadata,
  syncTelemetryFromGitNotes,
  TelemetryStoreSchema,
} from "../src/telemetry/index.js";
import { AnonymousDiagnosticPayloadSchema } from "../src/telemetry/schema.js";

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
      expect(extractModelFamilyCategory("deepseek/VS Code (kimi-code)")).toBe("deepseek/v3");
      expect(extractModelFamilyCategory("deepseek/vs-code")).toBe("deepseek/v3");
      expect(extractModelFamilyCategory(undefined)).toBe("unknown/other");
    });

    it("never publishes a human Git identity as a model family", () => {
      expect(extractModelFamilyCategory("Jane Doe <jane@example.com>")).toBe("unknown/other");
      expect(extractModelFamilyCategory("Organization-Bot")).toBe("unknown/other");
      expect(extractModelFamilyCategory("Jane Doe")).toBe("unknown/other");
      // A provider/model slug still survives next to an address.
      expect(extractModelFamilyCategory("someone/random <random@example.com>")).toBe(
        "someone/random",
      );
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

    it("gives explicit Carbon identities precedence over the Antigravity orchestrator fallback", () => {
      expect(extractModelFamilyCategory("Gemini 4 Carbon (antigravity, role: orchestrator)")).toBe(
        "gemini/carbon",
      );
      expect(extractModelFamilyCategory("google/gemini-4-carbon (antigravity, orchestrator)")).toBe(
        "gemini/carbon",
      );
      expect(inferTierFromAuthor("Gemini 4 Carbon (antigravity, role: orchestrator)")).toBe(
        "tier-1",
      );
      expect(inferTierFromAuthor("google/gemini-4-carbon (antigravity, orchestrator)")).toBe(
        "tier-1",
      );
    });

    it("infers the routing tier of frontier agent identities", () => {
      expect(
        inferTierFromAuthor("Gemini 4 Argon (Master Architecture & Security Orchestrator)"),
      ).toBe("tier-1");
      expect(inferTierFromAuthor("Gemini 4 Carbon (Independent Reviewer)")).toBe("tier-1");
      expect(inferTierFromAuthor("google/gemini-3.8-flash-high (antigravity)")).toBe("tier-2");
      expect(inferTierFromAuthor("google/gemini-3.8-pro (antigravity)")).toBe("tier-1");
      expect(inferTierFromAuthor("deepseek/chat (kimi-code)")).toBe("tier-3");
      expect(inferTierFromAuthor("deepseek/VS Code (kimi-code)")).toBe("tier-3");
      expect(inferTierFromAuthor("moonshot/kimi-k3")).toBe("tier-3");
      expect(inferTierFromAuthor("Kimi K3 (Moonshot AI)")).toBe("tier-3");
      expect(inferTierFromAuthor("gemini/flash-lite (antigravity)")).toBe("tier-3");
      expect(inferTierFromAuthor("")).toBeNull();
      expect(inferTierFromAuthor(null)).toBeNull();
    });

    it("detects Lua and SphereScript stacks from extensions", () => {
      mkdirSync(join(tempDir, "scripts"), { recursive: true });
      writeFileSync(join(tempDir, "scripts", "macro.lua"), "print('macro')\n", "utf8");
      writeFileSync(join(tempDir, "scripts", "ui.toc"), "## Interface: 100002\n", "utf8");
      writeFileSync(join(tempDir, "scripts", "undead.scp"), "[EOF]\n", "utf8");

      const stacks = detectProjectStacks(tempDir);
      expect(stacks).toContain("lua");
      expect(stacks).toContain("spherescript");
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
    it("backfills telemetry from Git notes written by the attach engine", () => {
      writeFileSync(join(tempDir, "worker.ts"), "export const run = () => {};\n", "utf8");
      execSync("git add -A", { cwd: tempDir, stdio: "ignore" });
      execSync('git commit -m "feat: add worker"', { cwd: tempDir, stdio: "ignore" });
      const sha = execSync("git rev-parse HEAD", { cwd: tempDir, encoding: "utf8" }).trim();

      attachCurrentStateToCommit(sha, { cwd: tempDir });

      expect(loadTelemetry(tempDir).summary.totalCommits).toBe(0);
      enableTelemetry({ cwd: tempDir });

      const { content } = generateTelemetryReportFile(tempDir);
      expect(content).toContain("`.ts`");

      const store = loadTelemetry(tempDir);
      // Both commits in history are reconciled: the unscoped backfill replays the full log,
      // and the parentless initial commit now reports its README diff as well.
      expect(store.summary.totalCommits).toBe(2);
      expect(store.summary.totalLinesAdded).toBe(2);
      expect(store.extensions[".ts"]?.commits).toBe(1);
      expect(Object.values(store.models).reduce((sum, m) => sum + m.commits, 0)).toBe(2);
      expect(store.summary.estimatedCostSavingsPct).toBe(96);
    });

    it("prefers the inferred tier over the legacy tier-3 default on historical notes", () => {
      writeFileSync(join(tempDir, "plan.md"), "# plan\n", "utf8");
      execSync("git add -A", { cwd: tempDir, stdio: "ignore" });
      execSync(
        'git commit -q -m "docs: orchestrator plan" --author "antigravity/lead-orchestrator (google-antigravity) <lead@example.com>"',
        { cwd: tempDir, stdio: "ignore" },
      );
      const sha = execSync("git rev-parse HEAD", { cwd: tempDir, encoding: "utf8" }).trim();

      execFileSync(
        "git",
        [
          "notes",
          "--ref=lognexus",
          "add",
          "-f",
          "-m",
          JSON.stringify({
            schema: "lognexus/note/v1",
            commit: sha,
            issue: { id: 36, title: "v1.3.3" },
            subtask: { id: "T1", title: "orchestrate", status: "completed" },
            tier: "tier-3",
          }),
          sha,
        ],
        { cwd: tempDir, stdio: "ignore", shell: false },
      );

      enableTelemetry({ cwd: tempDir });
      generateTelemetryReportFile(tempDir);

      const store = loadTelemetry(tempDir);
      const model = store.models["gemini/argon"];
      expect(model).toBeDefined();
      expect(model?.tier).toBe("tier-1");
      expect(model?.commits).toBe(1);
    });

    it("honours an explicit non-default tier stored in the note", () => {
      writeFileSync(join(tempDir, "plan.md"), "# plan\n", "utf8");
      execSync("git add -A", { cwd: tempDir, stdio: "ignore" });
      execSync('git commit -q -m "docs: plan" --author "someone/random <random@example.com>"', {
        cwd: tempDir,
        stdio: "ignore",
      });
      const sha = execSync("git rev-parse HEAD", { cwd: tempDir, encoding: "utf8" }).trim();

      execFileSync(
        "git",
        [
          "notes",
          "--ref=lognexus",
          "add",
          "-f",
          "-m",
          JSON.stringify({ commit: sha, tier: "tier-2" }),
          sha,
        ],
        { cwd: tempDir, stdio: "ignore", shell: false },
      );

      enableTelemetry({ cwd: tempDir });
      generateTelemetryReportFile(tempDir);

      expect(Object.values(loadTelemetry(tempDir).models)[0]?.tier).toBe("tier-2");
    });

    it("generates markdown report with HUD tables and frontmatter", () => {
      enableTelemetry({ cwd: tempDir });

      writeFileSync(join(tempDir, "app.py"), "print('hello')\n", "utf8");
      execSync("git add app.py", { cwd: tempDir, stdio: "ignore" });
      execSync(
        'git commit -q -m "feat: python script" --author "gemini/flash (antigravity) <flash@example.com>"',
        { cwd: tempDir, stdio: "ignore" },
      );
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
      // The unscoped reconciliation replays the whole log, so the initial commit is priced
      // under the repository's configured Git identity rather than the recording author.
      expect(content).toContain("`gemini/flash`");
      expect(content).toContain("`.py`");
    });

    it("displays only the Anonymous Project ID and redacts local repository metadata", () => {
      enableTelemetry({ cwd: tempDir });
      const store = loadTelemetry(tempDir);

      const markdown = formatTelemetryMarkdownReport(store);
      expect(markdown).toContain("Anonymous Project ID");
      expect(markdown).toContain(store.anonymousProjectId);
      expect(markdown).toContain(`anonymous_project_id: ${store.anonymousProjectId}`);
      expect(markdown).not.toContain(tempDir);

      const repoName = basename(tempDir);
      const notes = `\n## 6. Custom Notes\nRepository: ${repoName}\nPath: ${tempDir}\n`;
      const redacted = redactLocalProjectMetadata(notes, tempDir, store.anonymousProjectId);
      expect(redacted).toContain(store.anonymousProjectId);
      expect(redacted).toContain("<redacted-path>");
      expect(redacted).not.toContain(repoName);
      expect(redacted).not.toContain(tempDir);
      expect(redactLocalProjectMetadata("", tempDir, store.anonymousProjectId)).toBe("");
    });

    it("sanitizes preserved custom notes when regenerating the report file", () => {
      enableTelemetry({ cwd: tempDir });
      const store = loadTelemetry(tempDir);
      const repoName = basename(tempDir);

      const { filePath } = generateTelemetryReportFile(tempDir);
      writeFileSync(
        filePath,
        `${readFileSync(filePath, "utf8")}\n## 6. Custom Notes\nWorkspace: ${repoName}\nRoot: ${tempDir}\n`,
        "utf8",
      );

      const { content } = generateTelemetryReportFile(tempDir);
      expect(content).toContain("## 6. Custom Notes");
      expect(content).toContain(store.anonymousProjectId);
      expect(content).not.toContain(repoName);
      expect(content).not.toContain(tempDir);
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

    it("documents opt-in diagnostic sharing without performing any upload", () => {
      enableTelemetry({ cwd: tempDir });

      const { content } = generateTelemetryReportFile(tempDir);
      const sharingIndex = content.indexOf("## 5. Opt-in Diagnostic Sharing (100% Local-First)");
      expect(sharingIndex).toBeGreaterThan(-1);
      expect(sharingIndex).toBeLessThan(content.indexOf(CUSTOM_NOTES_MARKER));
      expect(content).toContain("gh issue create");
      expect(content).toContain("diagnostic-report.yml");
      expect(content).toMatch(/never automatic/i);
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

    it("migrates custom notes from legacy reports without a marker", () => {
      enableTelemetry({ cwd: tempDir });

      const { filePath } = generateTelemetryReportFile(tempDir);
      const legacyReport = [
        "# ⚡ LogNexus Telemetry & ROI Performance Report",
        "",
        "## 4. Cost Efficiency & Model-Tier ROI Evaluation",
        "",
        "Legacy metrics body.",
        "",
        "## 6. Engineering Notes",
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
      expect(stripped).not.toContain(CUSTOM_NOTES_MARKER);
      writeFileSync(filePath, stripped, "utf8");

      const regenerated = generateTelemetryReportFile(tempDir);
      expect(regenerated.content.trimEnd().endsWith(CUSTOM_NOTES_MARKER)).toBe(true);
      expect(regenerated.content.split(CUSTOM_NOTES_MARKER).length - 1).toBe(1);
      expect(regenerated.content.indexOf("Team Notes")).toBe(-1);
      expect(regenerated.content.indexOf("## 5. Opt-in Diagnostic Sharing")).toBeGreaterThan(-1);
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

  describe("Telemetry Schema v2.0 & Diff Categorization", () => {
    it("parses a legacy 1.0.0 store into the 2.0.0 shape without losing values", () => {
      const legacy = {
        schemaVersion: "1.0.0",
        mode: "local",
        anonymousProjectId: "11111111-2222-3333-4444-555555555555",
        consent: { accepted: false, policyVersion: "1.0.0", acceptedAt: null },
        detectedStacks: ["nodejs"],
        taskTimings: {},
        extensions: { ".ts": { ext: ".ts", commits: 2, linesAdded: 10, linesDeleted: 1 } },
        models: { "gemini/flash": { family: "gemini/flash", tier: "tier-3", commits: 2 } },
        summary: { totalCommits: 2, totalLinesAdded: 10, estimatedCostSavingsPct: 96 },
        lastUpdated: "2025-01-01T00:00:00.000Z",
      };

      const parsed = TelemetryStoreSchema.parse(legacy);
      expect(parsed.schemaVersion).toBe("1.0.0");
      expect(parsed.summary.totalCommits).toBe(2);
      expect(parsed.summary.totalLinesDeleted).toBe(0);
      expect(parsed.summary.contractCompliancePct).toBe(100);
      expect(parsed.summary.tierCommits).toEqual({ "tier-1": 0, "tier-2": 0, "tier-3": 0 });
      expect(parsed.extensions[".ts"]?.category).toBe("source");
      expect(parsed.models["gemini/flash"]?.estimatedCostUsd).toBe(0);
      expect(parsed.models["gemini/flash"]?.sourceLinesAdded).toBe(0);
    });

    it("defaults a fresh store schema version to 2.0.0", () => {
      const store = loadTelemetry(tempDir);
      expect(store.schemaVersion).toBe("2.0.0");
      expect(store.summary.estimatedTokensSaved).toBe(0);
      expect(store.summary.tierCommits["tier-1"]).toBe(0);
    });

    it("keeps the legacy community payload alias bound to the diagnostic payload", () => {
      const store = loadTelemetry(tempDir);
      const payload = buildAnonymousCommunityPayload(store);

      expect(AnonymousCommunityPayloadSchema.safeParse(payload).success).toBe(true);
      expect(AnonymousDiagnosticPayloadSchema.safeParse(payload).success).toBe(true);
      // 1.x consumers read `dispatchedAt`; the v2 payload must still expose it.
      expect(typeof payload.dispatchedAt).toBe("string");
    });

    it("classifies changed files into source, test, docs and config categories", () => {
      expect(classifyFileCategory("src/telemetry/detector.ts")).toBe("source");
      expect(classifyFileCategory("src\\main.py")).toBe("source");
      expect(classifyFileCategory("scripts/deploy.ps1")).toBe("source");
      expect(classifyFileCategory("tests/telemetry.test.ts")).toBe("test");
      expect(classifyFileCategory("test/helpers.ts")).toBe("test");
      expect(classifyFileCategory("__tests__/app.tsx")).toBe("test");
      expect(classifyFileCategory("src/lib/utils.spec.js")).toBe("test");
      expect(classifyFileCategory("docs/contexto/plan.md")).toBe("docs");
      expect(classifyFileCategory("README.md")).toBe("docs");
      expect(classifyFileCategory("CHANGELOG")).toBe("docs");
      expect(classifyFileCategory("LICENSE.txt")).toBe("docs");
      expect(classifyFileCategory("package.json")).toBe("config");
      expect(classifyFileCategory(".github/workflows/ci.yml")).toBe("config");
      expect(classifyFileCategory(".claude-plugin/plugin.json")).toBe("config");
      expect(classifyFileCategory(".gitignore")).toBe("config");
      expect(classifyFileCategory("")).toBe("source");
    });

    it("identifies governance and configuration surfaces", () => {
      expect(isGovernanceOrConfigSurface("CLAUDE.md")).toBe(true);
      expect(isGovernanceOrConfigSurface("AGENTS.md")).toBe(true);
      expect(isGovernanceOrConfigSurface("GEMINI.md")).toBe(true);
      expect(isGovernanceOrConfigSurface("package.json")).toBe(true);
      expect(isGovernanceOrConfigSurface(".github/workflows/ci.yml")).toBe(true);
      expect(isGovernanceOrConfigSurface(".lognexus/state.json")).toBe(true);
      expect(isGovernanceOrConfigSurface("README.md")).toBe(true);
      expect(isGovernanceOrConfigSurface("src/telemetry/schema.ts")).toBe(false);
      expect(isGovernanceOrConfigSurface("tests/telemetry.test.ts")).toBe(false);
      expect(isGovernanceOrConfigSurface("src/mcp/tools.ts")).toBe(false);
    });

    it("separates source and test diffs of the same extension without leaking paths", () => {
      mkdirSync(join(tempDir, "src"), { recursive: true });
      mkdirSync(join(tempDir, "tests"), { recursive: true });
      writeFileSync(join(tempDir, "src", "engine.ts"), "const a = 1;\nconst b = 2;\n", "utf8");
      writeFileSync(
        join(tempDir, "tests", "engine.test.ts"),
        "it('a', () => {});\nit('b', () => {});\nit('c', () => {});\n",
        "utf8",
      );
      execSync("git add src tests", { cwd: tempDir, stdio: "ignore" });
      execSync('git commit -m "feat: add engine and specs"', { cwd: tempDir, stdio: "ignore" });
      const sha = execSync("git rev-parse HEAD", { cwd: tempDir, encoding: "utf8" }).trim();

      const diffs = extractCommitDiffStats(sha, tempDir);
      const sourceTs = diffs.find((d) => d.ext === ".ts" && d.category === "source");
      const testTs = diffs.find((d) => d.ext === ".ts" && d.category === "test");

      expect(sourceTs?.linesAdded).toBe(2);
      expect(testTs?.linesAdded).toBe(3);

      const serialized = JSON.stringify(diffs);
      expect(serialized).not.toContain("engine");
      expect(serialized).not.toContain("src/");
      expect(serialized).not.toContain("tests/");
      expect(serialized).not.toContain("\u0000");
    });

    it("classifies doc and config diffs alongside source diffs", () => {
      mkdirSync(join(tempDir, "docs"), { recursive: true });
      writeFileSync(join(tempDir, "docs", "guide.md"), "# Guide\nBody\n", "utf8");
      writeFileSync(join(tempDir, "settings.json"), '{\n  "a": 1\n}\n', "utf8");
      execSync("git add -A", { cwd: tempDir, stdio: "ignore" });
      execSync('git commit -m "docs: guide"', { cwd: tempDir, stdio: "ignore" });
      const sha = execSync("git rev-parse HEAD", { cwd: tempDir, encoding: "utf8" }).trim();

      const diffs = extractCommitDiffStats(sha, tempDir);
      expect(diffs.find((d) => d.ext === ".md")?.category).toBe("docs");
      expect(diffs.find((d) => d.ext === ".json")?.category).toBe("config");
    });
  });

  describe("Gemini 4 Hydrogen Routing", () => {
    it("classifies every Hydrogen identity variant as the hydrogen family", () => {
      for (const identity of [
        "Gemini 4 Hydrogen",
        "Gemini 4 Hydrogen (Executor)",
        "gemini/hydrogen",
        "gemini/hydrogen (antigravity)",
        "google/gemini-4-hydrogen (antigravity)",
        "google/gemini-4-hydrogen-high (antigravity)",
      ]) {
        expect(extractModelFamilyCategory(identity)).toBe("gemini/hydrogen");
      }
    });

    it("routes Hydrogen identities to tier-2, never tier-1", () => {
      for (const identity of [
        "Gemini 4 Hydrogen",
        "gemini/hydrogen (antigravity)",
        "google/gemini-4-hydrogen (antigravity)",
        "google/gemini-4-hydrogen-high (antigravity)",
      ]) {
        expect(inferTierFromAuthor(identity)).toBe("tier-2");
      }
    });

    it("keeps Carbon and Argon as tier-1 flagship orchestrators", () => {
      expect(inferTierFromAuthor("Gemini 4 Carbon (anthropic-cloud)")).toBe("tier-1");
      expect(inferTierFromAuthor("Gemini 4 Argon (google-antigravity)")).toBe("tier-1");
      expect(extractModelFamilyCategory("Gemini 4 Carbon (antigravity)")).toBe("gemini/carbon");
      expect(extractModelFamilyCategory("Gemini 4 Argon (antigravity)")).toBe("gemini/argon");
    });
  });

  describe("Offline Guarantee", () => {
    const readSource = (file: string) =>
      readFileSync(join(repoRoot, "src", "telemetry", file), "utf8");

    it("contains no fetch() calls to remote endpoints in telemetry sources", () => {
      for (const file of [
        "benchmark.ts",
        "collector.ts",
        "detector.ts",
        "index.ts",
        "report.ts",
        "schema.ts",
      ]) {
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

  describe("LOC-Weighted ROI Estimator", () => {
    const writeLines = (relativePath: string, lineCount: number) => {
      const target = join(tempDir, relativePath);
      mkdirSync(dirname(target), { recursive: true });
      const body = Array.from({ length: lineCount }, (_, i) => `export const value${i} = ${i};`);
      writeFileSync(target, `${body.join("\n")}\n`, "utf8");
    };

    const commitAndRecord = (message: string, author: string, tier: string) => {
      execSync("git add -A", { cwd: tempDir, stdio: "ignore" });
      execSync(`git commit -q -m "${message}"`, { cwd: tempDir, stdio: "ignore" });
      const sha = execSync("git rev-parse HEAD", { cwd: tempDir, encoding: "utf8" }).trim();
      recordCommitTelemetry({ sha, author, tier, targetDir: tempDir });
      return sha;
    };

    it("prices a heavy refactor far above a one-line change on the same tier", () => {
      enableTelemetry({ cwd: tempDir });

      // Recorded straight from the commit so the incremental and replayed aggregates both
      // price the same commit identically.
      writeLines("src/small.ts", 1);
      commitAndRecord("feat(#61/T1): one line", "gemini/flash", "tier-3");
      const smallModel = loadTelemetry(tempDir).models["gemini/flash"];
      const smallCost = smallModel?.estimatedCostUsd ?? 0;
      const smallTokens =
        (smallModel?.estimatedInputTokens ?? 0) + (smallModel?.estimatedOutputTokens ?? 0);

      writeLines("src/large.ts", 100);
      commitAndRecord("feat(#61/T2): hundred lines", "gemini/flash", "tier-3");
      const largeModel = loadTelemetry(tempDir).models["gemini/flash"];
      const largeCost = largeModel?.estimatedCostUsd ?? 0;
      const largeTokens =
        (largeModel?.estimatedInputTokens ?? 0) + (largeModel?.estimatedOutputTokens ?? 0);

      expect(largeModel?.sourceLinesAdded).toBe(101);
      // `docsLinesAdded` folds documentation and configuration together. Here it is entirely
      // configuration: the telemetry store the recorder itself writes (47 plus 43 lines).
      expect(largeModel?.docsLinesAdded).toBe(90);

      const deltaCost = Number((largeCost - smallCost).toFixed(6));
      const deltaTokens = largeTokens - smallTokens;
      // 100 source lines cost 100x the per-line rate plus a token floor far above the
      // single-line commit, so a refactor can never be priced like a typo fix.
      expect(deltaCost).toBeCloseTo(0.002886, 6);
      expect(deltaTokens).toBe(3888);
    });

    it("prices source lines above documentation lines within one commit", () => {
      enableTelemetry({ cwd: tempDir });

      writeLines("src/engine.ts", 10);
      mkdirSync(join(tempDir, "docs"), { recursive: true });
      writeFileSync(join(tempDir, "docs", "guide.md"), "# Guide\n".repeat(20), "utf8");
      commitAndRecord("feat(#61/T3): engine and guide", "claude/haiku", "tier-3");

      const model = loadTelemetry(tempDir).models["claude/haiku"];
      expect(model?.sourceLinesAdded).toBe(10);
      // 20 guide lines plus the telemetry store the recorder writes during the commit (see
      // the bucket's total above); both land in the fold used for pricing.
      expect(model?.docsLinesAdded).toBe(67);
      // Tier-3: 0.002 base + 10 source lines at 0.000008 + 67 doc/config lines at 0.000002.
      expect(model?.estimatedCostUsd).toBeCloseTo(0.002214, 6);
    });

    it("scales the frontier baseline with the LOC actually shipped", () => {
      enableTelemetry({ cwd: tempDir });

      writeLines("src/engine.ts", 100);
      commitAndRecord("feat(#61/T4): engine", "gemini/flash", "tier-3");

      const summary = loadTelemetry(tempDir).summary;
      expect(summary.totalCommits).toBe(1);
      expect(summary.tierCommits["tier-3"]).toBe(1);
      // Tier-1 baseline for 100 source lines + the 47 lines of the telemetry store the
      // recorder writes alongside them: 0.05 + 100*0.00015 + 47*0.00004.
      expect(summary.estimatedBaselineCostUsd).toBe(0.067);
      expect(summary.estimatedActualCostUsd).toBe(0.003);
      expect(summary.estimatedCostSavingsUsd).toBe(0.064);
      expect(summary.estimatedBaselineTokens).toBeGreaterThan(summary.estimatedActualTokens);
      expect(summary.estimatedTokensSaved).toBeGreaterThan(0);
    });
  });

  describe("Scoped Filters & Git-Derived Metrics", () => {
    const note = (sha: string, payload: Record<string, unknown>) => {
      execFileSync(
        "git",
        ["notes", "--ref=lognexus", "add", "-f", "-m", JSON.stringify(payload), sha],
        { cwd: tempDir, stdio: "ignore", shell: false },
      );
    };

    const commitFile = (
      relativePath: string,
      body: string,
      message: string,
      author = "gemini/flash <flash@example.com>",
      dateIso?: string,
    ) => {
      const target = join(tempDir, relativePath);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, body, "utf8");
      execSync("git add -A", { cwd: tempDir, stdio: "ignore" });
      const dateFlag = dateIso ? ` --date "${dateIso}"` : "";
      execSync(`git commit -q -m "${message}" --author "${author}"${dateFlag}`, {
        cwd: tempDir,
        stdio: "ignore",
      });
      return execSync("git rev-parse HEAD", { cwd: tempDir, encoding: "utf8" }).trim();
    };

    it("preserves an explicit tier-3 recorded by a modern schema note", () => {
      const sha = commitFile(
        "worker.ts",
        "export const run = () => {};\n",
        "feat(#58/T1): add worker",
        "google/gemini-3.8-flash-high <flash@example.com>",
      );
      note(sha, {
        $schema: "lognexus/note/v1",
        issue: { id: 58 },
        subtask: { id: "T1" },
        tier: "tier-3",
      });

      enableTelemetry({ cwd: tempDir });
      const store = syncTelemetryFromGitNotes(tempDir, { issue: 58 });

      expect(store.summary.totalCommits).toBe(1);
      expect(store.summary.tierCommits["tier-3"]).toBe(1);
      expect(store.summary.tierCommits["tier-1"]).toBe(0);
      expect(store.models["gemini/flash-high"]?.tier).toBe("tier-3");
    });

    it("filters by numeric, hashed and alphanumeric issue identifiers without touching the store", () => {
      const numeric = commitFile("numeric.ts", "export const a = 1;\n", "feat(#58/T1): numeric");
      note(numeric, { issue: { id: 58 }, subtask: { id: "T1" } });
      const ticket = commitFile("ticket.ts", "export const b = 2;\n", "fix(SLM-201/T1): ticket");
      note(ticket, { issue: { id: "SLM-201" }, subtask: { id: "T1" } });
      const other = commitFile("other.ts", "export const c = 3;\n", "feat(#61/T1): other");
      note(other, { issue: { id: 61 }, subtask: { id: "T1" } });

      enableTelemetry({ cwd: tempDir });
      const persisted = syncTelemetryFromGitNotes(tempDir);
      const snapshot = readFileSync(getTelemetryPath(tempDir), "utf8");
      expect(persisted.summary.totalCommits).toBe(4);

      for (const [issue, expected] of [
        [58, 1],
        ["58", 1],
        ["#58", 1],
        ["SLM-201", 1],
        ["slm-201", 1],
        [61, 1],
      ] as const) {
        const scoped = syncTelemetryFromGitNotes(tempDir, { issue });
        expect(scoped.summary.totalCommits).toBe(expected);
      }

      expect(readFileSync(getTelemetryPath(tempDir), "utf8")).toBe(snapshot);
    });

    it("scopes by date window and branch without persisting a projection", () => {
      execSync("git checkout -q -b feature/telemetry", { cwd: tempDir, stdio: "ignore" });
      commitFile("branch.ts", "export const branch = true;\n", "feat(#61/T1): branch work");

      enableTelemetry({ cwd: tempDir });
      syncTelemetryFromGitNotes(tempDir);
      const snapshot = readFileSync(getTelemetryPath(tempDir), "utf8");

      const byBranch = syncTelemetryFromGitNotes(tempDir, {
        branch: "feature/telemetry",
        issue: 61,
      });
      expect(byBranch.summary.totalCommits).toBe(1);

      const bySince = syncTelemetryFromGitNotes(tempDir, { since: "2000-01-01" });
      expect(bySince.summary.totalCommits).toBe(2);

      const future = syncTelemetryFromGitNotes(tempDir, { since: "2099-01-01" });
      expect(future.summary.totalCommits).toBe(0);
      expect(future.summary.gitNotesCoveragePct).toBe(100);

      expect(() => syncTelemetryFromGitNotes(tempDir, { since: "--upload-pack=evil" })).toThrow(
        /Invalid telemetry scope value/,
      );

      expect(readFileSync(getTelemetryPath(tempDir), "utf8")).toBe(snapshot);
    });

    it("derives cadence, contract compliance, rework ratio and coverage from Git", () => {
      const baseMs = Date.parse(
        execSync("git log -1 --format=%aI HEAD", { cwd: tempDir, encoding: "utf8" }).trim(),
      );
      const contracted = commitFile(
        "src/engine.ts",
        "export const engine = 1;\n",
        "feat(#61/T1): engine",
        "gemini/flash <flash@example.com>",
        new Date(baseMs + 60_000).toISOString(),
      );
      note(contracted, {
        $schema: "lognexus/note/v1",
        issue: { id: 61 },
        subtask: { id: "T1", contract: { allowedFiles: ["src/engine.ts"] } },
      });

      const escaped = commitFile(
        "src/escape.ts",
        "export const escape = 1;\n",
        "feat(#61/T2): escape",
        "gemini/flash <flash@example.com>",
        new Date(baseMs + 180_000).toISOString(),
      );
      note(escaped, {
        $schema: "lognexus/note/v1",
        issue: { id: 61 },
        subtask: { id: "T2", contract: { allowedFiles: ["src/engine.ts"] } },
      });

      commitFile(
        "src/rework.ts",
        "export const rework = 1;\n",
        "fix(#61/T2): repair engine",
        "antigravity/lead-orchestrator <lead@example.com>",
        new Date(baseMs + 420_000).toISOString(),
      );

      enableTelemetry({ cwd: tempDir });
      const store = syncTelemetryFromGitNotes(tempDir);
      const summary = store.summary;

      expect(summary.contractedCommits).toBe(2);
      expect(summary.contractCompliancePct).toBe(50);
      expect(summary.reworkCommits).toBe(1);
      expect(summary.reworkRatioPct).toBe(25);
      // Only the two explicitly noted commits carry a Git Note; the coverage is a real ratio
      // over the scanned history, not a tautological share of the noted subset.
      expect(summary.gitNotesCoveragePct).toBe(50);
      expect(summary.escalatedCommits).toBe(0);
      // Both temporal metrics come from the recorded author timestamps, which the fixture
      // pins explicitly: deltas of 60s, 120s and 240s give a 420s span and a 120s median.
      expect(summary.activeDevelopmentSpanSec).toBe(420);
      expect(summary.medianCommitCadenceSec).toBe(120);
      expect(summary.tierCommits["tier-1"]).toBe(1);
      expect(summary.tierCommits["tier-3"]).toBe(1);
    });

    it("reports full coverage when every commit in the scope carries a note", () => {
      const first = commitFile("src/scope-a.ts", "export const a = 1;\n", "feat(#61/T1): a");
      note(first, { $schema: "lognexus/note/v1", issue: { id: 61 }, subtask: { id: "T1" } });

      // A commit outside the requested issue, deliberately left without a note.
      commitFile("src/other.ts", "export const other = 1;\n", "feat(#58/T1): other");

      const second = commitFile("src/scope-b.ts", "export const b = 1;\n", "feat(#61/T2): b");
      note(second, { $schema: "lognexus/note/v1", issue: { id: 61 }, subtask: { id: "T2" } });

      const scoped = syncTelemetryFromGitNotes(tempDir, { issue: 61 });
      expect(scoped.summary.totalCommits).toBe(2);
      expect(scoped.summary.gitNotesCoveragePct).toBe(100);

      // The same history read without a scope exposes the unnoted commit.
      const unscoped = syncTelemetryFromGitNotes(tempDir);
      expect(unscoped.summary.totalCommits).toBe(4);
      expect(unscoped.summary.gitNotesCoveragePct).toBe(50);
    });

    it("rolls one commit's source and test lines into a single extension entry", () => {
      enableTelemetry({ cwd: tempDir });

      const source = join(tempDir, "src", "engine.ts");
      const tests = join(tempDir, "tests", "engine.test.ts");
      mkdirSync(dirname(source), { recursive: true });
      mkdirSync(dirname(tests), { recursive: true });
      writeFileSync(source, "export const engine = 1;\n", "utf8");
      writeFileSync(tests, "expect(engine).toBe(1);\n", "utf8");
      execSync("git add -A", { cwd: tempDir, stdio: "ignore" });
      execSync('git commit -q -m "feat(#61/T3): engine and its test"', {
        cwd: tempDir,
        stdio: "ignore",
      });

      const store = syncTelemetryFromGitNotes(tempDir);
      const ts = store.extensions[".ts"];
      expect(ts).toBeDefined();
      // Both files are `.ts`, so the commit is counted once and both line totals are kept.
      expect(ts.commits).toBe(1);
      expect(ts.linesAdded).toBe(2);
      expect(ts.category).toBe("source");
    });

    it("counts source lines removed so the deletion total is not always zero", () => {
      enableTelemetry({ cwd: tempDir });

      writeFileSync(join(tempDir, "module.ts"), "export const a = 1;\n", "utf8");
      execSync("git add -A", { cwd: tempDir, stdio: "ignore" });
      execSync('git commit -q -m "feat(#61/T4): add module"', { cwd: tempDir, stdio: "ignore" });

      // `README.md` is a docs file, so these edits exercise the source counter in isolation.
      writeFileSync(join(tempDir, "README.md"), "# Test Repo\n\nExtra line.\n", "utf8");
      execSync("git add -A", { cwd: tempDir, stdio: "ignore" });
      execSync('git commit -q -m "docs(#61/T4): expand readme"', { cwd: tempDir, stdio: "ignore" });

      writeFileSync(join(tempDir, "module.ts"), "", "utf8");
      execSync("git add -A", { cwd: tempDir, stdio: "ignore" });
      execSync('git commit -q -m "refactor(#61/T4): trim module"', {
        cwd: tempDir,
        stdio: "ignore",
      });

      const summary = syncTelemetryFromGitNotes(tempDir).summary;
      expect(summary.sourceLinesAdded).toBe(1);
      expect(summary.sourceLinesDeleted).toBe(1);
    });

    it("excludes merge commits from the commit aggregates", () => {
      enableTelemetry({ cwd: tempDir });

      execSync("git checkout -q -b feature/merge", { cwd: tempDir, stdio: "ignore" });
      commitFile("src/side.ts", "export const side = 1;\n", "feat(#61/T5): side branch");
      execSync("git checkout -q -", { cwd: tempDir, stdio: "ignore" });
      // Both branches must carry their own commits, otherwise Git fast-forwards and no merge
      // commit is ever created — the very thing this test needs to observe.
      const mainFile = join(tempDir, "src", "main-line.ts");
      mkdirSync(dirname(mainFile), { recursive: true });
      writeFileSync(mainFile, "export const mainLine = 1;\n", "utf8");
      execSync("git add -A", { cwd: tempDir, stdio: "ignore" });
      execSync(
        'git commit -q -m "feat(#61/T5): mainline" --author "gemini/flash <flash@example.com>"',
        { cwd: tempDir, stdio: "ignore" },
      );
      execSync('git merge -q --no-ff feature/merge -m "chore(#61/T5): merge side branch"', {
        cwd: tempDir,
        stdio: "ignore",
      });

      // The merge commit really is in history; it is the scan that must skip it.
      const total = execSync("git rev-list --count HEAD", {
        cwd: tempDir,
        encoding: "utf8",
      }).trim();
      expect(Number(total)).toBe(4);
      const merges = execSync("git rev-list --merges --count HEAD", {
        cwd: tempDir,
        encoding: "utf8",
      }).trim();
      expect(Number(merges)).toBe(1);

      const summary = syncTelemetryFromGitNotes(tempDir).summary;
      expect(summary.totalCommits).toBe(3);
      expect(summary.reworkCommits).toBe(0);
    });

    it("preserves a mixed-tier commit distribution instead of collapsing to the last tier", () => {
      // Both identities collapse to the same model family (`gemini/flash`) while routing to
      // different tiers, so the buckets merge and the tier split must not be re-derived from
      // them — re-deriving it would overwrite the history with the last commit's tier.
      const high = "google/gemini-3.8-flash <flash@example.com>";
      const lite = "google/gemini-3.8-flash-lite <lite@example.com>";

      const tier2a = commitFile("src/a.ts", "export const a = 1;\n", "feat(#61/T6): a", high);
      const tier2b = commitFile("src/b.ts", "export const b = 1;\n", "feat(#61/T6): b", high);
      commitFile("src/c.ts", "export const c = 1;\n", "feat(#61/T6): c", lite);
      for (const sha of [tier2a, tier2b]) {
        note(sha, { $schema: "lognexus/note/v1", issue: { id: 61 }, subtask: { id: "T6" } });
      }

      const store = syncTelemetryFromGitNotes(tempDir);
      expect(store.summary.totalCommits).toBe(4);
      // The fixture's bootstrap commit is authored by the test runner and lands in the
      // anonymous bucket, which falls back to the default tier; the two model identities
      // collapse into one family bucket.
      expect(store.models["gemini/flash"].commits).toBe(3);
      expect(store.summary.tierCommits["tier-1"]).toBe(0);
      expect(store.summary.tierCommits["tier-2"]).toBe(2);
      expect(store.summary.tierCommits["tier-3"]).toBe(2);
    });
  });
});
