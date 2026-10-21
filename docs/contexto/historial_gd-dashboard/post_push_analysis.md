# Análisis Post-Push: Qué salió mal y estado del proyecto

> Periodo analizado: **15 Jul → 19 Jul 2026** (4 días desde nuestro último push)

---

## 🔴 Lo que hicimos mal — Issue #78 (Operator Auth Repair)

El developer (batz) abrió el issue **#78** y PR **#79** específicamente para **reparar fallos de seguridad** en nuestro PR #77 (operator auth). Estos son los 3 problemas que encontró:

### Problema 1: Seed scripts apuntaban a la DB equivocada en staging
**Commits**: `989cce4`, `5c76773`

Nuestros seed scripts (`db-seed-operator.mjs` y `db-seed-control-plane.mjs`) usaban `CORE_DB_URL` directamente para escribir. En staging con Turso, `CORE_DB_URL` apunta a una **réplica de lectura**, no al primario. Esto provocaba que los seeds fallaran o escribieran en la DB equivocada.

```diff
-const coreUrl = process.env.CORE_DB_URL ?? "file:./.local/core.db"
+const coreUrl = resolveOperatorSeedDatabaseUrl(deployEnv, process.env)
```

El fix creó un módulo centralizado `database-seed-target.ts` que resuelve la URL correcta del primario según el entorno y **falla cerrado** si las credenciales de staging están vacías.

### Problema 2: Surface de credenciales no estaba completamente bloqueado
**Commit**: `06ae197`

Nuestro `credentialAuthPaths` en `agent-browser-login.ts` dejaba sin bloquear rutas como:
- `/api/auth/request-password-reset`
- `/api/auth/change-password`
- `/api/auth/set-password`

Un atacante podría haber usado estas rutas de mutación que no bloqueamos.

```diff
 const credentialAuthPaths = new Set([
   "/api/auth/sign-in/email",
   "/api/auth/sign-up/email",
   "/api/auth/forget-password",
+  "/api/auth/request-password-reset",
   "/api/auth/reset-password",
+  "/api/auth/change-password",
+  "/api/auth/set-password"
 ])
```

### Problema 3: Sin validación de origen del navegador
**Commit**: `06ae197`

El endpoint `/api/agent-browser-login` no verificaba que la solicitud viniera del propio sitio. Faltaba una función `hasTrustedBrowserOrigin()` que:
- Rechaza requests `cross-site` vía `Sec-Fetch-Site`
- Exige que `Origin` o `Referer` coincidan con `AUTH_SITE_URL`
- Forwarda los headers `origin` y `referer` a Better Auth

> [!CAUTION]
> Estas 3 correcciones son de severidad **alta**. El surface incompleto de credenciales y la falta de validación de origen eran vectores de ataque reales en staging.

---

## 🟡 Re-implementación completa del #76 (Support Impersonation)

Nuestro trabajo del #76 **nunca se subió** (quedó en nuestra branch local `issue/76-impersonated-support-audit`). El developer lo implementó desde cero, pero de forma mucho más exhaustiva:

### Lo que nosotros hicimos (~200 líneas)
| Archivo | Líneas |
|---|---|
| Schema `impersonation_audits` | ~25 |
| `api.support.impersonate.start.ts` | ~100 |
| `api.support.impersonate.stop.ts` | ~52 |
| `ImpersonationBanner.tsx` | ~44 |
| Layout injection | ~2 |
| Runbook en `auth-operator-access.md` | ~20 |

### Lo que él hizo (~8,000+ líneas en 2 PRs)
| Componente | Archivos | Líneas |
|---|---|---|
| **PR #90** — Backend (`53cb0a0`) | 21 archivos | **+5,312** |
| **PR #93** — Console + Banner (`e6a251a`) | 33 archivos | **+2,473** |
| Cookie fixes (`744d4ce`, `3b9c672`) | 2 archivos | +65 |

Las diferencias clave frente a lo nuestro:

| Aspecto | Nosotros | batz |
|---|---|---|
| **Arquitectura** | 2 rutas API inline | Módulo `support-impersonation/` con 8+ archivos (domain, api, access, http-policy, reconcile-runner, client, test-helpers) |
| **Tests** | 0 | 1,500+ líneas de tests (domain, api, api-read, access, http-policy, reconcile-runner, SupportAccessBanner, SupportConsole, dashboard-session) |
| **Reconciliation** | Ninguno | CAS-first transactional reconciliation de sesiones pendientes |
| **Status machine** | start/stop simple | Matrix de status/failure-code con enforcement a nivel DB |
| **UI** | Banner básico (~44 líneas) | `SupportConsole.tsx` completo (519 líneas) + `SupportAccessBanner.tsx` (102 líneas) + SSR context |
| **Sesión** | No integrado | Dashboard session loader extendido con impersonation context |
| **Seed** | Ninguno | `db-seed-support-customer.mjs` (315 líneas) para fixtures de test |
| **Runbook** | 20 líneas en doc existente | Documento separado `support-impersonation-runbook.md` (291 líneas) |
| **Cookie handling** | Ninguno (asumimos que funciona) | Fallback parser para runtimes sin `getSetCookie()` + quoted-value grammar |
| **Ruta** | `/api/support/impersonate/start|stop` | `/api/support/impersonation` (consolidado) + `/support` (console page) |

---

## 📊 Estado general del proyecto (desde nuestro último push)

### PRs mergeados a master: **10**

| PR | Issue | Descripción | Autor |
|---|---|---|---|
| #79 | #78 | 🔧 Reparar nuestro operator auth | batz |
| #74 | #72/T3 | Dashboard custom domains + staging data plane | batz |
| #85 | #63 | Jobs audit | batz |
| #87 | #84 | Mobile error states + chat honest failures | batz |
| #88 | #80 | Notification outbox durable | batz |
| #89 | #82 | Website editor foundation | batz |
| #90 | #76 | Support impersonation backend | batz |
| #91 | #80 | Ambiguous retry hold | batz |
| #92 | #82 | Website editor publish | batz |
| #93 | #76/T4-T6 | Support console + banner | batz |

### Volumen de cambios
```
141 archivos modificados
+24,251 líneas añadidas
-1,442 líneas eliminadas
```

### Velocity del equipo
- **10 PRs en 4 días** — ritmo extremadamente alto
- El developer usa **GPT-5 / GPT-5.6-sol** (Codex, orchestrator) como AI assistant
- Todos los PRs incluyen tests exhaustivos

---

## 📋 Lecciones para nosotros

> [!IMPORTANT]
> ### 1. Tests son obligatorios
> Nuestro PR #77 no tenía tests para `agent-browser-login.ts`. El developer añadió **188 líneas de tests** solo para esa función. Nuestra implementación del #76 tenía **0 tests** — él escribió **1,500+ líneas**.

> [!IMPORTANT]
> ### 2. Surface de seguridad incompleto
> No bloqueamos todas las rutas de mutación de credenciales (`change-password`, `set-password`, `request-password-reset`). Esto es un patrón peligroso — cuando bloqueamos un surface, debemos auditar **todas** las rutas del framework.

> [!IMPORTANT]
> ### 3. Seed scripts need environment awareness
> Nuestros seeds asumían acceso directo a la DB local. En staging (Turso con réplicas), esto no funciona. Los scripts de seed deben resolver la URL del primario explícitamente.

> [!WARNING]
> ### 4. Nuestro #76 local es ahora basura
> Nuestra branch `issue/76-impersonated-support-audit` debería eliminarse. El developer implementó todo de forma incompatible. Nuestra migración `0008_breezy_chameleon.sql` colisiona con su `0008_parallel_leech.sql`.

---

## 🔮 Estado actual del backlog

| Issue | Estado | Notas |
|---|---|---|
| #76 Support Impersonation | ✅ **Completado por batz** | Backend + Console + Banner |
| #78 Operator Auth Repair | ✅ **Completado por batz** | Fixes a nuestro PR #77 |
| #72/T3 Custom Domains | ✅ **Completado** | Staging data plane isolado |
| #63 Jobs Audit | ✅ **Completado** | — |
| #80 Notification Outbox | ✅ **Completado** | Durable + ambiguous retry hold |
| #82 Website Editor | ✅ **Completado** | Foundation + publish |
| #84 Mobile Error States | ✅ **Completado** | Chat honest failures |
| #64 Paper Screen Matrix | ❓ Pendiente | Nuestro siguiente candidato |
| #65, #66, #67 | ❓ Pendiente | Sin cambios |
