# LogNexus

<p align="center">
  <strong>The Git-Powered Memory Nexus for AI Agents</strong>
</p>

<p align="center">
  <a href="https://github.com/digital-lake-ai/lognexus/actions"><img src="https://img.shields.io/badge/CI-passing-brightgreen.svg" alt="CI Status"></a>
  <a href="https://www.npmjs.com/package/@digital-lake/lognexus"><img src="https://img.shields.io/npm/v/@digital-lake/lognexus.svg?color=blue" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://github.com/digital-lake-ai/lognexus"><img src="https://img.shields.io/badge/org-Digital%20Lake-indigo.svg" alt="Digital Lake"></a>
</p>

---

## What is LogNexus?

As AI coding agents take on multi-step engineering tasks, they suffer from a fundamental failure mode: **cognitive amnesia**. Between conversation resets, context compactations, model handoffs, and unexpected bugs, the *why* behind design decisions, discarded alternatives, and technical discoveries vanishes.

**LogNexus transforms Git and GitHub into a persistent, traceable knowledge graph.** It turns every brainstorm into an issue, every issue into a scoped branch, every commit into an annotated milestone, and every Pull Request into an auditable timeline of the entire development journey.

```
Issues (Why & Goals) ──▶ Branches (Task Scopes) ──▶ Commits (Context & Diffs) ──▶ PR (Timeline & Review)
         ▲                                                                                 │
         └─────────────────────── Git-Backed Knowledge Graph ──────────────────────────────┘
```

---

## Key Features

- **Dual-Layer Architecture:**
  - **Skill Layer (Markdown):** Drop-in compatibility with **Claude Code**, **Cursor**, **Codex**, **Antigravity**, and **Gemini CLI**.
  - **Runtime Layer (TypeScript):** Lightweight, zero-heavy-dependency runtime with native `fetch` and a flexible **Strategy/Factory** pattern.
- **Native Multi-Model Routing:**
  - Route planning, PR synthesis, and cross-review to high-reasoning tiers (**Gemini / Claude Opus / DeepSeek Reasoner**).
  - Ingest massive codebases using long-context windows (**Gemini** with 1M tokens).
  - Delegate closed-contract implementation tasks to cost-effective execution engines (**DeepSeek Chat** at marginal cost).
- **Cross-Model Review Gates:** Enforce non-negotiable review separation (`Authored-by:` vs `Reviewed-by:`). No model merges its own code without independent verification.
- **Contract-First Subtasks:** Tasks are bounded by strict decision budgets, file allowlists, and stop conditions (`feat(#42/T1)`).
- **Hidden Metadata Envelopes:** HTML comments preserve machine-parseable state (`<!-- lognexus: kind: state ... -->`) without cluttering human-readable markdown.

---

## Why Multi-Model Routing?

Empirical benchmarks and community data demonstrate that routing specialized agent tasks to provider tiers according to context, reasoning, and execution profiles drastically reduces operating costs while improving quality.

<p align="center">
  <img src="docs/assets/multimodel-routing-costs.png" alt="Multi-Model Routing Cost and Performance Analysis" width="85%">
</p>

### Operational Tiers

| Tier | Default Provider / Model | Primary Role |
|---|---|---|
| **tier-1 (Reasoning)** | Gemini Pro/Flash (High) · DeepSeek Reasoner · Claude Opus | Architectural design, brainstorm synthesis, PR timelines, and cross-model review gates. |
| **tier-2 (Context)** | Gemini (1M Context Window) | Rapid codebase exploration, large context loading, discovery triage, and documentation. |
| **tier-3 (Execution)** | DeepSeek Chat | Routine implementation under closed delegation contracts, subtask commits, and timeline logging. |

---

## Architecture & Competitive Positioning

LogNexus advances agentic development workflows beyond passive markdown instructions into an active, verifiable development platform.

<p align="center">
  <img src="docs/assets/competitive-gap-map.png" alt="Competitive Gap Map and Roadmap" width="85%">
</p>

---

## Quickstart & Golden Path

LogNexus coordinates the full issue-to-merge lifecycle through intuitive slash commands:

### 1. Capture the Plan
```bash
/lognexus plan
```
Transforms an exploratory brainstorm into a structured GitHub Issue with discrete subtasks (`T1..Tn`), verification criteria, and tier tags.

### 2. Start Work on a Clean Branch
```bash
/lognexus start <issue-number>
```
Creates an ID-prefixed branch (`issue/<id>-<slug>`) from the default branch tip and logs a signed `[lognexus/session-start]` note.

### 3. Commit with Traceability
```bash
/lognexus commit
```
Stages changes and generates structured, task-scoped commits (`feat(#42/T1): ...`) paired with an issue progress update.

### 4. Synthesize the Pull Request
```bash
/lognexus pr
```
Compiles all commits, discoveries, discarded alternatives, and verification steps into a comprehensive Journey Timeline inside the PR description.

### 5. Cross-Model Review & Gate Verification
```bash
/lognexus review
```
An independent model inspects the PR diff, verifies task contracts, and signs off (`Reviewed-by: <model>`) before merge.

---

## Installation

### As a Claude Code Plugin
```bash
# From repository
claude plugin add digital-lake-ai/lognexus

# Or link locally
claude plugin add ./path/to/lognexus
```

### Via Agent Skills (Antigravity / Cursor / Codex)
```bash
npx -y skills add digital-lake-ai/lognexus
```

### Via Global CLI
```bash
npm install -g @digital-lake/lognexus
lognexus doctor
```

---

## Configuration

Configure your active provider in `.lognexus/config.json` or through environment variables:

```bash
# Provider selection
export LOGNEXUS_PROVIDER=gemini        # 'gemini' or 'deepseek'

# Google Gemini
export GEMINI_API_KEY="your-api-key"
export GEMINI_MODEL="gemini-3.8-flash"

# DeepSeek
export DEEPSEEK_API_KEY="your-api-key"
export DEEPSEEK_BASE_URL="https://api.deepseek.com"
export DEEPSEEK_MODEL="deepseek-chat"
```

Verify your environment anytime:
```bash
lognexus doctor
```

---

## Disambiguation

**LogNexus** by Digital Lake is an open-source development orchestrator and Git memory system for AI agents. It is not affiliated with academic research papers on industrial log compression (e.g. ISSTA 2026).

---

## Based on & Acknowledgments

LogNexus is an independent hard fork and continuation of [`shiplog`](https://github.com/devallibus/shiplog), originally created by **devallibus** under the MIT License.

We extend our deep gratitude to **devallibus** for pioneering the concept of Git-as-knowledge-graph for AI development. LogNexus builds upon that foundation by introducing:
- Multi-model routing with native **Google Gemini** and **DeepSeek** provider strategies.
- A standalone TypeScript runtime and automated verification CLI.
- Resilient backwards-compatibility for existing `.shiplog` envelopes and workflows.

Additional inspirations and patterns are derived from [OrchestKit](https://github.com/yonatangross/orchestkit) and [Superpowers](https://github.com/obra/superpowers). Detailed license texts are preserved in the [`LICENSES/`](LICENSES/) directory and in [`NOTICE.md`](NOTICE.md).

---

## License

LogNexus is released under the [MIT License](LICENSE).  
Copyright (c) 2026 devallibus  
Copyright (c) 2026 Digital Lake and LogNexus contributors.
