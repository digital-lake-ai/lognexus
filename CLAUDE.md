# Claude Code Instructions — LogNexus

Refer to [AGENTS.md](./AGENTS.md) for full governance and execution rules.

## Core Rules for Claude:
1. **Zero exceptions on main:** Never push directly to `main` (even for `docs:`, `ci:`, or `chore:`). Always create a scoped branch: `issue/<id>-<slug>` or `security/<id>-<slug>`.
2. **Merge with `--no-ff`:** When merging via `gh`, always run `gh pr merge <num> --merge --delete-branch`. Never use `--squash` or `--rebase`.
3. **Cross-Model Review:** You cannot approve your own PR. A different model family (e.g. Gemini, DeepSeek, OpenAI) must perform the review.
4. **Anti-Spoofing:** As the author you must never write a `Reviewed-by:` trailer and never run `gh pr merge`. Writing your own review sign-off — even under another model's name — forges the gate and is prohibited.
5. **Use LogNexus Engine:** Stage specific files, execute atomic commits via `lognexus commit` with `-m` or `-F`, and ensure Git Notes are preserved.
