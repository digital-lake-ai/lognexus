<p align="center">
  <img src="docs/assets/logo.png" alt="LogNexus Logo" width="360">
</p>

# LogNexus

<p align="center">
  <strong>The Universal, Git-Powered Context & Rules Framework for Native AI Agents</strong>
</p>

<p align="center">
  <a href="https://github.com/digital-lake-ai/lognexus/actions"><img src="https://img.shields.io/github/actions/workflow/status/digital-lake-ai/lognexus/ci.yml?branch=main&label=CI" alt="CI Status"></a>
  <a href="https://www.npmjs.com/package/@digital-lake/lognexus"><img src="https://img.shields.io/npm/v/@digital-lake/lognexus.svg?color=blue" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://github.com/digital-lake-ai/lognexus"><img src="https://img.shields.io/badge/org-Digital%20Lake-indigo.svg" alt="Digital Lake"></a>
  <a href="https://ko-fi.com/digitallake"><img src="https://img.shields.io/badge/Ko--fi-Fuel_the_AI-ff5e5b?logo=ko-fi&logoColor=white" alt="Ko-fi - Fuel the AI"></a>
</p>

---

## What is LogNexus?

As AI coding agents take on complex engineering tasks across different IDEs, they suffer from a fundamental failure mode: **cognitive amnesia**. Between conversation resets, context compactations, model handoffs, and unexpected bugs, the *why* behind design decisions, discarded alternatives, and technical discoveries vanishes.

**LogNexus transforms Git and GitHub into a persistent, traceable knowledge graph.** It is a **100% generic, model-agnostic and editor-agnostic framework** that operates directly inside your native AI development environments:
- **Clients:** Claude Code, Cursor, Codex, Google Antigravity, Kimi Code, VS Code, Zed.
- **Models:** Anthropic Claude (Opus, Sonnet, Haiku), OpenAI (o3, o1, GPT-4o), Google Gemini (2.5/3.8 Pro & Flash), DeepSeek (R1, V3, Chat).

```
Issues (Why & Goals) ──▶ Branches (Task Scopes) ──▶ Commits (Context & Diffs) ──▶ PR (Timeline & Review)
         ▲                                                                                 │
         └─────────────────────── Git-Backed Knowledge Graph ──────────────────────────────┘
```

> **Framework, Not an API Proxy:** LogNexus never intercepts network calls or wraps vendor APIs. Your models remain inside their native IDEs with full access to editor buffers, interactive diff viewers, terminals, MCP servers, and local tools.

---

## Key Features

- **Universal Multi-Model Support:** Native cognitive guidelines and prompt specifications for **Anthropic Claude**, **OpenAI**, **Google Gemini**, **DeepSeek**, and **Kimi K2.7 Code**.
- **Universal Client Compatibility:** Drop-in support for **Claude Code**, **Cursor**, **Codex**, **Google Antigravity**, and **Kimi Code / VS Code**.
- **Atomic Commit Engine (`lognexus commit` & MCP `lognexus_commit`):** Validates subtask file contracts, verifies reviewer separation, injects authorship trailers, commits changes, marks subtasks completed, and attaches Git Notes in a single ~0.15s execution.
- **Cross-Model Review Gates:** Non-negotiable review separation (`Authored-by:` vs `Reviewed-by:`) enforced both at pre-flight note attachment time and during branch audits. No model merges its own code without independent verification from another model family.
- **Contract-First Subtasks & Alphanumeric Tickets:** Tasks are bounded by strict decision budgets, file allowlists, and stop conditions—supporting both GitHub issues (`feat(#42/T1)`) and Jira/Linear ticket schemes (`feat(SLM-201/T1)`).
- **Persistent State & Session Recovery:** Local session state engine (`.lognexus/state.json`) prevents amnesia across context compactations and conversation resets, retaining completed subtask metadata through the closing commit.
- **Git Notes Engine (Quiet Mode / `git-ai` v3):** Attaches structured session payloads and contracts to commits under `refs/notes/lognexus` without changing commit SHAs.
- **Native MCP Stdio Server (`lognexus mcp`):** Zero-dependency JSON-RPC 2.0 stdio server exposing LogNexus tools, live state resources, and prompts to Claude Desktop, Cursor, and any MCP client.
- **Journey Timeline & Review Gate Audit:** Reconstructs the complete branch journey into structured PR descriptions (`lognexus timeline --pr-body`) and programmatically audits review gate separation (`lognexus audit`).
- **Hidden Metadata Envelopes:** HTML comments preserve machine-parseable state (`<!-- lognexus: kind: state ... -->`) without cluttering human-readable markdown.
- **Scaffolding & Health CLI (`@digital-lake/lognexus`):** Lightweight CLI for repository scaffolding (`init`), health diagnostics (`doctor`), and real-time status inspection (`status`).

---

## Model-Tier Routing Matrix

LogNexus organizes development phases into three cognitive tiers. You can assign any model or native client to any tier according to your team's workflow and cost preferences:

<p align="center">
  <img src="docs/assets/multimodel-routing-costs.png" alt="Multi-Model Routing Cost and Performance Analysis" width="85%">
</p>

### Operational Tiers

| Tier | Cognitive Role | Anthropic Claude | OpenAI | Google Gemini | DeepSeek | Primary Activities |
|---|---|---|---|---|---|---|
| **tier-1 (Reasoning)** | Deep synthesis, architectural design, narrative review | Claude Opus 3.7 / 4.x | o3, o1, GPT-5 | Gemini 2.5 / 3.8 Pro | DeepSeek R1 | Brainstorming-to-issue planning, PR journey timeline synthesis, cross-model review sign-offs. |
| **tier-2 (Context & Triage)** | Long context ingestion, discovery triage, structured mapping | Claude Sonnet | GPT-4.1, GPT-4o | Gemini Flash / Pro (1M context) | DeepSeek V3 | Large codebase exploration, discovery classification, knowledge retrieval. |
| **tier-3 (Execution)** | Surgical implementation, template filling, fast execution | Claude Haiku | GPT-4o-mini | Gemini Flash | DeepSeek Chat (V3) | Subtask commits (`feat(#N/Tk)`), atomic code changes under closed contracts, timeline logging. |

### Example Deployment Setups

LogNexus adapts to your existing toolstack. Configure your advisory preferences in `.lognexus/routing.md`:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                 POPULAR DEPLOYMENT SETUPS                              │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ Setup A (Anthropic Pure):  Claude Opus (t1) + Claude Sonnet (t2) + Claude Haiku (t3)   │
│ Setup B (Google + DeepSeek): Gemini Pro (t1/t2) in Antigravity + DeepSeek Chat in Kimi │
│ Setup C (OpenAI + DeepSeek): OpenAI o3 (t1) in Cursor + DeepSeek Chat (t3) for code    │
│ Setup D (Claude + OpenAI):   Claude Opus (t1) for design + GPT-4o-mini (t3) for tasks  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

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

## Installation & Setup

### 1. Scaffold Rules & Manage State with the CLI

Initialize `.lognexus/` rules, templates, and routing configuration:
```bash
npx @digital-lake/lognexus init
```

Verify your environment anytime:
```bash
npx @digital-lake/lognexus doctor
```

Inspect active branch and tier advisory:
```bash
npx @digital-lake/lognexus status
```

Manage persistent agent state (`.lognexus/state.json`) and session recovery:
```bash
npx @digital-lake/lognexus state sync
npx @digital-lake/lognexus state show
npx @digital-lake/lognexus state set-task T1 "Add user schema"
npx @digital-lake/lognexus state finish-task T1
```

Execute an **Atomic Commit** (validates subtask contract, enforces review-gate separation, injects trailers, commits, marks subtask completed, and attaches Git Note in a single ~0.15s call):
```bash
npx @digital-lake/lognexus commit -m "feat(#42/T1): add user schema" \
  --author "gemini/flash (antigravity)" \
  --reviewer "gemini/pro (lead-architect)" \
  --finish-task
```

Quiet Mode with Git Notes (`refs/notes/lognexus`, standard `git-ai` v3):
```bash
npx @digital-lake/lognexus note attach HEAD
npx @digital-lake/lognexus note show HEAD
npx @digital-lake/lognexus note push origin
```

Journey Timeline reconstruction and Review Gate audit:
```bash
npx @digital-lake/lognexus timeline main
npx @digital-lake/lognexus timeline main --pr-body
npx @digital-lake/lognexus audit main
```

### 2. Connect via Model Context Protocol (MCP)

LogNexus includes a native, lightweight JSON-RPC 2.0 stdio server (`lognexus mcp`) with zero external SDK dependencies. Connect it to Claude Desktop, Cursor, Google Antigravity, or any MCP-compliant client:

**`claude_desktop_config.json` or Cursor MCP settings:**
```json
{
  "mcpServers": {
    "lognexus": {
      "command": "npx",
      "args": ["-y", "@digital-lake/lognexus", "mcp"]
    }
  }
}
```

**Or install automatically via Smithery:**
```bash
npx -y @smithery/cli install @digital-lake/lognexus --client claude
```

**Exposed Capabilities:**
- **Tools:** `lognexus_status`, `lognexus_state_get`, `lognexus_state_sync`, `lognexus_state_set_task`, `lognexus_state_finish_task`, `lognexus_state_clear`, `lognexus_commit`, `lognexus_note_show`, `lognexus_note_attach`, `lognexus_timeline`, `lognexus_audit`
- **Resources:** `lognexus://state`, `lognexus://routing`
- **Prompts:** `lognexus-plan`, `lognexus-review`

### 3. Install Rules in Your Agent Environment

- **Claude Code:**
  ```bash
  claude plugin add digital-lake-ai/lognexus
  ```
- **Cursor / Codex / Agent Skills:**
  ```bash
  npx skills add digital-lake-ai/lognexus
  ```
- **Google Antigravity:** Active automatically via `skills/lognexus/SKILL.md` or workspace skills.
- **Kimi Code / VS Code:** Active via `.lognexus/` workspace instructions and prompts.

---

## ⚡ Production Telemetry & Field Benchmark

<div align="center">

![Corpus Analyzed](https://img.shields.io/badge/CORPUS_GOVERNED-250%2C000%2B_LOC-00f2fe?style=for-the-badge&labelColor=0d1117)
![Git Notes Coverage](https://img.shields.io/badge/GIT_NOTES_COVERAGE-100%25_(38%2F38)-00ff87?style=for-the-badge&labelColor=0d1117)
![Traceability Audit](https://img.shields.io/badge/REVIEW_GATE_AUDIT-100%25_PASS-7928ca?style=for-the-badge&labelColor=0d1117)
![Test Suite Health](https://img.shields.io/badge/UNIT_TESTS-536_PASSED_(0_WARN)-38ef7d?style=for-the-badge&labelColor=0d1117)

</div>

LogNexus was battle-tested in a high-intensity production deployment governing the end-to-end engineering of **Taranis**—a deterministic static analysis CLI and AI migration skill operating over **250,000+ lines of legacy code** with 22 AST/CFG rules (`SPH-001`..`SPH-022`).

```
╔══════════════════════════════════════════════════════════════════════════════════════════════╗
║  LOGNEXUS TELEMETRY HUD // PRODUCTION SWARM BENCHMARK (CASE STUDY: TARANIS)                  ║
╠═════════════════════════════════════════════╦════════════════════════════════════════════════╣
║  ▸ GOVERNED FEATURES     12 Issues (#1-#12) ║  ▸ ORPHAN / UNTRACKED COMMITS   0 (0.0%)       ║
║  ▸ VERIFIED COMMITS      38 / 38 Signed     ║  ▸ SELF-APPROVAL VIOLATIONS     0 Blocked      ║
║  ▸ GIT NOTES ATTACHED    100% (git-ai v3)   ║  ▸ SCOPE CREEP INCIDENTS        0 (Allowlist)  ║
║  ▸ TEST SUITE INTEGRITY  536 Passed (100%)  ║  ▸ ATOMIC COMMIT LATENCY        ~0.15s / op    ║
╚═════════════════════════════════════════════╩════════════════════════════════════════════════╝
```

### Multi-Model Swarm Performance Matrix

By enforcing **Closed Delegation Contracts** (`allowedFiles`, `forbiddenFiles`, `decisionBudget: "none"`) and **Cross-Model Review Gates**, LogNexus coordinated three distinct AI model families in production without a single context leak or rogue commit:

| Model Family | Assigned Tier | Production Strengths Observed | Optimal Contract Fit |
| :--- | :---: | :--- | :--- |
| **Google Antigravity / Gemini Pro** | `tier-1` & `tier-2`<br>*(Architect & Orchestrator)* | • Zero-drift multi-branch coordination<br>• Strict review-gate enforcement (`lognexus audit`)<br>• Rapid root-cause regression triage | Architecture synthesis, closed contract authoring, cross-model code review, release governance. |
| **DeepSeek V3 / R1** | `tier-3`<br>*(Scoped Implementer)* | • Ultra-low latency & token cost<br>• Exceptional at mathematical AST parsing, pushdown automata & CFG tokenization<br>• Strict adherence to stop conditions when hitting out-of-scope test assertions | Algorithmic engines, deterministic parsers, isolated single-file modules (`<500` LOC). |
| **Kimi K2.7 Code** | `tier-2` & `tier-3`<br>*(High-Context Implementer)* | • Massive context retention with zero file truncation on large modules (`>500` LOC)<br>• Flawless single-shot multi-file generation (rule catalogs + visitors + test suites) | Large-context refactorings, multi-file rule catalogs, CI/CD matrices & standalone packaging. |

> **Key Takeaway:** Contract-driven development paired with `refs/notes/lognexus` completely eliminated scope creep by Tier-3 implementers while keeping the public Git commit graph 100% clean and human-readable.

---

## Disambiguation

**LogNexus** by Digital Lake is an open-source development framework and Git memory system for AI agents. It is not affiliated with academic research papers on industrial log compression (e.g. ISSTA 2026).

---

## Based on & Acknowledgments

LogNexus is an independent hard fork and continuation of [`shiplog`](https://github.com/devallibus/shiplog), originally created by **devallibus** under the MIT License.

We extend our deep gratitude to **devallibus** for pioneering the concept of Git-as-knowledge-graph for AI development. LogNexus builds upon that foundation by:
- Expanding the model ecosystem to provide first-class native support for **Google Gemini**, **DeepSeek**, and **Kimi** alongside **Claude** and **OpenAI**.
- Formalizing the multi-model tier routing taxonomy and closed delegation contracts.
- Introducing the repository scaffolding CLI, Atomic Commit Engine, and native MCP server (`@digital-lake/lognexus`).
- Providing seamless backwards-compatibility for existing `.shiplog` envelopes and workflows.

Additional inspirations and patterns are derived from [OrchestKit](https://github.com/yonatangross/orchestkit) and [Superpowers](https://github.com/obra/superpowers). Detailed license texts are preserved in the [`LICENSES/`](LICENSES/) directory and in [`NOTICE.md`](NOTICE.md).

---

<div align="center">

### Did you find this project useful? 🤖⚡

Maintaining and evolving open-source agentic infrastructure takes time, dedication, and... quite a few **AI tokens** to power multi-model benchmarking, automated testing, and continuous architecture updates.

If **LogNexus** saved you time, prevented context amnesia in your workflows, and you'd like to help cover the API and compute costs to keep it evolving, consider fueling the AI with a token:

[![Ko-fi - Fuel the AI](https://img.shields.io/badge/Ko--fi-Fuel_the_AI-ff5e5b?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/digitallake)

*Every contribution goes straight into compute power, multi-model benchmarks, new MCP capabilities, and continuous improvements!*

</div>

---

## License

LogNexus is released under the [MIT License](LICENSE).  
Copyright (c) 2026 devallibus  
Copyright (c) 2026 Digital Lake and LogNexus contributors.
