export const MCP_PROMPT_PLAN = "lognexus-plan";
export const MCP_PROMPT_REVIEW = "lognexus-review";

export interface PromptArgument {
  name: string;
  description: string;
  required: boolean;
}

export interface PromptDefinition {
  name: string;
  title: string;
  description: string;
  arguments: PromptArgument[];
}

export interface PromptMessage {
  role: "user" | "assistant";
  content: {
    type: "text";
    text: string;
  };
}

export interface PromptResult {
  description: string;
  messages: PromptMessage[];
}

export class McpPromptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpPromptError";
  }
}

const PROMPT_DEFINITIONS: PromptDefinition[] = [
  {
    name: MCP_PROMPT_PLAN,
    title: "Plan an issue into tier-scoped subtasks",
    description:
      "Break a LogNexus issue down into ordered, verifiable subtasks with strict closed-delegation contracts delegated to the appropriate model tier.",
    arguments: [
      {
        name: "issue",
        description: "Issue identifier or URL, e.g. '#7' or a GitHub issue link.",
        required: false,
      },
      {
        name: "context",
        description: "Extra architectural context, constraints or acceptance criteria.",
        required: false,
      },
    ],
  },
  {
    name: MCP_PROMPT_REVIEW,
    title: "Run the LogNexus review gate",
    description:
      "Audit a diff or pull request against the LogNexus review gate before merging into main: contracts, verification, traceability and cross-model attribution.",
    arguments: [
      {
        name: "target",
        description: "Branch, pull request number or commit range under review.",
        required: false,
      },
      {
        name: "diff",
        description: "The diff or changed-files summary to audit.",
        required: false,
      },
    ],
  },
];

const CONTRACT_FORMAT = `### Contract
- **Allowed files:** \`path/to/file.ts\`, \`tests/file.test.ts\`
- **Must not change:** \`package.json\` dependencies, public interfaces
- **Stop and ask if:** the compiler requires new third-party dependencies
- **Verification required:** \`npm run build && npm run lint && npm test\` must pass
- **Decision budget:** \`none\``;

const TIER_TABLE = `| Tier | Role | Example models | Typical work |
| --- | --- | --- | --- |
| tier-1 | Reasoning, architecture, review | Claude Opus, OpenAI o3, Gemini Pro, DeepSeek R1 | Issue decomposition, architectural decisions, review gate |
| tier-2 | Large-context discovery and triage | Claude Sonnet, GPT-4.1, Gemini Pro (1M), DeepSeek V3 | Repository exploration, discovery triage |
| tier-3 | Scoped execution | Claude Haiku, GPT-4o-mini, Gemini Flash, DeepSeek Chat | Single-contract subtasks, atomic commits |`;

export function listMcpPrompts(): PromptDefinition[] {
  return PROMPT_DEFINITIONS;
}

function textPrompt(description: string, text: string): PromptResult {
  return {
    description,
    messages: [
      {
        role: "user",
        content: { type: "text", text },
      },
    ],
  };
}

function buildPlanPrompt(issue?: string, context?: string): PromptResult {
  const issueLine = issue ? `Target issue: ${issue}` : "Target issue: (the issue currently open)";
  const contextBlock = context ? `\nAdditional context provided by the user:\n\n${context}\n` : "";

  const text = `You are the tier-1 orchestrator for a LogNexus-governed repository. Plan the work described below as small, independently verifiable subtasks that a cheaper execution model can complete without improvising.

${issueLine}
${contextBlock}
## Rules

1. Decompose the work into ordered subtasks, each named \`[tier-X]\` according to the model tier suited to it.
2. Every subtask must carry a closed delegation contract. Never leave a subtask open-ended.
3. Subtasks must not overlap in the files they touch. If they would, split further or sequence them.
4. Each subtask must end in a state where the verification command passes.
5. Prefer the lowest tier that can safely complete the subtask. Escalate to tier-1 only for decisions the executor must not make.
6. Do not invent dependencies or APIs. If a capability is missing, the subtask must say "stop and ask".

## Tier taxonomy

${TIER_TABLE}

## Contract format (mandatory)

${CONTRACT_FORMAT}

## Output format

For each subtask emit exactly:

### [tier-X] <short imperative title>
- **Branch / commit:** \`feat(#<issue>/T<n>)\` or \`fix(#<issue>/T<n>)\`
- **Scope:** one or two sentences describing the exact change.

${CONTRACT_FORMAT}

Finally, propose the single verification command that gates the whole issue.`;

  return textPrompt(
    "Breakdown of an issue into tier-scoped subtasks with strict closed-delegation contracts.",
    text,
  );
}

function buildReviewPrompt(target?: string, diff?: string): PromptResult {
  const targetLine = target ? `Under review: ${target}` : "Under review: the current branch diff";
  const diffBlock = diff ? `\nDiff to audit:\n\n\`\`\`diff\n${diff}\n\`\`\`\n` : "";

  const text = `You are the LogNexus review gate (tier-1). Your job is to decide whether the change below may be merged into \`main\`. Be strict and evidence-driven.

${targetLine}
${diffBlock}
## Gate checklist

1. **Contract compliance**: every changed file is inside the subtask's allowed files, and no file listed as forbidden was touched.
2. **Verification**: \`npm run build\`, \`npm run lint\` and \`npm test\` pass on the delivered code. Ask for the actual command output if it is missing.
3. **Scope**: no unrelated refactor, no unrequested dependency in \`package.json\`, no dead code or commented-out blocks.
4. **Correctness**: edge cases, error paths, encoding/line-ending handling and platform differences (Windows vs POSIX) are addressed.
5. **Traceability**: commits follow \`feat(#N/Tk)\` / \`fix(#N/Tk)\`, and the PR links the issue and the subtask contracts.
6. **Attribution**: authorship trailers (\`Authored-by\`, \`Reviewed-by\`, \`Last-code-by\`) are present and the reviewer differs from the code author.
7. **Tests**: new behaviour is covered by tests that fail when the behaviour is reverted. Tests must not be weakened to make them pass.

## Output format

Emit a verdict first, then the evidence:

- **Verdict:** APPROVE | REQUEST CHANGES
- **Blocking findings:** numbered list, each with \`path/to/file.ts:line\` and the concrete fix.
- **Non-blocking findings:** numbered list, or "none".
- **Verification observed:** which commands were run and their result.

Never approve on partial evidence. If a check cannot be verified from what you were given, list it as blocking.`;

  return textPrompt("Review gate checklist for merging a branch into main.", text);
}

export function getMcpPrompt(name: string, args: Record<string, string> = {}): PromptResult {
  const issue = args.issue?.trim() || undefined;
  const context = args.context?.trim() || undefined;
  const target = args.target?.trim() || undefined;
  const diff = args.diff?.trim() || undefined;

  switch (name) {
    case MCP_PROMPT_PLAN:
      return buildPlanPrompt(issue, context);
    case MCP_PROMPT_REVIEW:
      return buildReviewPrompt(target, diff);
    default:
      throw new McpPromptError(`Unknown LogNexus prompt: '${name}'.`);
  }
}
