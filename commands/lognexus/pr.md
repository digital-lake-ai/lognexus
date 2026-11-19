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

**Provenance signatures:**
```
Authored-by: <family>/<version> (<tool>)
Last-code-by: <family>/<version> (<tool>)
Planned-by: <family>/<version> (<tool>) — <plan-id> (optional: for external master plans)
```
`Last-code-by:` is updated whenever new code is pushed to the branch after PR creation. See SKILL.md → "Agent Identity Signing" for code provenance rules.

Sign exclusively with canonical model identities:
- **Tier-1:** `Gemini 4 Neon` (`gemini/neon`, `Orchestrator (Neon)` / `gemini-pro-orchestrator-neon`), `Gemini 4 Carbon` (`gemini/carbon`), `Gemini 4 Argon` (`gemini/argon`), `Claude Opus 5.5` (`claude/opus-5.5`).
- **Tier-2 / Tier-3:** `Gemini 4 Hydrogen` (`google/gemini-4-hydrogen-high (antigravity)`), `Gemini 3.8 Flash` (`google/gemini-3.8-flash-high (antigravity)`), `gemini-flash-worker-agy`, `Claude Sonnet 5.5`, `deepseek/VS Code (kimi-code)`.
- Never use literal placeholder identities (`"auto"`, `"<provider>/<model>"`, bare `"orchestrator"`, `"unknown/other"`).

**Branch lanes:** Both scoped lanes (`issue/<id>-<slug>` and `security/<id>-<slug>`) are supported and recognized identically.

**Review gate & Anti-Spoofing:**
- Configured via `review_gate: auto | intra-fleet | cross-vendor | advisory | off` (`auto` resolves to `intra-fleet`). Both Cross-Vendor Review and Intra-Fleet Distinct-Model Review (`Gemini 4 Neon` / `Carbon` / `Argon` reviewing `Gemini 4 Hydrogen` / `3.8 Flash`; `Claude Opus 5.5` reviewing `Claude Sonnet 5.5`) satisfy the gate (`Authored-by` != `Reviewed-by`).
- Identical canonical model family across any reasoning-effort suffix is strictly blocked from self-approving.
- **Anti-Spoofing Rule:** the authoring agent never writes a `Reviewed-by:` trailer and never executes `gh pr merge`. Both actions belong exclusively to the independent reviewing identity.
- **Mandatory Merge Commit (`--no-ff`):** Merge exclusively using `gh pr merge <num> --merge --delete-branch`. Squash and rebase merges are strictly prohibited as they destroy atomic subtask history and orphan Git Notes (`refs/notes/lognexus`).

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
5. **Multi-Manifest SemVer Separation:** Keep **Software Version** (e.g. `0.1.0` pre-release until validated) strictly separate from **Document Revision** (e.g. `rev. 1.3`) across all manifests (`package.json`, `pyproject.toml`, `.claude-plugin/plugin.json`, `server.json`), skill docs, and UI labels.

## Acceptance Checklist

- [ ] PR envelope has `kind: history`, `readiness: needs-review`, correct triage fields
- [ ] PR body contains `Closes #<N>` (or `Addresses #<N>`) line
- [ ] Journey Timeline section present with commit list
- [ ] Both `Authored-by:` and `Last-code-by:` sig blocks present
- [ ] Review placeholder section present pointing to `review.md`
- [ ] Issue label transitioned from `lognexus/in-progress` to `lognexus/needs-review`
