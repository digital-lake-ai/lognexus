import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkGit, checkRulesConfig, runDiagnostics } from "../src/doctor.js";

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
    expect(results.length).toBeGreaterThanOrEqual(3);
  });
});
