# Open Source Notice

## Lead Author & Core Architecture

Copyright (c) 2026 [HorchataHTML](https://github.com/digital-lake-ai/lognexus)  
Copyright (c) 2026 [Digital Lake](https://github.com/digital-lake-ai) and LogNexus contributors.

**LogNexus** is designed, engineered, and maintained by **[HorchataHTML](https://github.com/digital-lake-ai/lognexus)** and **[Digital Lake](https://github.com/digital-lake-ai)** under the MIT License, including:

- **Core Runtime & Tooling:** Full TypeScript architecture, repository scaffolding and health diagnostics CLI (`lognexus init`, `doctor`, `status`), Persistent Agent State Engine (`.lognexus/state.json`), Automated Context Handoff (`lognexus handoff`), and optional Multi-Model Token Shield (`init --protect-tokens`).
- **Traceability, FinOps & Native MCP Server:** Atomic Commit Engine (`lognexus commit`), Git Notes memory graph (`refs/notes/lognexus` / `git-ai` v3), local-first FinOps telemetry & ROI cost-savings engine, and zero-dependency JSON-RPC 2.0 stdio MCP server (`@digital-lake/lognexus` on npm / `lognexus-mcp` on PyPI).
- **Cross-Reference CI & Review Governance Specification (`2026-08-04`, commit `cd0582c1`):** Automated cross-reference validation workflow (`.github/workflows/cross-ref-check.yml`), single-source-of-truth consolidation of review/signing and worktree safety blocks, and sub-skill anchor/index normalization authored by **HorchataHTML**.
- **Master Architecture & Security Orchestration:** Multi-model tier routing, supply-chain hardening, and cross-model review gates (`Authored-by` != `Reviewed-by`) orchestrated with **`Gemini 4 Argon`** and **`Gemini 4 Carbon`**.

---

## Third-Party Components & Attributions

Portions of the commit, brainstorm, and PR workflows in LogNexus incorporate ideas and patterns from:

1. **OrchestKit**
   - Repository: `https://github.com/yonatangross/orchestkit`
   - Copyright (c) 2025 Yonatan Gross
   - License: MIT (see `LICENSES/orchestkit-MIT.txt`)

2. **Superpowers**
   - Repository: `https://github.com/obra/superpowers`
   - Copyright (c) 2025 Jesse Vincent
   - License: MIT (see `LICENSES/superpowers-MIT.txt`)

---

## Legacy Template Copyright Notice

Initial baseline markdown skill templates include material distributed under the MIT License: Copyright (c) 2026 devallibus.
