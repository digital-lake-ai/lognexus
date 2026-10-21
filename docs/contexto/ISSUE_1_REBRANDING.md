# Issue #1: Rebranding a LogNexus y configuración base

<!-- lognexus:
kind: state
status: open
phase: 1
readiness: ready
task_count: 7
tasks_complete: 0
max_tier: tier-3
updated_at: 2026-10-21T16:10:00Z
-->

## Descripción
Realizar el rebranding completo de la skill y comandos desde `shiplog` a `lognexus`, inicializar el archivo `package.json` corporativo bajo `@digital-lake/lognexus`, actualizar los metadatos del plugin de Claude y ajustar los workflows de integración continua para la nueva estructura y rama `main`.

---

## Tasks
- [ ] **T1: Renombrar directorios base de shiplog a lognexus** `[tier-3]`
  - **Qué:** `git mv skills/shiplog skills/lognexus`, `git mv commands/shiplog commands/lognexus`, `git mv .shiplog .lognexus`.
  - **Verificación:** `git status` muestra los renames sin archivos huérfanos.
- [ ] **T2: Reemplazo masivo de referencias shiplog -> lognexus en comandos y skills** `[tier-3]`
  - **Qué:** Actualizar rutas internas, comandos slash (`/lognexus`), prefijos de prompt `[lognexus routing]`, envelopes `<!-- lognexus: -->` y etiquetas `lognexus/*`.
  - **Verificación:** Las referencias funcionales quedan migradas; no se alteran menciones de atribución histórica.
- [ ] **T3: Mecanismo de lectura retrocompatible** `[tier-2]`
  - **Qué:** Asegurar que las referencias de lectura en la skill reconozcan `.shiplog/` como fallback si `.lognexus/` no existe, y lean envelopes `<!-- shiplog: -->`.
  - **Verificación:** Documentado en `references/artifact-envelopes.md`.
- [ ] **T4: Inicializar package.json base y configuración de binario** `[tier-3]`
  - **Qué:** Crear `package.json` con `name: "@digital-lake/lognexus"`, `version: "1.0.0-alpha.0"`, `author: "Digital Lake"`, `contributors: ["devallibus"]`, `bin: { "lognexus": "dist/cli.js" }`, `license: "MIT"`.
  - **Verificación:** Archivo válido según especificación npm.
- [ ] **T5: Actualizar plugin.json y marketplace.json** `[tier-3]`
  - **Qué:** Cambiar nombre a `lognexus`, versión `1.0.0-alpha.0`, author `Digital Lake`, repositorios a `https://github.com/digital-lake-ai/lognexus`.
  - **Verificación:** JSONs válidos con rutas a `./skills/` y `./commands/`.
- [ ] **T6: Ajustar workflows de CI en .github/workflows/** `[tier-2]`
  - **Qué:** Actualizar `cross-ref-check.yml`, `version-bump-check.yml` y `release.yml` para apuntar a la rama `main` y rutas de `lognexus`.
  - **Verificación:** Sintaxis YAML correcta.
- [ ] **T7: Auditoría y verificación de grep** `[tier-1]`
  - **Qué:** Ejecutar `git grep -in "shiplog"` y comprobar que los únicos resultados corresponden a retrocompatibilidad o atribución de autoría.
  - **Verificación:** Lista limpia aprobada por el orquestador.

Authored-by: gemini/3.8-flash (antigravity, role: orchestrator)

---

# Contrato de Delegación para DeepSeek (Codificador)

> Este contrato delimita estrictamente el alcance de trabajo del modelo codificador. Cualquier desviación requiere escalar al orquestador.

### 1. Metadatos de Asignación
- **Tarea asignada:** Issue #1 (T1 a T6)
- **Modelo ejecutor:** `deepseek/chat` (tier-3)
- **Modelo supervisor / revisor:** `gemini/3.8-flash` (tier-1 / orquestador)
- **Rama de trabajo:** `issue/1-rebranding-lognexus`

### 2. Archivos Permitidos (Allowlist)
- `skills/lognexus/**` (tras rename)
- `commands/lognexus/**` (tras rename)
- `.lognexus/**` (tras rename)
- `.claude-plugin/plugin.json`
- `.claude-plugin/marketplace.json`
- `.github/workflows/*.yml`
- `package.json` (nuevo)

### 3. Cambios Prohibidos (Denylist)
- ❌ **NO modificar** `LICENSE` ni los archivos dentro de `LICENSES/` (reservado para Fase 3).
- ❌ **NO eliminar** menciones históricas de atribución a `devallibus` donde se reconozca la procedencia.
- ❌ **NO instalar** dependencias pesadas en `package.json` en esta fase.
- ❌ **NO alterar** la lógica de los workflows más allá de sustituir rutas, nombres y la rama `main`.

### 4. Condiciones de Parada (Stop Conditions)
1. Si un reemplazo genera ambigüedad con herramientas externas homónimas (ej. `EffortlessMetrics/shiplog`), detenerse y no modificar esa ocurrencia.
2. Si se detecta un conflicto en las rutas de los sub-skills, detenerse y emitir un descubrimiento.
3. Si `git status` reporta eliminación accidental de contenido fuera de rename, detenerse de inmediato.

### 5. Presupuesto de Decisión (Decision Budget)
- **Tier máximo permitido:** `tier-3` (operaciones mecánicas de renombrado, reemplazo de cadenas y plantillas de configuración).
- Decisiones de arquitectura o diseño (`tier-1`/`tier-2`) quedan reservadas al orquestador.

### 6. Convención de Commits
Cada subtarea completada debe guardarse en un commit independiente:
- Formato: `refactor(#1/Tk): <descripción concisa>` o `chore(#1/Tk): <descripción concisa>`
- Firma obligatoria en el mensaje:
  ```
  Authored-by: deepseek/chat
  ```
