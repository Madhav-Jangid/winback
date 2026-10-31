# Implementation Status

Updated: 2026-10-31

## Current phase

**Phase 2 — Database and seeded demo dataset: complete (gate passed).** Next up: Phase 3. The repository already contains pieces from later phases, which are preserved; their end-to-end completeness has not been audited yet.

## Phase 2 — Database and seeded demo dataset

### Decisions

- **Database:** hosted Supabase Postgres 17 (project region eu-north-1), reached through the Session pooler. The direct host is IPv6-only and unreachable from the dev network.
- **Access model:** the server connects as the table owner. RLS is enabled with no policies on every table and API-role grants are revoked, so the publishable key cannot reach app data through Supabase's REST API. Verified: REST returns `42501 permission denied` for customers, purchases, and merchants.
- **Authentication:** not added. The PRD allows a single-merchant demo without auth if labelled. Supabase Auth can be added later (Phase 10 or P1) by mapping `auth.users` to merchants; the env placeholders are reserved.
- **Demo clock:** in demo mode "now" is fixed at 2026-10-01 (`src/lib/clock.ts`), and seed dates are relative to it (PRD E-29). The dashboard shows this date.
- **Seed:** one module (`src/lib/demo/seed.ts`) is used by `npm run db:seed` and `POST /api/demo/reset`. It runs in one transaction under an advisory lock and deletes by merchant (cascading). The previous duplicate `supabase/seed.ts` was removed; its data mislabelled several healthy customers as at-risk.

### Acceptance criteria

- [x] Schema migrations with a tracked runner (`npm run db:migrate`).
- [x] Repository layer (`src/lib/repositories/`) reading through a `Queryable` interface so it is testable.
- [x] Deterministic, repeatable, transactional seed/reset.
- [x] Constraint, foreign key, unique, and RLS integration tests.
- [x] Dashboard reads seeded data from the database, with the at-risk KPI computed by the risk engine (previously hard-coded to 0).

### Files

- New: `supabase/migrations/002_rls_and_constraints.sql`, `scripts/db-migrate.ts`, `scripts/db-seed.ts`, `src/lib/clock.ts`, `src/lib/db/{config,migrate,types}.ts`, `src/lib/demo/{constants,seed-data,seed}.ts`, `src/lib/demo/seed-data.test.ts`, `src/lib/repositories/{customers,dashboard}.ts`, `src/test/integration/database.test.ts`
- Changed: `src/lib/db/pool.ts` (shared config, SSL for Supabase), `src/app/api/dashboard/route.ts`, `src/app/api/demo/reset/route.ts` (DEMO_MODE-gated), `src/app/api/customers/route.ts` (demo clock), all campaign/audit routes (shared `DEMO_MERCHANT_ID`), `src/app/(dashboard)/page.tsx` (merchant name + demo date), `vitest.config.mts` (`@` alias, timeouts), `package.json` (db scripts, `tsx`), `.env.example`, `README.md`
- Removed: `supabase/seed.ts`

### Verification (2026-10-31)

| Command | Result |
|---|---|
| `npm test` | PASS — 3 files, 18 tests (9 database integration tests against Supabase in a temporary schema) |
| `npm run lint` | PASS — 0 errors, 2 warnings (later-phase files) |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm run db:setup` | Applied 001 + 002; seeded 31 customers, 81 purchases, 1 historical campaign, 2 messages. Re-running migrate: "up to date". |
| `next start` + `GET /api/dashboard` | 200: 31 customers, 17 at risk, merchant name, as_of 2026-10-01 |
| `next start` + `POST /api/demo/reset` | 200: 31 customers, 81 purchases |
| `next start` + `GET /api/customers?filter=at_risk` | 17 (matches the dashboard) |
| Supabase REST with publishable key | `42501 permission denied` on app tables |

Tests covered: DM-01, DM-02, DM-03, FK/check/unique constraints, RLS, failed-reset rollback, seed scenarios vs risk engine.

### Known issues

- The dashboard's "Est. Incremental Revenue" still sums gross treatment revenue. Phase 9 must replace it with treatment-minus-control (PRD FR-11).
- Supabase SSL does not verify the server certificate.

## Phase 1 — Skeleton and developer workflow (complete)

### Phase 1 acceptance criteria

- [x] Existing Next.js 16 + TypeScript + Tailwind stack retained.
- [x] Winback dashboard is the single root route; starter-template route removed.
- [x] Server environment configuration has typed validation and safe defaults for demo startup.
- [x] Route and global error boundaries provide recovery actions.
- [x] lint, typecheck, and test scripts are present.
- [x] Environment validation test, lint, typecheck, production build, and local HTTP smoke check pass.
- [x] Clean local startup instructions documented (README).

### Files changed for Phase 1

- `package.json`, `README.md`, `vitest.config.mts` (renamed from `.ts` to silence Vite's ESM/CJS config warning), `.gitignore` (keep `.env.example` tracked)
- `src/lib/env.ts`, `src/lib/env.test.ts`, `src/lib/db/pool.ts`, `src/lib/providers/factory.ts`
- `src/app/page.tsx` (removed duplicate starter route), `src/app/error.tsx`, `src/app/global-error.tsx`, `src/app/globals.css`
- `src/app/(dashboard)/page.tsx` (use `router.push` instead of `window.location.href`)
- `src/app/api/{dashboard,customers,campaigns,audit}/route.ts`: call `await connection()` before the `try` block so Cache Components does not try to prerender these GET handlers at build time (previously the handlers' `catch` swallowed and logged Next's prerender bail-out).

### Verification (2026-10-31, run locally on Windows, Node via npm)

| Command | Result |
|---|---|
| `npm test` | PASS — 1 file, 4 tests |
| `npm run lint` | PASS — 0 errors, 3 warnings (unused vars in later-phase files, see below) |
| `npm run typecheck` | PASS — no errors |
| `npm run build` | PASS — clean, no prerender errors |
| `next start` + `GET /` | 200, page contains "Winback AI" and "Demo Mode" |
| `next start` + `GET /api/dashboard` (no `DATABASE_URL`) | 503 with typed `DATABASE_ERROR` body — expected until Phase 2 |

### Known issues / limitations

- Database-backed flows require PostgreSQL. The Phase 2 schema and seed exist, but complete database setup/seed behavior has not been verified here.
- Lint warnings left for their phases: unused `offerConfig` in `api/campaigns/[id]/plan/route.ts` (Phase 5), unused `withTransaction` import in `api/campaigns/[id]/route.ts` (Phase 4).
- Git repository on `main`, pushed to https://github.com/Madhav-Jangid/winback.

## Next task

Phase 3 — Customers and risk detection: customer list and detail UI, purchase history, risk reasons, filters (including frequency-capped), RD-01 to RD-08 tests, and customer API tests. Move the customer routes onto `src/lib/repositories/customers.ts`.

## Phase overview

| Phase | Status |
|---|---|
| 0 — Repository reconnaissance and plan | Complete |
| 1 — Skeleton and developer workflow | Complete |
| 2 — Database and seeded demo dataset | Complete |
| 3–11 | Not started / existing artifacts unverified |
