import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  acceptTerms,
  checkUpdateGate,
  compareVersions,
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
