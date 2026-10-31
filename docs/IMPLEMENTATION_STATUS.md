# Implementation Status

Updated: 2026-10-31

## Current phase

**Phase 4 — Campaign draft and validation: complete (gate passed).** Next up: Phase 5.

## Phase 4 — Campaign draft and validation

### Decisions

- **Offers are a typed union** (`src/lib/campaigns/schema.ts`): percentage (1–50%, optional cap), fixed amount (≤ ₹1,000), free item (name + cost to merchant, ≤ ₹1,000), or no offer; optional minimum order and expiry (1–90 days). Unknown fields are rejected. No expiry is shown unless configured.
- **Documented MVP limits** (`src/lib/campaigns/rules.ts`): message length SMS 320 / WhatsApp 1000 / Email 2000; budget ≤ ₹10 lakh; frequency cap 1–5; cooldown 1–180 days; control group 20%. Money is integer paise end to end; the form converts typed rupees without floating point.
- **Segments:** at-risk repeat customers; previously active but now overdue (at risk with 3+ completed purchases); all eligible customers. Exclusion counts reuse the customer service and the same eligibility check as sending, evaluated with the campaign's own cooldown and cap. The preview API returns counts only, never customer ids.
- **Status is decided by the server.** After every save the campaign is `ready_for_approval` if all readiness checks pass (non-empty segment, message present and within the channel limit, cost per redemption known and covered by the budget), else `draft`. Phase 5 adds the plan and Phase 6 the translation to these checks.
- **Versioning:** only material fields (segment, offer, budget, frequency cap, cooldown, language, channel, message) bump the version, and they invalidate an existing approval (audited as `approval_invalidated`). Name and goal are cosmetic. Updates require `expected_version`; a stale one returns `409 VERSION_CONFLICT`. Rows are locked with `SELECT … FOR UPDATE` and each change is written with its audit event in one transaction.
- **State machine** in `src/lib/campaigns/state.ts`. Editable: draft, ready_for_approval, approved. Cancel is allowed before sending (E-32) and is final.
- **Treatment/control split** in the preview is exact for saved campaigns (deterministic hash) and marked ≈ for unsaved drafts.
- **API errors** use one helper (`src/lib/http.ts`): typed codes, 413 for bodies over 32 KB, 400 for malformed JSON, and 503 without internal details for anything unexpected.

### Acceptance criteria

- [x] Campaign builder: basics, audience with live preview, offer, budget and frequency, language and simulated channel, message with character counter, readiness checklist, cost estimate.
- [x] Segment preview with eligible count and exclusions (no consent, opted out, insufficient history, frequency cap, other).
- [x] Merchant defaults (budget, cooldown, cap) prefilled and visible before approval.
- [x] Server-side validation on every mutating route; validation messages shown next to fields.
- [x] State machine with invalid-transition tests; empty-segment behaviour (E-17).
- [x] Gate: a campaign can be saved and reloaded as a valid draft.

### Files

- New: `src/lib/campaigns/{rules,schema,segments,state,readiness,service}.ts` (+ tests), `src/lib/repositories/campaigns.ts`, `src/lib/errors.ts`, `src/lib/http.ts`, `src/app/api/campaigns/[id]/cancel/route.ts`, `src/app/api/segments/[id]/preview/route.ts`, `src/app/api/campaigns/route.test.ts`, `src/components/campaigns/CampaignBuilder.tsx`, `src/app/(dashboard)/campaigns/{page,new/page,[id]/page}.tsx`, `src/test/fixtures/campaign.ts`, `src/test/helpers/demo-profiles.ts`, `src/test/integration/campaigns.test.ts`
- Changed: `src/app/api/campaigns/route.ts` and `[id]/route.ts` (rewritten), `src/lib/audit/service.ts` (optional db for transactions, `campaign_cancelled`), `src/lib/customers/service.ts` (policy override), `src/lib/repositories/merchants.ts` (default budget), `src/lib/experiments/assignment.ts` (shared control share), `src/types/index.ts` (`OfferConfig` = typed offer), seed snapshot shape, dashboard link, `src/test/helpers/test-db.ts` (fewer round trips), `.gitignore`

### Verification (2026-10-31)

| Command | Result |
|---|---|
| `npm test` | PASS — 13 files, 130 tests (29 database integration tests on Supabase) |
| `npm run lint` | PASS — 0 errors, 1 warning (Phase 5 file) |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| Live API on `next start` | create → 201 ready_for_approval, v1, 12 eligible, exact 8/4 split; invalid → 400 with field list; PATCH channel → v2; stale version → 409 VERSION_CONFLICT; 400-char SMS → draft + MESSAGE_TOO_LONG; cancel → cancelled; edit after cancel → 409 CAMPAIGN_LOCKED; preview hides customer ids |
| Pages | `/campaigns`, `/campaigns/new`, `/campaigns/[id]` render; headless Edge screenshot confirms live preview runs in the browser (19 match, 12 eligible, exclusions listed) |
| Cleanup | `npm run db:seed` restored the demo baseline afterwards |

### Known issues

- A stray "New draft" campaign had leaked into the real database from the earlier session-sharing test bug; removed by the reseed. The test helper no longer uses session state.
- The builder shows readiness and cost only once required fields are valid.
- Copying a locked campaign into a new draft is not implemented yet.
- The old plan/approve/send/translate/outcome routes are unchanged and are rewritten in Phases 5–9.

## Phase 3 — Customers and risk detection (complete)

## Phase 3 — Customers and risk detection

### Decisions

- **Risk and contactability are separate.** Risk status is purely purchase rhythm (`at_risk`, `healthy`, `insufficient_history`); `opted_out` was removed from `RiskStatus`. Whether a customer may be messaged comes from the existing eligibility service using the merchant's default frequency policy, with the same reason codes the send path will use (`CONSENT_UNKNOWN`, `OPTED_OUT`, `FREQUENCY_CAP`). An opted-out customer can be lapsing, and the UI now shows both.
- **Dashboard at-risk KPI** now counts every lapsing customer (19 in the seed) and shows how many can be contacted now (12). Previously it excluded opted-out customers silently.
- **Frequency caps use persisted campaign messages across all campaigns** (E-26); failed simulated sends don't count.
- **Pages are server components** that read through the service layer directly, wrapped in `<Suspense>` as Cache Components requires. Search is a `next/form` GET form; filters are links.
- **Supabase pooler behaves like transaction mode.** Concurrent connections were observed sharing one server session (same backend PID, shared `search_path`). The app relies on no session state, and transactions are safe. Integration tests now scope their schema with `SET LOCAL` inside per-statement transactions (`src/test/helpers/test-db.ts`).

### Acceptance criteria

- [x] Customer list with search and filters: at risk, healthy, not enough history, consented, opted out, no consent, recently messaged (frequency-capped).
- [x] Customer detail with purchase history (refunds/cancellations marked ignored), cadence, threshold, reason, contact status, reason code, simulated message history.
- [x] Every displayed classification is reproducible: unit tests check each seed scenario's expected status, and an integration test checks the same through the database.
- [x] RD-01 to RD-08 pass.
- [x] Customer API: validated input (typed 400), merchant-scoped lookups, 404 for malformed or unknown ids, 503 without leaking DB errors.

### Files

- New: `src/lib/customers/service.ts` (+ test), `src/lib/repositories/merchants.ts`, `src/lib/format.ts`, `src/components/customers/badges.tsx`, `src/components/ui/PageStates.tsx`, `src/components/ui/SidebarNav.tsx`, `src/app/(dashboard)/customers/page.tsx`, `src/app/(dashboard)/customers/[id]/page.tsx`, `src/lib/risk/engine.test.ts`, `src/app/api/customers/route.test.ts`, `src/test/helpers/test-db.ts`, `src/test/integration/customers.test.ts`
- Changed: `src/lib/repositories/customers.ts` (single-customer lookup, message stats), `src/lib/repositories/dashboard.ts`, both customer API routes (rewritten), `src/components/ui/Sidebar.tsx` (active link in Suspense), `src/lib/eligibility/service.ts` (locale-independent date), `src/types/index.ts`, dashboard page, `src/test/integration/database.test.ts`, `src/lib/db/config.ts` (pooler note)

### Verification (2026-10-31)

| Command | Result |
|---|---|
| `npm test` | PASS — 7 files, 53 tests (17 database integration tests on Supabase) |
| `npm run lint` | PASS — 0 errors, 2 warnings (later-phase files) |
| `npm run typecheck` | PASS |
| `npm run build` | PASS — `/customers` and `/customers/[id]` partially prerendered |
| `next start` + `/customers` | 200, 31 rows; chips: All 31, At risk 19, Healthy 10, Not enough history 2, Consented 26, Opted out 2, No consent 3, Recently messaged 2 |
| `?filter=frequency_capped` / `?search=nair` / `?filter=bogus` | Karan + Divya / Deepa + Ganesh / falls back to all 31 |
| `/customers/<Harish>` and `/customers/<Karan>` | reason, threshold, refund marked ignored / `FREQUENCY_CAP` + historical message |
| `/api/customers?filter=bogus` | 400 `VALIDATION_ERROR` |
| `/api/dashboard` | at_risk 19, contactable 12 |
| Pooler session check after tests | all sessions on default `search_path` |

### Known issues

- An unknown customer URL renders the not-found page with HTTP 200, because the page streams and the status is sent before the lookup. The API returns a real 404.
- Dates use the merchant time zone for display; cadence uses exact elapsed time (fractional days), not calendar days.

## Phase 2 — Database and seeded demo dataset (complete) The repository already contains pieces from later phases, which are preserved; their end-to-end completeness has not been audited yet.

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

Phase 5 — Gemini planner and fallback: provider interface, structured output schema validated with the Phase 4 offer schema and limits, Gemini adapter with timeout, labelled demo fallback, aggregate-only planner input (no customer PII). Tests AI-01 to AI-07. Rewrite `api/campaigns/[id]/plan` on the campaign service so plans go through `updateCampaign` (versioning, readiness, audit).

## Phase overview

| Phase | Status |
|---|---|
| 0 — Repository reconnaissance and plan | Complete |
| 1 — Skeleton and developer workflow | Complete |
| 2 — Database and seeded demo dataset | Complete |
| 3 — Customers and risk detection | Complete |
| 4 — Campaign draft and validation | Complete |
| 3–11 | Not started / existing artifacts unverified |
