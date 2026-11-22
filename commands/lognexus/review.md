---
allowed-tools: Bash(gh:*), Bash(git:*), Read
description: Review a PR and post a signed lognexus review comment
argument-hint: <PR-number>
---

Perform a cross-model review of a PR and post the signed review artifact. The review is not complete until the signed comment is published on the PR timeline. For the cross-model gate rule (what constitutes an independent review), see `skills/lognexus/references/closure-and-review.md` §3.

## Policy

**A signed lognexus review requires all four fields:**
```
Reviewed-by: <family>/<version> (<tool>)
Disposition: approve | approve-with-follow-ups | request-changes
Scope: <what was reviewed>
Follow-ups: #<issue-number> | none
```

**Review Gate Modes & Policy:**
Configured via `review_gate: auto | intra-fleet | cross-vendor | advisory | off` in `.lognexus/routing.md` (`auto` resolves to `intra-fleet`). Two independent review modes are supported:
- **Cross-Vendor Review:** Reviewer belongs to a different provider family than the author (e.g., `gemini/*` reviewed by `claude/*`, `openai/*`, or `deepseek/*`).
- **Intra-Fleet Distinct-Model Review:** Reviewer is a distinct canonical Tier-1 model operating in an independent reviewer session/subagent separate from the Tier-2/Tier-3 author model (e.g., `Gemini 4 Neon`, `Gemini 4 Carbon`, or `Gemini 4 Argon` reviewing `Gemini 4 Hydrogen` or `Gemini 3.8 Flash`; `Claude Opus 5.5` reviewing `Claude Sonnet 5.5` or `Claude Haiku`).
- **Strictly blocked:** Identical canonical model family across any reasoning-effort suffix (`-none | -minimal | -low | -medium | -high | -extra | -xhigh | -xtrahigh | -extra-high`) is strictly blocked from reviewing or approving its own code.
- **Strictly prohibited:** Placeholder identities (`"auto"`, `"<provider>/<model>"`, bare `"orchestrator"`, `"unknown/other"`). Every agent must sign with its real canonical runtime identity.
- **Audit Policy & Verification:** Verify PR compliance with `npx @digital-lake/lognexus audit`. Profiles (`default` | `incremental` | `strict`) are configured in `.lognexus/policy.json`, where `invalid-identity`, `review-gate-separation`, `base-branch-range`, and `invalid-policy` enforce a hardcoded non-overridable review-gate error floor. Run `npx @digital-lake/lognexus doctor --mcp` to validate MCP configuration health and schema compliance.

**Anti-Spoofing Rule (non-negotiable):**
- No author agent (`Authored-by`) may write `Reviewed-by:` trailers or execute `gh pr merge`.
- The review sign-off belongs exclusively to the independent reviewer.
- Merge execution is reserved to the independent reviewer or repository orchestrator after the sign-off exists; the author never merges its own work.

**Mandatory Merge Command (`--no-ff`):**
Merge PRs exclusively using `--merge` to force a merge commit:
```bash
gh pr merge <PR_NUMBER> --merge --delete-branch
```
Never use `--squash` or `--rebase`, as they flatten discrete subtask commits and orphan LogNexus Git Notes (`refs/notes/lognexus`).

**`approve-with-follow-ups`:** create the follow-up tracking issue BEFORE posting the review. The `Follow-ups:` field must reference a valid open issue. Do not post `approve-with-follow-ups` without this.

**Default publication:** after analysis, post the signed review comment on the PR. Do not leave the review only in the chat session. If GitHub posting fails, provide the review text for manual posting and note it as pending.

**Snapshot follow-through:** after posting the signed review comment, update the PR body's review snapshot in place (`Current state:`, `Last reviewed by:`, `Last reviewed at:`, `Reviewed commit:`, `Source artifact:`).

**Target selection:** before reviewing, check who last changed the code (via `Last-code-by:` in the PR body, then the fallback chain). Skip PRs where the last code author matches your identity — you cannot gate-satisfy your own work.

## Query / Template

### Check PR code author before reviewing

```bash
gh pr view <N> --json body,commits --jq '.body' | grep -E "Last-code-by:|Authored-by:|Updated-by:"
```

Walk the fallback chain if `Last-code-by:` is absent (see `references/closure-and-review.md` §3).

### Read the diff

```bash
gh pr diff <N>
gh pr view <N> --json title,body,files,commits,comments
```

Read the PR body for: envelope fields, summary, tasks completed, verification checklist, any existing review comments.

### Review sign-off comment template

Wrap in an envelope and use the full sign-off block:

```markdown
<!-- lognexus:
kind: verification
issue: <ISSUE_NUMBER>
pr: <PR_NUMBER>
updated_at: <ISO_TIMESTAMP>
-->

## [lognexus/review-handoff] #<ISSUE_NUMBER>: Review of PR #<PR_NUMBER>

<Optional: brief findings narrative — 1-3 paragraphs. Tag non-blocking items [follow-up].>

Reviewed-by: <family>/<version> (<tool>)
Disposition: approve | approve-with-follow-ups | request-changes
Scope: <what was reviewed — e.g., "full diff", "SKILL.md + hunt.md">
Follow-ups: #<issue-number> | none
```

Post with:
```bash
gh pr comment <N> --body-file <temp-file>
```

### Self-review (audit trail only — does NOT satisfy the gate)

```markdown
<!-- lognexus:
kind: verification
pr: <PR_NUMBER>
updated_at: <ISO_TIMESTAMP>
-->

Reviewed-by: <family>/<version> (<tool>)
Disposition: self-review (does NOT satisfy gate — independent review required)
Scope: full diff
Note: Self-review recorded as audit trail. This PR must not merge until an
independent cross-model review is completed.
```

### Update PR body review snapshot after posting

Edit the PR body in place to refresh:
```
Current state: approved | changes-requested | awaiting review
Last reviewed by: <family>/<version> (<tool>)
Last reviewed at: <ISO_TIMESTAMP>
Reviewed commit: <hash>
Source artifact: <URL to the review comment>
Needs re-review since: —
```

```bash
gh pr edit <N> --body-file <updated-body-file>
```

## Acceptance Checklist

- [ ] Last-code author checked; reviewer identity differs (cross-model gate requirement)
- [ ] PR diff and body both read before forming a disposition
- [ ] If `approve-with-follow-ups`: follow-up tracking issue created BEFORE posting the review
- [ ] Signed review comment posted on the PR (not just in chat) with all four fields
- [ ] PR body review snapshot updated in place after posting
- [ ] `Follow-ups:` field references a valid open issue number, or is `none`
