# Contexto del Proyecto LogNexus

> **Conversación Antigravity vinculada**: [`c5fe0df0-519e-4479-93f6-6724ffef3350`](conversation://c5fe0df0-519e-4479-93f6-6724ffef3350)  
> **Estado de vinculación**: Asociada al workspace y proyecto `LogNexus` (`fca212c5-6c36-49a2-baf6-02969d60dcd0`).

---

## 1. Propósito del Proyecto
Este proyecto (**LogNexus**) toma como base el desarrollo previo realizado sobre la arquitectura de **GustoDigital (`gd-dashboard`)** para refactorizarlo, mejorarlo y lanzarlo como un software libre propio e independiente.

---

## 2. Stack Tecnológico Base
* **Frontend**: React + Vite + TypeScript.
* **Runtime & Package Manager**: Bun / Node.
* **Base de Datos**: Turso (libSQL) con réplicas embebidas.
* **ORM**: Drizzle ORM (migraciones centralizadas).
* **Autenticación**: Better Auth + integración de Operator/Support Impersonation.

---

## 3. Resumen del Trabajo en la Conversación Previa (`c5fe0df0`)
1. **Migración fuera de Convex**: Migrado a stack propio Turso + Drizzle (Issue #40, ~20 PRs).
2. **Sistema de Soporte e Impersonación (Issue #76)**:
   - Registro de auditoría persistente (`impersonation_audits`).
   - Rutas auditadas `/api/support/impersonate/start` y `/stop`.
   - Banner visual persistente de impersonación con botón de salida.
3. **Auditoría y Corrección de Seguridad Post-Push (Issue #78 / PR #79)**:
   - Corrección de seed scripts para apuntar al primario de Turso en staging (`database-seed-target.ts`).
   - Bloqueo completo de endpoints de mutación de credenciales en Better Auth.
   - Validación estricta de origen del navegador (`hasTrustedBrowserOrigin`).
4. **Caché local del código anterior**:
   - Existe una copia local previa en `C:\Users\setga\.gemini\antigravity\scratch\gd-dashboard`.

---

## 4. Documentación Histórica Disponible
En la carpeta [`docs/historial_previo/`](docs/historial_previo/) se encuentran todos los artefactos generados en la sesión anterior:
* [`project_status.md`](docs/historial_previo/project_status.md): Estado general y mapa de issues del repo base.
* [`post_push_analysis.md`](docs/historial_previo/post_push_analysis.md): Análisis detallado de los últimos cambios y fixes de seguridad.
* [`walkthrough.md`](docs/historial_previo/walkthrough.md): Pasos de implementación del sistema de soporte y auditoría.
* [`task.md`](docs/historial_previo/task.md) / [`implementation_plan.md`](docs/historial_previo/implementation_plan.md) / [`priority_analysis.md`](docs/historial_previo/priority_analysis.md): Planificaciones detalladas.
