# Closure and Review

Evidence-linked issue closure and multi-model review protocol for lognexus. No issue closes without evidence. No PR merges without cross-model review.

---

## 1. Evidence-Linked Closure

### Core rule

Do not close an issue without linked evidence and a verification note.

### Evidence requirements

| Evidence type | When to use |
|---------------|-------------|
| Commit URL on default branch | The fix is a code change that has been merged |
| Merged PR URL | The fix is better represented by the full PR |
| Discussion or decision artifact | No code change — the issue was resolved by a decision, policy change, or external action |

**Preference order:** Commit on default branch > merged PR > discussion artifact. Use the most specific link available.

### Closure comment format

Every closure must include a comment (or be closed via PR body `Closes #N` with the PR containing the evidence). When closing manually:

```markdown
## [lognexus/history] #<ID>: Closure

**Evidence:** [URL to commit, PR, or decision artifact]
**Merged to default branch:** yes | no | n/a
**Verification:** [1-3 sentences — why this evidence satisfies the issue]
**Disposition:** fully resolved | superseded by #<N> | won't fix (reason)
```

### What counts as evidence

- A commit SHA on the default branch that addresses the issue.
- A merged PR whose diff addresses the issue.
- A comment, ADR, or external decision that makes the issue moot.
- For umbrella issues: links to the child PRs/issues that collectively satisfy the parent.

### What does NOT count

- Memory or assumption that the work was done.
- A branch that exists but was never merged.
- A PR that is still open or was closed without merging.
- Partial resolution without acknowledging the remaining gap.

### Escalation on ambiguity

If the match between the issue and the evidence is ambiguous:

1. **Do not close the issue.** Leave it open.
2. Post a comment explaining the ambiguity.
3. Tag the issue for human review or escalate to a higher-tier model.
4. If a verifier lane is available, delegate the ambiguity check using the bounded handoff contract from `references/model-routing.md` and the dispatch/collection rules from `references/orchestrator-protocol.md`.

### Optional verifier-lane workflow

Use this workflow when closure evidence is specific enough to audit but repetitive enough to delegate.
The supervising model remains responsible for the closure decision.

**Supervisor responsibilities:**
- choose the candidate evidence links to inspect
- assemble a bounded verifier contract using the handoff template from `references/model-routing.md`
- choose the strongest available execution primitive from `references/orchestrator-protocol.md`
- keep closure judgment for ambiguous issues, umbrella issues, and any case where the verifier reports mismatch or low confidence

**Verifier may:**
- read the issue body and linked discussion
- inspect candidate commits and merged PRs
- inspect current file state on the default branch
- produce a signed verification note with evidence, confidence, and a recommended action

**Verifier may not:**
- reinterpret vague issue intent
- decide that a partial fix is "good enough"
- close umbrella issues or mixed-status roadmap issues on its own
- close any issue directly
- resolve ambiguous evidence by inference

**Required verifier output:**
- candidate fix artifact links
- whether the fix is merged to the default branch
- which parts of the issue are satisfied by the diff or current file state
- any unresolved mismatch or ambiguity
- confidence: `high` | `medium` | `low`
- recommended action: `close` | `keep open` | `escalate`

**Decision rule:**
- Only close when the supervising model agrees with the verifier's evidence review and the verifier returns `close` with high confidence and no unresolved mismatch.
- If the verifier returns `keep open` or `escalate`, do not close the issue.
- When a verifier note materially informed the closure decision, post it as an issue comment before closing so the audit trail stays durable.

### Umbrella issues

Umbrella issues (tracking multiple sub-issues or a roadmap) require:

- All child issues closed with their own evidence.
- A summary comment on the umbrella linking each child's resolution.
- If any child is unresolved, the umbrella stays open.

### Partial delivery

When a PR ships some tasks from an issue but other tasks remain (blocked, deferred, or planned for a later phase):

1. **Do not use `Closes #N`.** Use `Addresses #N (completes T1, T2, ...)` in the PR body. This links the PR to the issue without triggering auto-close.
2. **The issue stays open.** Completed tasks are checked off in the issue body; remaining tasks stay unchecked.
3. **Post a milestone comment** on the issue after merge, listing what shipped and what remains. Use the `[lognexus/milestone]` tag.
4. **Post a blocker comment** if remaining tasks are blocked on an external dependency. Reference the upstream issue (e.g., `openai/codex#11180`). Use the `[lognexus/blocker]` tag.
5. **Final closure** happens when the last remaining task ships (via a follow-up PR with `Closes #N`) or when all remaining tasks are explicitly cancelled with a rationale.

**What counts as evidence for partial delivery:** The merged PR is evidence for the tasks it completes. It is NOT evidence for the tasks that remain. The issue stays open because the remaining gap is acknowledged, not ignored.

**External blockers:** When tasks are blocked on upstream work outside this repository, the blocker comment should include a link to the upstream issue or tracking artifact. This makes the dependency searchable and auditable.

---

## 2. Closure Scope

This policy applies to:

- Backlog hygiene and issue triage.
- Recovery or history-reconciliation flows that close stale issues.
- Any automated or semi-automated closure by lognexus workflows.
- Manual closure during PR merges (via `Closes #N` in the PR body).

This policy does NOT normalize:

- Silent closure of ambiguous issues.
- Closing issues "for housekeeping" without evidence.
- Closing issues because the branch exists (merge status matters, not branch existence).

---

## 3. Multi-Model Review Protocol

### Core rule

Every PR merge requires a positive review from a model different from the author. Same-model self-review does not count as independent review.

### Review Modes & Configuration

Configured via `review_gate: auto | intra-fleet | cross-vendor | advisory | off` in `.lognexus/routing.md` (`auto` defaults to `intra-fleet`).

**Zero Forced Cross-Vendor Review (ChatGPT / OpenAI Codex):**
- **ChatGPT / OpenAI Codex environments NEVER force cross-vendor review.**
- `review_gate: auto` defaults to `intra-fleet` within OpenAI (`GPT-6.2 Astra` reviewing `GPT-6.2 Sol` or `GPT-6 Luna`).
- Single-session or solo ChatGPT / Codex workflows where cross-model review is unnecessary or unavailable can configure `review_gate: advisory` (warns without blocking) or `review_gate: off` in `.lognexus/routing.md`.

Two independent review modes are supported:
1. **Cross-Vendor Review** *(recommended best practice for milestone releases)*: The reviewer belongs to a different provider family than the author (e.g., `gemini/*` reviewed by `claude/*`, `openai/*`, or `deepseek/*`).
2. **Intra-Fleet Distinct-Model Review** *(supported for single-provider workflows such as Antigravity, Claude Code, or Codex / ChatGPT)*: The reviewer is a distinct canonical Tier-1 model operating in an independent reviewer session/subagent separate from the Tier-2/Tier-3 author model (e.g., `Gemini 4 Neon`, `Gemini 4 Carbon`, or `Gemini 4 Argon` reviewing `Gemini 4 Hydrogen` or `Gemini 3.8 Flash`; `Claude Fable 5.2` / `Opus 5.5` reviewing `Claude Sonnet 5.5` or `Claude Haiku 5.5`; `OpenAI GPT-6.2 Astra` reviewing `GPT-6.2 Sol` or `GPT-6 Luna`).

### Audit Policy Configuration (`.lognexus/policy.json`)

Repositories configure audit strictness and rule enforcement via `.lognexus/policy.json`:
- **Profiles:**
  - `"default"`: Standard balanced enforcement for active feature development.
  - `"incremental"`: Softened checks for legacy branches or rapid prototyping.
  - `"strict"`: Hardened zero-tolerance validation for release branches and protected paths.
- **Rule Overrides:** Specific rule severity levels can be customized under `rules` (`"off"`, `"warn"`, `"error"`).
- **Non-Overridable Error Floor:** Four foundational governance rules cannot be downgraded or disabled under any profile or override — they maintain a hardcoded `"error"` floor:
  - `"invalid-identity"`: Enforces valid canonical model identity syntax.
  - `"review-gate-separation"`: Blocks author/reviewer collision and self-approval.
  - `"base-branch-range"`: Validates proper target branch commit ranges.
  - `"invalid-policy"`: Rejects malformed policy schemas or configurations.

### Anti-Spoofing Rule (Non-Negotiable)

- **No author agent (`Authored-by`) may write `Reviewed-by:` trailers or run `gh pr merge`.**
- Writing one's own review sign-off — under any model name, including one attributed to another model family — is strictly prohibited and forges the gate.
- The review sign-off belongs exclusively to the independent reviewer operating in an independent session.
- Merge execution is also reserved to the independent reviewer or repository orchestrator after the sign-off exists; the author never merges its own work.

### What constitutes "different model"

- **Cross-vendor pairing:** Different provider families (e.g., Claude vs Gemini, OpenAI vs DeepSeek).
- **Intra-fleet distinct-model pairing:** Distinct canonical models within the same provider family (e.g., `Gemini 4 Neon` / `Carbon` / `Argon` reviewing `Gemini 4 Hydrogen` or `Gemini 3.8 Flash`; `Claude Fable 5.2` / `Mythos 5.2` / `Opus 5.5` reviewing `Claude Sonnet 5.5` / `Haiku 5.5`; `OpenAI GPT-6.2 Astra` reviewing `GPT-6.2 Sol` / `GPT-6 Luna`).
- **Shared-weights equivalence (`Fable <-> Mythos` blocked):** `Claude Fable 5.2` (`claude/fable-5.2`) and `Claude Mythos 5.2` (`claude/mythos-5.2`) share identical base model weights, so `Fable <-> Mythos` cross-review is blocked as self-approval (`error`) in `intra-fleet` and `cross-vendor` modes.
- **Strictly blocked:** Identical canonical model family across any reasoning-effort/speed suffix (`-none | -minimal | -low | -medium | -high | -extra | -xhigh | -xtrahigh | -extra-high | -light | -fast | -ultrafast | -max`) or `codex/* -> openai/*` / dash-version alias (`claude/fable-5-2` == `claude/fable-5.2`, `openai/gpt-6-2-astra` == `openai/gpt-6.2-astra`) is strictly blocked from self-approving.
- **Strictly prohibited:** Literal placeholder identities (`"auto"`, `"<provider>/<model>"`, bare `"orchestrator"`, `"unknown/other"`) are invalid.
- Human review always counts as independent.

### Review target selection

When asked to review PRs, whether one PR or many (e.g., "review PRs", "check for PRs to review", "review PR #56"), the reviewing agent should:

Read the PR body's review snapshot first. If the snapshot is missing, stale, or contradicted by newer code, fall back to the signed `Reviewed-by:` comment artifacts directly before deciding what still needs review.

1. List open PRs on the repository.
2. For each PR, inspect the newest signed lognexus author-side artifact you can verify for that work (for example the PR body `Authored-by:` or `Updated-by:` line, or a newer linked commit-note / handoff / amendment artifact) and any existing `Reviewed-by:` sign-offs.
3. **Skip PRs where the last code author matches your model and version.** Reviewing your own code adds no independent assurance - it is the anti-pattern this protocol exists to prevent.
4. **Review PRs where the last code author is a different model.** These are candidates for cross-model review. A model that originally opened a PR CAN gate-satisfy a review if a different model subsequently pushed code changes - the gate is about who last changed the code, not who opened the PR.
5. If all open PRs were last coded by the current model, inform the user:
   > "All open PRs were last coded by [model]. Cross-model review requires a different model. Would you like me to review anyway as an audit trail (non-gate-satisfying)?"
6. Only proceed with self-authored PR review if the user explicitly confirms after the reminder. Mark such reviews as `self-review` per Section 4 audit trail rules.

The PR body review snapshot is the latest-wins summary. Read it first for current state, then verify against signed review comments when the snapshot is missing, stale, or needs explanation.

**Provenance fallback chain for determining last code author:**

Use the first available signal - each level is less authoritative than the one above:

1. **`Last-code-by:`** in the PR body - authoritative. This field tracks who most recently pushed code to the branch. See SKILL.md → "Agent Identity Signing" for code provenance rules.
2. **`Updated-by:`** in the PR body - approximate. May reflect artifact text edits rather than code changes, but is the best proxy when `Last-code-by:` is absent.
3. **`Authored-by:`** in the PR body - original author. May be stale if another model pushed code later.
4. **Git commit author** on the PR branch - last resort. Requires an additional API call and uses git metadata rather than signed artifacts, but provides ground truth when no signed field exists.

If none of these signals are available, treat code authorship as unknown and do not claim a gate-satisfying review.

**Where to find review artifacts:** LogNexus review sign-offs are posted as issue/PR comments, not formal GitHub review events (see Section 4 GitHub API constraint). When checking for existing reviews, search the PR body plus issue/PR comments for `Reviewed-by:` and `Disposition:` lines. Do not rely on the formal reviews API endpoint alone - it will miss most AI-operated reviews.

---

## 4. Review Execution

### GitHub API constraint (cross-cutting policy)

All AI agents authenticate as the repository owner's GitHub account. GitHub blocks self-`APPROVE`, making formal same-account review events unreliable. LogNexus does not depend on `reviewDecision`, review badges, or formal review states as merge-authoritative signals.

**Canonical approach:** post signed review comments. The cross-model provenance in the `Reviewed-by:` line is the authoritative review signal. Merge authorization follows the lognexus sign-off (§5), not GitHub review state.

**Self-review is an audit artifact, not a gate-satisfying event.** There are no exceptions to the independent review requirement.

For the full review execution runbook — bounded reviewer lane dispatch, review contract template, self-review artifact format, default-publication rule, and snapshot follow-through — see `commands/lognexus/review.md`.

---

## 5. Merge Authorization

### Merge conditions

A PR may be merged when:

1. At least one independent review with `Disposition: approve` or `Disposition: approve-with-follow-ups` exists (satisfying `review_gate`; single-session or solo ChatGPT / Codex workflows configured with `review_gate: advisory` or `off` in `.lognexus/routing.md` honor that configured mode without forcing cross-vendor review).
2. All `request-changes` reviews have been addressed (new review cycle or author response).
3. If any approving review uses `approve-with-follow-ups`, the `Follow-ups:` field must reference a valid open issue containing the non-blocking findings. Do not merge until this issue exists.
4. The PR body includes `Closes #<N>` linking to the tracking issue.
5. The issue closure will have linked evidence (the merged PR itself serves as evidence).
6. Pre-merge audit (`npx @digital-lake/lognexus audit`) passes under the configured `.lognexus/policy.json` profile without unhandled errors.

### Mandatory `--no-ff` Merge Command

Merge PRs exclusively using `--merge` to force a merge commit (`--no-ff`):

```bash
gh pr merge <PR_NUMBER> --merge --delete-branch
```

> [!CAUTION]
> **Squash and Rebase are strictly prohibited:**
> - NEVER use `--squash` or `--rebase` when merging Pull Requests.
> - Squash merging flattens discrete `T1..Tn` subtask commit history into a single commit and **orphans LogNexus Git Notes (`refs/notes/lognexus`)** on discarded commit SHAs.

### Implementation issue capture check

Reviewers must check whether failed attempts, hidden dependencies, risky workarounds, scope surprises, and verification gaps were captured as durable artifacts instead of remaining in chat-only memory.

### Risk-based review requirements

| Change type | Minimum review |
|-------------|----------------|
| Documentation only | 1 cross-model approve |
| Code changes | 1 cross-model approve |
| Gate/policy changes | 1 cross-model approve + explicit acknowledgment of policy impact |
| Security-sensitive | 1 cross-model approve + human confirmation recommended |

### After merge

1. Verify the linked issue(s) are closed (GitHub auto-close via `Closes #N`, or manual closure with evidence).
2. If manual closure is needed, use the closure comment format from §1.
3. Post a verification note if the auto-close does not carry sufficient evidence context.
4. If any approving review used `approve-with-follow-ups`, verify the follow-up issue referenced in `Follow-ups:` is open and correctly lists the non-blocking findings from the review.

---

## Integration with LogNexus Phases

### Phase 5 (PR-as-Timeline)

Before creating a PR, check:
- Is the author identity known? (Include in PR body or sign-off.)
- Who will review? (Note in the PR body if pre-arranged.)

After creating a PR:
- If a reviewer lane is available, dispatch it immediately using the orchestration ladder above.
- If not, generate the review contract and inform the user.

### Phase 4 (Commit-with-Context)

Commit context comments do not require cross-model review. The review gate applies at the PR level, not the commit level.

### Issue closure

When a PR merges and auto-closes issues via `Closes #N`:
- The merged PR is the evidence.
- If the PR body contains a clear evidence table or summary, no additional closure comment is needed.
- If the relationship between the PR and the issue is non-obvious, add a closure comment per §1.
