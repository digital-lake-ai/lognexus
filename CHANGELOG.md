# Changelog

All notable changes to **LogNexus** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.2.7] - 2026-10-30

### Summary
Frontier-model coverage and governance hardening. The MCP surface no longer shells out from the tool layer, the telemetry detector recognizes the current frontier model families (Gemini 4 Argon / Carbon, Gemini 3.8 Pro & Flash High, Kimi K3), and the repository formalizes a provenance trailer, a canonical architect identity and a core-maintained contribution policy. The README now advertises the audited quality posture with a two-row badge header and a dedicated trust section.

### Added
- **Frontier model detection (`src/telemetry/detector.ts`):** `extractModelFamilyCategory` and `inferTierFromAuthor` recognize `Gemini 4 Argon` and `Gemini 4 Carbon` (`tier-1`), `Gemini 3.8 Flash (High)` (`tier-2`), `Gemini 3.8 Pro`, and `Kimi K3` / `Moonshot K3` (`tier-3`).
- **Opt-in diagnostic sharing (`src/telemetry/report.ts`):** the report ends with a non-invasive guide that shows how to file a diagnostic issue with `gh issue create` under the developer's explicit authorization. No `fetch`, no upload, no URL is contacted.
- **Issue templates (`.github/ISSUE_TEMPLATE/`):** `diagnostic-report.yml` and `feedback-proposal.yml`, both local-first by design — no source code and no private paths, only LogNexus metrics and the Git user identity under express confirmation.
- **Verified quality section (`README.md`):** `## Verified Quality & Supply-Chain Security` documents the Glama card, the MCP TDQS grade and the Socket, SLSA and licence posture.

### Changed
- **README badge header:** replaced with a two-row, thirteen-badge block covering CI, npm, Glama TDQS, SLSA provenance, Socket, TypeScript, Node.js, privacy and licence.
- **README frontier models:** the supported model list now names `Gemini 4 Argon`, `Gemini 4 Carbon`, `Gemini 3.8 Pro & Flash High`, `Kimi K3` (Kimi Code), `DeepSeek R1 / V3 / Chat`, `Anthropic Claude` and `OpenAI`, and credits the *Master Architecture & Security Plan* to `Gemini 4 Argon`.

### Security
- **`child_process` isolated from the MCP tool layer:** `detectBaseBranch` moved to `src/git/safe.ts`, so `src/mcp/tools.ts` no longer imports `node:child_process` and the compiled `dist/mcp/tools.js` carries no process-spawning surface.

### Documentation
- **`Planned-by:` trailer:** formalized as an optional provenance trailer for plans authored outside the repository, documented in `AGENTS.md`, `GEMINI.md`, `CLAUDE.md`, `.agents/rules.md` and `skills/lognexus/pr.md`. It grants no review authority and no merge rights.
- **Canonical architect identity:** the lead architect is always declared as `Gemini 4 Argon` — never abbreviated to `Gemini/Pro`.
- **Contribution policy (`CONTRIBUTING.md`):** Open Source (MIT), Core-Maintained (Closed to Unsolicited External PRs). Feedback and reports are channelled through GitHub Issues.

## [1.2.6] - 2026-10-28

### Summary
Supply-chain hardening of the telemetry surface and a quality pass over the MCP tool contract. Telemetry is now verifiably local-only — the dead community dispatch path and its network environment variables are gone — and every MCP tool advertises a consistent title, an unambiguous `Use when` / `Not for` description and a schema example, so agents pick the right tool instead of guessing.

### Security
- **Dead community telemetry network dispatch removed:** the unused upload path and its associated environment variables are deleted. LogNexus performs zero telemetry network calls; all metrics stay in `.lognexus/telemetry.json` inside the working directory.

### Changed
- **MCP tool titles:** all 12 tools now follow the `LogNexus <Family>: <Action>` convention.
- **MCP tool descriptions:** every description states what the tool is for (`Use when`) and what it is not for (`Not for`), disambiguating the pairs that agents confused most — `state_get` vs `state_sync` and `commit` vs `note_attach`.
- **MCP input schemas:** each tool exposes an `examples` array with a valid sample payload, and the `tier` parameter of `lognexus_state_set_task` and `lognexus_commit` now shares a single canonical description.

### Documentation
- **Telemetry privacy policy:** rewritten to describe the 100% offline, local-only architecture explicitly, including the capability boundaries of the system.

## [1.2.5] - 2026-10-26

### Summary
Field-hardening cycle driven by real multi-model usage: subtask contracts are now settable from the CLI, state loading no longer destroys local edits, tier routing is enforced in the audit, telemetry reports preserve user notes, and every published surface reports a single synchronized version.

### Added
- **Non-interactive subtask contracts (`lognexus state set-task`):** new flags to register a subtask contract directly from automation, with `allowedFiles`, `forbiddenFiles`, `decisionBudget` and `verificationCmd`, plus tier validation and automatic branch synchronization.
- **Tier routing audit (`src/audit/audit.ts`):** new `tier-routing-violation` rule warns when a `tier-1` author touches implementation files without an `[escalated]` marker or `escalated: true` in the Git Note.
- **Author tier in Git Notes (`src/notes/attach.ts`, `src/telemetry/collector.ts`):** notes record the effective author tier (and `escalated: true` when applicable); commit telemetry attributes each model entry to its author tier.
- **PowerShell and Batch stack detection (`src/telemetry/detector.ts`):** `detectProjectStacks` now scans up to two levels deep for `.ps1`, `.psm1`, `.psd1` (`powershell`) and `.bat`, `.cmd` (`batch`), skipping `.git`, `node_modules`, `dist` and `.lognexus`.

### Changed
- **Subtask ID parsing:** a single unified regex now handles subtask identifiers across the engine, so `T1`-style IDs are recognized consistently.
- **Commit tier inference:** the CLI infers the author tier from the `Authored-by` trailer instead of relying on a hardcoded default.
- **MCP server version (`src/mcp/server.ts`):** `MCP_SERVER_VERSION` is derived from `getCliVersion()` instead of a hardcoded `1.0.0`, so the handshake always advertises the published package version (addresses Glama registration).
- **Git Note payload version (`src/notes/attach.ts`):** the `version` field now reports the real LogNexus version instead of a static `1.1.0`.

### Fixed
- **Destructive `loadState`:** reading the state file no longer rewrites or drops user edits on disk.
- **Custom notes preservation (`src/telemetry/report.ts`):** telemetry reports end with a `<!-- lognexus:custom-notes -->` marker, and regeneration preserves anything written after it — including notes from legacy `v1.2.4` reports that used a `## 5.` section, which are migrated forward.

## [1.0.0] - 2026-10-21

### Summary
Official General Availability (GA) release of **LogNexus** — the universal, Git-powered context & rules framework for native AI agents.

### Highlights
- **Universal Multi-Model Support:** 100% generic taxonomy and rules for Anthropic Claude (Opus, Sonnet, Haiku), OpenAI (o3, o1, GPT-4o), Google Gemini (2.5/3.8 Pro & Flash), and DeepSeek (R1, V3, Chat).
- **Client Flexibility:** Native drop-in support for Claude Code, Cursor, Codex, Google Antigravity, Kimi Code / VS Code, and Zed without external API proxies.
- **Persistent State Engine (`.lognexus/state.json`):** Automatic session recovery protocol and active issue/subtask tracking to eliminate cognitive amnesia.
- **Git Notes Engine (Quiet Mode / `git-ai` v3):** Traceability metadata attached under `refs/notes/lognexus` without mutating commit SHAs.
- **Native MCP Stdio Server (`lognexus mcp`):** Zero-heavy-dependency JSON-RPC 2.0 server exposing LogNexus tools, live state resources, and planning/review prompts.
- **Journey Timeline & Review Gate Audit (`lognexus timeline` & `lognexus audit`):** Automated timeline reconstruction into PR descriptions and programmatic enforcement of non-self-approval review gates.
- **Scaffolding & Health CLI (`@digital-lake/lognexus`):** Complete CLI suite with `init`, `doctor`, `status`, `state`, `note`, `timeline`, `audit`, `mcp`, and `--version`.

## [1.0.0-rc.1] - 2026-10-21

### Added
- **Full-Lifecycle End-to-End (E2E) Test Suite (`tests/e2e.test.ts`):**
  - Validates the complete golden path in a real isolated Git environment: scaffolding, diagnostics, status detection, persistent state tracking, Git Note attachment, timeline reconstruction, Review Gate auditing, and native MCP stdio server interaction.
- **CLI Flags `--version` and `-v` (`src/cli.ts`):**
  - Prints current LogNexus version directly to terminal.
- **Enhanced Documentation & Complete Feature Matrix (`README.md`):**
  - Updated key feature list showcasing persistent state, Git Notes, native MCP server, journey timeline, and Review Gate auditing.

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
