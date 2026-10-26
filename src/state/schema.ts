import { z } from "zod";

export const SubtaskContractSchema = z.object({
  allowedFiles: z.array(z.string()).default([]),
  forbiddenFiles: z.array(z.string()).default([]),
  decisionBudget: z.enum(["none", "narrow", "full"]).default("none"),
  verificationCmd: z.string().optional(),
});

export type SubtaskContract = z.infer<typeof SubtaskContractSchema>;

const CONTRACT_KEYS = [
  "allowedFiles",
  "forbiddenFiles",
  "decisionBudget",
  "verificationCmd",
] as const;

function hoistContractFields(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const record = { ...(value as Record<string, unknown>) };
  const hoisted: Record<string, unknown> = {};

  for (const key of CONTRACT_KEYS) {
    if (record[key] !== undefined) {
      hoisted[key] = record[key];
      delete record[key];
    }
  }

  if (Object.keys(hoisted).length === 0) {
    return record;
  }

  const existing =
    record.contract !== null &&
    typeof record.contract === "object" &&
    !Array.isArray(record.contract)
      ? (record.contract as Record<string, unknown>)
      : {};

  record.contract = { ...hoisted, ...existing };
  return record;
}

export const SubtaskStateSchema = z.preprocess(
  hoistContractFields,
  z.object({
    id: z.string(),
    title: z.string().default(""),
    status: z.enum(["pending", "in-progress", "completed"]).default("pending"),
    contract: SubtaskContractSchema.optional(),
  }),
);

export type SubtaskState = z.infer<typeof SubtaskStateSchema>;

export const ActiveIssueStateSchema = z.object({
  id: z.number(),
  title: z.string().default(""),
  branch: z.string(),
  phase: z
    .enum(["plan", "branch", "discovery", "execute", "commit", "pr", "review", "done"])
    .default("branch"),
  tier: z.enum(["tier-1", "tier-2", "tier-3"]).default("tier-3"),
  readiness: z.enum(["draft", "ready", "blocked", "in-review", "done"]).default("ready"),
});

export type ActiveIssueState = z.infer<typeof ActiveIssueStateSchema>;

export const LognexusStateSchema = z.object({
  schemaVersion: z.string().default("1.0.0"),
  activeIssue: ActiveIssueStateSchema.nullable().default(null),
  currentSubtask: SubtaskStateSchema.nullable().default(null),
  completedSubtasks: z.array(z.string()).default([]),
  lastSync: z.string().default(() => new Date().toISOString()),
});

export type LognexusState = z.infer<typeof LognexusStateSchema>;
