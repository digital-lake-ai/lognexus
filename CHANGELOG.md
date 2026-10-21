# Changelog

All notable changes to **LogNexus** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0-alpha.0] - 2026-10-21

### Added
- **Hard Fork Initialization:** Independent hard fork and architectural evolution of `devallibus/shiplog` under the MIT License by Digital Lake.
- **Dual-Layer Architecture:**
  - **Skill Markdown Layer:** Full support for Claude Code, Cursor, Codex, Antigravity, and Gemini CLI with `/lognexus` commands and workflows.
  - **TypeScript Runtime Layer:** Zero-heavy-dependency runtime (`@digital-lake/lognexus`) utilizing standard native `fetch` (Node.js >= 20).
- **Multi-Model Provider Engine:**
  - `GeminiProvider`: Native Google Gemini API integration supporting `gemini-3.8-flash` and `gemini-2.5-pro` with `x-goog-api-key` authentication and structured error handling.
  - `DeepSeekProvider`: High-efficiency DeepSeek integration via OpenAI-compatible endpoint supporting `deepseek-chat` and `deepseek-reasoner`.
  - `OpenAICompatibleProvider`: Extensible base adapter for self-hosted or OpenAI-compliant inference engines.
  - Strategy & Factory pattern (`createProvider`) for runtime extensibility.
- **Tier-Based Operation Routing:**
  - `tier-1 (Reasoning)`: Gemini Pro / Flash (high) or DeepSeek Reasoner for architectural planning, PR synthesis, and cross-model review.
  - `tier-2 (Context)`: Gemini 1M-token context for comprehensive codebase ingestion, discovery triage, and repository mapping.
  - `tier-3 (Execution)`: DeepSeek Chat for low-cost, contract-bounded implementation and task commits.
- **LogNexus CLI (`lognexus`):**
  - `lognexus doctor`: Comprehensive environment and health check for Git, GitHub CLI, and configured AI providers (with optional `--live` ping verification).
  - `lognexus route <tier>`: Query active provider and model for a given operational tier.
  - `lognexus config`: Inspect active configuration with secure key masking.
- **Backward Compatibility:**
  - Transparent fallback reading for `.shiplog/` directories and `<!-- shiplog: -->` metadata envelopes during transition.
- **Quality & Testing:**
  - Unit test suite using Vitest with mocked fetch fixtures.
  - Strict linting and formatting via Biome.
