import { describe, expect, it } from "vitest";
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
});
