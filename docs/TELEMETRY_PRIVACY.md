# LogNexus Telemetry & Privacy Policy

**Effective Date:** October 28, 2026  
**Policy Version:** 2.0.0  
**Framework:** [`@digital-lake/lognexus`](https://github.com/digital-lake-ai/lognexus) by Digital Lake AI  

---

## 1. Executive Summary

LogNexus operates under a **100% Offline / Local-Only** architecture.

1. **Zero Network Transmissions:** LogNexus never sends telemetry anywhere. There is no ingestion endpoint, no remote collector, and no dispatch code in the shipped package.
2. **Disabled by Default:** No metrics are recorded until you explicitly run `lognexus telemetry enable`.
3. **Strictly Local Storage:** Every metric lives in a single file inside your own working directory — `.lognexus/telemetry.json` — and never leaves that path.
4. **Single Operating Level:** The only supported mode is `local`. The former `community` mode has been retired; the `--share` and `--accept-terms` flags no longer exist and fail with an explicit error.
5. **Zero-PII Guarantee:** LogNexus **never** stores source code, file contents, file paths, commit messages, issue titles, author emails, or secrets in its telemetry store.

---

## 2. System Capability Disclosure

Full transparency about what the LogNexus process can touch:

| Capability | Scope | Implementation |
| :--- | :--- | :--- |
| **`networkAccess`** | **0% — does not exist** | No `fetch`, `http`, `https`, `net`, or `dgram` calls anywhere in the telemetry subsystem. There is no endpoint constant and no URL override variable. |
| **`filesystemAccess`** | Strictly the local working directory | Reads and writes are confined to `<cwd>/.lognexus/` (`state.json`, `telemetry.json`, `telemetry.md`). Nothing outside that directory tree is read or written. |
| **`shellAccess`** | Local binaries only, argument-safe | `execFileSync` with `shell: false` and array arguments. Only `git` and `gh` are invoked, to read branch, commit, diff, and PR metadata. No user-supplied string is ever interpolated into a shell. |
| **`processAccess`** | Read-only environment lookups | Reads `DO_NOT_TRACK` and `LOGNEXUS_TELEMETRY_DISABLED` to honor opt-outs. No environment value is persisted or transmitted. |

---

## 3. Industry Standards & Environment Flags

LogNexus strictly respects industry-standard privacy environment variables. If either of the following variables is present and set to `1` or `true`, telemetry is **completely disabled regardless of any configuration**:

```bash
export DO_NOT_TRACK=1
export LOGNEXUS_TELEMETRY_DISABLED=1
```

Under a kill switch, the store reports mode `off`, no metrics file is written, and active recording is a no-op.

---

## 4. Data Collection Audit: What Is Stored Locally vs. What Is Never Touched

| Category | ✅ What Is Stored Locally (`local` mode only) | ❌ What Is Never Stored (Forbidden) |
| :--- | :--- | :--- |
| **Identity** | An anonymous, randomly generated `UUIDv4` (`anonymousProjectId`) scoped to the project. | Usernames, real names, email addresses, GitHub handles, hostnames, IP addresses. |
| **System** | OS platform (`win32`, `darwin`, `linux`), Node.js version (`v22.11.0`), LogNexus version (`1.2.5`). | Absolute file system paths, home directories, environment variable values. |
| **Project Stack** | Detected stack categories (e.g. `["typescript", "nodejs"]`) and file-extension counters (`.ts`, `.py`, `.ps1`). | Source code, file names, directory names, package names, internal library names. |
| **AI Models** | Model family (`gemini`, `claude`, `deepseek`, `openai`, `kimi`) and operational tier (`tier-1`, `tier-2`, `tier-3`), derived from commit trailers. | Prompts, completions, reasoning tokens, system instructions, API keys. |
| **Metrics** | Numeric counters: lines added, lines deleted, subtask duration in seconds, blocked review gate count, estimated % cost saved. | Commit subjects, commit bodies, diff contents, git branches, PR descriptions, secrets. |

---

## 5. Full Transparency: Local Payload Inspection

You can print the exact JSON structure the report is generated from at any time. The command is read-only and produces no output file:

```bash
npx @digital-lake/lognexus telemetry inspect
```

Example payload:
```json
{
  "schemaVersion": "1.0.0",
  "anonymousProjectId": "e4f8d2c1-4b3e-412a-9c0f-7e6d5b4a3c2d",
  "consent": {
    "accepted": false,
    "policyVersion": "1.0.0",
    "acceptedAt": null
  },
  "environment": {
    "os": "win32",
    "nodeVersion": "v22.11.0",
    "lognexusVersion": "1.2.5",
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
    { "family": "gemini", "tier": "tier-3", "commits": 11, "avgSubtaskDurationSec": 142 }
  ]
}
```

This object is serialized to stdout only. It is never written to a buffer for later upload, because no upload path exists.

---

## 6. Network Behavior

There is none.

- **No HTTP client:** the telemetry subsystem contains no `fetch` call and no URL literal.
- **No endpoint configuration:** there is no `LOGNEXUS_TELEMETRY_URL` variable, because there is nothing to point anywhere.
- **No background jobs:** recording is synchronous file I/O on the local store; no timers, queues, or retries exist.
- **Auditable by test:** the test suite fails if any file under `src/telemetry/` gains a `fetch(` call, an `http(s)://` URL, or a network override variable.

The only outbound-capable code in LogNexus is the explicit `git` / `gh` invocation path described in Section 2, which talks to your own Git remote and GitHub account — never to Digital Lake.

---

## 7. How to Enable, Inspect, or Delete Telemetry

```bash
# Enable local analysis (creates .lognexus/telemetry.json, no network calls)
npx @digital-lake/lognexus telemetry enable

# Move a store from a pre-2.0.0 version: legacy 'community' mode is
# migrated to 'local' automatically on read. Nothing is dispatched.

# Generate a local .lognexus/telemetry.md report with ROI metrics
npx @digital-lake/lognexus telemetry report

# Inspect the exact local payload structure
npx @digital-lake/lognexus telemetry inspect

# Disable telemetry immediately
npx @digital-lake/lognexus telemetry disable

# Delete all locally stored telemetry data
npx @digital-lake/lognexus telemetry clear
```

**Retired flags.** `lognexus telemetry enable --share --accept-terms` exits with code 1 and the message:

> Community telemetry dispatch has been retired in favor of strict local-only telemetry. Run 'lognexus telemetry enable' for local performance metrics (zero network calls).

---

## 8. Compliance

This policy adheres to the **General Data Protection Regulation (GDPR / Regulation (EU) 2016/679)**, the **California Consumer Privacy Act (CCPA)**, and open-source telemetry best practices established by the Node.js and Linux Foundation ecosystems.

Because LogNexus performs no data processing on Digital Lake infrastructure, there is no data processor, no data transfer mechanism, and no cross-border transfer to disclose. Every record remains under your sole control on your own disk.

For questions, open an issue at [github.com/digital-lake-ai/lognexus/issues](https://github.com/digital-lake-ai/lognexus/issues).
