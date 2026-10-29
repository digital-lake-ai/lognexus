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
  - The trailer is **mandatory** whenever an external plan drove the work: an untrailered PR that implements an out-of-repo master plan fails the governance audit.

- **Canonical architect identity:**
  - The principal architect is always declared with its canonical full name **`Gemini 4 Argon`**. Abbreviated, ambiguous forms such as `Gemini/Pro`, `gemini-pro (lead)`, or `Pro` are **not** valid signatures and are rejected at review time.
  - Canonical signing examples:
    | Model | Tier | Canonical signature |
    |---|---|---|
    | Google Gemini 4 Argon | `tier-1` | `gemini/argon (antigravity)` |
    | Google Gemini 4 Carbon | `tier-1` | `gemini/carbon (antigravity)` |
    | Google Gemini 3.8 Flash High | `tier-2` | `gemini/flash-high (antigravity)` |
    | Moonshot Kimi K3 | `tier-3` | `moonshot/kimi-k3 (kimi-code)` |
    | DeepSeek Chat | `tier-3` | `deepseek/chat (kimi-code)` |
  - `src/telemetry/detector.ts` maps these identities onto their routing tiers, so a signature outside this vocabulary degrades tier attribution in the ROI report.

- **Closed-PR policy (branch hygiene):**
  - A Pull Request that has been **merged or closed is never reused**. Follow-up work requires a new issue and a new `issue/<id>-<slug>` or `security/<id>-<slug>` branch cut from `main`.
  - Reopening a closed PR, force-pushing onto its branch, or re-targeting it to a different issue is prohibited: it breaks the subtask timeline and detaches LogNexus Git Notes (`refs/notes/lognexus`) from the audited commit graph.

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
