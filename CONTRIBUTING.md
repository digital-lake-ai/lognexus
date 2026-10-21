# Contributing to LogNexus

Thank you for contributing to LogNexus. This document sets out the guidelines for contributing code, skills, and documentation to the project.

---

## 1. Development Principles & Architecture

LogNexus is an open-source orchestrator and Git-backed cognitive memory layer for AI agents. Development strictly adheres to:
- **Dogfooding:** We use LogNexus to build LogNexus. Every change is tracked through issues, tasks, and pull requests.
- **Cross-Model Review:** No AI model or developer merges unreviewed changes. Code written by one model is independently reviewed by another before merge.
- **Traceability:** Commits and PRs carry signed envelopes and provenance tags (`Authored-by:`, `Reviewed-by:`).

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

1. **Issue First:** Every change starts with an issue tagged with `lognexus/plan`.
2. **Branch Naming:** Create a branch from `main` using the format:
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
   - The reviewing agent or peer signs off with `Reviewed-by: <reviewer>`.

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

Open an issue with the label `lognexus/plan` describing your proposal or bug report, or run `/lognexus hunt` inside your agent environment.
