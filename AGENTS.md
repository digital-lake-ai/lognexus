# Agent Governance & Execution Rules — LogNexus

All AI agents (Claude, Gemini, DeepSeek, OpenAI, Cursor, Antigravity) operating in this repository MUST strictly follow these rules without exception.

---

## 1. Protected Branch & Branch Creation: Zero Exceptions
- Direct pushes (`git push origin main` or `git push origin master`) are strictly blocked by repository rulesets and the LogNexus commit engine.
- **CERO EXCEPCIONES POR TIPO DE CAMBIO:**
  - `chore:`, `ci:`, `docs:`, `build:`, `refactor:`, `style:`, `test:` require a dedicated branch and PR **exactly the same as** `feat:` or `fix:`.
  - Even if the user requests a "quick fix", "fast push", or asks to skip the PR, the agent MUST decline direct pushes to `main`, explain the governance requirement, and create a branch + PR.
- **Branch Naming Standard:**
  - Branches must originate from `main`: `git checkout -b issue/<id>-<slug> main`.
  - Two scoped lanes are supported and treated identically by the engine (`src/branch.ts`):
    - `issue/<id>-<slug>` — feature, fix, chore, docs, ci and refactor work.
    - `security/<id>-<slug>` — security remediation, audits and supply-chain hardening.
  - Both lanes are recognised by `lognexus status`, `lognexus state sync`, `lognexus timeline`, `lognexus audit` and the protected-branch guard.

---

## 2. Absolute Prohibition of Squash and Rebase: Merge Commit (`--no-ff`) Mandatory
- **PROHIBIDO SQUASH Y REBASE:**
  - NEVER use `--squash` or `--rebase` when merging Pull Requests.
  - Squash merging flattens the discrete `T1..Tn` subtask commit history into a single commit and **orphans LogNexus Git Notes (`refs/notes/lognexus`)** on discarded commit SHAs.
- **GitHub CLI Mandatory Merge Command:**
  - Merge PRs exclusively using `--merge` to force a merge commit (`--no-ff`):
    ```bash
    gh pr merge <PR_NUMBER> --merge --delete-branch
    ```

---

## 3. Mandatory Cross-Model Review Gate (`Authored-by` ≠ `Reviewed-by`)
- **PROHIBIDO AUTO-APROBAR:**
  - An agent or model cannot review or approve its own code.
  - The PR author and the reviewer MUST belong to different model families:
    - Example: `Authored-by: gemini/flash (antigravity)` → Reviewed by: `deepseek/chat`, `claude/sonnet`, or `openai/gpt-4o`.
  - Every PR body must carry the review snapshot and signed provenance trailers:
    ```markdown
    Authored-by: <family>/<version> (<client>)
    Reviewed-by: <family>/<version> (<client>)
    ```
  - Merging without an independent review sign-off is strictly prohibited.

- **Anti-Spoofing Rule (non-negotiable):**
  - **No author agent (`Authored-by`) may write `Reviewed-by:` trailers or run `gh pr merge`.**
  - The review sign-off belongs exclusively to the independent reviewer. An author who writes its own `Reviewed-by:` trailer — under any model name, including one attributed to a different model family — is forging the gate.
  - The reviewer must derive `Reviewed-by:` from an actual review of the delivered commits, performed through a client whose model family differs from the one in `Authored-by`.
  - Merge execution is also reserved to the independent reviewer or repository orchestrator after the sign-off exists; the author never merges its own work.

- **`Planned-by` registration for external master plans:**
  - When work originates from a plan authored outside this repository (a "master plan" produced by an external orchestrator session), record that provenance with a `Planned-by:` trailer in the PR body, alongside the commit trailers:
    ```markdown
    Planned-by: <family>/<version> (<client>) — <plan identifier>
    Authored-by: <family>/<version> (<client>)
    Reviewed-by: <family>/<version> (<client>)
    ```
  - `Planned-by` documents where the plan came from; it does **not** grant review authority, merge rights, or any exception from the rules above.

---

## 4. Atomic Commit Protocol
- Always use `lognexus commit` (or `git commit` following the ID-first convention):
  ```bash
  npx @digital-lake/lognexus commit -m "<type>(#<issue>/<Tn>): <description>" \
    --author "<family>/<version> (<client>)" \
    --finish-task
  ```
- Use `-F / --file <filePath>` for multiline messages or when running in Windows shells to prevent quote-stripping issues.
- `lognexus commit` will automatically abort with a governance error if run directly on `main` or `master`.
- **Contract-scoped staging:** `--stage-allowed` stages only the working-tree files that fall inside the active subtask contract, which removes the "forgot to `git add`" failure mode without widening the contract.

---

## 5. Context-Window Topology & Delegation Budget
- **Declare the topology before reading files.** Every client either shares one context window between orchestration and execution, or isolates each delegated agent in its own window:
  - **Shared-window clients (VS Code / Kimi Code):** orchestration and implementation consume the same window. Keep each turn inside the active contract, never inline a full specification into chat, and read `docs/contexto/issue-<id>-plan.md`, `.lognexus/handoff.md` and `.lognexus/state.json` instead of restating them.
  - **Isolated-subagent clients (Antigravity, Claude Code Task subagents, Gemini CLI delegation):** each delegated agent starts cold, so anything it must know has to be written into its prompt. Delegate reads larger than four files to a subagent and ask for a compact, technically complete summary back.
- **Model parity:** an orchestrator must not delegate to a model whose context window is smaller than the one it uses to plan, and a delegated agent must never assume it inherited the parent's context.
- **Hard budget:** `CONTEXT_MAX_FILES` (6 implementation files) and `CONTEXT_MAX_LOC` (1200 lines) per subtask. `evaluateContextBudget()` reports the active contract against that ceiling and the handoff embeds a delegation recommendation when it is exceeded. An oversized contract is legal but must be split, or explicitly delegated, before the next subtask starts.
- **Handoff as the context transfer:** `lognexus handoff --prompt` renders the compact dispatch prompt for the next agent. Prefer it over pasting instructions between sessions.

---

## 6. Canonical Identities & Closed-PR Policy
- The principal architect declares itself with the canonical name **`Gemini 4 Argon`** — never abbreviated as `Gemini/Pro`, `Pro` or any other variant. External master plans are recorded with the `Planned-by:` trailer defined in §3.
- The canonical DeepSeek implementer identity is **`deepseek/VS Code (kimi-code)`** in `Authored-by:` trailers — never `deepseek/chat`, `deepseek/r1` or any other variant.
- **Closed-PR policy:** a merged or closed PR is never reopened or reused. Follow-up work starts from a new issue and a new scoped branch cut from `main`.
