# Plan Maestro — LogNexus (Arquitectura de Reglas Nativas)

> **LogNexus — The Git-Powered Context & Rules Framework for Native AI Agents.**  
> Repo: `digital-lake-ai/lognexus` · npm: `@digital-lake/lognexus` · CLI: `lognexus` · Autor: **Digital Lake**  
> Basado en `devallibus/shiplog` (MIT). Atribución en `LICENSE` y `NOTICE.md`.

---

## 1. Principio Fundamental: Framework de Reglas, No un Router de APIs

LogNexus **NO** es un proxy ni un router de llamadas HTTP a modelos de IA.

### Por qué se descartó el Router de APIs
Sacar a modelos avanzados como **Gemini** o **DeepSeek** de sus clientes nativos mediante scripts o llamadas directas a APIs destruye el valor principal del desarrollo asistido por IA:
- Se pierde el acceso directo al contexto del editor (workspace, indexación de código, pestañas de navegador, visores de diffs interactivos y MCP servers).
- En **Google Antigravity**, Gemini opera con agentes autónomos, terminales persistentes y herramientas de depuración avanzadas.
- En **Kimi Code / Cursor**, DeepSeek opera con generación inline, contexto de buffers activos y edición multi-archivo nativa.

### La Solución LogNexus
LogNexus es un **Framework Puro de Contexto, Reglas y Memoria Git (Skill Markdown)**:
1. Gobierna el flujo de trabajo humano-agente y multi-agente dentro de los propios IDEs nativos.
2. Estandariza la memoria del proyecto utilizando **Git y GitHub como Knowledge Graph** (Issues, Ramas acotadas, Commits atómicos con contexto, PRs con Journey Timeline y Review Gates).
3. Adapta las directivas, los contratos de delegación y los formatos de prompt específicamente a la forma en que razonan Gemini y DeepSeek en sus respectivos entornos.

---

## 2. Especialización de Modelos y Roles Nativos

LogNexus divide el trabajo de ingeniería según la especialidad cognitiva de cada modelo dentro de su cliente nativo:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             DIGITAL LAKE (Humano)                           │
│             Aprueba planes de issues, autoriza merges y releases            │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                   ┌───────────────────┴───────────────────┐
                   ▼                                       ▼
    ┌─────────────────────────────┐         ┌─────────────────────────────┐
    │     GEMINI (Antigravity)    │         │     DEEPSEEK (Kimi Code)    │
    │     Orquestador / Tier-1    │         │     Codificador / Tier-3    │
    ├─────────────────────────────┤         ├─────────────────────────────┤
    │ • Brainstorming y diseño    │         │ • Implementación quirúrgica │
    │ • Creación de Issues y Tiers│ ──────▶ │ • Commits bajo contrato     │
    │ • Contratos de delegación   │         │ • feat(#N/Tk) atómicos      │
    │ • Síntesis Journey en PR    │ ◀────── │ • Decision budget: NONE     │
    │ • Cross-Model Review Gate   │         │ • Contexto de editor nativo │
    └─────────────────────────────┘         └─────────────────────────────┘
```

| Rol | Agente / Entorno | Responsabilidades en LogNexus |
|---|---|---|
| **Maintainer** | Digital Lake (Humano) | Aprueba planes, valida decisiones arquitectónicas, aprueba PRs y publica releases. |
| **Orquestador (tier-1 / tier-2)** | **Gemini (en Google Antigravity)** | • Convierte debates en issues estructurados con tareas `T1..Tn`.<br>• Redacta contratos de delegación cerrados con allowlists de archivos.<br>• Sintetiza la historia completa del desarrollo en la Journey Timeline del PR.<br>• Actúa como auditor independiente en el Cross-Model Review Gate (`Reviewed-by:`). |
| **Codificador (tier-3)** | **DeepSeek (en Kimi Code / Cursor)** | • Ejecuta tareas de código delimitadas estrictamente por contrato.<br>• Commits atómicos siguiendo la convención `feat(#N/Tk): ...`.<br>• Presupuesto de decisiones: `none` (no altera arquitecturas ni añade dependencias no autorizadas). |

---

## 3. Optimización de Prompts y Contratos para Gemini y DeepSeek

El soporte nativo de LogNexus para Gemini y DeepSeek reside en la ingeniería de especificaciones en `skills/lognexus/`:

1. **Para Gemini (Antigravity):**
   - Directivas optimizadas para razonamiento sistémico, análisis de dependencias cruzadas y contexto extendido (1M+ tokens).
   - Plantillas de síntesis que organizan hallazgos, alternativas descartadas y decisiones clave en tablas markdown.
   - Verificación de gates de revisión: auditoría de seguridad y calidad antes de autorizar merge.

2. **Para DeepSeek (Kimi Code / Cursor):**
   - Contratos de delegación ultra-específicos:
     ```markdown
     ### Contract
     - Allowed files: src/scaffold.ts, tests/scaffold.test.ts
     - Must not change: package.json dependencies, public interfaces
     - Stop and ask if: Any unexpected compiler error requires new packages
     - Decision budget: none
     ```
   - Eliminación de ambigüedades: DeepSeek sigue directivas imperativas de manera extremadamente precisa cuando se le delimita exactamente qué archivos tocar y qué evidencia retornar.

---

## 4. El Paquete CLI: `@digital-lake/lognexus` (Scaffolding y Diagnóstico)

El paquete npm distribuido como `@digital-lake/lognexus` cumple un propósito claro y acotado: **ser la herramienta de inicialización y diagnóstico del repositorio**.

### Comandos del CLI
* `npx @digital-lake/lognexus init`:
  - Inicializa `.lognexus/` en el proyecto.
  - Genera `.lognexus/routing.md` (configuración del advisory de modelos).
  - Configura plantillas de issues y PRs si no existen.
* `npx @digital-lake/lognexus doctor`:
  - Verifica la presencia y versión de `git`.
  - Comprueba la autenticación con GitHub CLI (`gh auth status`).
  - Audita el estado del repositorio y las reglas `.lognexus/`.
* `npx @digital-lake/lognexus status`:
  - Muestra la rama actual, el issue vinculado y la recomendación de tier para la fase en curso.

---

## 5. Distribución y Compatibilidad de Clientes

LogNexus se instala y ejecuta como una Skill en cualquier cliente compatible:

1. **Google Antigravity:** A través del sistema nativo de Agent Skills (`skills/lognexus/SKILL.md`).
2. **Kimi Code / VS Code / Cursor:** A través de las reglas de workspace (`.lognexus/` y prompts de comandos).
3. **Claude Code:** Como plugin nativo a través de `.claude-plugin/plugin.json`.
4. **Compatibilidad retroactiva:** Soporte transparente de lectura para proyectos que aún contengan carpetas `.shiplog/` o etiquetas `<!-- shiplog: ... -->`.

---

## 6. Roadmap

* **Hito 1 — CLI de Scaffolding y Diagnóstico:** Comandos `init`, `doctor` y `status` ultra-ligeros (sin dependencias de red pesadas).
* **Hito 2 — Estado Persistente (`.lognexus/state.json`):** Detección automática de sesión y sincronización con GitHub Issues para evitar la amnesia cognitiva tras compactaciones de contexto.
* **Hito 3 — Git Notes (Estándar `git-ai` v3):** Quiet Mode para adjuntar contratos y metadatos de agentes en `refs/notes/lognexus`.
* **Hito 4 — Servidor MCP (`lognexus mcp`):** Exponer las reglas, estado del proyecto y plantillas de contrato como recursos y herramientas MCP para que cualquier cliente IDE las consuma nativamente.
