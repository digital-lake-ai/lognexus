# Contributing to LogNexus

Thank you for your interest in LogNexus. This document sets out the guidelines for contributing code, skills, and documentation to the project.

---

## 0. Contribution Model: Open Source (MIT), Core-Maintained (Closed to Unsolicited External PRs)

LogNexus is distributed under the **MIT License** and its source is fully open. Development is **core-maintained**: the maintainers and the multi-model agent swarm they coordinate own the roadmap and the merge queue.

- **We do not accept unsolicited external Pull Requests.** PRs opened without a prior maintainer invitation are closed without review. This is not a judgement on the work: the repository enforces atomic subtask contracts, Git Notes (`refs/notes/lognexus`) and cross-model review gates that an outside PR cannot satisfy without hidden context.
- **All feedback is channelled through GitHub Issues.** Use one of the issue templates:
  - [Diagnostic report](./.github/ISSUE_TEMPLATE/diagnostic-report.yml) — local telemetry/ROI output, environment details, reproduction steps.
  - [Feedback or proposal](./.github/ISSUE_TEMPLATE/feedback-proposal.yml) — bugs, feature ideas, documentation gaps, design critique.
- **Security findings** do not go through public issues. Follow [SECURITY.md](./SECURITY.md).
- **Accepted contributions** are re-implemented inside the core-maintained pipeline, so the issue author is credited in the resulting changelog entry.

If you maintain a downstream fork, you are free to modify and redistribute under the terms of the MIT License.

---

## 1. Development Principles & Architecture

LogNexus is an open-source orchestrator and Git-backed cognitive memory layer for AI agents. Development strictly adheres to:
- **Dogfooding:** We use LogNexus to build LogNexus. Every change is tracked through issues, tasks, and pull requests.
- **Cross-Model Review:** No AI model or developer merges unreviewed changes. Code written by one model is independently reviewed by another before merge.
- **Traceability:** Commits and PRs carry signed envelopes and provenance tags (`Authored-by:`, `Reviewed-by:`).
- **Canonical identities:** The principal architect signs as **`Gemini 4 Argon`** (`gemini/argon`), never abbreviated as `Gemini/Pro` or `Pro`. External master plans carry a `Planned-by:` trailer.
- **Closed-PR policy:** A merged or closed PR is never reused. Follow-up work starts from a new issue and a new scoped branch cut from `main`.

---

## 2. Versioning Policy

LogNexus follows [semver](https://semver.org/).

The version field lives in:
- `package.json` (`version`)
- `.claude-plugin/plugin.json` (`version`)

### Bump Rule
If your PR modifies anything under:
- `commands/`
- `skills/`
- `src/`
- `.claude-plugin/`

Your PR **must** bump `version` in both `package.json` and `.claude-plugin/plugin.json`. CI enforces this via `.github/workflows/version-bump-check.yml`.

### Releases
Every version bump merged to `main` automatically triggers a GitHub Release and tag via `.github/workflows/release.yml`.

---

## 3. Pull Request Workflow

1. **Zero Exceptions on Main:** Every change (including `chore:`, `ci:`, `docs:`, `build:`, `test:`) requires an issue, a dedicated task branch, and a Pull Request. Direct pushes to `main` are blocked by server rulesets and the commit engine.
2. **Issue First:** Every change starts with an issue tagged with `lognexus/plan`.
3. **Branch Naming:** Create a branch from `main` using the format:
   ```bash
   git checkout -b issue/<id>-<slug> origin/main
   ```
3. **Task-Scoped Commits:** Commit subjects must follow:
   ```text
   <type>(#<id>/<Tn>): <concise message>
   
   <extended reasoning / what changed>
   
   Authored-by: <model/developer>
   ```
4. **Pull Request Body:**
   - Must contain the `<!-- lognexus: kind: history ... -->` envelope.
   - Include the Journey Timeline, verification checklist, and `Closes #<id>`.
5. **Cross-Model Review:**
   - Submit for review and label as `lognexus/needs-review`.
   - The reviewing agent or peer signs off with `Reviewed-by: <reviewer>` (`Authored-by` != `Reviewed-by` is strictly enforced).
6. **Merge Execution (Strict `--no-ff` Mandatory):**
   - Merges must be performed exclusively with standard merge commits:
     ```bash
     gh pr merge <num> --merge --delete-branch
     ```
   - **Squash and Rebase Merges are strictly prohibited:** They destroy the discrete subtask commit graph and orphan attached LogNexus Git Notes (`refs/notes/lognexus`).

---

## 4. Local Testing & Verification

Before opening a PR:
```bash
# Check cross-references and envelopes
grep -rnE '(^|[^!:-])(lognexus|shiplog):[a-z]+' skills commands --include='*.md' | grep -vE '<!-- (lognexus|shiplog):'

# Run lint and test suite (when working on runtime code)
npm run lint
npm test
```

---

## 5. Reporting Issues

Open an issue using the templates in `.github/ISSUE_TEMPLATE/` — `diagnostic-report.yml` for environment and telemetry-backed reports, `feedback-proposal.yml` for ideas and defects — and label it `lognexus/plan` if it should enter the planning track. Templates are **100% local-first**: never paste source code, absolute paths, repository remotes, or the output of `git remote -v`.

If an issue requires code, a maintainer will convert it into an internal issue with discrete subtasks (`T1..Tn`) and a closed delegation contract.
