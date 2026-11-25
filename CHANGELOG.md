# Changelog

All notable changes to **LogNexus** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.6.0] - 2026-11-25

### Summary
A milestone release delivering official Antigravity v2.35 environment integration, declarative MCP tool annotations, November 2026 frontier model parity, and a static SEO/GEO documentation hub (`#88`, `#90`, `#92`, `#94`). Expands MCP client configuration discovery in `src/doctor.ts` to locate Antigravity `~/.gemini/config/mcp_config.json` and `.agents/mcp_config.json`, auto-detects Antigravity `ConversationService` session context in `src/telemetry/consent-prompt.ts`, introduces official declarative MCP `ToolAnnotations` (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) across all 12 tools in `src/mcp/tools.ts` & `src/index.ts`, adds November 2026 frontier model recognition (DeepSeek V4-Pro/V4/V4.1-Flash, xAI Grok 4.6/4.7, Z.ai GLM-5.4, Qwen 4 Max, Moonshot Kimi K3.1 Pro/Thinking, GPT-6-Cyber) across `src/telemetry/detector.ts`, `src/telemetry/benchmark.ts`, `src/audit/audit.ts`, and `src/status.ts`, and deploys a static SEO/GEO hub (`site/index.html`, `site/llms.txt`, `site/robots.txt`, `site/sitemap.xml`, `.github/workflows/pages.yml`) while maintaining **TDQS Grade A in Security & Schema Integrity** with `"lognexusPolicy.minCriticalVersion": "0.0.0"`.

### Added
- **Antigravity v2.35 & Multi-Client MCP Discovery (`#90`, `src/doctor.ts`, `src/telemetry/consent-prompt.ts`):**
  - Added Antigravity v2.35 MCP client config discovery for `~/.gemini/config/mcp_config.json`, `.agents/mcp_config.json`, `~/.cursor/mcp.json`, and `~/.claude.json` in `src/doctor.ts`, including cross-platform Windows backslash normalization.
  - Added native detection of Antigravity `ConversationService` environment keys (`ANTIGRAVITY_CONVERSATION_ID`, `ANTIGRAVITY_LS_ADDRESS`, `ANTIGRAVITY_CSRF_TOKEN`, `ANTIGRAVITY_PROJECT_ID`) in `src/telemetry/consent-prompt.ts` for headless agent session awareness.
- **November 2026 Frontier Model Parity (`#90`, `src/telemetry/detector.ts`, `src/telemetry/benchmark.ts`, `src/audit/audit.ts`, `src/status.ts`):**
  - Added comprehensive tier routing and detector recognition for frontier models: DeepSeek V4-Pro (Tier-1), DeepSeek V4 (Tier-2), DeepSeek V4.1-Flash (Tier-3), xAI Grok 4.6/4.7 (Tier-1), Grok Code Fast (Tier-3), Z.ai GLM-5.4 (Tier-1), GLM-4-Flash (Tier-3), Qwen 4 Max (Tier-1), Qwen Coder (Tier-2), Moonshot Kimi K3.1 Pro / Thinking (Tier-1), Kimi K3 (Tier-2), and OpenAI GPT-6-Cyber (Tier-1).
  - Added benchmark and audit telemetry support across all newly recognized frontier families.
- **Official Declarative MCP Tool Annotations (`#92`, `src/mcp/tools.ts`, `src/index.ts`):**
  - Declared spec-compliant `ToolAnnotations` (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) across all 12 LogNexus MCP tools (5 read-only, 5 non-destructive write, 2 state-reset) in `src/mcp/tools.ts`.
  - Re-exported `type ToolAnnotations` from `src/index.ts` without altering tool names, schemas, or runtime execution logic.
- **Static SEO/GEO Hub & Documentation (`#94`, `site/index.html`, `site/llms.txt`, `site/robots.txt`, `site/sitemap.xml`, `.github/workflows/pages.yml`):**
  - Published static documentation hub with `SoftwareApplication` Schema.org JSON-LD structured metadata in `site/index.html`.
  - Added AI agent indexing discovery files `site/llms.txt`, `site/robots.txt`, and `site/sitemap.xml` with automated deployment via `.github/workflows/pages.yml`.

### Changed
- **Dependencies & Tooling Consolidation (`#88`, `package.json`, `biome.json`):**
  - Updated `@biomejs/biome` to `2.6.8` with modernized schema in `biome.json`, updated `vitest` to `5.1.1`, and kept development dependencies streamlined.
- **Documentation & Skills Synchronization (`#90`, `#92`, `#94`, `README.md`, `skills/lognexus/**`, `commands/lognexus/**`):**
  - Updated `README.md` with Antigravity MCP configuration paths and declarative tool capabilities.
  - Synchronized `skills/lognexus/SKILL.md`, `skills/lognexus/references/model-routing.md`, and `commands/lognexus/models.md` for November 2026 frontier models and MCP annotations while preserving zero cross-reference regressions.
  - Updated Software Version examples to `1.6.0` in `docs/TELEMETRY_PRIVACY.md` and `.github/ISSUE_TEMPLATE/diagnostic-report.yml` while strictly isolating `Policy Version: 2.0.0`.

### Security
- **TDQS Grade A in Security & Schema Integrity:**
  - Declarative-only `ToolAnnotations`: Zero changes to tool names, input schemas, or handler logic in `src/mcp/tools.ts`.
  - Minimum critical policy version remains locked at `"lognexusPolicy.minCriticalVersion": "0.0.0"`.
  - Strict zero-network-egress guarantee preserved for local telemetry and diagnostic inspection.
  - Policy Version remains strictly locked at `2.0.0` with GDPR consent isolation.

## [1.5.0] - 2026-11-22

### Summary
A major feature, MCP governance, audit policy, and release automation milestone (`#38`, `#39`, `#40`, `#42`, `#60`, `#78`, `#84`). Delivers `lognexus doctor --mcp` for cross-platform validation of client configurations and audit policies, configurable Zod-validated audit policies via `.lognexus/policy.json` (`default`, `incremental`, `strict`) with hardcoded review-gate error floors, `lognexus note export` for topological JSONL export of Git Notes, and the read-only `lognexus://handoff` MCP resource for zero-disk-write in-memory handoff synthesis. Establishes a deterministic 7-surface SemVer synchronization engine and lockstep release pipeline while maintaining **TDQS Grade A in Security & Schema Integrity** with `0` changes to `src/mcp/tools.ts` and `"minCriticalVersion": "0.0.0"`.

### Added
- **MCP Client Configuration & Policy Validator (`#39`, `src/doctor.ts`, `src/cli.ts`):**
  - Added `npx @digital-lake/lognexus doctor --mcp` for read-only cross-platform MCP client configuration validation across Claude Desktop (`darwin`, `linux`, `win32`), `.cursor/mcp.json`, `.vscode/mcp.json` (`servers` and `mcpServers`), and `.mcp.json`.
  - Added schema and semantic validation for `.lognexus/policy.json`, checking profile structure and rule severity configurations without executing network calls or altering user settings.
- **Configurable Audit Policy Profiles (`#42`, `src/audit/policy.ts`, `src/audit/audit.ts`):**
  - Added `.lognexus/policy.json` support with Zod validation, offering pre-configured enforcement profiles: `"default"` (balanced development), `"incremental"` (legacy / transitional branches), and `"strict"` (hardened release and production paths).
  - Enforced a hardcoded, non-overridable `"error"` floor for four foundational governance rules: `"invalid-identity"`, `"review-gate-separation"`, `"base-branch-range"`, and `"invalid-policy"`, preventing policy downgrades from bypassing core safety gates.
- **Topological Git Notes JSONL Export (`#40`, `src/notes/notes.ts`, `src/cli.ts`):**
  - Added `npx @digital-lake/lognexus note export [--since <ref>] [--issue <id>] [-o|--output <path>]` to export Git Notes (`refs/notes/lognexus`) in causation-preserving `--topo-order --reverse` JSONL format.
  - Implemented safe argument handling with `shell: false`, ref verification for `--since`, workspace path confinement for destination files (`-o`), and pure stdout streaming without decorative banner headers when `-o` is omitted.
- **In-Memory MCP Handoff Resource (`#38`, `src/mcp/resources.ts`):**
  - Exposed `lognexus://handoff` (`text/markdown`) alongside `lognexus://state` and `lognexus://routing` as an in-memory, zero-disk-write Markdown handoff snapshot for native MCP clients.
- **Deterministic 7-Surface SemVer Sync & Release Pipeline (`#60`, `#78`, `scripts/sync-version.mjs`):**
  - Implemented `scripts/sync-version.mjs` with `npm run version:check` and `npm run version:sync <X.Y.Z>` keeping all 7 repository version surfaces (`package.json`, `package-lock.json`, `.claude-plugin/plugin.json`, `server.json`, `pyproject.toml`, `python/lognexus_mcp/__init__.py`, `src/cli.ts`) in lockstep.
  - Integrated Hybrid Trunk-Based Release Train lockstep checks (`.github/workflows/version-bump-check.yml`), strict PyPI OIDC publishing in `.github/workflows/release.yml`, and monthly download badges in `README.md`.

### Changed
- **Skills and Commands Synchronization:** Updated `skills/lognexus/**` and `commands/lognexus/**` to document `doctor --mcp`, `.lognexus/policy.json`, `note export`, and `lognexus://handoff` while maintaining strict CI cross-reference hygiene (`cross-ref-check.yml`).
- **Documentation and Version Surfaces:** Updated `README.md`, `docs/TELEMETRY_PRIVACY.md`, `.github/ISSUE_TEMPLATE/diagnostic-report.yml`, and all 7 manifest/CLI version surfaces to reflect `1.5.0` while maintaining `Policy Version: 2.0.0` and GDPR consent isolation.
- **Review Cycle Enhancements:** Refined diagnostic reporting in `src/audit/audit.ts`, prompt descriptions in `src/mcp/prompts.ts`, and CLI output formatting in `src/status.ts`.

### Security
- **TDQS Grade A in Security & Schema Integrity:**
  - Zero tool modifications to `src/mcp/tools.ts`; tool signatures remain stable and backward-compatible.
  - Minimum critical policy version (`"lognexusPolicy.minCriticalVersion"`) remains locked at `"0.0.0"`.
  - Zero network telemetry calls; metrics and audit operations remain 100% local.
  - Path confinement and argument sanitization on `note export` to prevent path traversal or shell injection.
  - Non-overridable audit policy floor ensures identity validity and review gate separation cannot be disabled.

## [1.4.1] - 2026-11-20

### Summary
A frontier-model parity, CLI usability, and Swarm UX maintenance release (`#75`, `#76`). Adds full November 2026 recognition across **Anthropic Claude** (`Claude Fable 5.2`, `Claude Mythos 5.2` with shared-weights self-approval blocking, and `Claude 5.5` parity), **OpenAI / Codex** (`GPT-6.2 Astra`, `GPT-6.2 Sol`, `GPT-6 Luna`, `codex-mini`, `o4` / `o4-mini`, `gpt-oss`, `codex/*` alias normalization, `-ultrafast` / `-fast` / `-light` / `-max` suffix stripping, and `CODEX_CI` / `CODEX_SANDBOX_NETWORK_DISABLED` environment guards), **GitHub Copilot** (`.github/copilot-instructions.md`), and **Astro** stack detection. Clarifies unambiguously across all skills, templates, and routing references that **ChatGPT / OpenAI Codex workflows never force cross-vendor review** (`review_gate: auto` defaults to `intra-fleet`, and single-session / solo workflows support `advisory` or `off`). Fixes universal `--help` / `-h` subcommand interception across the CLI and codifies immediate Swarm UI handoff and right-sized effort routing (`#75`), while preserving **TDQS Grade A in Security & Schema Integrity** with `0` changes to `src/mcp/tools.ts` and `"minCriticalVersion": "0.0.0"`.

### Added
- **November 2026 Claude & OpenAI Model Parity (`src/telemetry/detector.ts`, `src/audit/audit.ts`):**
  - `Claude Fable 5.2` (`claude/fable-5.2`, `tier-1`), `Claude Mythos 5.2` (`claude/mythos-5.2`, `tier-1`), and `anthropic/claude-{opus,sonnet,haiku}*` normalization, plus a shared-weights equivalence check in `checkReviewGate()` blocking `Fable <-> Mythos` cross-review as self-approval while permitting `Fable`/`Mythos` <-> `Opus`/`Sonnet`/`Haiku` under `intra-fleet`.
  - `OpenAI GPT-6.2 Astra` (`openai/astra`, `tier-1`), `GPT-6.2 Sol` (`openai/sol`, `tier-2`), `GPT-6 Luna` (`openai/luna`, `tier-3`), `gpt-oss` (`openai/gpt-oss`, `tier-2`), `codex` / `codex-mini` (`openai/codex`, `tier-2`/`tier-3`), `o4` (`tier-1`), `o4-mini` (`tier-3`), and `gpt-<N>(.<M>)?-(mini|nano)` (`tier-3`) with linear word-boundary matching (preventing `"console"` or `"solver"` false positives on `"sol"`).
  - Effort/speed suffix stripping (`-ultrafast`, `-fast`, `-light`, `-max`), `codex/` -> `openai/` provider alias normalization, bare `gpt-*` / `o1*` / `o3*` / `o4*` / `codex-*` promotion, and linear `O(n)` `<major>-<minor>` dash-version normalization across `claude/` and `openai/` slugs (`claude/fable-5-2` == `claude/fable-5.2`, `openai/gpt-6-2-astra` == `openai/gpt-6.2-astra`).
- **Ecosystem, Stack & Token Shield Expansion (`src/routing/profile.ts`, `src/telemetry/detector.ts`, `src/telemetry/consent-prompt.ts`, `src/scaffold.ts`):**
  - `copilot` ecosystem marker (`.github/copilot-instructions.md`) and `astro` stack detection (`astro.config.{mjs,ts,js,cjs}`).
  - `CODEX_CI` and `CODEX_SANDBOX_NETWORK_DISABLED` added to `AGENT_ENV_KEYS` (leaving `CODEX_HOME` human-safe so interactive terminals are not suppressed).
  - Expanded `CLAUDE_DENY_RULES` in `.claude/settings.json` to block `dist-pypi/**`, `.next/**`, `bun.lockb`, `npm-shrinkwrap.json`, `.venv/**`, `venv/**`, and `__pycache__/**`.

### Changed
- **Non-Forced Cross-Vendor Review for ChatGPT / OpenAI Codex:** Updated `.lognexus/routing.md` scaffold templates, `src/mcp/prompts.ts`, `commands/lognexus/models.md`, `skills/lognexus/SKILL.md`, `references/model-routing.md`, and `references/closure-and-review.md` to confirm `review_gate: auto` uses `intra-fleet` (`GPT-6.2 Astra` -> `Sol`/`Luna`) and single-session / solo workflows may use `review_gate: advisory` or `off`.
- **Swarm UX & Effort Routing (`#75`):** Documented immediate Swarm UI link emission (`[Open the Swarm UI](sidecar://swarm/swarm_board/?auto_open=false)`) before `swarm_wait`, `@coordinator` model-sync behavior (`swarm{action: "model"}`), direct native `swarm` invocation by standard Tier-1 models, and right-sized effort (`Medium` for status/reviews vs. `XHigh`/`Max` for architectural planning).
- **2026 Status Labels & Version Contract (`1.4.1`):** Refreshed `src/status.ts` ecosystem tier labels (`claude-code`, `codex`, `copilot`, `cursor`, `windsurf`, `zed`, `roo`, `aider`), `docs/TELEMETRY_PRIVACY.md` examples, `.github/ISSUE_TEMPLATE/diagnostic-report.yml`, and all 7 version surfaces to `1.4.1`.

### Fixed
- **Universal CLI `--help` / `-h` Handling (`src/cli.ts`):** Added linear `hasStandaloneHelpFlag(args)` that skips values after value-taking flags (`-m`, `--message`, `-F`, `--file`, `--author`, `--title`, etc.) and stops at `--`, printing usage and exiting `0` without running `runStartupGate()` or writing `.lognexus/` across all non-`mcp` commands (`init --help`, `commit -h`, `telemetry --help`, `state --help`, `note --help`).

### Security
- **TDQS Grade A in Security & Schema Integrity:** `0` changes to `src/mcp/tools.ts`, `"lognexusPolicy.minCriticalVersion"` stays `"0.0.0"`, `0` network calls in telemetry, and `0` polynomial/backtracking regexes across new identity and version parsers.

---

## [1.4.0] - 2026-11-19

### Summary
A major telemetry, adaptive-routing, and skills release (`#62`, `#64`, `#66`, `#68`, `#70`, `#72`, and Phase B `#73`). **Telemetry Engine v2.0** introduces LOC-weighted ROI pricing, source/test/docs/config diff categorization, scoped `--issue` / `--since` / `--branch` projections, offline Zero-PII snapshots (`telemetry snapshot` & `telemetry benchmark`), native swarm metrics, and **Sealed GDPR `[y/N]` Consent (`Policy v2.0.0`)** with human IDE integrated-terminal detection and 100% silent background execution. **Adaptive Ecosystem Routing** adds a linear `O(n)` `.lognexus/routing.md` parser (`orchestration: auto`, `review_gate: auto | intra-fleet | cross-vendor`), universal effort-suffix stripping, placeholder identity rejection, first-class **`Gemini 4 Neon`** (`gemini/neon`, `Orchestrator (Neon)`), and multi-manifest SemVer drift diagnostics. **Phase B** updates `20` skill and command files with the Hard Turn-1 Discovery Probe Gate (`> 3` files), automatic post-plan native `swarm` execution, `lognexus handoff --prompt`, the `security/<id>-<slug>` branch lane, and strict Software Version vs. Document Revision separation — while preserving **TDQS Grade A in Security & Schema Integrity** with `0` changes to `src/mcp/tools.ts`.

### Added
- **Telemetry Engine v2.0 & Cohort Benchmarking (`#62`):**
  - LOC-weighted ROI estimator (`src/telemetry/roi.ts`) pricing `source` and `test` lines above `docs` and `config` boilerplate (`classifyFileCategory()`, `isGovernanceOrConfigSurface()`).
  - Scoped in-memory projections (`--issue <id>`, `--since <iso>`, `--branch <ref>`) across `lognexus telemetry inspect`, `report`, and `snapshot` without mutating `.lognexus/telemetry.json`.
  - Offline Zero-PII snapshot exporter (`lognexus telemetry snapshot`) and multi-repo cohort aggregator (`lognexus telemetry benchmark --json`), backed by `TelemetryStoreSchema` v2.0.0 and automatic `saveTelemetry()` migration from `"1.0.0"` -> `"2.0.0"`.
  - Native swarm coordination metrics (`--isolation swarm`, `--swarm-workers <n>`, `--swarm-posts <n>`) tracked across `state set-task`, `note attach`, `commit`, and `telemetry`.
- **Sealed GDPR Consent Gate (`Policy v2.0.0`, `#68`, `#72`):**
  - One-time interactive human-TTY `[y/N]` prompt on `lognexus init`, `status`, and `doctor` with sealed acceptance/refusal persistence, `outdated` pause & re-consent on material policy bumps, and `lognexus init --enable-telemetry` / `--no-telemetry` / `--disable-telemetry`.
  - Automated agent/CI suppression plus human IDE integrated-terminal detection (Antigravity, Cursor, VS Code) using exact `ANTIGRAVITY_AGENT_` / `CURSOR_AGENT_` prefixes so human terminals still receive the one-time prompt.
- **Adaptive Ecosystem Routing & `Gemini 4 Neon` (`#64`, `#66`, `#70`):**
  - Declarative `.lognexus/routing.md` `O(n)` parser supporting `orchestration: auto | swarm | subagent | off`, `review_gate: auto | cross-vendor | intra-fleet | advisory | off`, `implementer: auto`, and `reviewer: auto`.
  - First-class **`Gemini 4 Neon`** (`gemini/neon`, `Orchestrator (Neon)`, `gemini-pro-orchestrator-neon`) alongside `Gemini 4 Carbon`, `Gemini 4 Argon`, `Gemini 4 Hydrogen`, `Gemini 3.8 Flash`, and `gemini-flash-worker-agy`, with universal effort-suffix stripping (`-none` through `-extra-high`) and multi-manifest SemVer drift diagnostics in `doctor` and `status`.
  - Contract extensions for `--assignee`, `--tier`, `--allowed`, `--forbidden`, `--budget`, `--verify`, and `--isolation <subagent|swarm|worktree|branch|shared>`.

### Changed
- **Phase B Skills & Commands (`20` files updated):**
  - Enforced the **Hard Turn-1 Discovery Probe Gate** (`> 3` files -> immediate read-only `invoke_subagent` / `swarm` probes pinned to Tier-2/3 when Tier-1 orchestrates) and **Automatic Post-Plan Native Swarm** under `orchestration: auto` (`<= 4` workers, selective `@name`, `model` omitted on implementers unless requested, real runtime `--author`).
  - Standardized `lognexus handoff --prompt`, `CONTEXT_MAX_FILES` (`6`) / `CONTEXT_MAX_LOC` (`1200`), the `security/<id>-<slug>` lane, Software Version vs. Document Revision separation, `Planned-by:` provenance, and 100% silent background telemetry.
- **CLI Usage & Version Contract (`1.4.0`):**
  - Synchronized version `1.4.0` across all 7 manifest surfaces (`package.json`, `package-lock.json`, `.claude-plugin/plugin.json`, `server.json`, `pyproject.toml`, `python/lognexus_mcp/__init__.py`, and `src/cli.ts` `getCliVersion()` fallback).
  - Updated `printUsage()` in `src/cli.ts` with all `state set-task` and `note attach` swarm flags and deduplicated `lognexus telemetry inspect`.
- **Migration note:** Single-star contract globs (`src/*`) now strictly match a single directory segment; use `src/**` (or trailing slash `src/`) for recursive matching.

### Fixed
- **Circular ESM TDZ in `getCliVersion()` (`src/cli.ts`):** Replaced module-level `const __cliDir` with hoisted `getCliDir()` so `MCP_SERVER_VERSION` reads `package.json` cleanly when `src/mcp/server.ts` loads before `src/cli.ts` finishes top-level evaluation.
- **Word-boundary hardening in `extractModelFamilyCategory()` (`src/telemetry/detector.ts`):** Added linear boundary regex guards (`NEON_MARKER_PATTERN`, `CARBON_MARKER_PATTERN`, `ARGON_MARKER_PATTERN`, `HYDROGEN_MARKER_PATTERN`) so human names like `Neonila Perez (antigravity)` and `Orchestrator (Neonila)` classify as `unknown/other` instead of `gemini/neon`.
- **Placeholder identity rejection & `O(1)` passive telemetry hooks:** Rejected literal placeholder strings (`auto`, `<provider>/<model>`, `orchestrator`) and reduced passive telemetry hooks to `O(1)` fail-silent execution.

### Security
- **TDQS Grade A in Security & Schema Integrity:** `0` changes to `src/mcp/tools.ts`; `"lognexusPolicy.minCriticalVersion"` remains `"0.0.0"`.
- **Strict Offline Telemetry Guarantee:** `0` network egress, `0` `fetch(` or `http(s)://` literals in `src/telemetry/`, and `O(n)` linear parsing across `.lognexus/routing.md`, contract globs, and nested parenthetical identities.

---

## [1.3.7] - 2026-11-15

### Summary
A package-metadata, provenance, and toolchain maintenance patch. Lead author and contributor attribution (`HorchataHTML` and `Digital Lake`, including cross-reference CI provenance `cd0582c1`) is standardized across npm, PyPI, Claude plugin manifests, `LICENSE`, `NOTICE.md`, and `README.md`. Rules diagnostics, PR cross-reference grep checks, and envelope documentation are streamlined around canonical `.lognexus/` conventions, `@biomejs/biome` moves to `2.6.7`, and the atomic version contract advances to `1.3.7`.

### Changed
- **Provenance & manifest attribution parity:** `package.json` (`contributors`), `pyproject.toml` (`authors`), `.claude-plugin/plugin.json` (`author`), `LICENSE`, `NOTICE.md`, and `README.md` (`Provenance & Acknowledgments`) align lead authorship and copyright hierarchy around `HorchataHTML` (`https://github.com/digital-lake-ai/lognexus`) and `Digital Lake`, recording explicit provenance for the TypeScript runtime/MCP architecture and cross-reference validation specification (`cd0582c1`).
- **Canonical `.lognexus/` rules & envelope checks:** `checkRulesConfig()` in `src/doctor.ts`, `.github/workflows/cross-ref-check.yml`, `CONTRIBUTING.md`, and `skills/lognexus/references/artifact-envelopes.md` are streamlined around canonical `.lognexus/` directories and `<!-- lognexus:` envelopes.
- **Biome `2.6.7` upgrade:** `@biomejs/biome` in `devDependencies` and `"$schema"` in `biome.json` advance in lockstep to `2.6.7`.
- **Version contract:** the atomic version contract moves to `1.3.7` across `package.json`, `package-lock.json`, `.claude-plugin/plugin.json`, `server.json` (`root`, `npm`, `pypi`), `pyproject.toml`, `python/lognexus_mcp/__init__.py`, `src/cli.ts`, `.github/ISSUE_TEMPLATE/diagnostic-report.yml`, `docs/TELEMETRY_PRIVACY.md`, and the test suite, keeping `lognexusPolicy.minCriticalVersion` at `"0.0.0"`.

---

## [1.3.6] - 2026-11-12

### Summary
A context-economy and identity-consolidation release. `lognexus init --protect-tokens` adds an opt-in Multi-Model Token Shield that teaches every supported AI client to skip lockfiles, vendor trees and build output, and this repository now runs the shield on itself. `Gemini 4 Carbon` is recognised as a co-flagship tier-1 identity across routing, provenance and the review gate, and the CLI help finally documents every MCP tool and flag it ships.

### Added
- **Optional Multi-Model Token Shield (`lognexus init --protect-tokens`):** opt-in, zero-runtime-overhead workspace hygiene that detects the agent ecosystems present in a repository and writes the matching context-exclusion files — Gemini/Antigravity (`.geminiignore`, `.aiexclude`), Claude Code (`.claude/settings.json` `permissions.deny`), Cursor (`.cursorignore`), Roo Code (`.rooignore`), Windsurf (`.codeiumignore`) and Aider (`.aiderignore`). A workspace with no detectable client receives the universal core instead. The default `init` output is unchanged.
- **Repository token-shield activation:** `.geminiignore`, `.aiexclude`, `.cursorignore` and `.claude/settings.json` now guard this repository against accidental lockfile and build-artifact reads.
- **Token Hygiene governance:** `AGENTS.md` §5, `GEMINI.md` and `CLAUDE.md` rule 10, and `.agents/rules.md` item 10 forbid reading `node_modules/`, lockfiles, `dist/` and `coverage/` into context.

### Changed
- **Co-flagship `Gemini 4 Carbon` consolidation:** tier routing, provenance docs, the `CO_ARCHITECT_IDENTITY` export and `lognexus status` all name `Gemini 4 Carbon` alongside `Gemini 4 Argon` as tier-1 principal architects. `CONTRIBUTING.md` documents the six synchronized version surfaces.
- **Lockfile exemption in `evaluateContextBudget()`:** generated lockfiles no longer count toward `CONTEXT_MAX_FILES` or `CONTEXT_MAX_LOC`, so a contract is not penalised for a file the agent must never read.
- **CLI `--help` synchronization:** `printUsage()` now lists all 12 MCP tools plus `--stage-allowed`, `--prompt` and `--protect-tokens`, and a packaging test keeps that parity enforced.
- **Biome `2.6.6` schema alignment:** `biome.json` and `package.json` declare the same Biome version.

### Fixed
- **`extractModelFamilyCategory()` precedence:** the explicit `gemini/carbon` and `gemini/argon` checks now run before the Antigravity `orchestrator` fallback, so a `Gemini 4 Carbon` lane is no longer misclassified.
- **`parseIdentity()` / `checkSelfApproval()` canonical family normalization:** display names and provider slugs resolve to the same canonical family, which fixes self-approval detection for `Gemini 4 Carbon` and rejects it across distinct flagship identities.

---

## [1.3.5] - 2026-11-10

### Summary
A privacy and release-hygiene release. The startup update gate becomes strictly advisory, telemetry reports identify the host project by an anonymous ID instead of its local folder name, `lognexus status` surfaces the host project's own SemVer, and `lognexus doctor` flags projects that never left the `npm init -y` placeholder version. GitHub Actions are upgraded to supersede the pending Dependabot PRs, and the case-study documentation is sanitized.

### Changed
- **Advisory-only startup update gate:** `checkUpdateGate()` no longer blocks on `minCriticalVersion`; `lognexusPolicy.minCriticalVersion` is set to `"0.0.0"` and `requiresTermsAcceptance` remains the sole blocking condition. The gate now only advises the operator to update.
- **Telemetry project anonymity & redaction:** `formatTelemetryMarkdownReport()` displays an `Anonymous Project ID` (`anonymousProjectId`) instead of the local repository folder, and `redactLocalProjectMetadata()` strips local folder names and paths from custom notes before they are written. `diagnostic-report.yml` was updated accordingly and the case-study documentation was sanitized.
- **Host project SemVer visibility & maturity diagnostics:** `lognexus status` displays `Project Version` and the published release count (`detectHostProjectVersion()`, `countPublishedReleases()`). `lognexus doctor` adds a `Version Maturity` check (`checkVersionMaturity()`) that flags `npm init -y` `"1.0.0"` on greenfield repositories, and the skill/command docs now codify the SemVer Milestone Policy.

### Security
- **Security & CI supply-chain upgrades:** remediated CodeQL alerts (`#52`/`#53`), upgraded GitHub Actions to `actions/checkout@v7`, `actions/setup-node@v7`, `actions/setup-python@v7` and `github/codeql-action@v4` (`#45`–`#48`), and bumped `@biomejs/biome` (`^2.6.5`), `vitest` (`^5.1.0`) and `@types/node` (`^26.6.6`) (`#49`–`#51`).

---

## [1.3.4] - 2026-11-08

### Summary
A distribution and maintenance release. LogNexus is now reachable from three package ecosystems at once: the npm package keeps working as before, a first-party Python launcher (`lognexus-mcp`) exposes the same MCP server through `uvx` and `pip`, and a `server.json` manifest publishes it to the official MCP Registry. The repository also gains automated supply-chain telemetry with Dependabot and CodeQL, and the README documents the exact MCP client configuration path for Linux, macOS and Windows.

### Added
- **MCP Registry manifest:** `server.json` declares `io.github.digital-lake-ai/lognexus` with the npm package (`npx`) and the PyPI package (`uvx`) as distribution channels. `package.json` exposes the same identifier through `"mcpName"` and ships `server.json` in the published tarball.
- **PyPI package `lognexus-mcp`:** `pyproject.toml` and `python/lognexus_mcp/` provide `lognexus` and `lognexus-mcp` console scripts that resolve `npx` through `shutil.which` and delegate to the TypeScript CLI. Every subprocess call uses `subprocess.run(..., shell=False)`.
- **OIDC release pipeline:** `.github/workflows/release.yml` validates `server.json` and `pyproject.toml` against the detected version and publishes the sdist and wheel through `pypa/gh-action-pypi-publish` as a non-blocking step.
- **Dependabot:** `.github/dependabot.yml` keeps `npm` and `github-actions` dependencies updated weekly, with a limit of five open pull requests per ecosystem.
- **CodeQL analysis:** `.github/workflows/codeql.yml` runs the `javascript-typescript` query suite on every push and pull request to `main`, plus a weekly schedule.
- **Multi-OS MCP configuration:** the README documents the exact MCP client configuration path for macOS, Linux and Windows, alongside the Cursor and VS Code workspace files.
- **MCP Registry & PyPI audit row:** the verified-quality table now reports the registry identifier and the `npx` / `uvx` distribution channels.

### Changed
- **Version contract:** the atomic version contract moves to `1.3.4` across `package.json`, `package-lock.json`, `.claude-plugin/plugin.json`, `src/cli.ts`, the privacy policy and the test fixtures. `lognexusPolicy.minCriticalVersion` stays at `1.3.3` so older installs receive an advisory update notice instead of a blocking error.
- **CI safety net:** the workflow now runs `node dist/cli.js --version` after the build, so a broken binary fails the pipeline instead of shipping.
- **Generated artifacts:** `.gitignore` excludes Python build output (`__pycache__/`, `*.py[cod]`, `build/`, `dist-pypi/`, `*.egg-info/`).

## [1.3.3] - 2026-11-07

### Summary
A correctness and platform-release patch. Telemetry backfill now respects the real model tier recorded in the author trailer instead of the legacy `tier-3` default, so historical notes stop under-reporting frontier models, and the canonical DeepSeek implementer identity is mapped to its family. The handoff document no longer renders `{` for retro-attached notes without a subtask title. The agent governance model is restated as native assistant autonomy during exploration plus strict contract execution, and the package now declares its cross-platform OS support explicitly.

### Added
- **Cross-platform OS metadata:** `package.json` declares `"os": ["darwin", "linux", "win32"]` next to `"engines"`, so npm and MCP registry scanners (Glama, Smithery) report the supported platforms explicitly. Keywords gained `linux`, `macos`, `windows` and `cross-platform`.
- **Ecosystem directory coverage:** the README audit table now lists the community directories and registries where LogNexus is published (`awesome-mcp-servers`, Smithery, Claude Plugin).
- **`Platforms` badge:** the README header advertises Linux, macOS and Windows support next to the Node.js badge.
- **DeepSeek implementer identity normalization:** `extractModelFamilyCategory()` and `inferTierFromAuthor()` resolve canonical DeepSeek client identities to `tier-3`.

### Fixed
- **Telemetry backfill tier resolution:** `syncTelemetryFromGitNotes()` in `src/telemetry/collector.ts` prefers `inferTierFromAuthor(author)` over the legacy `"tier-3"` default stored in historical notes, while still honouring any explicit non-default tier. Historical commits authored by `tier-1` or `tier-2` models are no longer counted as `tier-3`.
- **Handoff summary on notes without a subtask title:** `firstLine()` in `src/state/handoff.ts` returns `null` for JSON notes whose `subtask` is absent or `null`, so the completed-subtask table falls back to the commit subject instead of rendering `{`.

### Changed
- **Native assistant autonomy vs. contract governance:** `AGENTS.md` §5, `GEMINI.md`, `CLAUDE.md` and `.agents/rules.md` now state that exploration happens with every native capability of the host assistant, while execution of an active subtask contract stays bound to `allowedFiles`, `forbiddenFiles`, `decisionBudget` and its `verificationCmd`. Test files are exempt from the `CONTEXT_MAX_FILES` count in `evaluateContextBudget()`.
- **Compact dispatch prompt:** `renderCompactDispatchPrompt()` states the assistant-versus-contract boundary explicitly, and the scaffolded `.lognexus/routing.md` documents the governance instead of a static topology table.
- **Version contract:** the atomic version contract moves to `1.3.3` across `package.json` (including `lognexusPolicy.minCriticalVersion`), `package-lock.json`, `.claude-plugin/plugin.json`, the CLI fallback, the privacy policy and the test fixtures.

## [1.3.2] - 2026-11-03

### Summary
A continuity release. Telemetry can now rebuild itself from the Git Notes history when the local store is lost or was never populated, so a cloned repository reports real numbers instead of zeros. The handoff generator gained a compact dispatch prompt, a context-window budget guard and two Git-derived fallbacks, and the commit engine can stage exactly the files its contract allows. Ephemeral CLI bookkeeping files stop polluting the working tree.

### Added
- **Telemetry backfill from Git Notes:** `syncTelemetryFromGitNotes()` in `src/telemetry/collector.ts` reconstructs the summary, stack extensions, model families, LOC and subtask counts from `refs/notes/lognexus` when the note history is longer than the local store. `generateTelemetryReportFile()` uses it, so `lognexus telemetry report` works on a fresh clone.
- **`lognexus handoff --prompt` / `--compact-prompt`:** renders a compact dispatch prompt (six lines, no inlined specs) that points the next agent at the plan file, the handoff document and the state store.
- **Context-window budget guard:** `evaluateContextBudget()` measures the active contract against `CONTEXT_MAX_FILES` (6) and `CONTEXT_MAX_LOC` (1200). Oversized contracts are flagged in the handoff with a delegation recommendation instead of failing governance.
- **`lognexus commit --stage-allowed`:** stages only the working-tree files that fall inside the subtask contract, never the forbidden set.
- **Plan-file discovery:** `discoverPlanFile()` resolves `docs/contexto/issue-<id>-plan.md`, falling back to `PLAN-ISSUE-<id>`-style names.
- **Git-derived handoff fallbacks:** when `completedSubtasks` is empty, the handoff rebuilds the completed list from commit subjects; the reported version falls back to the CLI version when `package.json` is absent.
- **`lua` and `spherescript` stacks:** `.lua`/`.toc` and `.scp` are now recognised by the stack detector.
- **Subtask inference on note attach:** attaching state to a commit now infers issue and subtask from the commit subject when the state store is empty.
- **GitHub Packages mirror:** the release workflow publishes `@digital-lake-ai/lognexus` to `npm.pkg.github.com` next to the npm release, as a non-blocking step.

### Fixed
- **Ephemeral bookkeeping files:** `.lognexus/update-check.json`, the terms consent, the handoff document and the state store are auto-excluded through `.git/info/exclude`, so they no longer show up as scope drift. `lognexus init` scaffolds the same entries into a project `.gitignore`, and `lognexus audit` exempts `.lognexus/` bookkeeping.

### Changed
- **Version contract:** the atomic version contract moves to `1.3.2` across `package.json` (including `lognexusPolicy.minCriticalVersion`), `package-lock.json`, `.claude-plugin/plugin.json`, the CLI fallback and the privacy policy.

## [1.3.1] - 2026-11-02

### Summary
A hardening patch for the Windows client and for the state store's long-lived accuracy. The startup update gate now resolves the npm CLI correctly outside a POSIX shell, a completed subtask no longer reports scope drift against its own contract, the state sync resets when the cycle moves to another issue, and memory recall searches the subtask payload instead of the shared issue title while attributing authorship to the `Authored-by:` trailer.

### Fixed
- **Startup update gate on Windows:** `resolveNpmCliScript()` locates `npm-cli.js` through `process.execPath` so the registry policy query no longer fails with `ENOENT` on Windows. The query still runs through `execFileSync` with `shell: false` and `timeout: 2500`, and there is still no `fetch` call under `src/`.
- **CLI entrypoint guard:** `isDirectCliExecution()` wraps the top-level `main().catch(...)` so importing the CLI module no longer executes the command handler.
- **Scope drift on a completed subtask:** `getScopeDrift()` and the handoff generator treat a `completed` subtask as holding no contract, so the working tree is no longer reported as drifted against files the closed subtask already delivered. `lognexus status` now prints the drift verdict (and the number of contracted files) instead of staying silent.
- **State sync across issues:** `syncStateFromGit()` clears `currentSubtask` and `completedSubtasks` when the active branch moves to a different issue, and on a base or unrecognised branch. Returning to the same issue preserves the cursor.
- **Status path parsing:** `readTouchedFiles()` no longer trims the whole porcelain blob, which previously ate the leading space of the first ` M path` entry, and it follows a rename to its destination path.
- **Memory recall precision:** `searchNotesMemory()` builds its free-text haystack from the commit subject, body, author, touched files and the subtask block of the note payload. The note's `issue.title` is excluded because every commit of a cycle shares it, which previously matched the entire cycle. Free-form notes remain fully searchable.
- **Author attribution:** both memory recall and the handoff generator resolve the commit author from the `Authored-by:` body trailer, falling back to `%an` when no trailer is present. The handoff prefers the commit nested under the active issue when resolving a completed subtask.

### Changed
- **Version contract:** the atomic version contract moves to `1.3.1` across `package.json` (including `lognexusPolicy.minCriticalVersion`), `package-lock.json`, `.claude-plugin/plugin.json`, the CLI fallback and the privacy policy.

## [1.3.0] - 2026-10-30

### Summary
Session continuity is now enforced by the toolchain instead of by the operator's memory. LogNexus can regenerate a complete context handoff from local state, refuses to let a subtask write outside its declared file contract, and lets an agent recall past reasoning by filtering Git Notes on file, model, issue or free text. A startup update and legal-terms gate closes the release loop, and the canonical implementer identity for the VS Code client is standardized as `deepseek/VS Code (kimi-code)`.

### Added
- **Automated Context Handoff (`lognexus handoff`):** a new generator (`src/state/handoff.ts`) renders `.lognexus/handoff.md` from the live state store — cycle state, the active subtask contract, the scope-drift report, a completed-subtask table and the next required action. It is refreshed automatically when a subtask is activated (`state set-task`) and when a commit is closed with `--finish-task`; the commit-path refresh is best-effort and never aborts a commit. Supports `--json` for programmatic consumption.
- **Live Scope-Drift Guard (`lognexus status` / `lognexus doctor`):** `getScopeDrift()` compares the files touched in the working tree against the `allowedFiles` of the active contract, using `git status --porcelain --untracked-files=all` so that untracked files are never collapsed away. `.lognexus/` and `docs/contexto/` are exempt. Exposed as a `Scope Drift Guard` diagnostic check and embedded in the handoff document, so an out-of-contract write is caught before it reaches a commit.
- **Memory Recall Filter (`lognexus note search`):** `searchNotesMemory()` in `src/notes/notes.ts` queries the LogNexus Git Notes history by `query` (commit subject, note body, note JSON), `file` (via `git show --name-only`), `author` (commit author and body trailers) and `issue` (from the note payload). Filters combine conjunctively and results are returned newest-first. CLI surface: `lognexus note search [query] --file <path> --author <model> --issue <num> --limit <n> --json`.
- **Startup Update & Legal Terms Gate (`src/update/gate.ts`):** a non-interactive gate that checks the published npm registry policy (`execFileSync`, `shell: false`, `timeout: 2500`) and surfaces update and legal-terms requirements at CLI startup. The MCP transport is exempt so it never writes to the JSON-RPC stdout channel.

### Changed
- **Canonical implementer identity:** the VS Code client identity is standardized as `deepseek/VS Code (kimi-code)`. The audit identity extractor (`src/audit/audit.ts`) now normalizes any `family/client` trailer into a stable slug (`deepseek/vs-code`), so identity spellings no longer produce spurious review-separation results.
- **`lognexus doctor`** reports four checks instead of three: the new `Scope Drift Guard` runs alongside the existing diagnostics.

### Security
- **Zero network access preserved:** the update gate is the only code path that consults the registry, and it does so through `execFileSync` with `shell: false`. There is still no `fetch` call anywhere under `src/`.
- **Hard-block regression fixed:** `checkUpdateGate` only enforces the policy published by the registry. The local `package.json` manifest can no longer hard-block the running CLI on its own.

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
- **Removed Legacy Artifact:** Removed legacy migration guide and cleaned fallback references in `src/doctor.ts`.

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
- **Framework Initialization:** Open-source multi-model architecture initialization under the MIT License by HorchataHTML and Digital Lake.
- **Native Context & Rules Framework (Skill Markdown):**
  - Drop-in support for Claude Code, Cursor, Codex, Google Antigravity, and Kimi Code.
  - Full issue-to-merge lifecycle governed by Git as a knowledge graph (`/lognexus plan`, `start`, `commit`, `pr`, `review`).
- **Cross-Model Review Gate Enforcement:** Guaranteed verification separation (`Authored-by:` vs `Reviewed-by:`).
- **Backward Compatibility:**
  - Canonical `.lognexus/` workspace directories and `<!-- lognexus: -->` HTML metadata envelopes.
- **Quality & Standards:**
  - Fast, modular unit tests with Vitest.
  - Strict linting and formatting via Biome.
  - Automated CI workflow on GitHub Actions.
