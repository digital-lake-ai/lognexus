# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

The LogNexus team takes the security of our project and its users seriously. If you discover a security vulnerability, please report it privately rather than opening a public issue.

### How to Report
- **GitHub Security Advisory:** Submit a report via the [LogNexus Security Advisory page](https://github.com/digital-lake-ai/lognexus/security/advisories/new).
- **Direct Contact:** If GitHub Security Advisories is unavailable, contact the maintainers at `security@digital-lake.ai`.

### What to Include
To help us triage and resolve the issue quickly, please provide:
1. A description of the vulnerability and its potential impact.
2. Steps to reproduce the vulnerability, including any proof-of-concept scripts or commands.
3. Your environment details (Node.js version, OS, LogNexus version).

### Response Timeline
- **Initial Response:** We will acknowledge receipt of your vulnerability report within 48 hours.
- **Triage & Fix:** We will provide an assessment and targeted release timeframe within 5 business days.
- **Disclosure:** We follow coordinated vulnerability disclosure and will publicly credit reporters unless you prefer anonymity.

## Secrets & API Key Safety

LogNexus interacts with AI provider APIs (Google Gemini, DeepSeek, etc.).
- **Never commit `.env` or configuration files containing raw API keys.** LogNexus includes `.env` and `*.local` in `.gitignore` by default.
- LogNexus CLI (`lognexus doctor`) masks and redacts API keys in console output by default.
