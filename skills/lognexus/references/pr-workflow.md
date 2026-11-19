# PR Creation Workflow

Convention-enforced PR creation workflow for lognexus. This replaces delegation to external PR skills (`ork:create-pr`, `superpowers:finishing-a-development-branch`) to guarantee lognexus's PR timeline template, envelope metadata, label application, provenance signing, and review gate are met.

External PR skills remain usable for their validation features (security scanning, test coverage), but this reference is the authoritative workflow for PR creation when lognexus is active.

---

## Step 1: Pre-flight checks

Both scoped lanes are supported and recognized identically: `issue/<id>-<slug>` and `security/<id>-<slug>`.

### Bash

```bash
BRANCH=$(git branch --show-current)
ISSUE=$(echo "$BRANCH" | grep -oE '[0-9]+' | head -1)
DEFAULT_BRANCH=$(gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name')

# Verify not on default branch
if [[ "$BRANCH" == "$DEFAULT_BRANCH" ]]; then
  echo "STOP: Cannot create PR from $BRANCH."
  exit 1
fi

# Check for uncommitted changes
if [[ -n $(git status --porcelain) ]]; then
  echo "Uncommitted changes detected. Commit or stash first."
  exit 1
fi

# Push branch if needed
git fetch origin
if ! git rev-parse --verify "origin/$BRANCH" &>/dev/null; then
  git push -u origin "$BRANCH"
fi
```

### PowerShell

```powershell
$branch = git branch --show-current
$issue = ([regex]::Match($branch, '\d+')).Value
$defaultBranch = gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name'

# Verify not on default branch
if ($branch -eq $defaultBranch) {
  Write-Host "STOP: Cannot create PR from $branch."
  exit 1
}

# Check for uncommitted changes
if (git status --porcelain) {
  Write-Host "Uncommitted changes detected. Commit or stash first."
  exit 1
}

# Push branch if needed
git fetch origin
git show-ref --verify --quiet "refs/remotes/origin/$branch"
if ($LASTEXITCODE -ne 0) {
  git push -u origin $branch
}
```

## Step 2: Gather context

### Bash

```bash
# Commits in this branch
git log --oneline "$DEFAULT_BRANCH..HEAD"

# File change summary
git diff "$DEFAULT_BRANCH...HEAD" --stat

# Issue context (if available)
gh issue view "$ISSUE" --json title,body,labels 2>/dev/null
```

### PowerShell

```powershell
# Commits in this branch
git log --oneline "$defaultBranch..HEAD"

# File change summary
git diff "$defaultBranch...HEAD" --stat

# Issue context (if available)
gh issue view $issue --json title,body,labels 2>$null
```

## Step 3: Determine delivery type

Check whether this PR fully resolves the issue or is a partial delivery.

**Full delivery:** All tasks in the issue are complete. Use `Closes #<id>`.

**Partial delivery:** Some tasks are complete but others are blocked or deferred. Use `Addresses #<id> (completes T1, T2, ...)` — this does not trigger GitHub auto-close.

## Step 4: Create the PR

Use the lognexus PR timeline template from `../pr.md`. The PR body must include:

1. Envelope metadata (`<!-- lognexus: ... -->`)
2. Summary
3. `Closes #N` or `Addresses #N (completes ...)`
4. Review Status snapshot
5. Journey Timeline (discoveries, decisions)
6. Changes (commit list)
7. Testing / Verification
8. Knowledge for Future Reference
9. Provenance signature (`Authored-by:`, `Last-code-by:`, and `Planned-by:` if driven by an external master plan)

Sign exclusively with canonical model identities:
- **Tier-1:** `Gemini 4 Neon` (`gemini/neon`, `Orchestrator (Neon)` / `gemini-pro-orchestrator-neon`), `Gemini 4 Carbon`, `Gemini 4 Argon`, `Claude Opus 5.5`.
- **Tier-2 / Tier-3:** `Gemini 4 Hydrogen` (`google/gemini-4-hydrogen-high (antigravity)`), `Gemini 3.8 Flash` (`google/gemini-3.8-flash-high (antigravity)`), `gemini-flash-worker-agy`, `Claude Sonnet 5.5`, `deepseek/VS Code (kimi-code)`.
- Never use literal placeholder identities (`"auto"`, `"<provider>/<model>"`, bare `"orchestrator"`, `"unknown/other"`).

### Labels

Apply lognexus labels at creation time:

### Bash

```bash
gh pr create --base "$DEFAULT_BRANCH" \
  --label "lognexus/history" \
  --label "lognexus/issue-driven" \
  --title "<type>(#$ISSUE): <brief description>" \
  --body-file "$TEMP_FILE"
```

### PowerShell

```powershell
gh pr create --base $defaultBranch `
  --label "lognexus/history" `
  --label "lognexus/issue-driven" `
  --title "<type>(#$issue): <brief description>" `
  --body-file $tempFile
```

For stacked PRs, also add `--label "lognexus/stacked"`.
For partial delivery PRs, use `status: in-progress` in the envelope instead of `status: resolved`.

### Base branch

Always use the repo's default branch (`$DEFAULT_BRANCH`), not a hardcoded value.

## Step 5: Review gate

Review gating is configured via `review_gate: auto | intra-fleet | cross-vendor | advisory | off` in `.lognexus/routing.md` (`auto` defaults to `intra-fleet`). Both Cross-Vendor Review and Intra-Fleet Distinct-Model Review (`Gemini 4 Neon` / `Carbon` / `Argon` reviewing `Gemini 4 Hydrogen` / `3.8 Flash`; `Claude Opus 5.5` reviewing `Claude Sonnet 5.5`) satisfy the independent review gate (`Authored-by` != `Reviewed-by`).

1. Note the review requirement in the PR body or a comment.
2. See `closure-and-review.md` for the full review protocol.
3. The review must come from a distinct model than the one that authored the PR (identical model family across any effort suffix is strictly blocked from self-approving).
4. **Anti-Spoofing Rule:** The authoring agent never writes a `Reviewed-by:` trailer and never executes `gh pr merge`. Both actions belong exclusively to the independent reviewing identity.
5. Sign the review artifact per the agent identity signing rules.
6. After each signed review comment, refresh the PR body's review snapshot in place.
7. If new code lands after a review, flip the snapshot to `needs re-review` before asking for another review.

Do not merge without an independent review sign-off (`Authored-by` != `Reviewed-by`).

### Merge Execution (Strict `--no-ff` Mandatory)

When merging via GitHub CLI, use exclusively `--merge` to force a standard merge commit:

```bash
gh pr merge <PR_NUMBER> --merge --delete-branch
```

**Prohibición absoluta de Squash y Rebase:**
- Never use `--squash` or `--rebase`.
- Squash and rebase merges collapse all atomic subtask commits (`T1..Tn`) and orphan LogNexus Git Notes (`refs/notes/lognexus`) on disconnected commit SHAs.

## SemVer & Release Milestone Policy

1. **Greenfield Bootstrap (`0.1.0`):** New repositories (`0` published releases) should start at `0.1.0` in `package.json` / `pyproject.toml` rather than the `npm init -y` default `1.0.0`.
2. **Subtasks Never Bump Version (`T1..Tn`):** Subtasks (`T1`, `T2`, `T3`...) are atomic commits inside a single feature/fix branch (`issue/<id>-<slug>`). Do **not** increment the project version per subtask (`T1 != 0.1.0`, `T2 != 0.2.0`).
3. **One Version Bump per Cycle at PR Closure (`--no-ff`):** Bump the project version at most once per Issue/PR cycle (typically in the final subtask before opening/merging the PR via `gh pr merge --merge --delete-branch`): `fix:` -> `PATCH` (`0.1.x`), `feat:` -> `MINOR` (`0.x.0`), and reserve `1.0.0` for the first production-validated milestone.
4. **No `lognexus release` Command:** LogNexus does not have a `lognexus release` CLI command; releases are cut through standard manifest version bumps merged into `main` (`--no-ff`) and tagged via Git/CI.
5. **Multi-Manifest SemVer Separation:** Keep **Software Version** (e.g. `0.1.0` pre-release until validated) strictly separate from **Document Revision** (e.g. `rev. 1.3`) across all manifests (`package.json`, `pyproject.toml`, `.claude-plugin/plugin.json`, `server.json`), skill docs, and UI labels.

## Step 6: Post-merge (after review and merge)

1. If the PR fully resolves the issue: GitHub auto-closes it via `Closes #N`.
2. If partial delivery: post a `[lognexus/milestone]` comment on the issue listing what shipped.
3. If any tasks are blocked on external dependencies: post a `[lognexus/blocker]` comment.
4. Store key learnings in the knowledge graph (`ork:remember` if available).

---

## Finishing a branch (integration options)

When implementation is complete and all tests pass, present these options:

1. **Push and create PR** — the standard lognexus path (this workflow).
2. **Keep the branch** — for further work before PR.

LogNexus does not support direct local merges without a PR, because every merge must go through the review gate. If the user requests a local merge, note the review requirement and offer to create a PR instead.

---

## Attribution

This workflow internalizes conventions from:
- [OrchestKit](https://github.com/yonatangross/orchestkit) `ork:create-pr` (MIT License)
- [Superpowers](https://github.com/obra/superpowers) `superpowers:finishing-a-development-branch` (MIT License)

See `LICENSES/` for full license texts.
