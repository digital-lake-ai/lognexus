import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isDirectCliExecution } from "../src/cli.js";
import * as barrel from "../src/index.js";
import {
  acceptTerms,
  checkUpdateGate,
  compareVersions,
  EPHEMERAL_LOGNEXUS_FILES,
  ensureLocalGitExclude,
  formatUpdateGateResult,
  getTermsConsentPath,
  getUpdateCachePath,
  isUpdateCheckDisabled,
  readLocalPolicy,
  readTermsConsent,
  UPDATE_CHECK_DISABLED_ENV,
  UPGRADE_COMMAND,
} from "../src/update/gate.js";

const TEST_ENV: NodeJS.ProcessEnv = {};

function writePackage(targetDir: string, lognexusPolicy?: unknown): void {
  writeFileSync(
    join(targetDir, "package.json"),
    JSON.stringify({ name: "fixture", version: "1.0.0", lognexusPolicy }, null, 2),
    "utf8",
  );
}

function writeUpdateCache(targetDir: string, entry: Record<string, unknown>): void {
  mkdirSync(join(targetDir, ".lognexus"), { recursive: true });
  writeFileSync(getUpdateCachePath(targetDir), JSON.stringify(entry), "utf8");
}

describe("Startup update & terms gate", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lognexus-update-gate-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("compares dotted versions numerically and ignores pre-release suffixes", () => {
    expect(compareVersions("1.3.0", "1.2.7")).toBe(1);
    expect(compareVersions("1.2.7", "1.3.0")).toBe(-1);
    expect(compareVersions("1.3.0", "1.3.0")).toBe(0);
    expect(compareVersions("1.10.0", "1.9.9")).toBe(1);
    expect(compareVersions("1.3.0-rc.1", "1.3.0")).toBe(0);
  });

  it("disables the check in test, CI and explicitly opted-out environments", () => {
    expect(isUpdateCheckDisabled({ [UPDATE_CHECK_DISABLED_ENV]: "1" })).toBe(true);
    expect(isUpdateCheckDisabled({ NODE_ENV: "test" })).toBe(true);
    expect(isUpdateCheckDisabled({ VITEST: "true" })).toBe(true);
    expect(isUpdateCheckDisabled({ CI: "true" })).toBe(true);
    expect(isUpdateCheckDisabled({ CI: "1" })).toBe(true);
    expect(isUpdateCheckDisabled({})).toBe(false);
    expect(isUpdateCheckDisabled({ CI: "false" })).toBe(false);
  });

  it("stays silent when the check is disabled", () => {
    writePackage(tempDir, { minCriticalVersion: "99.0.0", requiresTermsAcceptance: true });

    const result = checkUpdateGate({
      targetDir: tempDir,
      currentVersion: "1.2.7",
      env: { VITEST: "true" },
    });

    expect(result.checked).toBe(false);
    expect(result.blocked).toBe(false);
    expect(result.updateNotice).toBeNull();
    expect(formatUpdateGateResult(result)).toBe("");
  });

  it("serves a fresh cache entry without contacting the registry", () => {
    writeUpdateCache(tempDir, {
      checkedAt: new Date().toISOString(),
      remoteVersion: "1.4.0",
      policy: { minCriticalVersion: "1.0.0", termsVersion: "", requiresTermsAcceptance: false },
    });

    const result = checkUpdateGate({
      targetDir: tempDir,
      currentVersion: "1.2.7",
      packageName: "lognexus-nonexistent-fixture-package",
      env: TEST_ENV,
    });

    expect(result.checked).toBe(true);
    expect(result.remoteVersion).toBe("1.4.0");
    expect(result.updateNotice).toContain("1.4.0");
    expect(result.updateNotice).toContain(UPGRADE_COMMAND);
    expect(result.blocked).toBe(false);
  });

  it("shows an upgrade notice only when the remote version is newer", () => {
    writeUpdateCache(tempDir, {
      checkedAt: new Date().toISOString(),
      remoteVersion: "1.2.7",
      policy: null,
    });

    const result = checkUpdateGate({ targetDir: tempDir, currentVersion: "1.2.7", env: TEST_ENV });

    expect(result.updateNotice).toBeNull();
    expect(formatUpdateGateResult(result)).toBe("");
  });

  it("blocks when the published policy declares a newer critical version", () => {
    writeUpdateCache(tempDir, {
      checkedAt: new Date().toISOString(),
      remoteVersion: "1.2.7",
      policy: { minCriticalVersion: "1.3.0", termsVersion: "", requiresTermsAcceptance: false },
    });

    const result = checkUpdateGate({ targetDir: tempDir, currentVersion: "1.2.7", env: TEST_ENV });

    expect(result.blocked).toBe(true);
    expect(result.blockReason).toContain("minimum critical version");
    expect(formatUpdateGateResult(result)).toContain("[BLOCKED]");
  });

  it("passes the critical gate once the running version is high enough", () => {
    writeUpdateCache(tempDir, {
      checkedAt: new Date().toISOString(),
      remoteVersion: "1.3.0",
      policy: { minCriticalVersion: "1.3.0", termsVersion: "", requiresTermsAcceptance: false },
    });

    const result = checkUpdateGate({ targetDir: tempDir, currentVersion: "1.3.0", env: TEST_ENV });

    expect(result.blocked).toBe(false);
    expect(result.blockReason).toBeNull();
  });

  it("never hard-blocks on the local manifest alone", () => {
    writePackage(tempDir, { minCriticalVersion: "1.3.0", requiresTermsAcceptance: true });
    // Pin a fresh, policy-free cache entry: the point of this test is that the *local*
    // manifest never blocks, so the published registry policy must not leak in.
    writeUpdateCache(tempDir, {
      checkedAt: new Date().toISOString(),
      remoteVersion: null,
      policy: null,
    });

    const result = checkUpdateGate({ targetDir: tempDir, currentVersion: "1.2.7", env: TEST_ENV });

    expect(result.blocked).toBe(false);
    expect(result.blockReason).toBeNull();
  });

  it("blocks on unaccepted terms and unblocks after acceptance", () => {
    writeUpdateCache(tempDir, {
      checkedAt: new Date().toISOString(),
      remoteVersion: "1.3.0",
      policy: {
        minCriticalVersion: "0.0.0",
        termsVersion: "2026-10-v1",
        requiresTermsAcceptance: true,
      },
    });

    const blocked = checkUpdateGate({ targetDir: tempDir, currentVersion: "1.3.0", env: TEST_ENV });

    expect(blocked.blocked).toBe(true);
    expect(blocked.blockReason).toContain("2026-10-v1");
    expect(blocked.blockReason).toContain("lognexus terms --accept");

    const consent = acceptTerms("2026-10-v1", tempDir);
    expect(consent.acceptedVersion).toBe("2026-10-v1");
    expect(readFileSync(getTermsConsentPath(tempDir), "utf8")).toContain("2026-10-v1");
    expect(readTermsConsent(tempDir).acceptedVersion).toBe("2026-10-v1");

    const unblocked = checkUpdateGate({
      targetDir: tempDir,
      currentVersion: "1.3.0",
      env: TEST_ENV,
    });
    expect(unblocked.blocked).toBe(false);
  });

  it("stays blocked when only an older terms version was accepted", () => {
    writeUpdateCache(tempDir, {
      checkedAt: new Date().toISOString(),
      remoteVersion: "1.3.0",
      policy: {
        minCriticalVersion: "0.0.0",
        termsVersion: "2026-10-v1",
        requiresTermsAcceptance: true,
      },
    });
    acceptTerms("2026-01-v0", tempDir);

    const result = checkUpdateGate({ targetDir: tempDir, currentVersion: "1.3.0", env: TEST_ENV });

    expect(result.blocked).toBe(true);
  });

  it("returns empty consent and null policy for missing files", () => {
    expect(readTermsConsent(tempDir)).toEqual({ acceptedVersion: null, acceptedAt: null });
    expect(readLocalPolicy(tempDir)).toBeNull();
  });
});

describe("CLI entrypoint guard", () => {
  it("does not run main() when the module is imported", () => {
    expect(isDirectCliExecution(undefined)).toBe(false);
    expect(isDirectCliExecution("")).toBe(false);
  });

  it("recognises the resolved CLI module path as the entrypoint", () => {
    const cliPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
    expect(isDirectCliExecution(cliPath)).toBe(true);
  });

  it("recognises the compiled CLI and its launcher shims by name", () => {
    expect(isDirectCliExecution("/repo/dist/cli.js")).toBe(true);
    expect(isDirectCliExecution("C:\\repo\\dist\\cli.js")).toBe(true);
    expect(isDirectCliExecution("/usr/local/bin/lognexus")).toBe(true);
    expect(isDirectCliExecution("C:\\repo\\node_modules\\.bin\\lognexus.cmd")).toBe(true);
    expect(isDirectCliExecution("/usr/local/bin/lognexus.ps1")).toBe(true);
  });

  it("ignores unrelated scripts and libraries", () => {
    expect(isDirectCliExecution("/repo/dist/index.js")).toBe(false);
    expect(isDirectCliExecution("/repo/tests/mcp.test.ts")).toBe(false);
    expect(isDirectCliExecution("/repo/dist/mcp/server.js")).toBe(false);
  });
});

describe("Ephemeral .lognexus exclusion", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lognexus-ephemeral-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function readExclude(dir: string): string {
    return readFileSync(join(dir, ".git", "info", "exclude"), "utf8");
  }

  it("registers every ephemeral path in .git/info/exclude and is idempotent", () => {
    mkdirSync(join(tempDir, ".git"), { recursive: true });

    ensureLocalGitExclude(tempDir);
    const first = readExclude(tempDir);
    for (const entry of EPHEMERAL_LOGNEXUS_FILES) {
      expect(first).toContain(entry);
    }

    ensureLocalGitExclude(tempDir);
    const second = readExclude(tempDir);
    expect(second).toBe(first);
    expect(second.match(/\.lognexus\/state\.json\n/g)).toHaveLength(1);
  });

  it("preserves pre-existing exclude entries", () => {
    mkdirSync(join(tempDir, ".git", "info"), { recursive: true });
    writeFileSync(join(tempDir, ".git", "info", "exclude"), "custom-ignore/\n", "utf8");

    ensureLocalGitExclude(tempDir);
    const content = readExclude(tempDir);
    expect(content.startsWith("custom-ignore/\n")).toBe(true);
    expect(content).toContain(".lognexus/telemetry.json");
  });

  it("acceptTerms excludes the consent file so it never shows as untracked", () => {
    mkdirSync(join(tempDir, ".git"), { recursive: true });

    acceptTerms("2026-11", tempDir);
    expect(readExclude(tempDir)).toContain(".lognexus/terms-consent.json");
  });

  it("is a silent no-op outside a git repository or for a .git file", () => {
    expect(() => ensureLocalGitExclude(tempDir)).not.toThrow();
    expect(existsSync(join(tempDir, ".git", "info", "exclude"))).toBe(false);

    writeFileSync(join(tempDir, ".git"), "gitdir: ../elsewhere\n", "utf8");
    expect(() => ensureLocalGitExclude(tempDir)).not.toThrow();
    expect(existsSync(join(tempDir, ".git", "info"))).toBe(false);
  });
});

describe("Public barrel (src/index.ts)", () => {
  const expected = [
    "isDirectCliExecution",
    "checkScopeDrift",
    "fetchNpmPackagePolicy",
    "resolveNpmCliScript",
    "searchNotesMemory",
    "getScopeDrift",
    "generateContextHandoff",
    "getHandoffPath",
    "refreshContextHandoff",
    "renderContextHandoff",
    "writeContextHandoffFile",
    "IMPLEMENTER_IDENTITY",
    "AUDITOR_IDENTITY",
    "ARCHITECT_IDENTITY",
    "acceptTerms",
    "checkUpdateGate",
    "compareVersions",
    "formatUpdateGateResult",
    "getTermsConsentPath",
    "getUpdateCachePath",
    "isUpdateCheckDisabled",
    "readLocalPolicy",
    "readTermsConsent",
    "UPDATE_CHECK_DISABLED_ENV",
    "UPGRADE_COMMAND",
    "EPHEMERAL_LOGNEXUS_FILES",
    "ensureLocalGitExclude",
  ] as const;

  it("re-exports every public API introduced in v1.3.0", () => {
    for (const symbol of expected) {
      expect(barrel, `missing export: ${symbol}`).toHaveProperty(symbol);
    }
  });

  it("exposes the update gate and handoff identities with real values", () => {
    const dir = mkdtempSync(join(tmpdir(), "lognexus-barrel-"));
    try {
      expect(barrel.UPDATE_CHECK_DISABLED_ENV).toBe(UPDATE_CHECK_DISABLED_ENV);
      expect(barrel.UPGRADE_COMMAND).toBe(UPGRADE_COMMAND);
      expect(typeof barrel.IMPLEMENTER_IDENTITY).toBe("string");
      expect(barrel.getUpdateCachePath(dir)).toBe(getUpdateCachePath(dir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
