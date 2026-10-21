# Changelog

All notable changes to **LogNexus** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0-alpha.0] - 2026-10-21

### Added
- **Hard Fork Initialization:** Independent hard fork and architectural evolution of `devallibus/shiplog` under the MIT License by Digital Lake.
- **Native Context & Rules Framework (Skill Markdown):**
  - Drop-in support for Google Antigravity, Kimi Code, Cursor, Codex, and Claude Code.
  - Full issue-to-merge lifecycle governed by Git as a knowledge graph (`/lognexus plan`, `start`, `commit`, `pr`, `review`).
- **Native Model Specialization:**
  - Google Gemini (in Antigravity): High-reasoning orchestrator, planner, and independent review auditor leveraging 1M+ context tokens.
  - DeepSeek (in Kimi Code / Cursor): High-speed surgical implementer executing closed delegation contracts with zero decision budget.
  - Cross-model review gate enforcement (`Authored-by:` vs `Reviewed-by:`).
- **LogNexus Scaffolding & Diagnostic CLI (`@digital-lake/lognexus`):**
  - `lognexus init`: Scaffolds `.lognexus/` configuration, templates, and routing rules into any repository.
  - `lognexus doctor`: Health diagnostic suite for Git repository status, GitHub CLI authentication, and rules configuration.
  - `lognexus status`: Real-time inspection of current branch, active issue, and recommended native agent role.
- **Backward Compatibility:**
  - Transparent fallback reading for `.shiplog/` directories and `<!-- shiplog: -->` metadata envelopes during transition.
- **Quality & Standards:**
  - Fast, modular unit tests with Vitest.
  - Strict linting and formatting via Biome.
  - Automated CI workflow on GitHub Actions.
