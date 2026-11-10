import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkGit,
  checkRulesConfig,
  checkScopeDrift,
  checkVersionMaturity,
  runDiagnostics,
} from "../src/doctor.js";

describe("doctor diagnostics", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lognexus-doctor-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("checks git presence and repository status", () => {
    const check = checkGit(process.cwd());
    expect(check.name).toBe("Git");
    expect(check.status).toBe("pass");
  });

  it("warns when no .lognexus directory is found", () => {
    const check = checkRulesConfig(tempDir);
    expect(check.status).toBe("warn");
    expect(check.message).toContain("No .lognexus/ directory found");
  });

  it("passes when .lognexus/routing.md is present", () => {
    const logDir = join(tempDir, ".lognexus");
    mkdirSync(logDir);
    writeFileSync(join(logDir, "routing.md"), "# Routing\nrouting: warn\n", "utf8");

    const check = checkRulesConfig(tempDir);
    expect(check.status).toBe("pass");
    expect(check.message).toContain("routing mode: warn");
  });

  it("runDiagnostics returns an array of checks", () => {
    const results = runDiagnostics(process.cwd());
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThanOrEqual(4);
  });

  it("reports the Scope Drift Guard as passing when no subtask is active", () => {
    const check = checkScopeDrift(tempDir);
    expect(check.name).toBe("Scope Drift Guard");
    expect(check.status).toBe("pass");
    expect(check.message).toContain("nothing to compare against");
  });

  it("warns when the working tree leaves the contracted scope", () => {
    const logDir = join(tempDir, ".lognexus");
    mkdirSync(logDir);
    writeFileSync(
      join(logDir, "state.json"),
      JSON.stringify({ currentSubtask: { id: "T1", contract: { allowedFiles: ["src/ok.ts"] } } }),
      "utf8",
    );
    writeFileSync(join(tempDir, "rogue.ts"), "content\n", "utf8");
    execFileSync("git", ["init"], { cwd: tempDir, stdio: "ignore", shell: false });

    const check = checkScopeDrift(tempDir);
    expect(check.status).toBe("warn");
    expect(check.message).toContain("rogue.ts");
  });

  it("includes the Scope Drift Guard in the diagnostics table", () => {
    const results = runDiagnostics(process.cwd());
    expect(results.some((check) => check.name === "Scope Drift Guard")).toBe(true);
  });

  it("reports pass when the contracted subtask is already completed", () => {
    const logDir = join(tempDir, ".lognexus");
    mkdirSync(logDir);
    writeFileSync(
      join(logDir, "state.json"),
      JSON.stringify({
        currentSubtask: {
          id: "T1",
          status: "completed",
          contract: { allowedFiles: ["src/ok.ts"] },
        },
      }),
      "utf8",
    );
    writeFileSync(join(tempDir, "rogue.ts"), "content\n", "utf8");
    execFileSync("git", ["init"], { cwd: tempDir, stdio: "ignore", shell: false });

    const check = checkScopeDrift(tempDir);
    expect(check.status).toBe("pass");
    expect(check.message).toContain("nothing to compare against");
  });

  describe("Version Maturity", () => {
    function initRepo(): void {
      execFileSync("git", ["init"], { cwd: tempDir, stdio: "ignore", shell: false });
      writeFileSync(join(tempDir, "README.md"), "# demo\n", "utf8");
      execFileSync("git", ["add", "README.md"], { cwd: tempDir, stdio: "ignore", shell: false });
      execFileSync(
        "git",
        ["-c", "user.name=T", "-c", "user.email=t@example.com", "commit", "-m", "chore: seed"],
        { cwd: tempDir, stdio: "ignore", shell: false },
      );
    }

    it("warns on the npm init -y default version with no published release", () => {
      initRepo();
      writeFileSync(join(tempDir, "package.json"), JSON.stringify({ version: "1.0.0" }), "utf8");

      const check = checkVersionMaturity(tempDir);
      expect(check.name).toBe("Version Maturity");
      expect(check.status).toBe("warn");
      expect(check.message).toContain("npm init -y");
      expect(check.message).toContain("0.1.0");
    });

    it("passes when the manifest starts at 0.1.0", () => {
      initRepo();
      writeFileSync(join(tempDir, "package.json"), JSON.stringify({ version: "0.1.0" }), "utf8");

      const check = checkVersionMaturity(tempDir);
      expect(check.status).toBe("pass");
      expect(check.message).toContain("Manifest version 0.1.0");
    });

    it("passes once a release tag exists", () => {
      initRepo();
      writeFileSync(join(tempDir, "package.json"), JSON.stringify({ version: "1.0.0" }), "utf8");
      execFileSync("git", ["tag", "-a", "v1.0.0", "-m", "v1.0.0"], {
        cwd: tempDir,
        stdio: "ignore",
        shell: false,
      });

      const check = checkVersionMaturity(tempDir);
      expect(check.status).toBe("pass");
      expect(check.message).toContain("1 release(s) published");
    });

    it("skips the check when no manifest declares a version", () => {
      initRepo();

      const check = checkVersionMaturity(tempDir);
      expect(check.status).toBe("pass");
      expect(check.message).toContain("No package manifest detected");
    });

    it("is the fifth check in the diagnostics table", () => {
      const results = runDiagnostics(process.cwd());
      expect(results[4]?.name).toBe("Version Maturity");
    });
  });
});
