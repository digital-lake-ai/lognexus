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
| **Local parallel tool fan-out** | One orchestrator runs multiple independent tool calls without creating a child agent identity | Read-only gathering, non-overlapping helper checks, parallel status queries | Independent review, code ownership claims, multi-step delegated implementation | Codex `multi_tool_use.parallel` |
| **Bounded sub-agent** | The orchestrator spawns a child agent with a scoped contract and collects a return artifact | Review, verifier audits, bounded implementation slices, read-only exploration | Open-ended peer swarms, ambiguous ownership, silent long-running work | Codex `spawn_agent`; any runtime that exposes bounded worker agents |
| **External session delegation** | Work is handed to a separate durable session or tool instance outside the current orchestrator | Long-running background work, tmux-backed agents, separate human-visible sessions, explicit worktree ownership | Implicit same-turn completion guarantees | tmux background sessions, separate terminal agents, dedicated worktree workers |
| **Contract-only fallback** | LogNexus emits the contract but cannot execute the handoff itself in the current runtime | Review requests, verifier contracts, human handoff, later execution in another tool | Claiming parallelism or auto-spawn when none exists | Review contract, bounded handoff comment |

**Selection rule:** Prefer local fan-out for fast sidecar reads, bounded sub-agents for auditable delegated work, external sessions for durable out-of-band work, and contract-only fallback when no execution primitive is available.

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

- **Codex `multi_tool_use.parallel`** -> local parallel tool fan-out
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

### Review gate

At PR time, use the strongest available primitive in this order:

1. bounded sub-agent reviewer
2. external session reviewer
3. contract-only review handoff

Local parallel tool fan-out does **not** satisfy independent review because it does not create a separate reviewer identity.

### Closure verifier

When closure evidence is repetitive and well-bounded, dispatch a verifier lane using the same ladder:

1. bounded sub-agent verifier
2. external session verifier
3. contract-only verifier handoff

The supervising actor still decides whether to close the issue.

### Worktree hygiene

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
