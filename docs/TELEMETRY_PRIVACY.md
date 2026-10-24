# LogNexus Telemetry & Privacy Policy

**Effective Date:** October 23, 2026  
**Policy Version:** 1.0.0  
**Framework:** [`@digital-lake/lognexus`](https://github.com/digital-lake-ai/lognexus) by Digital Lake AI  

---

## 1. Executive Summary

LogNexus is committed to developer privacy, data minimization, and total transparency.

1. **Disabled by Default:** LogNexus does not collect or transmit any telemetry data unless you explicitly enable it.
2. **Strictly Opt-In:** Telemetry has two distinct operating levels:
   - **Local Mode (`local`)**: Analyzes your repository locally to generate performance reports (`.lognexus/telemetry.md`). Zero network calls are made.
   - **Community Mode (`community`)**: Requires explicit consent (`--share --accept-terms`). Sends anonymous, non-sensitive aggregate statistics to help Digital Lake improve Model Context Protocol (MCP) integrations, model tier routing, and review gates.
3. **Zero-PII Guarantee:** We **never** collect source code, file contents, file paths, file names, commit messages, issue titles, author emails, GitHub usernames, IP addresses, or secrets.

---

## 2. Industry Standards & Environment Flags

LogNexus strictly respects industry-standard privacy environment variables. If either of the following variables is present and set to `1` or `true`, telemetry is **completely disabled regardless of any configuration**:

```bash
export DO_NOT_TRACK=1
export LOGNEXUS_TELEMETRY_DISABLED=1
```

---

## 3. Data Collection Audit: What We Collect vs. What We Never Collect

| Category | ✅ What We Collect (Anonymous & Aggregate) | ❌ What We NEVER Collect (Forbidden) |
| :--- | :--- | :--- |
| **Identity** | An anonymous, randomly generated `UUIDv4` identifier (`anonymousProjectId`). | Usernames, real names, email addresses, GitHub handles, hostnames, IP addresses. |
| **System** | OS platform (`win32`, `darwin`, `linux`), Node.js major version (`v22`), LogNexus version (`1.2.1`). | File system directory paths, home directories, environment variables, installed personal apps. |
| **Project Stack** | Detected stack categories (e.g., `["typescript", "nodejs"]`, `["python"]`). File extensions only (`.ts`, `.py`, `.rs`). | Source code, file names, directory names, package names, internal library names. |
| **AI Models** | Model family (`gemini`, `claude`, `deepseek`, `openai`, `kimi`) and operational tier (`tier-1`, `tier-2`, `tier-3`). | Prompts, completions, reasoning tokens, system instructions, API keys. |
| **Metrics** | Numeric counters: lines added count (`+120`), lines deleted count (`-15`), subtask duration in seconds, audit pass/fail boolean, blocked review gate count, estimated % cost saved. | Commit subjects, commit bodies, diff contents, git branches, PR descriptions. |

---

## 4. Full Transparency: Payload Inspection

You can inspect the exact JSON payload collected by your project at any time:

```bash
npx @digital-lake/lognexus telemetry inspect
```

Example payload:
```json
{
  "schemaVersion": "1.0.0",
  "anonymousProjectId": "e4f8d2c1-4b3e-412a-9c0f-7e6d5b4a3c2d",
  "consent": {
    "accepted": true,
    "policyVersion": "1.0.0",
    "acceptedAt": "2026-10-23T19:00:00.000Z"
  },
  "environment": {
    "os": "win32",
    "nodeVersion": "v22.11.0",
    "lognexusVersion": "1.2.1",
    "detectedStacks": ["typescript", "nodejs"]
  },
  "summary": {
    "totalCommits": 14,
    "totalSubtasksCompleted": 6,
    "gitNotesCoveragePct": 100,
    "reviewGateBlocksPrevented": 1,
    "estimatedCostSavingsPct": 74.5
  },
  "languageBreakdown": [
    { "ext": ".ts", "commits": 12, "linesAdded": 840, "linesDeleted": 110 }
  ],
  "modelBreakdown": [
    { "family": "gemini/flash", "tier": "tier-3", "commits": 11, "avgSubtaskDurationSec": 142 }
  ]
}
```

---

## 5. Network Behavior & Ingestion Endpoint

When Community Mode is active:
- Telemetry events are dispatched asynchronously using non-blocking HTTP `POST` requests.
- Requests enforce a strict 1.5-second timeout (`AbortSignal.timeout(1500)`) and silently fail if offline, ensuring your local CLI and MCP workflows are never slowed down or interrupted.
- Default endpoint: `https://telemetry.digital-lake.ai/v1/events` (configurable via `LOGNEXUS_TELEMETRY_URL`).

---

## 6. How to Enable, Revoke, or Delete Telemetry

```bash
# Enable Local Analysis Only (generates .lognexus/telemetry.md, no network calls)
npx @digital-lake/lognexus telemetry enable

# Enable Anonymous Community Contribution (requires explicit flag)
npx @digital-lake/lognexus telemetry enable --share --accept-terms

# Revoke Consent and Completely Disable Telemetry at any time
npx @digital-lake/lognexus telemetry disable

# Clear all locally stored telemetry data
npx @digital-lake/lognexus telemetry clear
```

---

## 7. Compliance

This policy adheres to the **General Data Protection Regulation (GDPR / Regulation (EU) 2016/679)**, the **California Consumer Privacy Act (CCPA)**, and open-source telemetry best practices established by the Node.js and Linux Foundation ecosystems.

For questions, open an issue at [github.com/digital-lake-ai/lognexus/issues](https://github.com/digital-lake-ai/lognexus/issues).
