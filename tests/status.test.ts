import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractIssueNumber } from "../src/branch.js";
import {
  countPublishedReleases,
  detectHostProjectVersion,
  detectProjectManifestVersions,
  getProjectStatus,
  getScopeDrift,
} from "../src/status.js";

describe("getProjectStatus", () => {
  it("reports current repository status and branch", () => {
    const status = getProjectStatus(process.cwd());

    expect(status.isInsideGit).toBe(true);
    expect(typeof status.branch).toBe("string");
    expect(status.branch.length).toBeGreaterThan(0);
    expect(["confirm", "warn", "off", "not configured"]).toContain(status.routingMode);
    expect(typeof status.recommendedTier).toBe("string");
    expect(status.recommendedTier).toContain("tier-");
  });

  it("reports no active issue outside a Git repository", () => {
    const dir = mkdtempSync(join(tmpdir(), "lognexus-status-"));
    try {
      const status = getProjectStatus(dir);
      expect(status.isInsideGit).toBe(false);
      expect(status.activeIssue).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("recommends tier-1 with the consolidated Gemini 4 Carbon / Argon identity on main", () => {
    const dir = mkdtempSync(join(tmpdir(), "lognexus-status-main-"));
    try {
      execFileSync("git", ["init", "-b", "main"], { cwd: dir, stdio: "ignore", shell: false });
      const status = getProjectStatus(dir);

      expect(status.branch).toBe("main");
      expect(status.recommendedTier).toContain("tier-1");
      expect(status.recommendedTier).toContain("Gemini 4 Carbon / Argon");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("tailors recommendedTier to a single detected ecosystem without vendor nagging", () => {
    const dir = mkdtempSync(join(tmpdir(), "lognexus-status-claude-"));
    try {
      execFileSync("git", ["init", "-b", "main"], { cwd: dir, stdio: "ignore", shell: false });
      mkdirSync(join(dir, ".claude"));
      const status = getProjectStatus(dir);

      expect(status.ecosystemProfile).toBe("single-client (claude-code)");
      expect(status.reviewGateMode).toBe("intra-fleet");
      expect(status.recommendedTier).toContain("Claude Opus");
      expect(status.recommendedTier).toContain("Claude Fable 5.2");
      expect(status.recommendedTier).toContain("Mythos 5.2");
      expect(status.recommendedTier).not.toContain("Gemini");

      execFileSync("git", ["checkout", "-b", "issue/76-claude"], {
        cwd: dir,
        stdio: "ignore",
        shell: false,
      });
      const claudeIssue = getProjectStatus(dir);
      expect(claudeIssue.recommendedTier).toBe("tier-3 (Scoped Execution: Claude Haiku 5.5)");
      expect(claudeIssue.recommendedTier).not.toContain("Sonnet 5.5");
      expect(claudeIssue.recommendedTier).not.toContain("GPT-6.2 Sol");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports 2026 model recommendations for codex, copilot, cursor, and active issue branches", () => {
    const codexDir = mkdtempSync(join(tmpdir(), "lognexus-status-codex-"));
    const copilotDir = mkdtempSync(join(tmpdir(), "lognexus-status-copilot-"));
    try {
      execFileSync("git", ["init", "-b", "main"], { cwd: codexDir, stdio: "ignore", shell: false });
      mkdirSync(join(codexDir, ".codex"));
      const codexMain = getProjectStatus(codexDir);
      expect(codexMain.ecosystemProfile).toBe("single-client (codex)");
      expect(codexMain.recommendedTier).toContain("OpenAI GPT-6.2 Astra");

      execFileSync("git", ["checkout", "-b", "issue/76-codex"], {
        cwd: codexDir,
        stdio: "ignore",
        shell: false,
      });
      const codexIssue = getProjectStatus(codexDir);
      expect(codexIssue.recommendedTier).toContain("GPT-6 Luna");
      expect(codexIssue.recommendedTier).toContain("codex-mini");
      expect(codexIssue.recommendedTier).not.toContain("Sonnet 5.5");
      expect(codexIssue.recommendedTier).not.toContain("GPT-6.2 Sol");

      execFileSync("git", ["init", "-b", "main"], {
        cwd: copilotDir,
        stdio: "ignore",
        shell: false,
      });
      mkdirSync(join(copilotDir, ".github"), { recursive: true });
      writeFileSync(join(copilotDir, ".github", "copilot-instructions.md"), "# Copilot\n", "utf8");
      const copilotMain = getProjectStatus(copilotDir);
      expect(copilotMain.ecosystemProfile).toBe("single-client (copilot)");
      expect(copilotMain.recommendedTier).toContain("Claude Fable 5.2 / GPT-6.2 Astra");

      execFileSync("git", ["checkout", "-b", "issue/76-copilot"], {
        cwd: copilotDir,
        stdio: "ignore",
        shell: false,
      });
      const copilotIssue = getProjectStatus(copilotDir);
      expect(copilotIssue.recommendedTier).toContain("Claude Haiku 5.5");
      expect(copilotIssue.recommendedTier).toContain("GPT-6 Luna");
      expect(copilotIssue.recommendedTier).not.toContain("Sonnet 5.5");
      expect(copilotIssue.recommendedTier).not.toContain("GPT-6.2 Sol");
    } finally {
      rmSync(codexDir, { recursive: true, force: true });
      rmSync(copilotDir, { recursive: true, force: true });
    }
  });

  it("recommends pure tier-3 Gemini 3.8 Flash for antigravity on active issue branches", () => {
    const dir = mkdtempSync(join(tmpdir(), "lognexus-status-antigravity-"));
    try {
      execFileSync("git", ["init", "-b", "main"], { cwd: dir, stdio: "ignore", shell: false });
      mkdirSync(join(dir, ".gemini"));
      execFileSync("git", ["checkout", "-b", "issue/78-antigravity"], {
        cwd: dir,
        stdio: "ignore",
        shell: false,
      });
      const status = getProjectStatus(dir);
      expect(status.ecosystemProfile).toBe("single-client (antigravity)");
      expect(status.recommendedTier).toBe("tier-3 (Scoped Execution: Gemini 3.8 Flash)");
      expect(status.recommendedTier).not.toContain("Hydrogen");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ignores commented routing directives when reporting routingMode", () => {
    const dir = mkdtempSync(join(tmpdir(), "lognexus-status-comments-"));
    try {
      mkdirSync(join(dir, ".lognexus"));
      writeFileSync(
        join(dir, ".lognexus", "routing.md"),
        "# routing: off\n<!-- routing: off -->\nrouting: warn\n",
        "utf8",
      );
      const status = getProjectStatus(dir);
      expect(status.routingMode).toBe("warn");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("host project SemVer visibility", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lognexus-semver-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("reads the version from package.json", () => {
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({ version: "2.4.1" }), "utf8");
    expect(detectHostProjectVersion(tempDir)).toBe("2.4.1");
  });

  it("falls back to pyproject.toml and Cargo.toml", () => {
    writeFileSync(
      join(tempDir, "pyproject.toml"),
      '[project]\nname = "demo"\nversion = "0.3.0"\n',
      "utf8",
    );
    expect(detectHostProjectVersion(tempDir)).toBe("0.3.0");

    rmSync(join(tempDir, "pyproject.toml"));
    writeFileSync(
      join(tempDir, "Cargo.toml"),
      '[package]\nname = "demo"\nversion = "0.1.2"\n',
      "utf8",
    );
    expect(detectHostProjectVersion(tempDir)).toBe("0.1.2");
  });

  it("returns null when no manifest declares a version", () => {
    expect(detectHostProjectVersion(tempDir)).toBeNull();

    writeFileSync(join(tempDir, "package.json"), JSON.stringify({ name: "demo" }), "utf8");
    expect(detectHostProjectVersion(tempDir)).toBeNull();
  });

  it("counts published Git tags and reports zero without tags or outside Git", () => {
    execFileSync("git", ["init"], { cwd: tempDir, stdio: "ignore", shell: false });
    expect(countPublishedReleases(tempDir)).toBe(0);
    expect(countPublishedReleases(join(tempDir, "not-a-repo"))).toBe(0);

    execFileSync(
      "git",
      [
        "-c",
        "user.name=T",
        "-c",
        "user.email=t@example.com",
        "commit",
        "-m",
        "chore: seed",
        "--allow-empty",
      ],
      {
        cwd: tempDir,
        stdio: "ignore",
        shell: false,
      },
    );
    execFileSync(
      "git",
      [
        "-c",
        "user.name=T",
        "-c",
        "user.email=t@example.com",
        "tag",
        "-a",
        "v0.1.0",
        "-m",
        "v0.1.0",
      ],
      {
        cwd: tempDir,
        stdio: "ignore",
        shell: false,
      },
    );
    expect(countPublishedReleases(tempDir)).toBe(1);
  });

  it("exposes version and release count through getProjectStatus", () => {
    execFileSync("git", ["init"], { cwd: tempDir, stdio: "ignore", shell: false });
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({ version: "0.1.0" }), "utf8");

    const status = getProjectStatus(tempDir);
    expect(status.isInsideGit).toBe(true);
    expect(status.projectVersion).toBe("0.1.0");
    expect(status.publishedReleases).toBe(0);
  });

  it("detects multi-manifest versions across Tauri, Cargo, Python and depth-2 plugin manifests", () => {
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({ version: "0.4.0" }), "utf8");
    mkdirSync(join(tempDir, "src-tauri"), { recursive: true });
    writeFileSync(
      join(tempDir, "src-tauri", "tauri.conf.json"),
      JSON.stringify({ package: { version: "0.4.0" } }),
      "utf8",
    );
    writeFileSync(
      join(tempDir, "src-tauri", "Cargo.toml"),
      '[package]\nname = "app"\nversion = "0.4.0" # desktop crate\n[dependencies]\nserde = "1.0"\n',
      "utf8",
    );
    mkdirSync(join(tempDir, "modules", "modA"), { recursive: true });
    writeFileSync(
      join(tempDir, "modules", "modA", "plugin.manifest.json"),
      JSON.stringify({ version: "0.5.0" }),
      "utf8",
    );
    mkdirSync(join(tempDir, "node_modules", "ignored"), { recursive: true });
    writeFileSync(
      join(tempDir, "node_modules", "ignored", "plugin.manifest.json"),
      JSON.stringify({ version: "9.9.9" }),
      "utf8",
    );
    mkdirSync(join(tempDir, "a", "b", "c"), { recursive: true });
    writeFileSync(
      join(tempDir, "a", "b", "c", "plugin.manifest.json"),
      JSON.stringify({ version: "8.8.8" }),
      "utf8",
    );

    const manifests = detectProjectManifestVersions(tempDir);
    expect(manifests).toEqual([
      { path: "package.json", version: "0.4.0" },
      { path: "src-tauri/tauri.conf.json", version: "0.4.0" },
      { path: "src-tauri/Cargo.toml", version: "0.4.0" },
      { path: "modules/modA/plugin.manifest.json", version: "0.5.0" },
    ]);
  });

  it("falls back to src-tauri/tauri.conf.json and ignores non-package TOML sections", () => {
    writeFileSync(
      join(tempDir, "Cargo.toml"),
      '[workspace]\nmembers = ["crates/a"]\n[dependencies]\nversion = "9.9.9"\n',
      "utf8",
    );
    mkdirSync(join(tempDir, "src-tauri"), { recursive: true });
    writeFileSync(
      join(tempDir, "src-tauri", "tauri.conf.json"),
      JSON.stringify({ version: "0.2.0" }),
      "utf8",
    );

    expect(detectHostProjectVersion(tempDir)).toBe("0.2.0");
  });
});

describe("live scope-drift guard", () => {
  let tempDir: string;

  function git(args: string[]): void {
    execFileSync("git", args, { cwd: tempDir, stdio: "ignore", shell: false });
  }

  function writeState(allowedFiles: string[], status?: string): void {
    mkdirSync(join(tempDir, ".lognexus"), { recursive: true });
    writeFileSync(
      join(tempDir, ".lognexus", "state.json"),
      JSON.stringify({
        currentSubtask: { id: "T1", ...(status ? { status } : {}), contract: { allowedFiles } },
      }),
      "utf8",
    );
  }

  function touch(file: string): void {
    const full = join(tempDir, file);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, "content\n", "utf8");
  }

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lognexus-drift-test-"));
    git(["init"]);
    git(["config", "user.name", "Test Runner"]);
    git(["config", "user.email", "test@example.com"]);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("reports no drift when there is no contracted subtask", () => {
    touch("loose.txt");

    const drift = getScopeDrift(tempDir);
    expect(drift.detected).toBe(false);
    expect(drift.allowedFiles).toEqual([]);
  });

  it("stays clean when every touched file is inside the contract", () => {
    writeState(["src/allowed.ts"]);
    touch("src/allowed.ts");

    const drift = getScopeDrift(tempDir);
    expect(drift.detected).toBe(false);
    expect(drift.unauthorizedFiles).toEqual([]);
    expect(drift.allowedFiles).toEqual(["src/allowed.ts"]);
  });

  it("flags files changed outside the contract", () => {
    writeState(["src/allowed.ts"]);
    touch("src/allowed.ts");
    touch("src/rogue.ts");

    const drift = getScopeDrift(tempDir);
    expect(drift.detected).toBe(true);
    expect(drift.unauthorizedFiles).toEqual(["src/rogue.ts"]);
  });

  it("ignores agent bookkeeping and plan documents", () => {
    writeState(["src/allowed.ts"]);
    touch("src/allowed.ts");
    touch(".lognexus/state.json");
    touch("docs/contexto/issue-30-plan.md");

    const drift = getScopeDrift(tempDir);
    expect(drift.detected).toBe(false);
  });

  it("exempts a completed subtask from drift tracking entirely", () => {
    writeState(["src/allowed.ts"], "completed");
    touch("src/rogue.ts");

    const drift = getScopeDrift(tempDir);
    expect(drift.detected).toBe(false);
    expect(drift.allowedFiles).toEqual([]);
    expect(drift.unauthorizedFiles).toEqual([]);
  });

  it("keeps the full path of an unstaged modification on the first status line", () => {
    writeState(["src/allowed.ts"]);
    touch("src/allowed.ts");
    git(["add", "src/allowed.ts"]);
    // Rewrite without staging: git now reports " M src/allowed.ts", whose leading
    // space used to be trimmed away and shift every path by one character.
    writeFileSync(join(tempDir, "src/allowed.ts"), "changed\n", "utf8");
    touch("src/rogue.ts");

    const drift = getScopeDrift(tempDir);
    expect(drift.allowedFiles).toEqual(["src/allowed.ts"]);
    expect(drift.unauthorizedFiles).toEqual(["src/rogue.ts"]);
  });

  it("reads the destination path of a renamed file", () => {
    writeState(["src/renamed.ts"]);
    touch("src/original.ts");
    git(["add", "src/original.ts"]);
    git([
      "-c",
      "user.name=Test Runner",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-m",
      "chore: seed",
    ]);
    git(["mv", "src/original.ts", "src/renamed.ts"]);

    const drift = getScopeDrift(tempDir);
    expect(drift.unauthorizedFiles).toEqual([]);
    expect(drift.detected).toBe(false);
  });
});

describe("active issue detection lane parity", () => {
  it("derives the same active issue from issue/ and security/ lanes", () => {
    const issueLane = extractIssueNumber("issue/22-audit-and-supply-chain");
    const securityLane = extractIssueNumber("security/22-audit-and-supply-chain");

    expect(issueLane).toBe("22");
    expect(securityLane).toBe(issueLane);
  });

  it("yields no active issue on protected branches", () => {
    expect(extractIssueNumber("main")).toBeNull();
    expect(extractIssueNumber("master")).toBeNull();
  });
});
