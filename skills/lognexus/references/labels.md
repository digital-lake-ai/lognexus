# GitHub Labels

Use this file when LogNexus needs to bootstrap, apply, or repair repository labels.

**Kind source of truth:** The canonical mapping from envelope `kind:` to title tags and GitHub labels lives in `SKILL.md` — "Canonical Kind → Tag → Label Map" section. This file documents the label bootstrap commands, colors, and descriptions; it does not duplicate the kind map.

## Canonical label set

| Label | Use when | Color | Description |
|------|----------|-------|-------------|
| `lognexus/plan` | The issue is the planning artifact created from a brainstorm | `0B7285` | Brainstorm captured as a planning issue |
| `lognexus/discovery` | The issue was created from an in-flight discovery | `1D6F42` | Work discovered during another issue or PR |
| `lognexus/blocker` | The tracked work is currently blocked | `C92A2A` | Progress is blocked and needs unblocking |
| `lognexus/history` | The PR is the final timeline/history artifact for the work | `495057` | Final history-bearing LogNexus PR |
| `lognexus/verification` | The issue or PR mainly audits evidence, review readiness, or closure status | `5F3DC4` | Verification, closure audit, or review evidence |
| `lognexus/stacked` | The issue or PR is a stacked prerequisite or child of another work item | `E67700` | Stacked dependency or prerequisite |
| `lognexus/issue-driven` | The PR is explicitly tied to a tracking issue | `1971C2` | PR is linked to a LogNexus issue |
| `lognexus/ready` | The issue is fully scoped and ready to implement | `2DA44E` | Ready to implement |
| `lognexus/in-progress` | Work has started and a branch exists | `FBCA04` | Implementation in progress |
| `lognexus/needs-review` | A PR exists and awaits review | `D93F0B` | Awaiting review |

**Lifecycle label rules:** `lognexus/ready`, `lognexus/in-progress`, and `lognexus/needs-review` are mutually exclusive.

## Bootstrap

Run this once before the first labeled `gh issue create` or `gh pr create` in a repository, then rerun it whenever the label descriptions need to be refreshed.

```bash
gh label create "lognexus/plan" --color 0B7285 --description "Brainstorm captured as a planning issue" --force
gh label create "lognexus/discovery" --color 1D6F42 --description "Work discovered during another issue or PR" --force
gh label create "lognexus/blocker" --color C92A2A --description "Progress is blocked and needs unblocking" --force
gh label create "lognexus/history" --color 495057 --description "Final history-bearing LogNexus PR" --force
gh label create "lognexus/verification" --color 5F3DC4 --description "Verification, closure audit, or review evidence" --force
gh label create "lognexus/stacked" --color E67700 --description "Stacked dependency or prerequisite" --force
gh label create "lognexus/issue-driven" --color 1971C2 --description "PR is linked to a LogNexus issue" --force
gh label create "lognexus/ready" --color 2DA44E --description "Ready to implement" --force
gh label create "lognexus/in-progress" --color FBCA04 --description "Implementation in progress" --force
gh label create "lognexus/needs-review" --color D93F0B --description "Awaiting review" --force
```

## Auto-label mapping

Use high-confidence mapping only.

| Signal | Labels |
|--------|--------|
| Issue title starts with `[lognexus/plan]` | `lognexus/plan` |
| Issue title starts with `[lognexus/discovery]` | `lognexus/discovery` |
| Discovery issue explicitly blocks a parent or is created as a prerequisite | `lognexus/discovery`, `lognexus/stacked` |
| Full-mode PR body follows the timeline template and includes `Closes #<N>` | `lognexus/history`, `lognexus/issue-driven` |
| PR branch matches `issue/<N>-...` or the PR body includes `Closes #<N>` | `lognexus/issue-driven` |
| Issue or PR exists mainly to audit closure, review, or verification evidence | `lognexus/verification` |
| Timeline state says blocked and work cannot proceed | add `lognexus/blocker` |
| Timeline state says unblocked, resumed, or prerequisite resolved | remove `lognexus/blocker` |
| Issue envelope `readiness: ready` and no lifecycle label is present | add `lognexus/ready` |
| Branch created for issue | replace lifecycle label with `lognexus/in-progress` |
| PR created for issue | replace lifecycle label with `lognexus/needs-review` |
| PR merged and issue closed | remove all lifecycle labels |

## Backfill and repair

Inspect labels before changing them:

```bash
gh issue view <ISSUE_NUMBER> --json labels
gh pr view <PR_NUMBER> --json labels
```

Add or repair labels without touching user labels outside the `lognexus/` namespace:

```bash
gh issue edit <ISSUE_NUMBER> --add-label "lognexus/plan"
gh issue edit <ISSUE_NUMBER> --add-label "lognexus/discovery" --add-label "lognexus/stacked"
gh issue edit <ISSUE_NUMBER> --add-label "lognexus/blocker"
gh issue edit <ISSUE_NUMBER> --remove-label "lognexus/blocker"
gh pr edit <PR_NUMBER> --add-label "lognexus/history" --add-label "lognexus/issue-driven"
gh pr edit <PR_NUMBER> --add-label "lognexus/verification"
gh pr edit <PR_NUMBER> --remove-label "lognexus/blocker"
gh issue edit <ISSUE_NUMBER> --remove-label "lognexus/in-progress" --remove-label "lognexus/needs-review" --add-label "lognexus/ready"
gh issue edit <ISSUE_NUMBER> --remove-label "lognexus/ready" --remove-label "lognexus/needs-review" --add-label "lognexus/in-progress"
gh issue edit <ISSUE_NUMBER> --remove-label "lognexus/ready" --remove-label "lognexus/in-progress" --add-label "lognexus/needs-review"
gh issue edit <ISSUE_NUMBER> --remove-label "lognexus/ready" --remove-label "lognexus/in-progress" --remove-label "lognexus/needs-review"
```
