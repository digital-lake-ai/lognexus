---
name: lognexus
description: Git-as-knowledge-graph workflow for traceability. Use when planning work, brainstorming designs, creating/managing issues and PRs, tracking architectural decisions, or resuming prior sessions. Slash command /lognexus.
---

# LogNexus

The captain's log for your codebase. Every decision, discovery, and change logged as you ship code.

Use GitHub as a complete knowledge graph where every brainstorm, commit, review, and decision is traceable. This skill orchestrates existing skills and references; it defines when and how to invoke them and what documentation protocol to follow.

## Core Principle

**Nothing gets lost.** Every brainstorm becomes an issue. Every issue drives a branch. Every branch produces a PR. Every PR is a timeline of the entire journey. Git becomes the uber-memory.

---

## Persistent State & Session Recovery

To eliminate cognitive amnesia between conversation resets, context compactations, or model handoffs:
1. **At Session Start or after conversation compactation:**
   Inspect `.lognexus/state.json`, run `npx @digital-lake/lognexus state show`, or read MCP resources (`lognexus://state`, `lognexus://routing`, `lognexus://handoff`) to immediately recover active issue, branch, current subtask, and delegation contract. Validate MCP setup and audit policy with `npx @digital-lake/lognexus doctor --mcp` (discovering Antigravity `~/.gemini/config/mcp_config.json`, `.agents/mcp_config.json`, Cursor, Claude Desktop, and VS Code, with declarative `ToolAnnotations` like `readOnlyHint` and `idempotentHint` across all 12 tools).
2. **Synchronize State:**
   Run `npx @digital-lake/lognexus state sync` upon branch checkout or switching to update local state from Git and GitHub.
3. **Subtask Tracking & Contract Declaration:**
   - Before coding, declare the bounded contract:
     ```bash
     npx @digital-lake/lognexus state set-task <id> "<title>" \
       --assignee "<identity>" \
       --isolation <subagent|swarm|worktree|branch|shared> \
       --swarm-workers <n> \
       --swarm-posts <n> \
       --allowed "<csv>" \
       --verify "<cmd>"
     ```
   - Render the compact dispatch prompt for the next agent/worker:
     ```bash
     npx @digital-lake/lognexus handoff --prompt
     ```
     (Native MCP clients can read `lognexus://handoff` alongside `lognexus://state` and `lognexus://routing` for pure in-memory Markdown handoff synthesis with 0 disk writes).
   - After verification passes:
     ```bash
     npx @digital-lake/lognexus state finish-task <id>
     ```
4. **Post-Merge Cleanup:**
   Run `npx @digital-lake/lognexus state clear` after PR merge.
5. **Silent Background Telemetry Directive:**
   Never print telemetry notices, banners, or invoke `lognexus telemetry` during normal turns unless explicitly requested by the developer; sealed GDPR `[y/N]` consent (`Policy v2.0.0`) runs strictly in interactive human TTY sessions (`lognexus init --enable-telemetry` / `--no-telemetry`, `status`, `doctor`). Telemetry stays 100% silent in the background during automated agent workflows.

---

## Golden-Path Walkthrough

A complete issue-to-merge example using a concrete fake issue `#999`. Follow this sequence and every artifact produced will pass the acceptance checklists in `commands/lognexus/*.md`. The blocks here are illustrative; the canonical, copy-ready templates live in the phase sub-skills under `skills/lognexus/` (see the Phase Sub-skill Index) and in `references/`. If a template changes, verify this walkthrough example is updated to match.

### Step 1 — Plan Capture (`/lognexus plan`)

A brainstorm produces: "Add rate-limit headers to the API so clients can back off intelligently." Load `commands/lognexus/plan.md` and create the issue:

```bash
gh issue create \
  --title "[lognexus/plan] Add rate-limit headers to API" \
  --label "lognexus/plan" \
  --body-file .tmp-plan.md
```

Issue body (excerpt):
```
<!-- lognexus:
kind: state
status: open
phase: 1
readiness: ready
task_count: 2
tasks_complete: 0
max_tier: tier-2
updated_at: 2026-04-18T10:00:00Z
-->
## Tasks
- [ ] **T1: Add X-RateLimit-* headers to response middleware** `[tier-2]`
  - **What:** Inject X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset on every API response.
  - **Verification:** curl the endpoint; confirm all three headers are present.
- [ ] **T2: Document header semantics in API reference** `[tier-2]`
  - **What:** Add a "Rate Limiting" section to docs/api-reference.md.
  - **Verification:** Section exists and matches header values in integration test.

Authored-by: claude/sonnet-4.6 (claude-code)
```

Apply lifecycle label: `gh issue edit 999 --add-label "lognexus/ready"`

### Step 2 — Branch Setup (`/lognexus start`)

Load `commands/lognexus/start.md`. Create the branch from the default branch tip (substitute your repo's default branch, e.g. `main` or `master`):

```bash
git fetch origin <default-branch>
git checkout -b issue/999-rate-limit-headers origin/<default-branch>
```

Swap label and update envelope:
```bash
gh issue edit 999 --remove-label "lognexus/ready" --add-label "lognexus/in-progress"
# Edit issue body: readiness: ready → readiness: in-progress
```

Post session-start comment:
```
[lognexus/session-start] #999: Starting work

**Branch:** `issue/999-rate-limit-headers`
**Starting tasks:** T1, T2
**Plan:** Add headers in middleware (T1) then document (T2).

Authored-by: claude/sonnet-4.6 (claude-code)
```

### Step 3 — Commit Context (`/lognexus commit`)

After implementing T1, load `commands/lognexus/commit.md` and commit. Prefer `npx @digital-lake/lognexus commit` to stage contract-allowed files, complete the subtask, and attach structured Git Notes (`refs/notes/lognexus`) automatically:

```bash
npx @digital-lake/lognexus commit \
  -m "feat(#999/T1): add X-RateLimit-* headers to response middleware" \
  --author "claude/sonnet-4.6 (claude-code)" \
  --stage-allowed \
  --finish-task \
  --swarm-workers 2 \
  --swarm-posts 42
```

Export structured Git Notes in topological JSONL format:
```bash
npx @digital-lake/lognexus note export [--since <ref>] [--issue <id>] [-o|--output <path>]
```

Alternatively, commit via standard Git following the ID-first convention:

```bash
git add src/middleware/rate_limit.ts
git commit -F .tmp-commit-msg.md
# Commit message: feat(#999/T1): add X-RateLimit-* headers to response middleware
#
# Injects the three standard headers into every API response via middleware.
#
# Authored-by: claude/sonnet-4.6 (claude-code)
```

Post commit-note on the issue:
```
[lognexus/commit-note] #999: a1b2c3d feat(#999/T1): add X-RateLimit-* headers

**What:** Middleware now injects X-RateLimit-Limit, -Remaining, and -Reset.
**Why:** Clients need these to implement back-off without polling.
**Verification:** curl localhost:3000/api/health — all three headers present.

Authored-by: claude/sonnet-4.6 (claude-code)
```

Repeat for T2 commit (`docs(#999/T2): document rate-limit headers in API reference`).

### Step 4 — PR Timeline (`/lognexus pr`)

Load `commands/lognexus/pr.md`. Push and create the PR:

```bash
git push -u origin issue/999-rate-limit-headers
gh pr create \
  --title "feat(#999): add rate-limit headers to API" \
  --label "lognexus/history" \
  --label "lognexus/issue-driven" \
  --body-file .tmp-pr-body.md
```

PR body includes: envelope (`kind: history`), summary, `Closes #999`, Journey Timeline with both commits, Verification checklist, Reviews placeholder, and sig block:
```
Authored-by: claude/sonnet-4.6 (claude-code)
Last-code-by: claude/sonnet-4.6 (claude-code)
*Captain's log — PR timeline by **lognexus***
```

Transition issue label:
```bash
gh issue edit 999 --remove-label "lognexus/in-progress" --add-label "lognexus/needs-review"
```

### Step 5 — Independent Review (`/lognexus review`)

Review gating is controlled by `review_gate: auto | intra-fleet | cross-vendor | advisory | off` in `.lognexus/routing.md` (where `auto` resolves to `intra-fleet` distinct-model review). **ChatGPT / OpenAI Codex environments NEVER force cross-vendor review**: `review_gate: auto` uses `intra-fleet` within OpenAI (`GPT-6.2 Astra` reviewing `GPT-6.2 Sol` or `GPT-6 Luna`), and single-session or solo ChatGPT / Codex workflows where cross-model review is unnecessary or unavailable can set `review_gate: advisory` or `review_gate: off`. Audit rules are configured in `.lognexus/policy.json` (`profiles`: `default` | `incremental` | `strict`), where rules `invalid-identity`, `review-gate-separation`, `base-branch-range`, and `invalid-policy` enforce a hardcoded non-overridable error floor.

An independent reviewer model (e.g., `openai/gpt-6.2-astra (codex)` or `openai/gpt-5.4 (codex)` under cross-vendor review, or a distinct Tier-1 model like `Gemini 4 Argon`, `Gemini 4 Neon`, or `GPT-6.2 Astra` reviewing `GPT-6.2 Sol`/`GPT-6 Luna` under intra-fleet review) loads `commands/lognexus/review.md`, reads the diff, and posts the signed review comment on the PR:

```
[lognexus/review-handoff] #999: Review of PR #<PR>

Middleware approach is correct. Headers match RFC 6585 semantics.

Reviewed-by: openai/gpt-5.4 (codex, effort: high)
Disposition: approve
Scope: full diff
Follow-ups: none
```

The reviewer then updates the PR body review snapshot in place:
```
Current state: approved
Last reviewed by: openai/gpt-5.4 (codex, effort: high)
Last reviewed at: 2026-04-18T15:00:00Z
Reviewed commit: a1b2c3d
Source artifact: <URL to review comment>
Needs re-review since: —
```

**Anti-Spoofing Rule:** No author agent (`Authored-by`) may write `Reviewed-by:` trailers or run `gh pr merge`. Writing one's own review sign-off—under any model name—is strictly prohibited. The review sign-off belongs exclusively to the independent reviewer.

### Step 6 — Merge (`--no-ff` Mandatory)

The independent review gate is satisfied (`Last-code-by: claude/sonnet-4.6` ≠ `Reviewed-by: openai/gpt-5.4`).

Merge the PR exclusively using `--merge` to force a merge commit (`--no-ff`):
```bash
gh pr merge 999 --merge --delete-branch
```
> [!IMPORTANT]
> Never use `--squash` or `--rebase`. Squash merging flattens subtask commits (`T1..Tn`) into a single commit and orphans LogNexus Git Notes (`refs/notes/lognexus`).

Remove all lifecycle labels from issue #999. GitHub closes #999 automatically via `Closes #999`.

---

## SemVer & Release Milestone Policy

1. **Greenfield Bootstrap (`0.1.0`):** New repositories (`0` published releases) should start at `0.1.0` in `package.json` / `pyproject.toml` rather than the `npm init -y` default `1.0.0`.
2. **Subtasks Never Bump Version (`T1..Tn`):** Subtasks (`T1`, `T2`, `T3`...) are atomic commits inside a single feature/fix branch (`issue/<id>-<slug>`). Do **not** increment the project version per subtask (`T1 != 0.1.0`, `T2 != 0.2.0`).
3. **One Version Bump per Cycle at PR Closure (`--no-ff`):** Bump the project version at most once per Issue/PR cycle (typically in the final subtask before opening/merging the PR via `gh pr merge --merge --delete-branch`): `fix:` -> `PATCH` (`0.1.x`), `feat:` -> `MINOR` (`0.x.0`), and reserve `1.0.0` for the first production-validated milestone.
4. **No `lognexus release` Command:** LogNexus does not have a `lognexus release` CLI command; releases are cut through standard manifest version bumps merged into `main` (`--no-ff`) and tagged via Git/CI.
5. **Multi-Manifest SemVer Separation:** Keep **Software Version** (e.g. `0.1.0` pre-release until validated) strictly separate from **Document Revision** (e.g. `rev. 1.3`) across all manifests (`package.json`, `pyproject.toml`, `.claude-plugin/plugin.json`, `server.json`), skill docs, and UI labels.

---

## When This Skill Activates

**User-invocable:** `/lognexus`, `/lognexus models`, `/lognexus <phase>`

**`/lognexus models`:** Re-runs the routing setup prompt. See `references/model-routing.md`.

**Auto-activate when ANY of these occur:**
- User says "let's plan", "let's brainstorm", or "let's design"
- User explicitly requests traceability or knowledge-graph tracking
- Creating a new issue or PR with intent to document decisions
- Mid-work discovery requiring a new issue or stacked PR
- User asks "where did we decide X?" or "what's the status of Y?"
- Resuming work on an existing issue or PR
- Applying review feedback, fixing review findings, or addressing request-changes dispositions
- User references an issue or PR by number
- Issue or PR body footer contains `Managed by **lognexus**` (recognition trigger — do not add this footer proactively)

**Do NOT auto-activate for:**
- Generic coding requests that do not need traceability
- Simple bug fixes or refactors that do not need durable workflow history
- Work where a more specific skill is the better fit

---

## Verb Grid

Each `/lognexus <command>` slash command maps to one command file under `commands/lognexus/`. Load the command file — it owns the phase's runnable policy, templates, and acceptance checklist.

Two trees co-exist and complement each other:

- `commands/lognexus/*.md` — the slash commands (`plan`, `start`, `hunt`, `commit`, `pr`, `review`, `lookup`, `resume`, `models`). Executable policy: runnable queries, allowed tools, acceptance checklists.
- `skills/lognexus/*.md` — the phase sub-skills (`brainstorm`, `branch`, `discovery`, `commit`, `pr`, `lookup`, `timeline`). Template library + routing annotations; referenced by phase, not invoked as commands.

The phase sub-skills are indexed below in "Phase Sub-skill Index". Open a phase sub-skill when you need its template or checklist; open the matching command file when you are about to execute that phase.

| Command | What it does | Command file |
|---------|-------------|--------------|
| `/lognexus plan` | Capture a brainstorm as a GitHub planning issue with envelope + task contracts | `commands/lognexus/plan.md` |
| `/lognexus start` | Create a branch from an issue, swap lifecycle labels, post session-start comment | `commands/lognexus/start.md` |
| `/lognexus hunt` | Triage open issues and PRs; rank by readiness; detect gate-satisfying reviews | `commands/lognexus/hunt.md` |
| `/lognexus commit` | Stage and commit with ID-first format; post commit-note comment for significant commits | `commands/lognexus/commit.md` |
| `/lognexus pr` | Push branch, create PR with journey timeline body, transition issue label | `commands/lognexus/pr.md` |
| `/lognexus review` | Perform cross-model review; post signed comment; update PR body review snapshot | `commands/lognexus/review.md` |
| `/lognexus lookup` | Search issues, PRs, and git log by `#ID` or keyword; return compact table first | `commands/lognexus/lookup.md` |
| `/lognexus resume` | Re-orient to current branch; detect issue number; post session-resume comment | `commands/lognexus/resume.md` |

**`/lognexus models`:** Re-runs the model-routing setup prompt. See `references/model-routing.md`.

---

## Phase Sub-skill Index

The phase sub-skills under `skills/lognexus/` carry templates, routing annotations, and acceptance checklists per phase. They are keyed the same way the command files are keyed, but are loaded by phase (look up the template you need), not invoked as slash commands.

| Phase | Sub-skill | Holds templates for |
|-------|-----------|---------------------|
| 1. Brainstorm   | `skills/lognexus/brainstorm.md` | Issue creation, task contracts, plan envelope |
| 2. Branch Setup | `skills/lognexus/branch.md`     | Session-start comment, delegation handoffs |
| 3. Discovery    | `skills/lognexus/discovery.md`  | Discovery issues, blocker cross-reference comments, stacked-PR flow |
| 4. Commit       | `skills/lognexus/commit.md`     | Commit-context comments |
| 5. PR           | `skills/lognexus/pr.md`         | PR timeline body (full + partial delivery) |
| 6. Lookup       | `skills/lognexus/lookup.md`     | Retrieval results, triage-scan output formats |
| 7. Timeline     | `skills/lognexus/timeline.md`   | Session-start/resume, milestone, blocker, closure artifacts |

**Single source of truth:** `references/phase-templates.md` is a compatibility pointer that indexes the same files; keep this index and that pointer in sync. See `references/closure-and-review.md` for the review sign-off template (owned there, cross-referenced from `skills/lognexus/pr.md`).

---

## Canonical Kind → Tag → Label Map

`kind:` in envelope YAML is the source of truth. Title tags (`[lognexus/<tag>]`) and GitHub labels (`lognexus/<label>`) are derived views on `kind:`. When a new artifact kind is defined, it is added here once and all three surfaces are updated together.

| `kind:` (envelope) | Title tag `[lognexus/<tag>]` | GitHub label `lognexus/<label>` | Description |
|--------------------|-----------------------------|-------------------------------|-------------|
| `state` | `plan`, `session-start`, `session-resume`, `milestone`, `discovery`, `implementation-issue` | `plan` (planning issues) | Current status snapshot of an issue or PR |
| `handoff` | `session-start`, `review-handoff` | — | Context transfer between tiers, tools, or sessions |
| `verification` | `commit-note`, `review-handoff`, `verification` | `verification` | Evidence of testing, review, or quality check |
| `commit-note` | `commit-note` | — | Reasoning behind a specific commit |
| `review-handoff` | `review-handoff` | — | Review request or review completion artifact |
| `amendment` | `amendment` | — | Correction or clarification for an existing signed artifact |
| `blocker` | `blocker` | `blocker` | Something preventing progress |
| `history` | `history` | `history` | Retrospective summary for knowledge retrieval |

**Lifecycle labels** (`lognexus/ready`, `lognexus/in-progress`, `lognexus/needs-review`) are not tied to an artifact `kind:`. They track issue/PR workflow state and are mutually exclusive. Apply them per the Triage Field Maintenance table below.

**Aspect labels** (`lognexus/discovery`, `lognexus/stacked`, `lognexus/issue-driven`) classify the relationship between artifacts, not their content kind. They may coexist with lifecycle labels.

For the full label set, color codes, and bootstrap CLI snippets, see `references/labels.md` (which cross-references this table as its canonical kind source).

---

## ID-First Naming Convention

All artifacts use `#ID` as the primary key for fast, token-efficient retrieval.

**Semantic tag vocabulary** for user-facing headings: `plan`, `session-start`, `session-resume`, `commit-note`, `discovery`, `blocker`, `implementation-issue`, `handoff`, `review-handoff`, `history`, `amendment`, `milestone`, and `verification`. Format: `[lognexus/<tag>] <human title>`. See the Canonical Kind → Tag → Label Map section for the authoritative mapping.

| Artifact | Convention | Example |
|----------|-----------|---------|
| Branch | `issue/<id>-<slug>` or `security/<id>-<slug>` | `issue/42-auth-middleware`, `security/42-audit-fix` |
| Commit | `<type>(#<id>): <msg>` | `feat(#42): add JWT validation` |
| Commit (task) | `<type>(#<id>/<Tn>): <msg>` | `feat(#42/T2): add middleware chain` |
| PR title | `<type>(#<id>): <msg>` | `feat(#42): add auth middleware` |
| PR body (closes) | `Closes #<id>` | `Closes #42` |
| PR body (partial) | `Addresses #<id> (completes ...)` | `Addresses #42 (completes T1, T2)` |
| Task in issue | `- [ ] **T<n>: Title** [tier-N]` | `- [ ] **T1: Add JWT** [tier-3]` |
| Timeline comment | `[lognexus/<kind>] #<id>: ...` | `[lognexus/discovery] #42: race condition` |
| Stacked branch | `issue/<new-id>-<slug>` | `issue/43-fix-race-condition` |
| Stacked PR title | `<type>(#<new-id>): ... [stack: #<parent>]` | `fix(#43): race cond [stack: #42]` |
| Memory entry | `#<id>: <decision>` | `#42: chose JWT over sessions` |

**Branch lanes:** Both scoped lanes (`issue/<id>-<slug>` and `security/<id>-<slug>`) are recognized and treated identically across the LogNexus engine (`status`, `timeline`, `audit`, and protected branch guard). Direct commits or pushes to `main` are strictly blocked. Pre-merge audit compliance is enforced via `lognexus audit` under `.lognexus/policy.json` (`default` | `incremental` | `strict`).

**Task IDs:** Tasks carry local IDs (`T1`, `T2`, ...) scoped to the issue. Commits use `#<id>/<Tn>`.

**Retrieval:** `gh issue list --search "#42"` | `git log --grep="#42"` | `git log --grep="#42/T1"` | `gh pr list --search "#42"` | `npx @digital-lake/lognexus note export --issue 42`

### Envelope Schema and Triage Fields

Issue and PR envelopes use `<!-- lognexus: ... -->` HTML comment blocks. The full field schema and triage field derivation rule live in `references/artifact-envelopes.md` §1. Summary of triage fields:

| Field | Derived from | Hand-written? |
|-------|-------------|---------------|
| `task_count` | Count of `- [ ]` + `- [x]` lines | No — derived |
| `tasks_complete` | Count of `- [x]` lines | No — derived |
| `max_tier` | Highest `[tier-N]` among unchecked tasks | No — derived |
| `readiness` | Workflow intent | Yes |

**Triage field maintenance:** keep envelope triage fields current on each lifecycle event. See the Triage Field Maintenance table below. Derivation rule is in `references/artifact-envelopes.md` §1.

### Triage Field Maintenance

Issue envelope triage fields (`readiness`, `task_count`, `tasks_complete`, `max_tier`) and lifecycle labels must be kept current so triage scans produce accurate results.

| Event | Envelope update | Label update |
|-------|----------------|--------------|
| Issue created (Phase 1) | Set all four triage fields at creation (`task_count`, `tasks_complete`, `max_tier` from derivation rule; `readiness` by intent) | Apply `lognexus/ready` if tasks are scoped and no blockers |
| Branch created (Phase 2) | Set `readiness: in-progress` | Replace lifecycle label with `lognexus/in-progress` |
| Task checked off (Phase 4) | Recompute `tasks_complete` and `max_tier` from body (derivation rule) | - |
| All tasks complete | Set `readiness: done`; `max_tier` will be empty per derivation rule | - |
| Blocker found (Phase 3) | Set `readiness: blocked` | Add `lognexus/blocker` |
| Blocker cleared | Restore previous `readiness` (`in-progress` or `ready`) | Remove `lognexus/blocker` |
| PR created (Phase 5) | Set `readiness: done` if all tasks shipped | Replace lifecycle label with `lognexus/needs-review` |
| PR merged and issue closed | - | Remove all lifecycle labels |

**Derived fields:** `task_count`, `tasks_complete`, and `max_tier` are computed from the issue body task list (counted `- [ ]` / `- [x]` lines and highest `[tier-N]` among unchecked tasks). See the derivation rule in `references/artifact-envelopes.md` §1 "Triage field derivation". Only `readiness` is hand-written.

Edit the issue body in place when these fields change. Triage metadata is derived state, so refreshing it does not require `Updated-by:` provenance.

---

## Agent Identity Signing

Every lognexus artifact (comments, PR bodies, review sign-offs) must carry a provenance signature in the canonical format:

```
<role>: <family>/<version> (<tool>[, <qualifier>])
```

### Signature field reference

| Field | Values | Examples |
|-------|--------|---------|
| `role` | `Authored-by`, `Updated-by`, `Reviewed-by`, `Last-code-by`, or `Planned-by` | — |
| `family` | Provider name, lowercase | `claude`, `openai`, `google`, `deepseek`, `xai`, `zai`, `qwen`, `moonshot` |
| `version` | Model identifier | `fable-5.2`, `mythos-5.2`, `opus-5.5`, `sonnet-5.5`, `gpt-6.2-astra`, `gpt-6.2-sol`, `gpt-6-luna`, `gpt-6-cyber`, `gpt-5.4`, `carbon`, `argon`, `neon`, `hydrogen`, `v4-pro`, `v4.1-flash`, `grok-4.7`, `glm-5.4`, `qwen-4-max`, `kimi-k3.1-pro` |
| `tool` | Runtime environment, lowercase | `claude-code`, `codex`, `copilot`, `cursor`, `antigravity`, `kimi-code` |
| `qualifier` | Optional metadata string; may be compound when needed | `effort: high`, `orchestrator`, `sub-agent: reviewer`, `effort: high; orchestrator` |

**Searching:** `Planned-by:` → external master plan provenance. `Authored-by:` → original authorship. `Updated-by:` → later material editors. `Reviewed-by:` → review artifacts. `Last-code-by:` → most recent code author on a PR branch. `claude/` → all Claude artifacts. `(codex` → all Codex artifacts.

### Model detection per tool

| Tool | Source | Example signature |
|------|--------|-------------------|
| Claude Code | System prompt model name | `claude/fable-5.2 (claude-code)`, `claude/mythos-5.2 (claude-code)`, `claude/opus-5.5 (claude-code)`, `claude/sonnet-5.5 (claude-code)`, `claude/haiku-5.5 (claude-code)` |
| Codex CLI / App / Cloud | `~/.codex/config.toml` `model` + effort (`CODEX_CI` / `CODEX_SANDBOX_NETWORK_DISABLED`) | `openai/gpt-6.2-astra (codex)`, `openai/gpt-6.2-sol (codex)`, `openai/gpt-6-luna (codex)`, `openai/codex-mini (codex)` |
| GitHub Copilot | `.github/copilot-instructions.md` (`copilot` ecosystem) | `claude/fable-5.2 (copilot)`, `openai/gpt-6.2-astra (copilot)` |
| Cursor | System prompt model identifier | `claude/opus-5.5 (cursor)` |
| Antigravity (Tier-1 Orchestrators) | Workspace agent configuration | **`Gemini 4 Neon`** (`gemini/neon`, `Orchestrator (Neon)` / `gemini-pro-orchestrator-neon`), `Gemini 4 Carbon` (`gemini/carbon`), `Gemini 4 Argon` (`gemini/argon`) |
| Antigravity (Tier-2/3 Workers) | Runtime subagent or swarm worker | `google/gemini-4-hydrogen-high (antigravity)`, `google/gemini-3.8-flash-high (antigravity)`, `gemini-flash-worker-agy` |
| Kimi Code / Moonshot | Active model identifier in editor | `moonshot/kimi-k3.1-pro (kimi-code)`, `deepseek/VS Code (kimi-code)` |
| xAI Grok | API / CLI runtime environment | `xai/grok-4.7 (grok-cli)` |
| Z.ai GLM | API / CLI runtime environment | `zai/glm-5.4 (glm-cli)` |
| Qwen | API / CLI runtime environment | `qwen/qwen-4-max (qwen-cli)` |
| Other | Best available model identifier | `<family>/<version> (<tool>)` |

**November 2026 Normalization & Shared-Weights Gate:**
- Effort/speed suffixes (`-ultrafast`, `-fast`, `-light`, `-max`, `-extra-high`, `-xhigh`, `-high`, `-medium`, `-low`, `-minimal`, `-none`) and `codex/* -> openai/*` provider aliases strip cleanly during family normalization (`claude/fable-5-2` == `claude/fable-5.2`, `openai/gpt-6-2-astra` == `openai/gpt-6.2-astra`).
- Frontier models across DeepSeek (**DeepSeek V4-Pro** / **V4** / **V4.1-Flash**), xAI (**Grok 4.6/4.7** / **Grok Code Fast**), Z.ai (**GLM-5.4** / **GLM-4-Flash**), Qwen (**Qwen 4 Max** / **Qwen Coder**), Moonshot (**Kimi K3.1 Pro / Thinking**), and OpenAI (**GPT-6-Cyber**) are fully supported and mapped into the 3-tier taxonomy.
- `Claude Fable 5.2` (`claude/fable-5.2`) and `Claude Mythos 5.2` (`claude/mythos-5.2`) share identical underlying base weights: `Fable <-> Mythos` cross-review is blocked as self-approval, while `Fable`/`Mythos` may review `Opus 5.5`, `Sonnet 5.5`, or `Haiku 5.5` under `intra-fleet`.
- In `CODEX_CI` or `CODEX_SANDBOX_NETWORK_DISABLED` agent subshells, interactive telemetry prompts stay suppressed (`CODEX_HOME` alone does not suppress human TTY prompts).

### Master Plan Provenance: `Planned-by:`

When work originates from a plan authored outside this repository (an external "master plan" produced by an external orchestrator session), record that provenance with a `Planned-by:` trailer in the PR body, alongside the commit trailers:

```markdown
Planned-by: <family>/<version> (<client>) — <plan identifier>
Authored-by: <family>/<version> (<client>)
Reviewed-by: <family>/<version> (<client>)
```

`Planned-by:` documents where the plan came from; it does **not** grant review authority, merge rights, or any exception from the independent review gate.

### Prohibited Placeholder Identities

Literal placeholder identities are strictly prohibited across all artifacts, issue comments, PR bodies, and `--author` commit flags:
- **NEVER** use literal `"auto"`, `"<provider>/<model>"`, bare `"orchestrator"`, or `"unknown/other"`.
- Every agent and swarm worker must resolve and sign with its real canonical runtime identity (e.g. `google/gemini-3.8-flash-high (antigravity)` or `gemini/carbon`).

### Orchestration role qualifiers

When an artifact is emitted as part of a multi-lane flow, qualifiers carry orchestration role information:

- `orchestrator` — the current actor dispatched or collected delegated lanes
- `sub-agent: reviewer` — delegated reviewer lane
- `sub-agent: verifier` — delegated closure verifier lane
- `sub-agent: implementation` — delegated implementation lane

Examples:
- `Authored-by: openai/gpt-5.4 (codex, effort: high; orchestrator)`
- `Reviewed-by: claude/opus-4.6 (claude-code, sub-agent: reviewer)`
- `Authored-by: openai/gpt-5.4 (codex, sub-agent: verifier)`

### Correction rule

If a lognexus artifact carries an incorrect or incomplete signature, correct it in place when the platform allows editing. Otherwise post an immediate follow-up correction.

### Edit provenance rules

- `Authored-by:` records the original author of an artifact body.
- `Updated-by:` records a later model or human who materially edits that same artifact body. Preserve the original `Authored-by:` line and append a new `Updated-by:` line for each material edit, newest last.
- `Reviewed-by:` is review-only. Do not use it for authorship or edit attribution.
- Updating a PR body's review snapshot after publishing a signed review comment or after pushing code that makes a prior review stale counts as a material edit.
- A **material edit** changes meaning, facts, scope, requirements, acceptance criteria, verification results, review disposition, or a handoff contract. Typos, formatting cleanups, and link-only fixes are cosmetic and do not need `Updated-by:`.

### Code provenance: `Last-code-by:`

`Last-code-by:` tracks which model most recently pushed code to a PR branch. It is distinct from artifact provenance fields.

| Field | Tracks | Updated when |
|-------|--------|-------------|
| `Planned-by:` | External master plan provenance | Recorded in PR body alongside commit trailers |
| `Authored-by:` | Original artifact text author | Artifact is created |
| `Updated-by:` | Later artifact text editor | Artifact body is materially edited |
| `Reviewed-by:` | Review author | Review sign-off is posted |
| `Last-code-by:` | Most recent code author | Code is pushed to the PR branch |

**When to set `Last-code-by:`:**
- On PR creation: set in the PR body sign-off block (the creating model is the initial code author).
- After pushing code to an existing PR branch: update via `gh pr edit`.
- After review-driven code changes: the reviewer who pushes fixes becomes `Last-code-by:`.

**When NOT to update `Last-code-by:`:** reviewing without pushing code; editing the PR body text without commits; rebasing or force-pushing without new code changes.

**Why this field exists:** The multi-model review gate must know who last changed the code to determine whether a review is cross-model (gate-satisfying) or same-model (non-gate-satisfying). Without `Last-code-by:`, consumers fall back to git commit forensics.

**Fallback chain for review gating:**
1. `Last-code-by:` in the PR body (authoritative)
2. `Updated-by:` in the PR body (approximate)
3. `Authored-by:` in the PR body (original author — may be stale)
4. Git commit author on the PR branch (last resort)

### Edit-in-place vs amendment

- **Edit in place** when the artifact is meant to stay the single canonical current body: issue bodies, PR bodies, and latest-wins status/history artifacts. Refresh envelope `updated_at` and add `updated_by` plus `edit_kind` fields when an envelope exists.
- **Post an amendment artifact** when the original text matters for auditability: handoffs, verification comments, commit-note comments, review sign-offs, and other major signed timeline entries.

Use `supersedes` when the new artifact replaces the old one as canonical. Use `amends` when the new artifact corrects or clarifies but both should remain visible.

**In-place edit footer — append after original `Authored-by:`:**

```markdown
Updated-by: <family>/<version> (<tool>)
Edit-kind: correction | amendment | rewrite
Edit-note: [1 sentence describing what changed and why]
```

**Amendment artifact template:**

```markdown
<!-- lognexus:
kind: amendment
issue: <ISSUE_NUMBER>
pr: <PR_NUMBER>
updated_at: <ISO_TIMESTAMP>
amends: <artifact-reference>
-->

## [lognexus/amendment] #<ISSUE_NUMBER>: <brief description>

**Target:** [URL to the artifact being corrected or clarified]
**Edit kind:** correction | amendment | rewrite
**Why new artifact:** [why this should not be a silent in-place edit]
**What changed:**
- [change 1]
- [change 2]

**Current canonical artifact:** [URL to the current body, or `this comment`]

Authored-by: <family>/<version> (<tool>)
```

If the amendment fully replaces the old artifact, swap `amends:` for `supersedes:` and update the old artifact with `superseded_by:` when practical.

### PR body review snapshot maintenance

When a PR body carries the current review snapshot:
- Post the signed `Reviewed-by:` comment first. That comment is the review evidence.
- Then refresh the PR body snapshot in place so retrieval flows can read current review state without replaying the comment thread.
- If new code lands after the latest signed review, update the snapshot to `needs-rereview` and record the commit that made the prior review stale.
- Use the standard `Updated-by:` footer and envelope `updated_by` / `edit_kind` fields for these edits.

Model identity detection is also used by model-tier routing to verify the current model matches the recommended tier. See `references/model-routing.md`.

---

## GitHub Labels

**lognexus** manages a compact repo-level label vocabulary so issues and PRs stay filterable even when a reader never opens the body. See `references/labels.md` for the canonical label set, descriptions, and CLI snippets.

Label rules:
- On the first write operation in a repo, bootstrap or refresh labels with `gh label create --force ...`.
- Apply labels at creation time with `gh issue create --label` or `gh pr create --label`.
- `lognexus/blocker` is stateful. Add it when work becomes blocked and remove it when the blocker is cleared.
- `lognexus/ready`, `lognexus/in-progress`, and `lognexus/needs-review` are mutually exclusive lifecycle labels.

---

## Mandatory Issue Capture

Implementation trouble that materially affects the work must be durably recorded before the agent proceeds to the next material step or ends the turn.

### What counts as a relevant implementation issue

- Failed attempts
- Hidden dependencies
- Risky workarounds
- Scope surprises
- Verification gaps
- Environment or tooling friction

### What does not require capture

- Normal iteration where the final approach is obvious from the diff
- Minor typos or lint fixes resolved in the same commit
- Expected complexity that matches the task description

### Capture rule

| Situation | Artifact | Where |
|-----------|----------|-------|
| Issue is local and resolved inline | Timeline comment (`[lognexus/implementation-issue]`) | Issue |
| Issue warrants follow-up, scope split, or long-term retrieval | New linked issue | GitHub issue with cross-reference on parent |

The timeline comment is the minimum: one paragraph explaining what happened, why it matters, and how it was resolved or deferred.

---

## Edge Cases

- **No issue exists:** Let the user work. At first commit or PR, offer to create a tracking issue.
- **Mid-work activation:** Check branch name for `issue/N-*`. If found, add catch-up timeline comment via `skills/lognexus/timeline.md`. If not, offer retroactive issue creation.
- **Small tasks (< 30 min):** Lightweight protocol - issue optional, branch still created, PR sections can be brief.
- **Hotfix / emergency:** Fix first. Create issue and PR after, backfilling the timeline.
- **Post-merge cleanup:** Remove a worktree only when its branch is merged, no open PR still depends on it, and it is not the active workspace. See `references/orchestrator-protocol.md`.

---

## Requirements

| Dependency | Purpose | Install |
|-----------|---------|---------|
| `gh` CLI | GitHub issue/PR/comment operations | `brew install gh` / `winget install GitHub.cli` |
| `git` | Branch, commit, diff, log | Pre-installed |
| GitHub remote | Must be in a git repo with GitHub remote | — |

All recommended skills are optional. The current optional integrations are listed below. Without them, lognexus falls back to direct `gh`/`git` commands.

### MCP & Policy Validation

Run `npx @digital-lake/lognexus doctor --mcp` for read-only cross-platform MCP client config validation (`Claude Desktop`, `.cursor/mcp.json`, `.vscode/mcp.json`, `.mcp.json`, Antigravity `~/.gemini/config/mcp_config.json`, `.agents/mcp_config.json`) and `.lognexus/policy.json` schema validation. All 12 MCP tools declare official `ToolAnnotations` (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`).

### User-Facing Language

The phase numbers are internal workflow labels. Do not surface them to the user.

Preferred labels: `Plan Capture`, `Branch Setup`, `Discovery Handling`, `Commit Context`, `PR Timeline`, `History Lookup`, `Timeline Updates`.

**Brand formatting:** Always bold the word **lognexus** in user-facing text (messages, comments, PR bodies, issue bodies). Write it lowercase and bold: **lognexus**. This does not apply to code identifiers, branch names, CLI output, or other machine-readable contexts where markdown is not rendered.

### Shell Portability

Keep the workflow cross-platform. See `references/shell-portability.md` for full guidance and Bash/PowerShell patterns.

Key rules:
- Prefer `gh ... --body-file <temp-file>` for multiline content.
- Break chained shell commands into separate steps when the shell operator differs.
- Keep Bash examples as the primary path; add PowerShell notes where syntax diverges.

### Integration Map

This skill ORCHESTRATES. Command files under `commands/lognexus/` each own their phase's policy, runnable queries, and acceptance checklist in a single file — no cross-file navigation required during execution. References in `references/` are deep-dive anchors for cross-cutting policy only.

Alongside the command files, `skills/lognexus/*.md` are the phase sub-skills carrying templates and routing annotations (open them by phase — see "Phase Sub-skill Index"). The command file is the executable entry point for a phase; the phase sub-skill is its template/checklist companion. Where both exist under the same name (`commit`, `pr`, `lookup`), they are distinct: `commands/` = runnable policy, `skills/` = template library.

#### Command map

| Phase | Command file | Owns |
|-------|--------------|------|
| Plan Capture | `commands/lognexus/plan.md` | Brainstorm-to-issue policy, gh issue create template, envelope requirements |
| Branch Setup | `commands/lognexus/start.md` | Branch naming, label swap, session-start comment template |
| Triage / Hunt | `commands/lognexus/hunt.md` | PR+issue triage, signed-review detection (comment-based), reviewability classification |
| Commit Context | `commands/lognexus/commit.md` | Commit format, Authored-by sig, commit-note template |
| PR Timeline | `commands/lognexus/pr.md` | PR body structure, sig blocks, review gate pointer |
| Review | `commands/lognexus/review.md` | Review sign-off template, cross-model check, PR snapshot update |
| Lookup | `commands/lognexus/lookup.md` | ID-first retrieval queries, multi-surface search |
| Session Resume | `commands/lognexus/resume.md` | Branch detection, session-resume comment template |

#### Cross-cutting reference anchors

| Policy | Reference | What stays there |
|--------|-----------|-----------------|
| Cross-model gate rule | `references/closure-and-review.md` §3 | What constitutes different model; provenance fallback chain; where reviews live |
| Merge conditions | `references/closure-and-review.md` §5 | Gate satisfaction conditions; risk-based requirements |
| Closure evidence | `references/closure-and-review.md` §1–2 | Evidence requirements; closure comment format |
| Envelope schema | `references/artifact-envelopes.md` §1 | Triage field derivation rule; field definitions |
| Signing spec | `SKILL.md → "Agent Identity Signing"` | Authored-by / Updated-by / Reviewed-by / Last-code-by rules |
| Worktree cleanup | `references/orchestrator-protocol.md` | Canonical portable cleanup sequence (`skills/lognexus/branch.md` duplicates this block) |

#### External skill delegation

| Activity | Primary | External (optional) | LogNexus Adds |
|----------|---------|---------------------|--------------|
| Committing | `commands/lognexus/commit.md` | `ork:commit`, `commit-commands:commit` | ID-first format, task refs, Authored-by sig |
| Creating PRs | `commands/lognexus/pr.md` | `ork:create-pr` (validation agents) | Timeline body, envelopes, labels, review gate pointer |
| Finishing branches | `commands/lognexus/pr.md` | `superpowers:finishing-a-development-branch` | Review gate enforcement |
| Brainstorming | `references/brainstorm-workflow.md` | `superpowers:brainstorming`, `ork:brainstorming` | Design-to-issue capture with task contracts |
| Planning | `commands/lognexus/plan.md` | `superpowers:writing-plans` | Issue task list, envelope, sig |
| Plan execution | `superpowers:executing-plans` | — | Timeline comments at checkpoints |
| Worktree creation | `superpowers:using-git-worktrees` | — | Branch-issue linking |
| Stacked PRs | `ork:stacked-prs` | — | Discovery-driven stacking protocol |
| Issue tracking | `ork:issue-progress-tracking` | — | Auto-checkbox updates from commits |
| Fixing issues | `ork:fix-issue` | — | Timeline documentation of RCA |
| Storing decisions | `ork:remember` | — | Structured `#ID: decision` entries |
| Model routing | Built-in | — | Phase entry check (Step 0), routing prompts, handoffs |
| Fan-out dispatch | `references/orchestrator-protocol.md` | runtime sub-agent/session tools | Dispatch artifact, per-lane contracts, collection summary |
| Review execution | `commands/lognexus/review.md` + `references/closure-and-review.md` §3 | runtime reviewer/verifier tools | Signed comment, cross-model gate check, PR snapshot update |
| Worktree hygiene | `references/orchestrator-protocol.md` | shell commands or external cleanup helpers | Workspace tracking and post-merge cleanup protocol |

**Graceful degradation:** Co-located sub-skill → references deep-dive → external skill → direct `gh`/`git` commands. Minimum viable installation: `gh` CLI + `git` + this skill.

**Conflict avoidance:** This skill sets the WORKFLOW context. External skills provide IMPLEMENTATION helpers. LogNexus's internalized conventions always take precedence for artifact format, signing, labels, and review gates.

#### Runtime-Aware Orchestration & Swarm Governance

LogNexus records orchestration honestly instead of assuming one agent backend fits every runtime.

- **Local parallel tool fan-out:** one orchestrator runs multiple independent helper calls in parallel. Good for sidecar reads; not a separate reviewer identity.
- **Bounded sub-agent:** the orchestrator spawns a child lane with a scoped contract and collects a return artifact.
- **Native Swarm (`orchestration: auto | swarm`):** the orchestrator coordinates multi-agent work across a shared message board with discrete task contracts.
- **External session delegation:** a separate tmux session, terminal agent, or other durable worker runs the lane outside the current orchestrator.
- **Contract-only fallback:** lognexus emits the handoff or review contract when the current runtime cannot execute the lane itself.

##### Hard Turn-1 Probe Gate (`> 3` files)
When exploring code across more than 3 files (with or without an active issue), a Tier-1 orchestrator (`Neon` / `Carbon` / `Argon` / `Opus`) must **NEVER** read `> 3` repository files directly into its own context. Instead, immediately auto-dispatch read-only exploration probes (`invoke_subagent` or read-only `swarm` probes) without asking first:
- Pin a Tier-2/Tier-3 model (e.g. `google/gemini-3.8-flash-high (antigravity)`) whenever the orchestrator is Tier-1, performing zero file writes.
- Stay conversational and direct on small queries (`<= 3` files) without spawning subagents.

##### Automatic Post-Plan Native Swarm (`orchestration: auto`)
Before implementation writes begin, the Tier-1 orchestrator emits the `T1..Tn` plan with pre-assigned subagents/models (`--assignee`), tier, isolation mode (`--isolation`), and file/LOC budgets, awaiting explicit developer confirmation. Once confirmed under `orchestration: auto`:
- When Antigravity `Orchestrator` (`Neon` / `Carbon` / `Argon`) or a standard Tier-1 model with native `swarm` is active, launch native `swarm` automatically under LogNexus contracts without asking again (standard Tier-1 models can invoke `swarm` directly without stacking conflicting IDE Orchestrator wrapper prompts).
- **Immediate Swarm UI Handoff:** Immediately after initial `swarm add` calls, emit a brief progress turn ending with `[Open the Swarm UI](sidecar://swarm/swarm_board/?auto_open=false)` on its own line BEFORE entering `swarm_wait`, so the UI button renders live instead of stalling until workers finish.
- **Coordinator Model Sync:** Switching the IDE model selector mid-conversation changes which model answers turns while the Swarm roster keeps `@coordinator` labeled with its initial model unless `swarm{action: "model"}` is called.
- **Right-Sized Effort:** Reserve `XHigh` / `Max` reasoning effort for deep architectural planning; use `Medium` Tier-1 or Tier-2/Tier-3 for routine status queries, visual reviews, and focused checks.
- Maintain `<= 4` active swarm workers and use selective `@name` mentions (no `@all` broadcast chatter).
- Omit `model` (`"auto"`) on implementation workers unless explicitly requested by the developer, allowing Antigravity to allocate runtime capacity dynamically.
- Sign `--author` with each worker's real canonical runtime identity (never literal `"auto"` or `"<provider>/<model>"`).
- Record `--isolation swarm --swarm-workers <n> --swarm-posts <count>` on commits and state updates.
- Keep subtask contracts strictly within context budgets (`CONTEXT_MAX_FILES = 6` implementation files, `CONTEXT_MAX_LOC = 1200` lines), handing context via `npx @digital-lake/lognexus handoff --prompt` (or the pure in-memory `lognexus://handoff` MCP resource with 0 disk writes).

Isolation backend is tracked separately from the orchestration primitive. A git worktree, forked workspace, or tmux session may all isolate delegated work, but only the primary feature branch/worktree is lognexus's canonical branch record.

See `references/orchestrator-protocol.md` for the capability mapping, fan-out templates, and cleanup protocol.

#### Optional External Skills

These skills enhance lognexus but are not required. LogNexus's conventions take precedence when both are active.

| Skill | Plugin | What It Adds |
|-------|--------|-------------|
| `ork:commit` | OrchestKit | Pre-commit validation (lint, type-check) |
| `ork:create-pr` | OrchestKit | Parallel validation agents (security, tests, quality) |
| `ork:stacked-prs` | OrchestKit | Stacked PR mechanics and management |
| `ork:issue-progress-tracking` | OrchestKit | Auto-checkbox updates from commits |
| `ork:remember` / `ork:memory` | OrchestKit | Knowledge graph storage and retrieval |
| `ork:brainstorming` | OrchestKit | Parallel agent exploration (steps 1-4) |
| `superpowers:brainstorming` | Superpowers | Visual companion, design dialogue (steps 1-4) |
| `superpowers:using-git-worktrees` | Superpowers | Isolated workspace creation |
| `superpowers:writing-plans` | Superpowers | Structured plan documents |
| `superpowers:executing-plans` | Superpowers | Plan execution with checkpoints |

---

## References

One line per deep-dive file. Open only when the co-located sub-skill or inline section is insufficient.

| File | Open when |
|------|-----------|
| `references/artifact-envelopes.md` | Writing or parsing `<!-- lognexus: ... -->` blocks; need triage field derivation rule or full field schema |
| `references/closure-and-review.md` | Deciding whether a PR is mergeable; need cross-model gate rule, merge conditions, or closure evidence requirements |
| `references/labels.md` | Bootstrapping a new repo or repairing labels; need color codes or full label bootstrap CLI |
| `references/signing.md` | The inline Agent Identity Signing section is insufficient; need edge-case signing rules or full model detection details |
| `references/model-routing.md` | Running `/lognexus models` or checking agent tier assignments |
| `references/brainstorm-workflow.md` | Processing brainstorm output before filing an issue; need capture and design-to-issue conventions |
| `references/orchestrator-protocol.md` | Coordinating multi-lane work; need fan-out dispatch templates, reviewer lane contracts, or worktree cleanup |
| `references/shell-portability.md` | Shell syntax for a command is unclear; need Bash/PowerShell cross-platform patterns |
| `references/commit-workflow.md` | The co-located `commands/lognexus/commit.md` is insufficient for cross-cutting commit policy |
| `references/pr-workflow.md` | The co-located `commands/lognexus/pr.md` is insufficient for cross-cutting PR policy |
| `references/verification-profiles.md` | A task requires a named verification profile |
| `references/phase-templates.md` | A template is not covered by any co-located sub-skill file |
