---
allowed-tools: Bash(cat:*), Bash(test:*), Bash(mkdir:*), Read, Write
description: Configure model-tier routing for lognexus phase transitions
---

## Context

- Routing config exists: !`test -f .lognexus/routing.md && echo "yes" || echo "no"`
- Current config: !`cat .lognexus/routing.md 2>/dev/null || echo "(no config file)"`

## Your Task

You are running the lognexus model-routing setup.

### If Config Exists

Show the current routing mode and ask if the user wants to change it.

### If No Config Exists (or user wants to change)

Present the setup prompt:

> How should I handle model-tier suggestions at phase transitions?
>
> - **routing: confirm** (default) -- Pause and ask before proceeding, allowing model switches.
> - **routing: warn** -- Show a banner but keep going.
> - **routing: off** -- No routing prompts.
>
> **Orchestration & Review Gate Options:**
> - `orchestration: auto | swarm | subagent | off` (`auto` defaults to native swarm under Antigravity Orchestrator or subagent when available)
> - `review_gate: auto | cross-vendor | intra-fleet | advisory | off` (`auto` defaults to `intra-fleet`; ChatGPT / OpenAI Codex workflows never force cross-vendor review, and single-session solo workflows may use `advisory` or `off`)
> - `implementer: auto`
> - `reviewer: auto`
>
> **Tier reference & Taxonomy (November 2026):**
> | Tier | Use For | Recommended Models |
> |------|---------|--------------------|
> | tier-1 (reasoning) | Architecture, master planning, independent review | `Gemini 4 Neon`, `Gemini 4 Carbon`, `Gemini 4 Argon`, `Claude Fable 5.2`, `Claude Mythos 5.2`, `Claude Opus 5.5`, `OpenAI GPT-6.2 Astra`, `GPT-6-Cyber`, `o3 / o4 / GPT-5(.N)`, `DeepSeek R1`, `DeepSeek V4-Pro`, `xAI Grok 4.6/4.7`, `Z.ai GLM-5.4`, `Qwen 4 Max`, `Kimi K3.1 Pro / Thinking` |
> | tier-2 (capable) | Turn-1 exploration probes, complex implementation | `Gemini 4 Hydrogen`, `Gemini 3.8 Flash High`, `Claude Sonnet 5.5`, `OpenAI GPT-6.2 Sol`, `Codex`, `gpt-oss`, `DeepSeek V4`, `xAI Grok`, `Z.ai GLM`, `Qwen Coder`, `Kimi K3` |
> | tier-3 (fast) | Scoped execution, commits, timeline updates | `Gemini 3.8 Flash`, `gemini-flash-worker-agy`, `Claude Haiku 5.5`, `OpenAI GPT-6 Luna`, `codex-mini`, `o4-mini`, `DeepSeek V4.1-Flash`, `DeepSeek V3`, `xAI Grok Code Fast`, `Z.ai GLM-4-Flash` |
>
> *Gate & Normalization Notes:* `Claude Fable 5.2` and `Claude Mythos 5.2` share identical base model weights, so `Fable <-> Mythos` cross-review is blocked as self-approval while both may review `Opus 5.5` / `Sonnet 5.5` / `Haiku 5.5` under `intra-fleet`. Speed/effort suffixes (`-ultrafast`, `-fast`, `-light`, `-max`) and `codex/* -> openai/*` aliases normalize cleanly (`gpt-6-2-astra` == `gpt-6.2-astra`). Frontier models across DeepSeek (V4-Pro / V4.1-Flash), xAI (Grok 4.6/4.7), Z.ai (GLM-5.4), Qwen (Qwen 4 Max), Moonshot (Kimi K3.1 Pro), and OpenAI (GPT-6-Cyber) are recognized natively.

### Save the Choice

Create `.lognexus/routing.md`:

```markdown
# Model Routing

routing: <chosen-mode>
orchestration: auto
review_gate: auto
implementer: auto
reviewer: auto
```

Create the `.lognexus/` directory if it doesn't exist.

### Report

Confirm the saved routing mode and explain when it will take effect (at the next phase transition).

Note: Telemetry consent is managed strictly via interactive human TTY (`lognexus init --enable-telemetry` / `--no-telemetry`) and stays 100% silent during agent turns.
