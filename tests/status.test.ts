import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractIssueNumber } from "../src/branch.js";
import { getProjectStatus } from "../src/status.js";

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
