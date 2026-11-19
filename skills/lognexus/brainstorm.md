---
name: brainstorm
description: "Phase 1: Capture brainstorming output as a GitHub issue with structured tasks, alternatives, and verification status."
---

# Plan Capture (Phase 1)

<!-- routing: tier-1, plan -->
<!-- cross-cutting: references/model-routing.md (Step 0), SKILL.md → "Agent Identity Signing", references/labels.md -->

0. **Routing check.** Run the phase entry check from `references/model-routing.md`. On first activation, if `.lognexus/routing.md` is missing, run the setup prompt first.

1. **Run the brainstorm & Turn-1 Probe Gate.** Follow `references/brainstorm-workflow.md` for the design exploration process. For context exploration across `> 3` files, a Tier-1 orchestrator must never read `> 3` files directly into context; immediately auto-dispatch read-only exploration probes (`invoke_subagent` or read-only `swarm` probes pinned to Tier-2/3, e.g. `google/gemini-3.8-flash-high (antigravity)`) without prompting first, performing zero file writes. Casual queries (`<= 3` files) remain conversational and direct. External skills (`superpowers:brainstorming`, `ork:brainstorming`) may be used for the exploration phase (steps 1-4) but output capture (steps 5-6) follows the internalized workflow.

2. **Capture as GitHub Issue (Full Mode).** Before the first labeled create in a repo, bootstrap the LogNexus labels per `references/labels.md`. Create the issue with `lognexus/plan` already applied using the template below. Sign the issue body per the signing spec — see SKILL.md → "Agent Identity Signing".

   Before writing the final issue body, classify factual claims:
   - **Internal claims** about this repository's code, tests, configuration, or committed docs can be verified from the repo itself.
   - **External claims** about third-party tools, URLs, APIs, platform capabilities must be verified against primary sources before they are stated as facts.
   - If an external claim cannot be verified yet, keep it explicitly marked as `[unverified]` and treat it as a hypothesis, not settled input.

3. **Store in knowledge graph.** If `ork:remember` is available, store the key decision.

4. **Transition.** Proceed to `skills/lognexus/branch.md` if the user wants to start work.

---

## Issue Template (Full Mode)

```bash
gh issue create \
  --label "lognexus/plan" \
  --title "[lognexus/plan] Brief title describing the work" \
  --body-file <temp-file>
```

Issue body content:

```markdown
<!-- lognexus:
kind: state
status: open
phase: 1
updated_at: <ISO_TIMESTAMP>
-->

## Context

[1-3 sentences: what problem are we solving and why now]

## Design Summary

[Key decisions from the brainstorm — 3-5 bullet points]

## Approach

[The chosen approach with brief rationale]

## Alternatives Considered

- **Alternative A**: [why not chosen]
- **Alternative B**: [why not chosen]

## Sources and Verification Status

Use this section when the issue includes external factual claims. If the issue is only
about this repository's own code or docs, cite repo paths inline where useful and omit
this section if it adds no value.

- `[verified]` Claim: [external factual statement that affects the issue]
  - **Source:** [primary source URL or official repository link]
  - **Checked:** [what the source confirms]
- `[unverified]` Claim or hypothesis: [idea worth preserving, but not yet confirmed]
  - **Why unverified:** [missing source, conflicting reports, or pending experiment]
  - **Next step:** [what must be checked before this can become a requirement]

## Tasks

Each task is self-contained and bounded by contract budgets (`CONTEXT_MAX_FILES = 6` implementation files, `CONTEXT_MAX_LOC = 1200` lines). A tier-3 or tier-2 model should be able to execute any task using only the information in that task block, without reading the rest of this issue.

- [ ] **T1: [Short title]** `[tier-3]`
  - **What:** [1-2 sentences, exactly what to do - no ambiguity]
  - **Files:** `path/to/file.ts` (create|modify|delete) (max 6 implementation files)
  - **Allowed to change:** [`path/to/file.ts`; specific symbols or sections if needed]
  - **Must not change:** [files, APIs, behavior, or decisions that are out of scope]
  - **Forbidden judgment calls:** [choices the implementer must not make locally]
  - **Stop and ask if:** [condition that would require widening scope]
  - **Verification:** [command, check, or evidence required before claiming completion]
  - **Return artifact:** [diff, comment, checklist update, verification note]
  - **Decision budget:** `none`
  - **Assignee:** [canonical runtime identity, e.g. `google/gemini-3.8-flash-high (antigravity)`]
  - **Isolation:** `swarm` | `subagent` | `worktree` | `branch` | `shared`
  - **Accept when:** [concrete, testable acceptance criteria]
  - **Context:** [any non-obvious background the implementer needs]

- [ ] **T2: [Short title]** `[tier-1]`
  - **What:** [1-2 sentences]
  - **Files:** `path/to/file.ts`
  - **Decision budget:** [what judgment this task is allowed to exercise]
  - **Assignee:** [canonical identity, e.g. `gemini/carbon` or `claude/opus-5.5 (claude-code)`]
  - **Isolation:** `subagent` | `swarm` | `worktree`
  - **Accept when:** [criteria]
  - **Why tier-1:** [why this needs reasoning]

Task ID rules:
- Every task carries a local ID: `T1`, `T2`, `T3`, etc.
- IDs are scoped to the issue — `T1` in issue #42 is `#42/T1` globally.
- Commits referencing a task use: `<type>(#<id>/<Tn>): <msg>`.
- `[tier-3]` tasks MUST be executable without creative judgment.
- `[tier-1]` tasks require reasoning — include **Why tier-1**.
- Open Questions cross-check: before assigning `[tier-3]`, verify that
  no field in the task assumes an answer to any item listed in
  `## Open Questions`. If the task hardcodes a value that Open Questions
  marks as undecided, either resolve the open question first (move the
  decision into the task contract and remove it from Open Questions) or
  promote the task to `[tier-2]` or `[tier-1]`.
- `[tier-3]` tasks must use the full contract format (all fields from the
  tier-3 template above). Compressed or abbreviated formats are acceptable
  only for `[tier-1]` and `[tier-2]` tasks, which carry their own decision
  budgets. If a field is not applicable, write `none` rather than omitting it.
- **Contract budgets:** Each task contract is strictly bounded by `CONTEXT_MAX_FILES = 6` implementation files (test files exempt) and `CONTEXT_MAX_LOC = 1200` lines.
- **Post-plan developer confirmation before auto-swarm:** Under `orchestration: auto`, present the complete `T1..Tn` task plan and await explicit developer confirmation before executing writes. Once confirmed, launch native `swarm` or subagents automatically without asking again.

## Open Questions

- [Any unresolved questions]

---
Authored-by: <family>/<version> (<tool>)
*Captain's log entry created by [lognexus](https://github.com/digital-lake-ai/lognexus)*
```

On PowerShell, prefer the `--body-file` temp-file pattern from `references/shell-portability.md`.
Before the first labeled create in a repository, run the bootstrap commands from `references/labels.md`.
