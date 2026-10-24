import { describe, expect, it } from "vitest";
import {
  extractIssueNumber,
  isScopedBranch,
  parseScopedBranch,
  SCOPED_BRANCH_TEMPLATE,
} from "../src/branch.js";

describe("parseScopedBranch", () => {
  it("parses issue lane branches", () => {
    expect(parseScopedBranch("issue/22-audit-and-supply-chain")).toEqual({
      lane: "issue",
      issueId: 22,
      slug: "audit-and-supply-chain",
    });
  });

  it("parses security lane branches", () => {
    expect(parseScopedBranch("security/22-audit-and-supply-chain")).toEqual({
      lane: "security",
      issueId: 22,
      slug: "audit-and-supply-chain",
    });
  });

  it("parses lane branches without a slug", () => {
    expect(parseScopedBranch("security/7")).toEqual({
      lane: "security",
      issueId: 7,
      slug: null,
    });
  });

  it("is case-insensitive on the lane prefix", () => {
    expect(parseScopedBranch("SECURITY/9-hardening")?.lane).toBe("security");
  });

  it("rejects protected and unrelated branches", () => {
    expect(parseScopedBranch("main")).toBeNull();
    expect(parseScopedBranch("master")).toBeNull();
    expect(parseScopedBranch("feature/22-something")).toBeNull();
    expect(parseScopedBranch("perf/22-something")).toBeNull();
    expect(parseScopedBranch("")).toBeNull();
  });

  it("does not accept a prefixed lane such as xissue/", () => {
    expect(parseScopedBranch("xissue/22-something")).toBeNull();
  });
});

describe("extractIssueNumber", () => {
  it("extracts the issue number from both lanes", () => {
    expect(extractIssueNumber("issue/22-slug")).toBe("22");
    expect(extractIssueNumber("security/22-slug")).toBe("22");
  });

  it("returns null when no scoped lane is present", () => {
    expect(extractIssueNumber("main")).toBeNull();
    expect(extractIssueNumber("feature/22-slug")).toBeNull();
  });
});

describe("isScopedBranch", () => {
  it("accepts both scoped lanes", () => {
    expect(isScopedBranch("issue/1-a")).toBe(true);
    expect(isScopedBranch("security/1-a")).toBe(true);
  });

  it("rejects protected branches", () => {
    expect(isScopedBranch("main")).toBe(false);
    expect(isScopedBranch("master")).toBe(false);
  });
});

describe("SCOPED_BRANCH_TEMPLATE", () => {
  it("documents both lanes", () => {
    expect(SCOPED_BRANCH_TEMPLATE).toContain("issue/<id>-<slug>");
    expect(SCOPED_BRANCH_TEMPLATE).toContain("security/<id>-<slug>");
  });
});
