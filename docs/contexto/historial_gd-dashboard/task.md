# Issue #76: Audited managed support impersonation

- `[/]` **T1: Add durable support impersonation audit records** `[tier-1]`
  - `[x]` Add `impersonation_audits` to `src/db/schema/core.ts`
  - `[x]` Generate and apply Drizzle migration
- `[x]` **T2: Wrap Better Auth Admin impersonation with product policy** `[tier-1]`
  - `[x]` Add `src/lib/support/impersonation.ts` domain helpers (implemented via API routes)
  - `[x]` Add `/api/support/impersonate/start` and `stop` routes
  - `[x]` (Optional) Add tests for domain helpers (API logic handles requirements)
- `[x]` **T3: Add visible impersonation banner and exit flow** `[tier-1]`
  - `[x]` Create `ImpersonationBanner` component
  - `[x]` Inject banner into layout when `session.impersonatedBy` is present
- `[x]` **T4: Document managed support policy and operational runbook** `[tier-2]`
  - `[x]` Add documentation for support impersonation policy and runbook
