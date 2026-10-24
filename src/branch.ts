export const SCOPED_BRANCH_PREFIXES = ["issue", "security"] as const;

export type ScopedBranchLane = (typeof SCOPED_BRANCH_PREFIXES)[number];

export interface ScopedBranch {
  lane: ScopedBranchLane;
  issueId: number;
  slug: string | null;
}

export const SCOPED_BRANCH_PATTERN = /(?:issue|security)\/(\d+)(?:-(.*))?/i;
export const SCOPED_BRANCH_ISSUE_PATTERN = /(?:issue|security)\/(\d+)/i;
export const SCOPED_BRANCH_TEMPLATE = "issue/<id>-<slug> or security/<id>-<slug>";

export function parseScopedBranch(branch: string): ScopedBranch | null {
  const match = branch.match(SCOPED_BRANCH_PATTERN);
  if (!match) return null;

  const lane = branch.slice(0, branch.indexOf("/")).toLowerCase();
  if (!(SCOPED_BRANCH_PREFIXES as readonly string[]).includes(lane)) return null;

  return {
    lane: lane as ScopedBranchLane,
    issueId: Number.parseInt(match[1], 10),
    slug: match[2] ? match[2] : null,
  };
}

export function extractIssueNumber(branch: string): string | null {
  const match = branch.match(SCOPED_BRANCH_ISSUE_PATTERN);
  return match ? match[1] : null;
}

export function isScopedBranch(branch: string): boolean {
  return parseScopedBranch(branch) !== null;
}
