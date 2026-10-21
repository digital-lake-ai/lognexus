# 🚢 Shiplog Hunt — GustoDigital Project Status

> Scan date: 2026-06-19 · Organization: [GustoDigital](https://github.com/GustoDigital)

---

## Repositorios de la Organización

| Repositorio | Última actividad | Estado |
|-------------|-----------------|--------|
| **gd-dashboard** | 19 Jun 2026 | 🔥 Activo — foco actual |
| **gd-api** | 6 Jun 2026 | ✅ Limpio — sin issues ni PRs abiertos |
| gd-widgets | 10 Feb 2026 | 💤 Inactivo |
| gd-application | 10 Ene 2026 | 💤 Inactivo |
| gd-marketing | 6 Ene 2026 | 💤 Inactivo |

---

## Hito Principal Completado ✅

### Issue #40 — Rewrite dashboard onto owned Convex-free stack (Turso + Drizzle)

Migración masiva completada con **~20 PRs mergeados** entre junio 2 y junio 18. Incluye:
- Bootstrap de base de datos Turso
- Autenticación Better Auth + Google OAuth
- Runtime propio en Fly con réplicas embebidas
- Portado de: website publish, realtime chat, reservas, analytics, user settings, menús, importaciones, mensajes, notificaciones, plan de upgrade, traducciones
- Eliminación completa del código Convex residual

### Otros Hitos Cerrados Recientes

| Issue | Descripción | PR | Merge |
|-------|------------|-----|-------|
| #68 | Harden embedded runtime migrations | [#70](https://github.com/GustoDigital/gd-dashboard/pull/70) | 19 Jun |
| #61 | Deepen analytics against Paper C6 | [#62](https://github.com/GustoDigital/gd-dashboard/pull/62) | 19 Jun |
| #59 | Document post-convex hardening gaps | [#60](https://github.com/GustoDigital/gd-dashboard/pull/60) | 18 Jun |

---

## Issues Abiertos — Listos para trabajar 🟢

> [!IMPORTANT]
> Los 6 issues abiertos están en estado **`shiplog/ready`** — ninguno está `in-progress`. No hay PRs abiertos. El proyecto está esperando que se elija el próximo lane de trabajo.

### Ranking por preparación (recomendación **shiplog**)

| # | Prioridad | Issue | Tasks | Max Tier | Descripción |
|---|-----------|-------|-------|----------|-------------|
| 1 | 🔴 Alta | [#64](https://github.com/GustoDigital/gd-dashboard/issues/64) | 5 tareas | tier-3 | **Map Paper screens to dashboard product state** — Matriz de cobertura Paper vs rutas del dashboard. Es el prerequisito lógico para los demás issues. |
| 2 | 🔴 Alta | [#66](https://github.com/GustoDigital/gd-dashboard/issues/66) | — | — | **Close managed onboarding and setup gaps** — Cerrar gaps de onboarding para clientes gestionados. |
| 3 | 🟡 Media | [#65](https://github.com/GustoDigital/gd-dashboard/issues/65) | — | — | **Add managed-client custom domain operations** — Operaciones de dominio personalizado para clientes. |
| 4 | 🟡 Media | [#67](https://github.com/GustoDigital/gd-dashboard/issues/67) | — | — | **Add client email branding and template basics** — Branding de email y plantillas para clientes. |
| 5 | 🟡 Media | [#69](https://github.com/GustoDigital/gd-dashboard/issues/69) | 5 tareas | tier-3 | **Add dashboard support and status visibility** — Soporte y visibilidad de estado en el dashboard. |
| 6 | 🟢 Baja | [#63](https://github.com/GustoDigital/gd-dashboard/issues/63) | 4 tareas | tier-2 | **Audit background jobs and cron needs** — Auditar necesidad de jobs en background. No construir scheduler sin evidencia concreta. |

### gd-api

✅ **Sin issues ni PRs abiertos** — repositorio limpio y al día.

---

## Recomendación de Siguiente Paso

> [!TIP]
> El proyecto acaba de completar una migración masiva de Convex a un stack propio (Turso + Drizzle + Fly). Los 6 issues abiertos representan la fase de **hardening y expansión de funcionalidades** para el modelo de clientes gestionados.
>
> **Recomiendo empezar por el Issue #64** (Map Paper screens) porque es un issue de auditoría que genera la matriz de referencia para decidir qué superficies implementar primero. Los issues #65, #66, #67 y #69 dependen implícitamente de esa visión.

---

## Setup Local

| Elemento | Estado | Path |
|----------|--------|------|
| GitHub CLI | ✅ v2.95.0 | Sistema |
| Auth GitHub | ✅ HorchataHTML | `gh auth status` |
| Skill shiplog | ✅ Instalada | `~\.gemini\antigravity\scratch\.agents\skills\shiplog` |
| gd-dashboard | ✅ Clonado | `~\.gemini\antigravity\scratch\gd-dashboard` |
| gd-api | ⬜ Pendiente | Clonar cuando sea necesario |

*Captain's log — hunt scan by **shiplog***
