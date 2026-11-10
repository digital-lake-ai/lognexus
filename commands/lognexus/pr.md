---
allowed-tools: Bash(gh:*), Bash(git:*), Read, Write, Skill
description: Create a PR with a lognexus journey timeline
---

Push the branch and create a PR whose body is a complete timeline of the work: initial plan, discoveries, key decisions, verification, and provenance signatures. Cross-model review is required before merge — see `commands/lognexus/review.md` for the review sub-skill.

## Policy

**PR body structure (mandatory sections, in order):**
1. Envelope comment (HTML `<!-- lognexus: ... -->`) with `kind: history`, `status: open`, `phase: 5`, `readiness: needs-review`, triage fields
2. Summary (1-3 bullets)
3. `Closes #<N>` (or `Addresses #<N> (completes T1, T2, ...)` for partial delivery)
4. Journey Timeline — Initial Plan, What We Discovered, Key Decisions table, Changes Made (commit list)
5. Verification — checklist of what was tested/checked
6. Reviews placeholder
7. Sig block: `Authored-by:` and `Last-code-by:` (both set to the creating model at creation)

**Provenance signatures (both required):**
```
Authored-by: <family>/<version> (<tool>)
Last-code-by: <family>/<version> (<tool>)
```
`Last-code-by:` is updated whenever new code is pushed to the branch after PR creation. See SKILL.md → "Agent Identity Signing" for code provenance rules.

**Review gate:** do NOT merge until a cross-model `Reviewed-by:` + `Disposition: approve` (or `approve-with-follow-ups`) comment exists on the PR. Self-review does not satisfy the gate. See `commands/lognexus/review.md` for the full review sub-skill, and `references/closure-and-review.md` §3 for the cross-model gate policy.

**Partial delivery:** use `Addresses #<N> (completes T1, T2)` instead of `Closes #<N>` when some tasks remain. Post a `[lognexus/milestone]` comment on the issue after merge.

**Labels to apply at creation:** `lognexus/history`, `lognexus/issue-driven`

**Issue label transition:** move the issue from `lognexus/in-progress` to `lognexus/needs-review` after creating the PR.

## Query / Template

### Push and create the PR

```bash
git push -u origin <branch-name>

gh pr create \
  --title "<type>(#<N>): <summary>" \
  --body-file <temp-file> \
  --label "lognexus/history" \
  --label "lognexus/issue-driven"
```

### PR body template

```markdown
<!-- lognexus:
kind: history
status: open
phase: 5
readiness: needs-review
task_count: <N>
tasks_complete: <N>
updated_at: <ISO_TIMESTAMP>
-->

## Summary

- <bullet 1>
- <bullet 2>

Closes #<N>

## Journey Timeline

### Initial Plan

<1-2 sentences on what the issue called for>

### What We Discovered

<discoveries, blockers encountered, approach changes; omit if none>

### Key Decisions

| Decision | Rationale |
|----------|-----------|
| <decision> | <why> |

### Changes Made

- `<hash>` — <commit subject>
- `<hash>` — <commit subject>

## Verification

- [ ] <verification item 1>
- [ ] <verification item 2>

## Reviews

<!-- Awaiting cross-model review. See commands/lognexus/review.md for the review sub-skill. -->

Current state: awaiting review
Last reviewed by: —
Last reviewed at: —
Reviewed commit: —
Source artifact: —
Needs re-review since: —

---
Authored-by: <family>/<version> (<tool>)
Last-code-by: <family>/<version> (<tool>)
*Captain's log — PR timeline by **lognexus***
```

### Transition issue label

```bash
gh issue edit <N> --remove-label "lognexus/in-progress" --add-label "lognexus/needs-review"
```

## SemVer & Release Milestone Policy

1. **Greenfield Bootstrap (`0.1.0`):** New repositories (`0` published releases) should start at `0.1.0` in `package.json` / `pyproject.toml` rather than the `npm init -y` default `1.0.0`.
2. **Subtasks Never Bump Version (`T1..Tn`):** Subtasks (`T1`, `T2`, `T3`...) are atomic commits inside a single feature/fix branch (`issue/<id>-<slug>`). Do **not** increment the project version per subtask (`T1 != 0.1.0`, `T2 != 0.2.0`).
3. **One Version Bump per Cycle at PR Closure (`--no-ff`):** Bump the project version at most once per Issue/PR cycle (typically in the final subtask before opening/merging the PR via `gh pr merge --merge --delete-branch`): `fix:` -> `PATCH` (`0.1.x`), `feat:` -> `MINOR` (`0.x.0`), and reserve `1.0.0` for the first production-validated milestone.
4. **No `lognexus release` Command:** LogNexus does not have a `lognexus release` CLI command; releases are cut through standard manifest version bumps merged into `main` (`--no-ff`) and tagged via Git/CI.

## Acceptance Checklist

- [ ] PR envelope has `kind: history`, `readiness: needs-review`, correct triage fields
- [ ] PR body contains `Closes #<N>` (or `Addresses #<N>`) line
- [ ] Journey Timeline section present with commit list
- [ ] Both `Authored-by:` and `Last-code-by:` sig blocks present
- [ ] Review placeholder section present pointing to `review.md`
- [ ] Issue label transitioned from `lognexus/in-progress` to `lognexus/needs-review`
