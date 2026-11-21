import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

export const AuditSeveritySchema = z.enum(["error", "warn"]);
export type AuditSeverity = z.infer<typeof AuditSeveritySchema>;

export const AuditProfileNameSchema = z.enum(["default", "strict", "incremental"]);
export type AuditProfileName = z.infer<typeof AuditProfileNameSchema>;

export const OVERRIDABLE_AUDIT_RULES = [
  "authored-by-trailer",
  "git-note-presence",
  "commit-format",
  "contract-files",
  "tier-routing-violation",
] as const;

export const NON_OVERRIDABLE_AUDIT_RULES = [
  "invalid-identity",
  "review-gate-separation",
  "base-branch-range",
] as const;

export type AuditRuleName =
  | (typeof OVERRIDABLE_AUDIT_RULES)[number]
  | (typeof NON_OVERRIDABLE_AUDIT_RULES)[number]
  | "invalid-policy";

export const AuditPolicySchema = z
  .object({
    profile: AuditProfileNameSchema.optional(),
    rules: z
      .object({
        "authored-by-trailer": AuditSeveritySchema.optional(),
        "git-note-presence": AuditSeveritySchema.optional(),
        "commit-format": AuditSeveritySchema.optional(),
        "contract-files": AuditSeveritySchema.optional(),
        "tier-routing-violation": AuditSeveritySchema.optional(),
        "invalid-identity": z.literal("error").optional(),
        "review-gate-separation": z.literal("error").optional(),
        "base-branch-range": z.literal("error").optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type AuditPolicyConfig = z.infer<typeof AuditPolicySchema>;

export interface LoadedAuditPolicy {
  exists: boolean;
  valid: boolean;
  profile: AuditProfileName;
  rules: Partial<Record<AuditRuleName, AuditSeverity>>;
  errors: string[];
}

const OVERRIDABLE_RULE_SET = new Set<string>(OVERRIDABLE_AUDIT_RULES);

/**
 * Loads and validates `.lognexus/policy.json` from `targetDir`.
 * Missing policy files resolve cleanly to the default strict profile.
 */
export function loadAuditPolicy(targetDir: string = process.cwd()): LoadedAuditPolicy {
  const policyPath = join(targetDir, ".lognexus", "policy.json");
  if (!existsSync(policyPath)) {
    return {
      exists: false,
      valid: true,
      profile: "default",
      rules: {},
      errors: [],
    };
  }

  let raw: unknown;
  try {
    const content = readFileSync(policyPath, "utf8");
    raw = JSON.parse(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      exists: true,
      valid: false,
      profile: "default",
      rules: {},
      errors: [`Invalid JSON in .lognexus/policy.json: ${message}`],
    };
  }

  const parsed = AuditPolicySchema.safeParse(raw);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((issue) => {
      const pathStr = issue.path.length > 0 ? issue.path.map(String).join(".") : "<root>";
      return `${pathStr}: ${issue.message}`;
    });
    return {
      exists: true,
      valid: false,
      profile: "default",
      rules: {},
      errors: errors.length > 0 ? errors : [parsed.error.message],
    };
  }

  return {
    exists: true,
    valid: true,
    profile: parsed.data.profile ?? "default",
    rules: parsed.data.rules ?? {},
    errors: [],
  };
}

/**
 * Resolves the effective severity for an audit rule under the loaded policy while
 * enforcing a non-overridable error floor for security and integrity rules.
 */
export function resolveAuditRuleSeverity(
  rule: AuditRuleName,
  defaultSeverity: AuditSeverity,
  policy: LoadedAuditPolicy,
): AuditSeverity {
  if (
    rule === "invalid-identity" ||
    rule === "base-branch-range" ||
    rule === "invalid-policy" ||
    (rule === "review-gate-separation" && defaultSeverity === "error")
  ) {
    return "error";
  }

  if (!policy.valid) {
    return defaultSeverity;
  }

  let resolved: AuditSeverity = defaultSeverity;

  if (policy.profile === "incremental") {
    if (
      rule === "authored-by-trailer" ||
      rule === "contract-files" ||
      rule === "git-note-presence" ||
      rule === "commit-format" ||
      rule === "tier-routing-violation"
    ) {
      resolved = "warn";
    }
  } else if (policy.profile === "strict") {
    if (
      rule === "git-note-presence" ||
      rule === "commit-format" ||
      rule === "tier-routing-violation" ||
      rule === "review-gate-separation"
    ) {
      resolved = "error";
    }
  }

  if (OVERRIDABLE_RULE_SET.has(rule)) {
    const override = policy.rules[rule];
    if (override !== undefined) {
      resolved = override;
    }
  } else if (policy.rules[rule] === "error") {
    resolved = "error";
  }

  return resolved;
}
