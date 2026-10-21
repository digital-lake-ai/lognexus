# [shiplog/plan] Implement audited managed support impersonation (#76)

Este plan detalla cómo implementar la impersonation segura y auditada para el equipo de soporte gestionado (issue #76), construyendo sobre la base de Better Auth que ya introdujo el issue #75.

## User Review Required

> [!IMPORTANT]
> **API de Impersonation:** Better Auth Admin plugin ya expone rutas cliente como `/api/auth/admin/impersonate-user`. Como necesitamos forzar que se cree un registro de auditoría antes, vamos a interceptar esto exponiendo nuestras propias rutas (ej. `/api/support/impersonate/start`) y bloquearemos el uso directo de la ruta nativa de Better Auth desde el frontend. ¿Estás de acuerdo con este enfoque de "wrapper"?

## Open Questions

> [!WARNING]
> **Límites de cliente (Customer Boundaries):** ¿Debería el staff tener permisos para impersonar a cualquier usuario del sistema por defecto, o solo a los que tienen el rol `user`? 

## Proposed Changes

---

### Database Schema (Auditoría)

Añadiremos una nueva tabla para guardar los registros de auditoría de forma inmutable.

#### [MODIFY] [core.ts](file:///C:/Users/setga/.gemini/antigravity/scratch/gd-dashboard/src/db/schema/core.ts)
Añadir la tabla `impersonationAudits`:
- `id` (PK)
- `staffUserId` (FK a `user.id`)
- `targetUserId` (FK a `user.id`)
- `targetRestaurantId` (FK opcional a `restaurants.id`)
- `reason` (text, not null)
- `sourceIp` (text)
- `userAgent` (text)
- `impersonatedSessionId` (FK a `session.id`)
- `startedAt` (timestamp)
- `stoppedAt` (timestamp)

#### [NEW] `drizzle/core/0008_impersonation_audits.sql`
El script de migración que crea la tabla `impersonation_audits`.

---

### Server-Side API (Wrapper de Seguridad)

Crearemos un wrapper alrededor del plugin de Admin de Better Auth para forzar que la auditoría ocurra en la misma transacción lógica.

#### [NEW] `src/lib/support/impersonation.ts`
Lógica de dominio (helpers) para:
- Escribir en `impersonationAudits` (start/stop).
- Validar permisos del staff (`user.role === 'admin'`).
- Validar longitud/existencia del `reason`.

#### [NEW] `src/routes/api.support.impersonate.start.ts` y `stop.ts`
Rutas exclusivas para el frontend de soporte. Estas rutas:
1. Verifican el rol del solicitante.
2. Escriben el registro de auditoría en la DB.
3. Usan el cliente o instancia de servidor de Better Auth para crear (o detener) la sesión impersonada.

#### [MODIFY] [auth-server.ts](file:///C:/Users/setga/.gemini/antigravity/scratch/gd-dashboard/src/lib/auth-server.ts) (Posiblemente)
Si es necesario para inyectar un middleware o bloquear el endpoint nativo `/api/auth/admin/impersonate-user` si decidimos que nadie pueda llamarlo directamente sin pasar por nuestro wrapper.

---

### Frontend UI (Banner y Exit)

#### [NEW] `src/components/support/ImpersonationBanner.tsx`
Un banner visible y persistente (rojo/naranja) en la parte superior del dashboard que indique:
*"Estás actuando como [Usuario] (Soporte). [Botón: Finalizar Impersonation]"*

#### [MODIFY] Layout principal (ej. `src/routes/__root.tsx` o dashboard layout)
Inyectar el `ImpersonationBanner` si la sesión actual tiene `session.impersonatedBy`.

---

### Documentation

#### [NEW] `docs/managed-support-runbook.md` (o actualizar auth doc)
Documentar:
- Quién puede usar impersonation (solo rol `admin`).
- Qué debe incluirse en el campo `reason` (ej. ticket number).
- Retención de auditoría.
- Pasos de emergencia para desactivar la función.

## Verification Plan

### Automated Tests
- Ejecutaré unit tests para los helpers de dominio (`src/lib/support/impersonation.test.ts`):
  - Verifica que sin `reason` falla.
  - Verifica que un usuario no admin no puede impersonar.
  - Verifica la escritura del audit log al inicio y al final.

### Manual Verification
- En el browser local, iniciar sesión con el operador admin.
- Usar la interfaz para impersonar a un usuario de demo con una razón ("Fixing issue #123").
- Verificar que el `ImpersonationBanner` aparece.
- Clicar en "Finalizar" y verificar que el banner desaparece y volvemos a la sesión original.
- Comprobar en la DB que `stopped_at` se actualiza.
