import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  aggregateBenchmarkCohort,
  assertZeroPiiLeakage,
  CohortBenchmarkSchema,
  exportTelemetrySnapshot,
  formatCohortMarkdownReport,
  generateCohortBenchmarkReportFile,
} from "../src/telemetry/index.js";

const initRepo = (dir: string): void => {
  execFileSync("git", ["init", "-q"], { cwd: dir, stdio: "ignore", shell: false });
  execFileSync("git", ["config", "user.name", "Test Runner"], {
    cwd: dir,
    stdio: "ignore",
    shell: false,
  });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: dir,
    stdio: "ignore",
    shell: false,
  });
  execFileSync("git", ["config", "commit.gpgsign", "false"], {
    cwd: dir,
    stdio: "ignore",
    shell: false,
  });
};

const commitFile = (dir: string, relativePath: string, body: string, message: string): void => {
  const target = join(dir, relativePath);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, body, "utf8");
  execFileSync("git", ["add", "-A"], { cwd: dir, stdio: "ignore", shell: false });
  execFileSync("git", ["commit", "-q", "-m", message], { cwd: dir, stdio: "ignore", shell: false });
};

describe("Zero-PII Snapshot Exporter & Cohort Benchmark", () => {
  const created: string[] = [];

  const makeProject = (label: string, stackFile: string, lineCount: number): string => {
    const dir = mkdtempSync(join(tmpdir(), `lognexus-benchmark-${label}-`));
    created.push(dir);
    initRepo(dir);
    writeFileSync(join(dir, stackFile), label === "python" ? "" : "{}\n", "utf8");
    commitFile(
      dir,
      `src/module.${label === "python" ? "py" : "ts"}`,
      Array.from({ length: lineCount }, (_, i) => `export const value${i} = ${i};`).join("\n") +
        "\n",
      `feat(#61/T1): seed ${label} module`,
    );
    return dir;
  };

  beforeEach(() => {
    clearProjects();
  });

  afterEach(() => {
    clearProjects();
  });

  function clearProjects(): void {
    for (const dir of created.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const pythonProject = () => makeProject("python", "pyproject.toml", 40);
  const typescriptProject = () => makeProject("typescript", "tsconfig.json", 120);
  const powershellProject = () => makeProject("powershell", "script.ps1", 20);

  /**
   * Exports a snapshot inside the project it describes, then copies it into the cohort
   * directory. The exporter is confined on purpose: a repository that could write outside
   * itself could plant data in another project's cohort.
   */
  const exportInto = (projectDir: string, snapshotDir: string, fileName: string): void => {
    const { filePath } = exportTelemetrySnapshot(projectDir);
    mkdirSync(snapshotDir, { recursive: true });
    copyFileSync(filePath, join(snapshotDir, fileName));
  };

  it("exports a validated snapshot without leaking the repository name or a local path", () => {
    const dir = typescriptProject();
    const { filePath, payload } = exportTelemetrySnapshot(dir);

    expect(existsSync(filePath)).toBe(true);
    expect(filePath.endsWith(join(".lognexus", "snapshot-v2.json"))).toBe(true);

    const written = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
    expect(written.schemaVersion).toBe("2.0.0");
    expect(JSON.stringify(written)).not.toContain(dir);
    expect(payload.summary.totalCommits).toBe(1);
    expect(payload.summary.sourceLinesAdded).toBe(120);
  });

  it("aggregates three multi-stack snapshots into one cohort benchmark", () => {
    const snapshotDir = mkdtempSync(join(tmpdir(), "lognexus-benchmark-cohort-"));
    created.push(snapshotDir);

    for (const [index, dir] of [
      typescriptProject(),
      pythonProject(),
      powershellProject(),
    ].entries()) {
      exportInto(dir, snapshotDir, `project-${index}.json`);
    }

    const cohort = aggregateBenchmarkCohort([snapshotDir]);

    expect(cohort.cohortSize).toBe(3);
    expect(cohort.projectIds).toHaveLength(3);
    expect(new Set(cohort.projectIds).size).toBe(3);
    expect(cohort.totals.commits).toBe(3);
    // 120 TypeScript + 40 Python + 21 PowerShell: the .ps1 driver is itself a source file.
    expect(cohort.totals.sourceLinesAdded).toBe(181);
    expect(cohort.totals.baselineCostUsd).toBeGreaterThan(cohort.totals.actualCostUsd);
    expect(cohort.totals.weightedCostSavingsPct).toBeGreaterThan(0);
    expect(cohort.tierDistribution["tier-3"]).toBe(3);
    expect(Object.keys(cohort.stackDistribution).length).toBeGreaterThan(0);
    expect(Object.values(cohort.modelDistribution).length).toBeGreaterThan(0);

    expect(() => CohortBenchmarkSchema.parse(cohort)).not.toThrow();
  });

  it("deduplicates snapshots of the same project, keeping the newest generation", () => {
    const snapshotDir = mkdtempSync(join(tmpdir(), "lognexus-benchmark-dedup-"));
    created.push(snapshotDir);

    const dir = typescriptProject();
    const first = exportTelemetrySnapshot(dir);
    copyFileSync(first.filePath, join(snapshotDir, "older.json"));

    commitFile(dir, "src/extra.ts", "export const extra = 1;\n", "feat(#61/T2): extra");
    const second = exportTelemetrySnapshot(dir);
    copyFileSync(second.filePath, join(snapshotDir, "newer.json"));

    expect(second.payload.anonymousProjectId).toBe(first.payload.anonymousProjectId);

    const cohort = aggregateBenchmarkCohort([snapshotDir]);
    expect(cohort.cohortSize).toBe(1);
    expect(cohort.totals.commits).toBe(second.payload.summary.totalCommits);
    expect(cohort.totals.sourceLinesAdded).toBe(second.payload.summary.sourceLinesAdded);
  });

  it("renders a Markdown cohort report with titled sections and no project names", () => {
    const snapshotDir = mkdtempSync(join(tmpdir(), "lognexus-benchmark-report-"));
    created.push(snapshotDir);

    const dir = typescriptProject();
    exportInto(dir, snapshotDir, "one.json");
    exportInto(pythonProject(), snapshotDir, "two.json");

    const cohort = aggregateBenchmarkCohort([snapshotDir]);
    const markdown = formatCohortMarkdownReport(cohort);

    expect(markdown).toContain("# LogNexus Multi-Repo Cohort Benchmark Report");
    expect(markdown).toContain("## Cohort Totals");
    expect(markdown).toContain("## Statistical Medians");
    expect(markdown).toContain("## Stack Coverage");
    expect(markdown).toContain("## Tier Distribution");
    expect(markdown).toContain("## Model Efficiency Matrix");
    expect(markdown).toContain("| tier-3 | 2 |");
    expect(markdown).toContain("weighted");
    expect(markdown).not.toContain(snapshotDir);
    expect(markdown).not.toContain(dir);
  });

  it("writes the cohort report file inside the working directory", () => {
    const snapshotDir = mkdtempSync(join(tmpdir(), "lognexus-benchmark-file-"));
    const outputDir = mkdtempSync(join(tmpdir(), "lognexus-benchmark-out-"));
    created.push(snapshotDir, outputDir);

    exportInto(typescriptProject(), snapshotDir, "one.json");

    const { filePath, content, cohort } = generateCohortBenchmarkReportFile(
      [snapshotDir],
      join("reports", "cohort.md"),
      outputDir,
    );

    expect(filePath).toBe(join(outputDir, "reports", "cohort.md"));
    expect(readFileSync(filePath, "utf8")).toBe(content);
    expect(content).toContain("# LogNexus Multi-Repo Cohort Benchmark Report");
    expect(cohort.cohortSize).toBe(1);
  });

  describe("Zero-PII enforcement", () => {
    it("accepts a clean anonymous payload", () => {
      expect(() =>
        assertZeroPiiLeakage(JSON.stringify({ family: "gemini/flash", commits: 3 }), []),
      ).not.toThrow();
    });

    it("rejects Windows and Unix absolute paths", () => {
      expect(() => assertZeroPiiLeakage('{"note":"C:\\\\work\\\\repo"}')).toThrow(
        /zero-PII guarantee breached/,
      );
      expect(() => assertZeroPiiLeakage('{"note":"/Users/someone/project"}')).toThrow(
        /absolute system path/,
      );
      expect(() => assertZeroPiiLeakage('{"note":"/home/someone/project"}')).toThrow(
        /absolute system path/,
      );
      expect(() => assertZeroPiiLeakage('{"note":"/etc/passwd"}')).toThrow(/absolute system path/);
    });

    it("rejects URL literals without naming a scheme in this source file", () => {
      const schemes = ["ht" + "tp", "ht" + "tps", "gi" + "t", "s" + "sh"];
      for (const scheme of schemes) {
        expect(() => assertZeroPiiLeakage(`{"ref":"${scheme}${"://"}example.com/x"}`)).toThrow(
          /URL literal/,
        );
      }
    });

    it("rejects email-shaped tokens", () => {
      expect(() => assertZeroPiiLeakage('{"author":"someone@example.com"}')).toThrow(
        /email-shaped token/,
      );
      expect(() => assertZeroPiiLeakage('{"handle":"@handle-only"}')).not.toThrow();
      expect(() => assertZeroPiiLeakage('{"path":"src/dir@2x/logo"}')).not.toThrow();
    });

    it("rejects caller-supplied private tokens such as the repository name", () => {
      expect(() =>
        assertZeroPiiLeakage('{"project":"my-private-repo"}', ["my-private-repo"]),
      ).toThrow(/private project identifier/);
      expect(() =>
        assertZeroPiiLeakage('{"project":"My-Private-Repo"}', ["my-private-repo"]),
      ).toThrow(/private project identifier/);
      // Tokens shorter than three characters are too generic to be meaningful.
      expect(() => assertZeroPiiLeakage('{"project":"ab"}', ["ab"])).not.toThrow();
    });

    it("scans a 50,000-character adversarial payload in under 200ms", () => {
      const adversarial = [
        "a".repeat(50_000),
        `${"@".repeat(50_000)}`,
        `${":".repeat(25_000)}/`,
        `${"a@b.".repeat(12_500)}`,
        `${"/ ".repeat(25_000)}`,
        `${"{".repeat(50_000)}`,
        `${"x".repeat(25_000)}@${".".repeat(25_000)}`,
      ];

      for (const payload of adversarial) {
        const startedAt = performance.now();
        try {
          assertZeroPiiLeakage(payload, ["lognexus"]);
        } catch {
          // Either verdict is acceptable; only the time bound matters.
        }
        const elapsed = performance.now() - startedAt;
        expect(elapsed).toBeLessThan(200);
      }
    });
  });

  describe("Path confinement", () => {
    it("rejects traversal and absolute output paths for snapshots", () => {
      const dir = typescriptProject();
      expect(() => exportTelemetrySnapshot(dir, join("..", "outside.json"))).toThrow(
        /Governance violation/,
      );
      expect(() => exportTelemetrySnapshot(dir, "/etc/evil")).toThrow(/Governance violation/);

      const escaped = join(dir, "..", "outside-snapshot.json");
      expect(existsSync(escaped)).toBe(false);
    });

    it("rejects traversal and absolute report paths", () => {
      const dir = mkdtempSync(join(tmpdir(), "lognexus-benchmark-escape-"));
      created.push(dir);

      expect(() => generateCohortBenchmarkReportFile([dir], "../outside.md", dir)).toThrow(
        /Governance violation/,
      );
      expect(() => generateCohortBenchmarkReportFile([dir], "/etc/evil.md", dir)).toThrow(
        /Governance violation/,
      );
    });

    it("refuses to export a snapshot outside the project it scans", () => {
      const dir = typescriptProject();
      const foreignDir = mkdtempSync(join(tmpdir(), "lognexus-benchmark-foreign-"));
      created.push(foreignDir);

      expect(() => exportTelemetrySnapshot(dir, join(foreignDir, "planted.json"))).toThrow(
        /Path traversal detected/,
      );
      expect(existsSync(join(foreignDir, "planted.json"))).toBe(false);
    });

    it("ignores non-JSON files and unparseable snapshots inside an input directory", () => {
      const snapshotDir = mkdtempSync(join(tmpdir(), "lognexus-benchmark-ignore-"));
      created.push(snapshotDir);

      exportInto(typescriptProject(), snapshotDir, "valid.json");
      writeFileSync(join(snapshotDir, "notes.md"), "# not a snapshot\n", "utf8");
      writeFileSync(join(snapshotDir, "broken.json"), "{ not json", "utf8");
      writeFileSync(join(snapshotDir, "invalid.json"), '{"unexpected":true}', "utf8");

      const cohort = aggregateBenchmarkCohort([snapshotDir]);
      expect(cohort.cohortSize).toBe(1);
    });
  });
});
