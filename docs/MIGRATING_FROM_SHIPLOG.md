# Migrating from Shiplog to LogNexus

This guide assists existing `shiplog` users and teams in transitioning to **LogNexus**, the next-generation Git-powered memory nexus maintained by Digital Lake.

---

## 1. Zero-Friction Compatibility Guarantee

LogNexus maintains backwards compatibility during the `1.0.x` release series:
- If a project contains `.shiplog/` and lacks `.lognexus/`, LogNexus reads the configuration from `.shiplog/` automatically.
- Metadata envelopes starting with `<!-- shiplog: ... -->` in existing PRs and commit messages continue to be parsed alongside new `<!-- lognexus: ... -->` envelopes.
- No existing Git history or issue tracker state is invalidated.

---

## 2. Step-by-Step Migration

### Step A: Update Configuration Folder
In your repository root, rename the configuration directory:

```bash
# On Linux / macOS
git mv .shiplog .lognexus

# On Windows (PowerShell)
git mv .shiplog .lognexus
```

If you have a `.shiplog/routing.md` file, its contents remain identical in `.lognexus/routing.md`:
```markdown
# Model Routing

routing: confirm
```

### Step B: Update the Claude Code Plugin / Skills

If you used the Claude Code plugin:
```bash
# Remove the old plugin
claude plugin remove shiplog

# Install LogNexus
claude plugin add digital-lake-ai/lognexus
```

If you installed via Agent Skills:
```bash
npx skills add digital-lake-ai/lognexus
```

### Step C: Install the TypeScript Runtime & CLI (Optional but Recommended)

Install the global `@digital-lake/lognexus` CLI to unlock multi-model diagnostics and automated routing:

```bash
npm install -g @digital-lake/lognexus
```

Verify your setup:
```bash
lognexus doctor
```

### Step D: Update Slash Commands

Update your workflow commands from `/shiplog` to `/lognexus`:

| Old Command | New Command | Function |
|-------------|-------------|----------|
| `/shiplog plan` | `/lognexus plan` | Brainstorm-to-issue structuring |
| `/shiplog start <id>` | `/lognexus start <id>` | Scoped branch checkout & session start |
| `/shiplog commit` | `/lognexus commit` | Bounded commit with issue update |
| `/shiplog pr` | `/lognexus pr` | Narrative PR timeline generation |
| `/shiplog review` | `/lognexus review` | Independent cross-model review gate |
| `/shiplog models` | `/lognexus models` | Routing configuration |

---

## 3. Configuring Multi-Model Routing (Gemini + DeepSeek)

LogNexus introduces native multi-tier routing. Add your API keys to `.env` or your shell profile:

```env
# Primary Provider
LOGNEXUS_PROVIDER=gemini

# Google Gemini (Tiers 1 & 2)
GEMINI_API_KEY="your-gemini-api-key"
GEMINI_MODEL="gemini-3.8-flash"

# DeepSeek (Tier 3 Execution)
DEEPSEEK_API_KEY="your-deepseek-api-key"
DEEPSEEK_BASE_URL="https://api.deepseek.com"
DEEPSEEK_MODEL="deepseek-chat"
```

Verify live connectivity:
```bash
lognexus doctor --live
```
