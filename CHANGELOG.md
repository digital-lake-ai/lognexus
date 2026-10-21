# Changelog

All notable changes to **LogNexus** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0-alpha.1] - 2026-10-21

### Changed
- **Universal Multi-Model Architecture:** Refactored documentation, rules, and CLI to establish LogNexus as a 100% generic, model-agnostic, and editor-agnostic open-source framework.
- **Unified Model Taxonomy:** Published complete operational routing matrix encompassing **Anthropic Claude** (Opus, Sonnet, Haiku), **OpenAI** (o3, o1, GPT-4o/5), **Google Gemini** (Pro, Flash), and **DeepSeek** (R1, V3, Chat).
- **Client Flexibility:** Formatted deployment guides for Claude Code, Cursor, Codex, Google Antigravity, and Kimi Code / VS Code without vendor lock-in.

### Added
- **Lightweight CLI Scaffolding Suite (`@digital-lake/lognexus`):**
  - `lognexus init`: Initializes repository `.lognexus/` rules, templates, and multi-model routing configuration.
  - `lognexus doctor`: Health diagnostic suite for Git repository status, GitHub CLI authentication, and rules configuration.
  - `lognexus status`: Real-time inspection of active branch, issue, and recommended tier.
- **Model Detection & Provenance Signing:** Updated `SKILL.md` provenance signing specification with automatic model detection rules across Antigravity, Kimi Code, Cursor, Codex, and Claude Code.

---

## [1.0.0-alpha.0] - 2026-10-21

### Added
- **Hard Fork Initialization:** Independent hard fork and architectural evolution of `devallibus/shiplog` under the MIT License by Digital Lake.
- **Native Context & Rules Framework (Skill Markdown):**
  - Drop-in support for Claude Code, Cursor, Codex, Google Antigravity, and Kimi Code.
  - Full issue-to-merge lifecycle governed by Git as a knowledge graph (`/lognexus plan`, `start`, `commit`, `pr`, `review`).
- **Cross-Model Review Gate Enforcement:** Guaranteed verification separation (`Authored-by:` vs `Reviewed-by:`).
- **Backward Compatibility:**
  - Transparent fallback reading for `.shiplog/` directories and `<!-- shiplog: -->` metadata envelopes during transition.
- **Quality & Standards:**
  - Fast, modular unit tests with Vitest.
  - Strict linting and formatting via Biome.
  - Automated CI workflow on GitHub Actions.
