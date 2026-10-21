import { z } from "zod";

export const SubtaskContractSchema = z.object({
  allowedFiles: z.array(z.string()).default([]),
  forbiddenFiles: z.array(z.string()).default([]),
  decisionBudget: z.enum(["none", "narrow", "full"]).default("none"),
  verificationCmd: z.string().optional(),
});

export type SubtaskContract = z.infer<typeof SubtaskContractSchema>;

export const SubtaskStateSchema = z.object({
  id: z.string(),
  title: z.string().default(""),
  status: z.enum(["pending", "in-progress", "completed"]).default("pending"),
  contract: SubtaskContractSchema.optional(),
});

export type SubtaskState = z.infer<typeof SubtaskStateSchema>;

export const ActiveIssueStateSchema = z.object({
  id: z.number(),
  title: z.string().default(""),
  branch: z.string(),
  phase: z
    .enum(["plan", "branch", "discovery", "commit", "pr", "review", "done"])
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
