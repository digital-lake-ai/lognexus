import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractIssueNumber } from "../src/branch.js";
import { getProjectStatus, getScopeDrift } from "../src/status.js";

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
