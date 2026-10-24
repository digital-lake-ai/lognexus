# Agent Governance Rules

See root [AGENTS.md](../AGENTS.md) for authoritative rules.

Key mandates:
1. No direct commits or pushes to `main` for any type of change (`chore`, `ci`, `docs`, `feat`, `fix`).
2. Pull requests must be merged exclusively using `gh pr merge <num> --merge --delete-branch` (`--no-ff`). Squash and rebase merges are strictly prohibited to protect the subtask timeline and Git Notes (`refs/notes/lognexus`).
3. Cross-model review gate is mandatory (`Authored-by` != `Reviewed-by`).
