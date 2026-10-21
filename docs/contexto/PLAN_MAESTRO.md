# Plan Maestro — LogNexus (Framework Universal Multi-Modelo)

> **LogNexus — The Universal, Git-Powered Context & Rules Framework for Native AI Agents.**  
> Repo: `digital-lake-ai/lognexus` · npm: `@digital-lake/lognexus` · CLI: `lognexus` · Autor: **Digital Lake**  
> Basado en `devallibus/shiplog` (MIT). Atribución en `LICENSE` y `NOTICE.md`.

---

## 1. Principio Fundamental: Framework de Reglas Universal y Agnóstico

LogNexus es un framework de software libre **100% genérico y agnóstico al modelo y al editor**.

### Por qué es un Framework de Reglas (Skill Markdown) y NO un Proxy de APIs
Sacar a los modelos de sus clientes nativos mediante llamadas directas a APIs destruye el contexto del editor (workspace, buffers activos, visores interactivos de diffs, terminales y MCP servers).

LogNexus opera directamente dentro de los entornos nativos del desarrollador:
* **Clientes:** Claude Code, Cursor, Codex, Google Antigravity, Kimi Code / VS Code, Zed.
* **Modelos:** Anthropic Claude (Opus, Sonnet, Haiku), OpenAI (o3, o1, GPT-4o/5), Google Gemini (Pro, Flash), DeepSeek (R1, V3, Chat).

### La Aportación de LogNexus
El proyecto original (`shiplog`) soportaba flujos para Claude y OpenAI en Claude Code, Cursor y Codex. **LogNexus expande este ecosistema sumando soporte de primer nivel para Gemini y DeepSeek** (y clientes como Antigravity o Kimi Code), formalizando:
1. Una taxonomía operativa de **3 Tiers Cognitivos** aplicable a cualquier combinación de modelos.
2. Contratos de delegación cerrados (`Decision budget: none`, allowlists de archivos obligatorias).
3. Gates de revisión cruzada obligatorios (`Reviewed-by:` != `Authored-by:`).
4. Herramienta CLI de scaffolding y diagnóstico de repositorios (`@digital-lake/lognexus`).

---

## 2. Taxonomía de Tiers y Roles Multi-Modelo

LogNexus desacopla el rol del modelo físico. Los proyectos definen el comportamiento de routing en `.lognexus/routing.md` y asignan los modelos que prefieran a cada nivel:

| Tier | Perfil Cognitivo | Anthropic Claude | OpenAI | Google Gemini | DeepSeek | Actividades en LogNexus |
|---|---|---|---|---|---|---|
| **tier-1 (Reasoning)** | Razonamiento profundo, diseño sistémico y síntesis narrativa | Claude Opus 3.7 / 4.x | o3, o1, GPT-5 | Gemini 2.5 / 3.8 Pro | DeepSeek R1 | Brainstorm-to-issue planning (`/lognexus plan`), síntesis de Journey Timeline en PRs (`/lognexus pr`), auditoría de Review Gate (`/lognexus review`). |
| **tier-2 (Context & Triage)** | Gran ventana de contexto, triaje y clasificación estructurada | Claude Sonnet | GPT-4.1, GPT-4o | Gemini Flash / Pro (1M) | DeepSeek V3 | Exploración de repositorios grandes, triaje de descubrimientos (`/lognexus lookup`), carga de contexto de issues. |
| **tier-3 (Execution)** | Ejecución quirúrgica, seguimiento estricto de directivas | Claude Haiku | GPT-4o-mini | Gemini Flash | DeepSeek Chat (V3) | Subtareas acotadas por contrato, commits atómicos (`feat(#N/Tk)`), comentarios de progreso en issues. |

### Ejemplos de Configuraciones Populares

* **Setup A (Anthropic Pure):** Claude Opus (tier-1) + Claude Sonnet (tier-2) + Claude Haiku (tier-3) en Claude Code o Cursor.
* **Setup B (Google + DeepSeek):** Gemini Pro (tier-1/2) en Google Antigravity + DeepSeek Chat (tier-3) en Kimi Code / Cursor.
* **Setup C (OpenAI + DeepSeek):** OpenAI o3 (tier-1) en Cursor + DeepSeek Chat (tier-3) en VS Code.
* **Setup D (Híbrido con Review Cruzada):** Cualquier combinación donde el modelo que revisa y firma (`Reviewed-by:`) difiere del autor del código (`Last-code-by:`).

---

## 3. Protocolo de Contratos de Delegación Cerrados

Para que cualquier modelo de ejecución rápida (`tier-3`) opere sin riesgo de alucinación o sobreingeniería, LogNexus estandariza el formato de contrato:

```markdown
### Contract
- **Allowed files:** `src/scaffold.ts`, `tests/scaffold.test.ts`
- **Must not change:** `package.json` dependencies, public interfaces
- **Stop and ask if:** Compiler requires new third-party dependencies
- **Verification required:** `npm test && npm run lint` must pass
- **Decision budget:** `none`
```

Esto garantiza que modelos como DeepSeek Chat, GPT-4o-mini o Claude Haiku ejecuten cambios exactos y verificables dentro de su cliente nativo.

---

## 4. El Paquete CLI: `@digital-lake/lognexus` (Scaffolding y Diagnóstico)

El paquete npm `@digital-lake/lognexus` es una herramienta ligera (**10.5 kB**) para inicializar y auditar repositorios:

* `npx @digital-lake/lognexus init`:
  - Crea la carpeta `.lognexus/`.
  - Genera `.lognexus/routing.md` con la taxonomía multi-modelo.
  - Prepara plantillas de issues y PRs.
* `npx @digital-lake/lognexus doctor`:
  - Diagnostica la instalación y repositorio `git`.
  - Comprueba la autenticación con GitHub CLI (`gh auth status`).
  - Audita la presencia y configuración de reglas `.lognexus/`.
* `npx @digital-lake/lognexus status`:
  - Inspecciona la rama actual, el issue vinculado y la recomendación de tier para la fase activa.

---

## 5. Distribución y Compatibilidad

* **Claude Code:** Plugin nativo en `.claude-plugin/plugin.json`.
* **Cursor / Codex / Agent Skills:** Instalación directa vía `npx skills add digital-lake-ai/lognexus`.
* **Google Antigravity:** Activación directa vía `skills/lognexus/SKILL.md`.
* **Kimi Code / VS Code / Zed:** Instrucciones de workspace en `.lognexus/` y comandos markdown.
* **Compatibilidad retroactiva:** Soporte transparente de lectura para configuraciones legacy `.shiplog/` y metadatos `<!-- shiplog: ... -->`.

---

## 6. Roadmap

* **Hito 1 — Framework Universal y CLI de Scaffolding:** Soporte completo Claude + OpenAI + Gemini + DeepSeek y CLI `init`/`doctor`/`status` ✅.
* **Hito 2 — Estado Persistente (`.lognexus/state.json`):** Detección de sesión y sincronización con issues de GitHub para evitar la amnesia cognitiva entre compactaciones de contexto.
* **Hito 3 — Git Notes (Estándar `git-ai` v3):** Quiet Mode para adjuntar contratos y razonamiento en `refs/notes/lognexus`.
* **Hito 4 — Servidor MCP (`lognexus mcp`):** Exponer las reglas, estado del proyecto y plantillas de contrato como herramientas y recursos MCP para cualquier IDE.
