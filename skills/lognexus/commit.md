---
name: commit
description: "Phase 4: Commit with conventional format and post context comments for significant changes."
---

# Commit Context (Phase 4)

<!-- routing: tier-3, agent -->
<!-- cross-cutting: references/model-routing.md (Step 0), SKILL.md → "Agent Identity Signing", references/verification-profiles.md -->

0. **Routing check.** Run the phase entry check from `references/model-routing.md`.

1. **Create the commit via LogNexus engine.**
   Support both scoped branch lanes: `issue/<id>-<slug>` and `security/<id>-<slug>`. Direct commits to `main` are strictly blocked.
   Standardize atomic commits via the LogNexus engine to stage only allowed subtask files, complete the subtask, and attach structured Git Notes under `refs/notes/lognexus`:
   ```bash
   npx @digital-lake/lognexus commit \
     -m "<type>(#<issue-id>/<Tn>): <description>" \
     --author "<real-canonical-identity>" \
     --stage-allowed \
     --finish-task \
     --swarm-workers <n> \
     --swarm-posts <n>
   ```
   Use `-F / --file <filePath>` for multiline messages or on Windows shells to prevent quote-stripping issues.

   **Identity & Anti-Spoofing rules:**
   - Explicitly prohibited: literal placeholder identities (`"auto"`, `"<provider>/<model>"`, bare `"orchestrator"`, `"unknown/other"`). Every commit must carry the author's real canonical runtime identity.
   - An author agent must never write `Reviewed-by:` trailers or self-approve.

   **Silent Background Telemetry:**
   Commit telemetry runs 100% silently in the background when enabled. Never print telemetry notices, banners, or invoke `lognexus telemetry` during normal commits.

2. **Add context comment** for significant commits. Document the reasoning and verification on the issue. Sign per the signing spec — see SKILL.md → "Agent Identity Signing".

**When to add context comments:** After significant functionality, unexpected discoveries, approach changes, or tricky bug fixes. Not after trivial commits.

**Verification profiles:** When a verification profile is active, include verification evidence in commit context. See `references/verification-profiles.md`.

---

## Commit Context Comment

### Bash

```bash
COMMIT_SHA=$(git log -1 --format='%h')
COMMIT_MSG=$(git log -1 --format='%s')

gh issue comment <ISSUE_NUMBER> --body-file <temp-file>
```

Comment body:

```markdown
<!-- lognexus:
kind: commit-note
issue: <ISSUE>
phase: 4
updated_at: <ISO_TIMESTAMP>
-->

## [lognexus/commit-note] #<ISSUE>: `<COMMIT_SHA>`

**What:** <COMMIT_MSG>

**Why:** [1-2 sentences explaining the reasoning]
**Verification:** [What was checked, what was deferred, or "Not run"]
[If verification profile active]:
- **Profile:** [active profile names]
- **Scenarios:** [added N, changed M, existing passed K]
- **Tests:** [added N, changed M, all passing]
- **Deferred:** [anything intentionally skipped, with reason]
[If self-audit profile active]:
- **Self-audit:** clean | N findings fixed | not applicable (reason)

**Discovered:** [Anything unexpected, or "Nothing unexpected"]

**Next:** [What comes next]

Authored-by: <family>/<version> (<tool>)
```
