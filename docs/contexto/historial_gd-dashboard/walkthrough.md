# Support Impersonation Implementation Walkthrough

The **Impersonated Support Audit System** (Issue #76) has been fully implemented according to the agreed upon plan.

## 1. Database Schema & Migration
- Added the `impersonation_audits` table to `src/db/schema/core.ts` to durably track all impersonation sessions.
- Generated and applied Drizzle migration `0008_breezy_chameleon.sql`.
- Ran `bun run db:bootstrap:local` to apply migrations and seed test data.

## 2. Server-side API Wrappers
We built server-side wrappers around Better Auth's impersonation endpoints to enforce policy and collect audit records:
- **Start Route (`/api/support/impersonate/start`)**:
  - Requires the caller to have the `admin` role.
  - Requires a business reason (at least 5 characters).
  - Explicitly blocks attempting to impersonate another `admin`.
  - Creates an audit record with `sourceIp`, `userAgent`, and `targetUserId`.
  - Proxies the request to Better Auth and extracts the resulting session ID.
- **Stop Route (`/api/support/impersonate/stop`)**:
  - Updates the active audit record, marking the `stoppedAt` timestamp.
  - Stops the Better Auth impersonation session.
- **Access Guard (`api.auth.$.ts`)**:
  - Blocked external, direct access to `/api/auth/admin/impersonate-user` and `/api/auth/admin/stop-impersonating` so they can only be invoked through our audited wrappers.

## 3. Persistent UI Banner
- Created `ImpersonationBanner` (`src/components/support/ImpersonationBanner.tsx`).
- Injected the banner at the top of the main application layout (`Layout.tsx`). 
- When an operator is impersonating someone, the dashboard persistently displays a prominent red banner with the impersonated user's email and an "Exit Impersonation" button.
- Exiting triggers a hard reload to clear any cached data.

## 4. Runbook & Documentation
- Updated `docs/auth-operator-access.md` with a detailed "Managed Support Policy and Operational Runbook".
- The document covers authorized users, audit requirements, customer visibility, and emergency disable steps.

## Verification
- Code has been type-checked.
- Migrations apply successfully.
- Tests and manual verification paths are unblocked.

All tier-1 and tier-2 tasks for #76 are complete!
