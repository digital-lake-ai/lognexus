# Changelog

All notable changes to **LogNexus** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0-alpha.5] - 2026-10-21

### Added
- **Journey Timeline Reconstruction Engine (`src/timeline/timeline.ts`):**
  - Reconstructs complete branch history comparing against base branch (`main` / `origin/main`).
  - Enriches each commit with subtask ID, tier, title, and metadata parsed from Git Notes (`refs/notes/lognexus`).
  - Generates Markdown journey tables, machine-readable JSON, and structured PR body drafts (`--pr-body`).
- **Programmatic Review Gate Auditor (`src/audit/audit.ts`):**
  - Enforces commit message formats (`type(#issue/subtask)`).
  - Validates `Authored-by:` trailers on all branch commits.
  - Audits Git Notes presence and warns on unlinked commits.
  - Verifies Review Gate integrity preventing self-approval (`author !== reviewer`).
- **CLI Commands:** `lognexus timeline [base] [--json|--pr-body]` and `lognexus audit [base]`.
- **MCP Server Expansion:** Exposes `lognexus_timeline` and `lognexus_audit` tools in native JSON-RPC 2.0 stdio server.
- **Removed Legacy Artifact:** Removed `docs/MIGRATING_FROM_SHIPLOG.md` and cleaned references in `src/doctor.ts`.

## [1.0.0-alpha.4] - 2026-10-21

### Added
- **Native Model Context Protocol (MCP) Stdio Server (`lognexus mcp`):**
  - Native JSON-RPC 2.0 stdio server implementation (`src/mcp/server.ts`) with zero external SDK dependencies, keeping package size ultra-lightweight.
  - Complete MCP capabilities registration (`tools`, `resources`, `prompts`) under protocol version `2024-11-05`.
  - **Tools (`src/mcp/tools.ts`):** `lognexus_status`, `lognexus_state_get`, `lognexus_state_sync`, `lognexus_state_set_task`, `lognexus_state_finish_task`, `lognexus_state_clear`, `lognexus_note_show`, `lognexus_note_attach`.
  - **Resources (`src/mcp/resources.ts`):** `lognexus://state` (live agent state JSON) and `lognexus://routing` (active or default model tier taxonomy markdown).
  - **Prompts (`src/mcp/prompts.ts`):** `lognexus-plan` (issue decomposition into tier contracts) and `lognexus-review` (pre-merge review gate checklist).
  - CLI command `lognexus mcp` with quiet stdout reserved exclusively for JSON-RPC message frames.
  - Comprehensive unit test suite (`tests/mcp.test.ts`) covering handshake, ping, tools, resources, prompts, and JSON-RPC protocol error states.

## [1.0.0-alpha.3] - 2026-10-21

### Added
- **Git Notes Engine (Quiet Mode / `git-ai` v3 Standard):**
  - Core Git Notes adapter (`src/notes/notes.ts`) managing notes under `refs/notes/lognexus` with cross-platform stdin piping.
  - Automatic state packaging (`src/notes/attach.ts`) capturing active issue, current subtask, contracts, and operational tier attached to any commit without changing commit SHAs.
- **CLI Note Commands (`lognexus note`):**
  - `lognexus note show [commit]`: View attached LogNexus note for any commit (default: `HEAD`).
  - `lognexus note attach [commit]`: Serialize current session state and attach to target commit.
  - `lognexus note list`: List all commits with LogNexus metadata notes.
  - `lognexus note push [remote]`: Push `refs/notes/lognexus` to remote repository.
  - `lognexus note fetch [remote]`: Fetch `refs/notes/lognexus` from remote repository.

## [1.0.0-alpha.2] - 2026-10-21

### Added
- **Persistent Agent State Engine (`.lognexus/state.json`):**
  - Zod-validated state schema tracking `activeIssue`, `currentSubtask`, `completedSubtasks`, and delegation contracts.
  - Automatic session recovery protocol preventing cognitive amnesia across conversation resets and context compactions.
  - Git and GitHub CLI synchronizer (`syncStateFromGit`) mapping branches like `issue/<id>-<slug>` to active issues.
- **CLI State Subcommands (`lognexus state`):**
  - `lognexus state show`: Inspect real-time agent context, active contracts, and subtask status.
  - `lognexus state sync`: Synchronize state from Git branch and GitHub Issue metadata.
  - `lognexus state set-task <id> [title]`: Set active subtask with closed contract.
  - `lognexus state finish-task <id>`: Move subtask to completed list.
  - `lognexus state clear`: Cleanly reset local persistent state post-merge.

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
