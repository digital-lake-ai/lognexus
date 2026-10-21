# Plan Maestro — LogNexus

> **LogNexus — The Git-powered memory nexus for AI agents.**
> Repo: `digital-lake-ai/lognexus` · npm: `@digital-lake/lognexus` · CLI: `lognexus` · Autor: **Digital Lake**
> Basado en `devallibus/shiplog` (MIT). La atribución está en `LICENSE` y `NOTICE.md`.

## Roles
| Rol | Quién | Responsabilidad |
|---|---|---|
| Maintainer | Digital Lake (humano) | Aprueba planes, hace el merge de los PRs y publica las releases |
| Orquestador | Gemini 3.8 Flash | tier-1/2: crear issues, planificar, escribir los contratos de delegación, revisar PRs y escribir la timeline |
| Codificador | DeepSeek | tier-3: escribir código bajo contrato, con commits `type(#N/Tk)` |

Reglas: nadie revisa su propio trabajo (DeepSeek escribe, Gemini revisa y `Reviewed-by` lo firma otro modelo). Un PR por issue y un commit por subtarea. CI en verde antes de pedir revisión.

---

## 1. Decisiones de arquitectura

### Capa 1 — Skill Markdown (se mantiene por compatibilidad)
- `skills/lognexus/**` y `commands/lognexus/*.md`; plugin en `.claude-plugin/`.
- Compatible con Claude Code, Codex, Cursor, Gemini CLI y Antigravity.
- Config del proyecto en `.lognexus/`. Durante 1 versión menor se sigue leyendo `.shiplog/` como fallback, con aviso de deprecación.

### Capa 2 — Runtime TS (nueva, `@digital-lake/lognexus`)
- Node >= 20, ESM, **`fetch` nativo** y sin SDKs obligatorios.
- Patrón **Strategy + Factory**:
  - `LLMProvider` (interfaz) → `GeminiProvider`, `DeepSeekProvider` y una base `OpenAICompatibleProvider` (para Ollama/OpenRouter en el futuro).
  - `createProvider(config)` registra cada proveedor por id.
  - `tierRouter` decide qué proveedor y modelo corresponde a cada tier.
- Precedencia de la configuración: variables de entorno > `.lognexus/config.json` > valores por defecto (validado con zod).

```env
LOGNEXUS_PROVIDER=gemini           # gemini | deepseek
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.8-flash
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
```

---

## 2. Fase 0 — Git limpio
| T | Tier | Acción |
|---|---|---|
| T1 | humano | Crear el repo vacío `digital-lake-ai/lognexus` |
| T2 | tier-2 | `git merge origin/audit/fix-cross-refs` en `master` (consolidar nuestras mejoras) ✅ |
| T3 | humano | Reiniciar el historial: `git checkout --orphan main` → `git add -A` → `git commit -m "chore: initial commit — LogNexus by Digital Lake"` → `git branch -D master` |
| T4 | humano | `git remote set-url origin https://github.com/digital-lake-ai/lognexus.git` → `git push -u origin main` |
| T5 | tier-2 | Protección de la rama `main`, etiquetas `lognexus/*` y plantillas de issue/PR |
| T6 | humano | Reservar en npm el scope `@digital-lake` |

> Obligación MIT: el aviso `Copyright (c) 2026 devallibus` y los textos de `LICENSES/` (orchestkit, superpowers) **se mantienen siempre** en la distribución.

---

## 3. Fase 1 — Rebranding (issue #1)
| T | Tier | Acción |
|---|---|---|
| T1 | tier-3 | `git mv` skills/shiplog → skills/lognexus, commands/shiplog → commands/lognexus, .shiplog → .lognexus |
| T2 | tier-3 | Reemplazar `shiplog` por `lognexus` en todo el repo: `/lognexus <cmd>`, `[lognexus routing]`, etiquetas `lognexus/*`, envelopes `<!-- lognexus: -->` |
| T3 | tier-2 | Lectura retrocompatible de `.shiplog/` y del prefijo `shiplog:` |
| T4 | tier-3 | Crear `package.json`: `name: @digital-lake/lognexus`, `bin: { lognexus: dist/cli.js }`, `author: Digital Lake`, `contributors: [devallibus]`, `license: MIT`, `version: 1.0.0-alpha.0` |
| T5 | tier-3 | `plugin.json` / `marketplace.json`: nombre, autor y URLs de `digital-lake-ai/lognexus` |
| T6 | tier-2 | Workflows de CI con las rutas nuevas y la rama `main` |
| T7 | tier-1 | Revisión: `git grep -i shiplog` solo debe aparecer en atribución y compatibilidad |

---

## 4. Fase 2 — Runtime core (issue #2)
```
src/
  cli.ts                      # lognexus doctor | route <tier> | config
  config/loadConfig.ts
  providers/types.ts          # interface LLMProvider { id; generate(req) }
  providers/factory.ts
  providers/gemini.ts         # contents/parts, x-goog-api-key, reintentos
  providers/deepseek.ts       # /chat/completions OpenAI-compatible
  providers/openaiCompatible.ts
  routing/tierRouter.ts
tests/**                      # vitest + fetch mockeado
```
| T | Tier | Acción |
|---|---|---|
| T1 | tier-1 | Diseñar `LLMProvider` y escribir el contrato de delegación |
| T2 | tier-3 | Scaffold: tsconfig, biome, vitest y CI (`npm run lint && npm test`) |
| T3 | tier-3 | `loadConfig` y sus tests |
| T4 | tier-3 | `GeminiProvider` y sus tests |
| T5 | tier-3 | `DeepSeekProvider` y sus tests |
| T6 | tier-3 | `factory` y `tierRouter` |
| T7 | tier-3 | CLI `lognexus doctor` (gh, git, claves y `--live`) |
| T8 | tier-2 | Actualizar `references/model-routing.md` y `.lognexus/routing.md` |

**Tiers por defecto**
| Tier | Proveedor | Uso |
|---|---|---|
| tier-1 | Gemini (high) / DeepSeek Reasoner | Brainstorm, síntesis del PR, revisión |
| tier-2 | Gemini | Contexto largo, descubrimientos, búsqueda de conocimiento |
| tier-3 | DeepSeek Chat | Commits, implementación bajo contrato |

Seguridad: nunca registrar API keys en logs, `.env` en `.gitignore` y los IDs de modelo siempre configurables.

---

## 5. Fase 3 — Docs OSS (issue #3)
- **README.md**: eslogan, badges (MIT, npm, CI), qué es, instalación (plugin, `npx skills add digital-lake-ai/lognexus`, `npm i -g @digital-lake/lognexus`), configuración y quick start. Secciones **"Based on shiplog by devallibus"** y **"What's new"** (fixes de referencias cruzadas e índice de fases, Gemini/DeepSeek, routing por tiers). Nota de desambiguación con el paper LogNexus (ISSTA 2026).
- **Imágenes** del análisis competitivo en `docs/assets/multimodel-routing-costs.png` y `docs/assets/competitive-gap-map.png`, presentadas como "research snapshot 2026" con sus fuentes (o regeneradas en inglés).
- **LICENSE (MIT)**: `Copyright (c) 2026 devallibus` + `Copyright (c) 2026 Digital Lake`.
- **NOTICE.md**: procedencia (hard fork de devallibus/shiplog) y componentes MIT de `LICENSES/`.
- **CONTRIBUTING.md**, **CODE_OF_CONDUCT.md** (Contributor Covenant 2.1), **SECURITY.md** y **CHANGELOG.md**.
- `docs/MIGRATING_FROM_SHIPLOG.md`.

**Release `1.0.0-alpha.0`** = Fases 0–3, publicada en npm y en el marketplace.

---

## 6. Roadmap futuro
- **Estado persistente**: `.lognexus/state.json` + hooks `SessionStart` y tras compactar; bloqueo de edición hasta que el plan esté aprobado.
- **Git Notes**: Quiet Mode con `refs/notes/lognexus` (estándar `git-ai` v3) en lugar de ramas `--log`.
- **Servidor MCP**: comandos como Prompts, Resource Templates (`lognexus://issue/{id}/contract`) y Completions; `--dashboard` opcional.
- **Después**: alcance por globs en monorepos, `/lognexus ask`, gate de CI `lognexus doctor --check` y `lognexus changelog`.
