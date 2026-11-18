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

## 3. Mandatory Independent Review Gate (`Authored-by` ≠ `Reviewed-by`)
- **PROHIBIDO AUTO-APROBAR:**
  - An agent or model cannot review or approve its own code. Same canonical model family across any reasoning-effort suffix (`-none | -minimal | -low | -medium | -high | -xhigh | -xtrahigh | -extra-high`) is strictly blocked.
  - Two independent review modes are supported (configured via `review_gate` in `.lognexus/routing.md`):
    1. **Cross-Vendor Review** *(recommended best practice for milestone releases)*: the reviewer belongs to a different provider family than the author (e.g., `gemini/*` reviewed by `claude/*`, `openai/*`, or `deepseek/*`).
    2. **Intra-Fleet Distinct-Model Review** *(supported for single-provider workflows such as Antigravity or Claude Code)*: the reviewer is a distinct canonical Tier-1 model operating in an independent reviewer session/subagent separate from the Tier-2/Tier-3 author model (e.g., `Gemini 4 Carbon`, `Gemini 4 Argon`, or `Gemini 4 Neon` / `Orchestrator (Neon)` reviewing `Gemini 4 Hydrogen` or `Gemini 3.8 Flash`; `Claude Opus` reviewing `Claude Sonnet` or `Claude Haiku`).
  - Every PR body must carry the review snapshot and signed provenance trailers:
    ```markdown
    Authored-by: <family>/<version> (<client>)
    Reviewed-by: <family>/<version> (<client>)
    ```
  - Merging without an independent review sign-off is strictly prohibited.

- **Anti-Spoofing Rule (non-negotiable):**
  - **No author agent (`Authored-by`) may write `Reviewed-by:` trailers or run `gh pr merge`.**
  - The review sign-off belongs exclusively to the independent reviewer. An author who writes its own `Reviewed-by:` trailer — under any model name, including one attributed to a different model family — is forging the gate.
  - The reviewer must derive `Reviewed-by:` from an actual review of the delivered commits, performed in an independent session whose canonical model family differs from `Authored-by`.
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

## 5. Native Assistant Autonomy, Two-Stage Delegation & Contract Governance
- **Native Assistant Autonomy & Two-Stage Delegation (`orchestration: auto`):**
  - **Casual / single-scope queries (`<= 3` files):** stay conversational, direct, and non-invasive; do not unnecessarily spawn subagents.
  - **Hard Turn-1 Probe Gate (`> 3` files, with or without an active issue):** NEVER read `> 3` repository files directly from a Tier-1 orchestrator; immediately auto-dispatch read-only exploration probes (`invoke_subagent` or read-only `swarm` probes) without asking the developer first and with zero file writes — **pinning a Tier-2/Tier-3 model (e.g., `flash`) whenever the orchestrator is Tier-1 (`Carbon` / `Argon` / `Neon` / `Opus`)**, and omitting `model` only when the coordinator is already Tier-2/Tier-3.
  - **Pre-delimited plan presentation & automatic post-plan native `swarm`:** before launching any implementation writes, the Tier-1 orchestrator emits the `T1..Tn` plan with pre-assigned subagent/model (`--assignee`), tier, isolation mode (`--isolation`), and file/LOC budgets, awaiting explicit developer confirmation. Once confirmed under `orchestration: auto`, when Antigravity `Orchestrator` (`Carbon` / `Argon` / `Neon`) with `swarm` is active, execute implementation subtasks automatically via native `swarm` under **LogNexus** contracts without asking again — keeping `<= 4` active swarm workers, selective `@name` mentions (no `@all` bloat), **omitting `model` (`"auto"`) on implementation workers** (unless the user explicitly asks for another model) so Antigravity assigns runtime strength dynamically, and signing `--author` with each worker's real canonical runtime identity (never literal `"auto"` or `"<provider>/<model>"`).
- **100% Silent Background Telemetry:** Agents must never emit telemetry chatter or notices on screen, nor invoke `lognexus telemetry` during normal workflows, unless the developer explicitly asks for telemetry output; sealed interactive consent runs strictly in human TTY sessions (`init` / `status` / `doctor`).
- **Strict Contract Execution Governance:** the moment a subtask contract becomes active, execution is bound by it. Modify only `allowedFiles`, never touch `forbiddenFiles`, stay inside the declared `decisionBudget`, and treat `verificationCmd` as the gate. Exploration freedom does not extend to unapproved writes.
- **Subtask Context Budget & Handoff:** keep the contract itself scoped — `CONTEXT_MAX_FILES` (6 implementation files) and `CONTEXT_MAX_LOC` (1200 lines), with test files exempt from the file count. `evaluateContextBudget()` reports the active contract against that ceiling and the handoff embeds a split recommendation when it is exceeded. An oversized contract is legal but must be split before the next subtask starts, and `lognexus handoff --prompt` renders the compact dispatch prompt for the next agent — prefer it over pasting instructions between sessions.
- **Swarm Discipline & SemVer Separation:** cap active swarm workers (`<= 4`), never assign `Tier-1` models (`Carbon`/`Argon`/`Neon`/`Opus`) as read-only probes when `Tier-2`/`Tier-3` suffice, use selective `@name` mentions (avoiding `@all` broadcast bloat), record `--isolation swarm --swarm-workers <n> --swarm-posts <count>` on swarm-governed subtasks, and keep **Software Version** (e.g. `0.1.0` pre-release) strictly separate from **Document Revision** (e.g. `rev. 1.3`) across all manifests.
- **Token Hygiene (Zero Lockfile / Build-Artifact Reads):** Agents MUST NOT read `node_modules/`, `package-lock.json` (or other dependency lockfiles), `dist/`, `dist-pypi/`, or `coverage/` into context. Inspect `package.json` for declared dependency ranges, or run targeted CLI queries (`npm ls <pkg> --depth=0`) when exact resolved versions are needed. `.geminiignore`, `.aiexclude`, `.cursorignore` and the `permissions.deny` rules in `.claude/settings.json` enforce this exclusion workspace-wide; `lognexus init --protect-tokens` scaffolds them in downstream repositories.

---

## 6. Canonical Identities & Closed-PR Policy
- The principal architect declares itself with the canonical name **`Gemini 4 Argon`** (`gemini/argon`) — never abbreviated as `Gemini/Pro`, `Pro` or any other variant. External master plans are recorded with the `Planned-by:` trailer defined in §3.
- **`Gemini 4 Carbon`** (`gemini/carbon`) is recognised alongside `Gemini 4 Argon` (`gemini/argon`) as a co-flagship Tier-1 Principal Architect, Orchestrator & Independent Reviewer — never abbreviated as `Gemini/Pro`, `Pro`, or bare `Carbon`/`Argon`.
- **`Gemini 4 Neon`** (`gemini/neon`) and **`Orchestrator (Neon)`** (`gemini-pro-orchestrator-neon`) are recognised alongside `Gemini 4 Carbon` (`gemini/carbon`) and `Gemini 4 Argon` (`gemini/argon`) as co-flagship Tier-1 Principal Architects, Orchestrators & Independent Reviewers (distinct canonical model family from Hydrogen, Flash, Carbon, and Argon under Intra-Fleet Review) — never abbreviated as `Gemini/Pro`, `Pro`, or bare `Neon`/`Carbon`/`Argon`.
- **`Gemini 4 Hydrogen`** (`gemini/hydrogen` / `google/gemini-4-hydrogen-high (antigravity)`) is recognised as a canonical Tier-2 implementer alongside **`google/gemini-3.8-flash-high (antigravity)`** and **`deepseek/VS Code (kimi-code)`** (never `deepseek/chat`, `deepseek/r1` or any other variant).
- **Closed-PR policy:** a merged or closed PR is never reopened or reused. Follow-up work starts from a new issue and a new scoped branch cut from `main`.
