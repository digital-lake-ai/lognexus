---
name: pr
description: "Phase 5: Create PR with timeline body, handle review gate, and link to tracking issue."
---

# PR Timeline (Phase 5)

<!-- routing: tier-1, plan -->
<!-- cross-cutting: references/model-routing.md (Step 0), SKILL.md → "Agent Identity Signing", references/closure-and-review.md, references/labels.md, references/orchestrator-protocol.md -->

0. **Routing check.** Run the phase entry check from `references/model-routing.md`.

1. **Pre-PR checks.** Follow `references/pr-workflow.md`. External PR skills may still be used for validation help, but lognexus's internal PR workflow is authoritative for title, body, labels, and review gate behavior.

2. **Create PR (Full Mode).** Use the PR timeline template below. Create the PR with `lognexus/history` and `lognexus/issue-driven` already applied. Sign per the signing spec — see SKILL.md → "Agent Identity Signing".

   LogNexus accepts two scoped branch lanes: `issue/<id>-<slug>` for regular feature and fix work, and `security/<id>-<slug>` for security, supply-chain, and hardened-remediation work. Both parse identically for issue lookup, state sync, and PR `Closes`/`Addresses` detection.

   When a master plan drafted outside this repository drove the work, register it in the signature block with a `Planned-by:` trailer naming the external planner and its plan identifier. The authoring identity goes in `Authored-by:` and stays distinct from any reviewer.

   Sign with canonical model identities only. The principal architect is always declared as **`Gemini 4 Argon`** (`gemini/argon`), never abbreviated as `Gemini/Pro` or `Pro`. Other canonical frontier identities are `gemini/carbon` (tier-1), `gemini/flash-high` (tier-2), `moonshot/kimi-k3` (tier-3) and `deepseek/chat` (tier-3).

3. **Review gate & Merge Execution.**
   - Every PR requires cross-model review before merge (`Authored-by` != `Reviewed-by`). Use the execution ladder in `references/closure-and-review.md`. Local parallel tool fan-out does not count as an independent reviewer identity.
   - **Anti-Spoofing Rule (hard boundary):** the authoring agent never writes a `Reviewed-by:` trailer and never runs `gh pr merge`. Both actions belong exclusively to the reviewing identity. An author who signs its own review gate is a governance violation, not a shortcut.
   - **Zero exceptions by change type:** `chore:`, `ci:`, `docs:`, `build:`, and `test:` require a branch and PR exactly like `feat:` or `fix:`. Direct pushes to `main` are strictly prohibited.
   - **Mandatory Merge Commit (`--no-ff`):** Merge exclusively using:
     ```bash
     gh pr merge <num> --merge --delete-branch
     ```
     Squash merge (`--squash`) and rebase merge (`--rebase`) are strictly prohibited because they destroy the discrete `T1..Tn` commit history and orphan attached LogNexus Git Notes (`refs/notes/lognexus`) on discarded SHAs.
   - **Closed-PR policy:** a merged or closed PR is never reused. Do not reopen it, force-push onto its branch, or re-target it to another issue — open a new issue and a new scoped branch from `main` instead.

4. **Link and store.** PR body includes `Closes #<issue>` when the PR fully resolves the issue. For partial delivery, use `Addresses #<issue> (completes T1, T2, ...)` - see the partial-delivery template below and `references/closure-and-review.md` Section 1. Store key learning in knowledge graph.

5. **Closure verification (optional).** When evidence-to-issue mapping is non-obvious, optionally dispatch a verifier lane using the same orchestration ladder described in `references/closure-and-review.md` and `references/orchestrator-protocol.md`.

---

## PR Timeline Body (Full Mode)

```bash
ISSUE_NUMBER=<N>
BASE_BRANCH=$(gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name')

gh pr create --base $BASE_BRANCH \
  --label "lognexus/history" \
  --label "lognexus/issue-driven" \
  --title "<type>(#$ISSUE_NUMBER): Brief description" \
  --body-file <temp-file>
```

PR body:

```markdown
<!-- lognexus:
kind: history
issue: <ISSUE_NUMBER>
branch: <issue|security>/<ISSUE_NUMBER>-<slug>
status: resolved
updated_at: <ISO_TIMESTAMP>
review_status: awaiting-review
-->

## Summary

[2-3 sentences: what this PR does and why]

Closes #<ISSUE_NUMBER>

## Review Status

- **Current state:** awaiting review
- **Last reviewed by:** none yet
- **Last reviewed at:** n/a
- **Reviewed commit:** n/a
- **Source artifact:** none yet
- **Needs re-review since:** no

## Journey Timeline

### Initial Plan
[What we set out to do - reference the issue]

### What We Discovered
- [Discovery 1: what surprised us]
- [Discovery 2: what we learned]

### Implementation Issues
- [Issue 1: what happened, how it was resolved - or "None"]

### Key Decisions Made

| Decision | Choice | Why |
|----------|--------|-----|
| [Decision 1] | [Chosen option] | [Reasoning] |

### Changes Made

**Commits:**
[list commits with `git log --oneline $BASE_BRANCH..HEAD`]

## Testing

[If verification profile active]:
**Verification profile:** [profile names]

- [x] [What was tested and how]
- [x] All existing tests pass
- [x] Self-audit: implementation reviewed for redundancy, dead code, and simplification opportunities

**Verification summary:** [scenarios added/changed, tests added/changed, deferred items]

## Stacked PRs / Related

- [#related-pr or #related-issue if any]

## Knowledge for Future Reference

[Anything a future developer should know when revisiting this area.]

---
Authored-by: <family>/<version> (<tool>)
Last-code-by: <family>/<version> (<tool>)
Planned-by: <family>/<version> (<tool>) — plan <PLAN_ID>
*Captain's log - PR timeline by [lognexus](https://github.com/digital-lake-ai/lognexus)*
```

The PR body is large enough that `--body-file` should be the preferred portable path.
After every signed review comment and every post-review code push, refresh this review snapshot in place per `references/closure-and-review.md` and the signing spec in SKILL.md → "Agent Identity Signing".

If review or cleanup work is dispatched in parallel, post the fan-out dispatch and collection artifacts from `references/orchestrator-protocol.md` instead of leaving that orchestration implicit in chat-only context.

---

## Partial-Delivery PR Variant

When a PR ships some tasks but the issue has remaining work:

```markdown
<!-- lognexus:
kind: history
issue: <ISSUE_NUMBER>
branch: <issue|security>/<ISSUE_NUMBER>-<slug>
status: in-progress
updated_at: <ISO_TIMESTAMP>
review_status: awaiting-review
-->

## Summary

[2-3 sentences: what this PR ships and why it is a partial delivery]

Addresses #<ISSUE_NUMBER> (completes T1, T2, T3)

## Review Status

- **Current state:** awaiting review
- **Last reviewed by:** none yet
- **Last reviewed at:** n/a
- **Reviewed commit:** n/a
- **Source artifact:** none yet
- **Needs re-review since:** no

## Completed Tasks

- [x] **T1:** [title] - [1-sentence summary of what shipped]
- [x] **T2:** [title] - [1-sentence summary]

## Remaining Tasks

- [ ] **T4:** [title] - [why deferred: blocked on X / next phase / needs design]
- [ ] **T5:** [title] - [why deferred]

## Blocked On

- [External dependency with link, or "No external blockers - remaining tasks deferred by choice"]

## Journey Timeline

[Same structure as the standard PR template]

## Knowledge for Future Reference

[Same structure as the standard PR template]

---
Authored-by: <family>/<version> (<tool>)
Last-code-by: <family>/<version> (<tool>)
Planned-by: <family>/<version> (<tool>) — plan <PLAN_ID>
*Captain's log - partial delivery by [lognexus](https://github.com/digital-lake-ai/lognexus)*
```
