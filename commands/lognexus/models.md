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
> - `review_gate: auto | cross-vendor | intra-fleet | advisory | off` (`auto` defaults to `intra-fleet`)
> - `implementer: auto`
> - `reviewer: auto`
>
> **Tier reference & Taxonomy:**
> | Tier | Use For | Recommended Models |
> |------|---------|--------------------|
> | tier-1 (reasoning) | Architecture, master planning, independent review | `Gemini 4 Neon`, `Gemini 4 Carbon`, `Gemini 4 Argon`, `Claude Opus 5.5`, `OpenAI o3 / GPT-5`, `DeepSeek R1` |
> | tier-2 (capable) | Turn-1 exploration probes, complex implementation | `Gemini 4 Hydrogen`, `Gemini 3.8 Flash High`, `Claude Sonnet 5.5`, `Kimi K3` |
> | tier-3 (fast) | Scoped execution, commits, timeline updates | `Gemini 3.8 Flash`, `gemini-flash-worker-agy`, `Claude Haiku`, `DeepSeek V3`, `GPT-4o-mini` |

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
