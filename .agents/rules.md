# Agent Governance Rules

See root [AGENTS.md](../AGENTS.md) for authoritative rules.

Key mandates:
1. No direct commits or pushes to `main` for any type of change (`chore`, `ci`, `docs`, `feat`, `fix`).
2. Pull requests must be merged exclusively using `gh pr merge <num> --merge --delete-branch` (`--no-ff`). Squash and rebase merges are strictly prohibited to protect the subtask timeline and Git Notes (`refs/notes/lognexus`).
3. Cross-model review gate is mandatory (`Authored-by` != `Reviewed-by`).
4. Scoped lanes are `issue/<id>-<slug>` and `security/<id>-<slug>`; both are equivalent for the engine (`src/branch.ts`). Use the `security/` lane for security remediation, audits and supply-chain hardening.
5. Anti-Spoofing: no author agent may write a `Reviewed-by:` trailer or run `gh pr merge`. The sign-off belongs only to the independent reviewer.
6. External master plans are registered with a `Planned-by:` trailer in the PR body; `Planned-by` never grants review authority or merge rights.
7. The principal architect signs with its canonical name **`Gemini 4 Argon`**; abbreviations such as `Gemini/Pro` or `Pro` are invalid signatures. Canonical forms: `gemini/argon`, `gemini/carbon` (tier-1), `gemini/flash-high` (tier-2), `moonshot/kimi-k3`, `deepseek/VS Code` (tier-3).
8. Closed-PR policy: a merged or closed PR is never reopened, force-pushed, or re-targeted. Follow-up work requires a new issue and a new scoped branch from `main`.
