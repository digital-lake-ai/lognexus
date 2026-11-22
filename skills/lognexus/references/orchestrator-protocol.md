# Orchestrator Protocol Reference

LogNexus orchestration is about bounded dispatch, durable collection, and honest capability claims. The orchestration primitive and the isolation backend are related but not interchangeable.

---

## 1. Core Rule

When lognexus documents parallel or delegated work, it must answer two separate questions:

1. **How is work dispatched?** Same agent, spawned sub-agent, external session, or contract-only handoff.
2. **How is work isolated?** Git worktree, forked workspace, tmux session, or shared checkout.

Do not collapse these into one label. A runtime may support bounded sub-agent dispatch with a forked workspace, while another team may use tmux sessions as the isolation backend for an external delegation lane. LogNexus records the dispatch contract and collection artifacts either way.

---

## 2. Orchestration Primitives

Use the smallest primitive that accurately matches the runtime and the task.

| Primitive | What it means | Safe for | Not for | Typical examples |
|-----------|---------------|----------|---------|------------------|
| **Local parallel tool fan-out** | One orchestrator runs multiple independent tool calls without creating a child agent identity | Read-only gathering (`<= 3` files), non-overlapping helper checks, parallel status queries | Independent review, reading > 3 files into context, code ownership claims, multi-step delegated implementation | Codex `multi_tool_use.parallel` |
| **Bounded sub-agent** | The orchestrator spawns a child agent with a scoped contract and collects a return artifact | Turn-1 exploration probes (`> 3` files), independent review, verifier audits, bounded implementation slices | Open-ended uncontracted execution, ambiguous ownership, silent long-running work | Antigravity `invoke_subagent`, Codex `spawn_agent`, Claude Code `Agent` |
| **Native swarm coordination** | The orchestrator coordinates multi-agent workers via a shared message board with discrete task contracts | Multi-subtask execution (`orchestration: auto`), parallel verified slices, bounded worker execution | Unfocused `@all` chatter, uncontracted file writes | Antigravity native `swarm` (`add`, `post_message`, `read_board`) |
| **External session delegation** | Work is handed to a separate durable session or tool instance outside the current orchestrator | Long-running background work, tmux-backed agents, separate human-visible sessions, explicit worktree ownership | Implicit same-turn completion guarantees | tmux background sessions, separate terminal agents, dedicated worktree workers |
| **Contract-only fallback** | LogNexus emits the contract but cannot execute the handoff itself in the current runtime | Review requests, verifier contracts, human handoff, later execution in another tool | Claiming parallelism or auto-spawn when none exists | Review contract, bounded handoff comment |

**Selection rule:** For casual/single-scope queries (`<= 3` files), stay direct and non-invasive. For discovery or queries spanning `> 3` files (with or without an active issue), enforce the **Hard Turn-1 Discovery Probe Gate** (auto-dispatch read-only probes pinned to Tier-2/3 models without asking first, zero file writes). Use bounded sub-agents or native swarm for auditable delegated work, external sessions for durable out-of-band work, and contract-only fallback when no execution primitive is available.

---

## 3. Isolation Backends

Isolation is the boundary that keeps delegated work from trampling unrelated state.

| Backend | What it isolates | Good fit | Caveat |
|---------|------------------|----------|--------|
| **Git worktree** | Branch + checkout + filesystem state | Primary feature work, long-lived branch ownership, explicit cleanup after merge | Requires lifecycle management and cleanup |
| **Forked workspace** | Filesystem state inside the runtime's agent model | Bounded sub-agents that edit files without owning a git worktree | Not itself a lognexus worktree record |
| **tmux session** | Terminal process state and session durability | Background agents, session handoff, file-marker or timeout-based completion | Session persistence is not branch ownership; track workspace separately |
| **Shared checkout** | Little or none | Read-only helpers, very small local checks | Unsafe for concurrent branch switching or overlapping writes |

**LogNexus default:** The primary feature branch remains worktree-first. Other isolation backends may be used for delegated lanes, but they do not replace the canonical branch/worktree record for the main line of work.

---

## 4. Capability Mapping

LogNexus is capability-neutral. Document the actual primitive exposed by the runtime or companion tool instead of implying behavior.

Examples:

- **Antigravity `invoke_subagent`** -> bounded sub-agent probe or reviewer lane
- **Antigravity native `swarm`** -> multi-worker coordination on shared message board (`add`, `post_message`, `read_board`)
- **Claude Code `Agent` / `pr-review`** -> bounded sub-agent
- **Codex `multi_tool_use.parallel`** -> local parallel tool fan-out (`<= 3` files)
- **Codex `spawn_agent`** -> bounded sub-agent with forked-workspace isolation
- **tmux background session manager** -> external session delegation, typically paired with a shared JSON/file completion marker or timeout policy
- **No agent runtime at all** -> contract-only fallback

Do not claim:

- that local parallel tool fan-out provides an independent reviewer identity
- that forked workspace isolation is the same as lognexus's git worktree lifecycle
- that tmux session delegation is automatically tracked unless lognexus artifacts record the dispatch and collection steps

---

## 5. Fan-Out Protocol

Fan-out is a single orchestrator managing multiple bounded lanes in parallel.

### Dispatch rules

1. Decompose only independent lanes. If lane B blocks the very next local step, keep it local instead of dispatching it.
2. Assign one owner per lane. The owner may be a sub-agent, external session, or the current orchestrator running local parallel tools.
3. Give every delegated lane a bounded contract. Reuse the single-lane handoff template from `../branch.md` as the per-lane contract.
4. Post a durable dispatch artifact when the fan-out affects project history, review state, or worktree/session lifecycle.
5. Collect lanes explicitly. Do not let a successful lane silently imply the status of the others.

### Dispatch announcement template

Use one artifact for the overall fan-out instead of one top-level comment per lane. The per-lane contract can be embedded or linked.

```markdown
<!-- lognexus:
kind: handoff
issue: <ID>
phase: <PHASE>
updated_at: <ISO_TIMESTAMP>
-->

## [lognexus/handoff] #<ID>: fan-out dispatch

**Orchestrator:** <family>/<version> (<tool>[, <qualifier>])
**Primitive:** local-parallel-tools | bounded-sub-agents | external-sessions | mixed
**Collection rule:** collect all lanes before merge / collect partial results after timeout / collect on next session

### Lanes
1. **reviewer**
   - **Owner:** [sub-agent | external session | current orchestrator]
   - **Goal:** [one concrete outcome]
   - **Contract:** [link or heading reference]
   - **Isolation:** worktree | forked workspace | tmux session | shared checkout
2. **cleanup**
   - **Owner:** [...]
   - **Goal:** [...]
   - **Contract:** [...]
   - **Isolation:** [...]

Authored-by: <family>/<version> (<tool>, orchestrator)
```

### Collection summary template

```markdown
<!-- lognexus:
kind: state
issue: <ID>
phase: <PHASE>
updated_at: <ISO_TIMESTAMP>
-->

## [lognexus/milestone] #<ID>: fan-out collection

**Orchestrator:** <family>/<version> (<tool>[, <qualifier>])
**Overall status:** complete | partial | blocked

### Lane results
- **reviewer:** completed | blocked | timed-out | superseded - [artifact link or reason]
- **cleanup:** completed | blocked | timed-out | superseded - [artifact link or reason]

### Remaining follow-up
- [What still needs collection, re-dispatch, or user action]

Authored-by: <family>/<version> (<tool>, orchestrator)
```

### Partial failure and late-return rules

- If one lane blocks or times out, collect the successful lanes anyway and record the blocked lane explicitly.
- If a late lane returns after the collection summary was posted, add an amendment or follow-up milestone artifact. Do not silently rewrite the prior summary.
- External-session implementations may use JSON state files, file markers, or timeout heuristics internally. LogNexus only requires that the durable collection artifact records the outcome.

---

## 6. Auto-Dispatch Triggers

### 1. Turn-1 Discovery Probe Gate (`> 3` files, with or without an active issue)

When code exploration spans more than 3 repository files, a Tier-1 orchestrator (`Neon` / `Carbon` / `Argon` / `Opus`) must **NEVER** read `> 3` files directly into its context. Instead, immediately auto-dispatch read-only exploration probes (`invoke_subagent` or read-only `swarm` probes) without prompting the developer:
- Pin a Tier-2 or Tier-3 model (e.g. `google/gemini-3.8-flash-high (antigravity)`) whenever the orchestrator is Tier-1 (`Carbon`, `Argon`, `Neon`, `Opus`).
- Perform zero file writes during discovery probes.
- Casual / single-scope queries (`<= 3` files) remain conversational and direct without spawning subagents.

### 2. Post-Plan Automatic Native Swarm Execution (`orchestration: auto`)

Before writing code, the Tier-1 orchestrator emits the `T1..Tn` plan with pre-assigned subagents/models (`--assignee`), tier, isolation mode (`--isolation`), and file/LOC budgets, awaiting explicit developer confirmation. Once confirmed under `orchestration: auto`:
- When Antigravity `Orchestrator` (`Neon` / `Carbon` / `Argon`) or a standard Tier-1 model with `swarm` is active, launch native `swarm` automatically under LogNexus contracts without asking again (standard Tier-1 models can invoke `swarm` directly without stacking conflicting IDE Orchestrator wrapper prompts).
- **Immediate Swarm UI Handoff:** Immediately after initial `swarm add` calls, emit a brief progress turn ending with `[Open the Swarm UI](sidecar://swarm/swarm_board/?auto_open=false)` on its own line BEFORE entering `swarm_wait`, so the UI button appears live instead of stalling until workers finish.
- **Coordinator Model Sync:** Switching the IDE model selector mid-conversation changes which model answers turns while the Swarm roster keeps `@coordinator` labeled with its initial model unless `swarm{action: "model"}` is called.
- **Right-Sized Effort:** Reserve `XHigh` / `Max` reasoning effort for deep architectural planning; use `Medium` Tier-1 or Tier-2/Tier-3 for routine status queries, visual reviews, and focused checks.
- Maintain `<= 4` active swarm workers and use selective `@name` mentions (prohibit `@all` broadcast chatter).
- Omit `model` (`"auto"`) on implementation workers unless explicitly requested by the developer, allowing Antigravity to allocate runtime capacity dynamically.
- Sign `--author` with each worker's real canonical runtime identity (never literal `"auto"` or `"<provider>/<model>"`).
- Record `--isolation swarm --swarm-workers <n> --swarm-posts <count>` on subtasks and commits.
- Bound contracts under `CONTEXT_MAX_FILES = 6` implementation files and `CONTEXT_MAX_LOC = 1200` lines, handing context via `npx @digital-lake/lognexus handoff --prompt`. Native MCP clients can alternatively read `lognexus://handoff` (`text/markdown`) alongside `lognexus://state` and `lognexus://routing` as an in-memory, zero-disk-write equivalent.

### 3. Review gate

At PR time, use the strongest available primitive in this order:

1. bounded sub-agent reviewer
2. external session reviewer
3. contract-only review handoff

Local parallel tool fan-out does **not** satisfy independent review because it does not create a separate reviewer identity.

### 4. Closure verifier

When closure evidence is repetitive and well-bounded, dispatch a verifier lane using the same ladder:

1. bounded sub-agent verifier
2. external session verifier
3. contract-only verifier handoff

The supervising actor still decides whether to close the issue.

### 5. Worktree hygiene

After merge, or when resuming a repo with stale worktrees, run a cleanup lane if the check is independent of the critical path. Otherwise execute it locally.

---

## 7. Worktree Lifecycle

LogNexus owns the record of the primary feature worktree even when helper lanes use other isolation backends.

### Recording rule

Session-start artifacts should record:

- feature branch name
- workspace path when known
- isolation backend when non-default or important to the audit trail

### Cleanup rule

Only remove a worktree when all of the following are true:

1. the branch has been merged to the default branch
2. there is no open PR that still depends on that branch
3. the worktree is not the active workspace for ongoing local changes

### Cleanup commands

```bash
git fetch origin
git branch --merged origin/$(gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name')
git worktree list
git worktree remove <path-to-worktree>
git branch -d <branch-name>
```

```powershell
git fetch origin
$defaultBranch = gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name'
git branch --merged origin/$defaultBranch
git worktree list
git worktree remove <path-to-worktree>
git branch -d <branch-name>
```

If the runtime uses forked workspaces or tmux sessions, that runtime-specific cleanup is separate. Do not claim the git worktree is cleaned up unless the git worktree commands were actually run or the user explicitly confirmed equivalent cleanup.
