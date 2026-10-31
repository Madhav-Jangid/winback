# Implementation Status

Updated: 2026-10-31

## Current phase

**Phase 6 — Sarvam localization: complete (gate passed).** Next up: Phase 7.

## Phase 6 — Sarvam localization

### Decisions

- **Direct REST calls**, like Phase 5. The request matches Sarvam's reference exactly (`input`, `source_language_code: en-IN`, `target_language_code`, `model`, `mode: formal`, `numerals_format: international`; key in `api-subscription-key`). It is the same call the `sarvamai` SDK makes; no dependency was added. `international` numerals keep offer digits verifiable (`native` would turn ₹45,000 into ४५,०००).
- **Models:** default `mayura:v1` (1000 characters), `SARVAM_MODEL` can select `sarvam-translate:v1` (2000). If the text exceeds the configured model's limit the larger model is used and recorded with the translation; over 2000 is rejected. All 11 campaign languages (English + 10) are supported by both models; one test asserts every `LANGUAGES` code has a Sarvam code.
- **The demo fallback does not translate.** Arbitrary text cannot be translated without a model, and canned sentences would not match the merchant's message or offer (the old demo translator returned an unrelated hard-coded Hindi sentence with a `{name}` placeholder). It returns the English text labelled `demo_fallback`, and unreviewed demo text blocks approval (`TRANSLATION_NEEDS_REVIEW`) until the merchant edits and saves it.
- **Provenance** is stored in `campaigns.translation_meta` (migration 003): source, model, language, the exact English text it was made from, edited flag, warnings, fallback reason. `translation_source` mirrors the source.
- **Stale detection** (`translationState`): a translation is trusted only while the English text and language match what it was made from. Changing either makes it `stale` and blocks approval. Saving the translated text confirms it against the current English (editing counts as review).
- **E-16 number check:** offer numbers must survive translation. Machine output that loses or invents numbers is saved, flagged, and blocks approval until edited and saved; native-script digits (Devanagari, Bengali, Gurmukhi, Gujarati, Odia, Tamil, Telugu, Kannada, Malayalam) are normalized.
- **Versioning:** a translation, and any edit of the localized text, is a material change: version bump, approval invalidated and audited. A save fails with `VERSION_CONFLICT` if the campaign changed while the provider was working.
- **No duplicate work:** with a current translation, a plain request returns it (`cached: true`) without calling Sarvam; replacing it needs `force: true`, and the UI asks first because it would discard edits.
- **Failure never substitutes text:** `502 TRANSLATION_FAILED` with `retry_available` and `fallback_available`; nothing is saved, the English is untouched. Provider messages and keys are never echoed; Sarvam error codes map to fixed hints.

### Acceptance criteria

- [x] Sarvam adapter behind the `Translator` interface; language and model configuration verified against current docs.
- [x] Side-by-side editor with provider badge, character counter, offer terms shown unchanged, retry, and labelled demo draft.
- [x] Localized text persisted against the campaign version; cannot bypass approval (stale/review/missing block readiness).
- [x] SA-01 to SA-05 pass, plus mocked timeout, HTTP-error, unsupported-language and too-long cases.

### Files

- New: `supabase/migrations/003_translation.sql`, `src/lib/localization/{rules,types,validate,service}.ts` (+ tests), `src/lib/providers/sarvam/languages.ts`, `src/lib/providers/sarvam/translator.test.ts`, `src/lib/providers/demo/translator.ts`, `src/components/campaigns/TranslationPanel.tsx`, `src/app/api/campaigns/[id]/translate/route.test.ts`, `src/test/integration/translation.test.ts`
- Rewritten: `src/lib/providers/sarvam/translator.ts`, `src/app/api/campaigns/[id]/translate/route.ts`, `src/lib/campaigns/readiness.ts`, `src/lib/repositories/campaigns.ts`
- Changed: `src/lib/campaigns/{schema,state,service,rules}.ts` (`localized_message` as a material field, `applyTranslation`, `translation_state`), `src/lib/providers/{factory,interfaces,demo/index}.ts`, `src/lib/env.ts` (`SARVAM_MODEL`), `src/types/index.ts`, campaign builder and pages, shared test fixtures, `.env.example`, `README.md`

### Verification (2026-10-31)

| Command | Result |
|---|---|
| `npm test` | PASS — 25 files, 266 tests (adapter tests use a fake `fetch`; 51 database integration tests on Supabase; the full run now takes about 5 minutes because of the remote database) |
| `npm run lint` / `typecheck` / `build` | PASS (0 errors, 0 warnings) |
| `npm run db:migrate` | Applied `003_translation.sql` to Supabase |
| **Real Sarvam calls** (`mayura:v1`, your key; English message and language only) | PASS — Hindi in 6 s and Tamil after switching language; "14 days" preserved in both; no warnings. A repeat request was served from the saved copy (`cached: true`, no second call). Switching language marked the old translation stale (`status` back to `draft`); a bad body returned `400 VALIDATION_ERROR` |
| Headless Edge screenshot | Side-by-side panel renders with the Sarvam badge, model, and offer terms |

Not exercised against the real API: timeouts, HTTP 4xx/5xx, quota errors (covered with a fake `fetch` only).

### Known issues

- The buttons in the translation panel (translate, replace confirmation, retry, demo draft) were not clicked through in a browser; the API and the rendered panel were verified.
- Sarvam's `formal` mode produced a fairly colloquial Tamil sentence ("மிஸ் பண்ணறோம்"). The merchant reviews every translation; tone modes are not exposed in the UI.
- `numerals_format` is fixed to `international`; native numerals are not offered.
- Translation needs a saved campaign; unsaved edits must be saved first.
- `effectiveMessage()` (what customers actually receive) exists but is not used until sending is rewritten.

## Phase 5 — Gemini planner and fallback (complete)

## Phase 5 — Gemini planner and fallback

### Decisions

- **Direct REST calls, no SDK.** The Gemini docs now mark `@google/generative-ai` deprecated (since 2025-11-30) and its replacement's call shapes could not be confirmed from the docs, so the adapter uses `fetch` against `generativelanguage.googleapis.com/v1beta` with the key in an `x-goog-api-key` header. `@google/generative-ai` was uninstalled. The old default `gemini-1.5-flash` is no longer listed; the default is **`gemini-3.5-flash-lite`** (docs checked 2026-10-31), configurable via `GEMINI_MODEL`.
- **The planner only suggests.** `POST /api/campaigns/:id/plan` changes nothing on the campaign except `plan_source` and `plan_rationale`. The merchant applies the message (and optionally an equal-or-cheaper offer) in the builder and saves, which is what versions it and invalidates approval. The old route's `planning`/`failed` statuses, which left campaigns stuck, are gone; `planning` is not used.
- **Fallback rules.** No key configured: the labelled demo planner runs automatically. Provider failure (timeout, HTTP error, blocked, invalid after one retry): `502 PLAN_PROVIDER_FAILED` with `fallback_available`, campaign untouched; the merchant chooses **Use demo draft** (`{ use_demo: true }`). Never silent.
- **Validation** (`src/lib/planner/validate.ts`): strict schema (null treated as missing, unknown top-level fields dropped, offer strict), offer type allowlist, cost per redemption ≤ budget and ≤ the configured offer's cost (E-13), message length for the channel, no placeholders/markup, no percentages or rupee amounts outside the offer, no urgency wording unless the offer has an expiry (E-16, E-30). One retry for an invalid answer, with the rejection reason given to the model (E-12).
- **Privacy** (AI-07): input is built through a strict whitelist schema (`planInputSchema`); tests check that no demo customer name, id, email or phone-like value appears in the input or in the HTTP request body. Goal text is truncated to 200 characters. Provider operations store only a hash of the input.
- **Errors never leak:** timeouts and HTTP failures report status only; keys and provider bodies are never included.

### Acceptance criteria

- [x] Provider interface with Gemini adapter, labelled demo planner, timeout handling.
- [x] Structured output validated server-side; malformed, unsupported, over-budget and overlong output rejected.
- [x] Works with a key and without one; fallback is labelled in the data (`source`, `fallback_reason`) and the UI.
- [x] Builder panel: draft, source badge and model, rationale, assumptions, warnings, apply message / apply message and offer, retry and demo-draft actions.
- [x] Planning is audited (`plan_generated`, `plan_failed`) and recorded in `provider_operations`.
- [x] AI-01 to AI-07 pass.

### Bug found and fixed (from Phase 4)

Postgres JSONB reorders object keys, and offers were compared with `JSON.stringify`, so a stored free-item offer with an expiry looked different from the same offer re-parsed. A name-only edit would have bumped the version and cancelled an approval; the planner would also have reported "offer changed". Comparisons now use `src/lib/stable-json.ts`. Regression tests at unit and database level.

### Files

- New: `src/lib/planner/{types,input,prompt,validate,service}.ts` (+ tests), `src/lib/providers/demo/planner.ts`, `src/lib/providers/{gemini/planner,factory}.test.ts`, `src/lib/repositories/planning.ts`, `src/lib/db/transaction.ts`, `src/lib/stable-json.ts` (+ test), `src/components/campaigns/PlanPanel.tsx`, `src/app/api/campaigns/[id]/plan/route.test.ts`, `src/test/fixtures/plan-input.ts`, `src/test/integration/planner.test.ts`
- Rewritten: `src/lib/providers/gemini/planner.ts`, `src/app/api/campaigns/[id]/plan/route.ts`
- Changed: `src/lib/providers/{factory,interfaces,demo/index}.ts`, `src/lib/campaigns/{segments,state,service}.ts` (aggregate rhythm in preview; stable comparison), `src/lib/http.ts` (optional body), `src/lib/audit/service.ts`, `src/lib/env.ts` (`GEMINI_MODEL`), `src/types/index.ts`, `src/components/campaigns/CampaignBuilder.tsx`, campaign page, `.env.example`, `README.md`, `package.json`

### Verification (2026-10-31)

| Command | Result |
|---|---|
| `npm test` | PASS — 20 files, 202 tests (adapter tests use a fake `fetch`; 38 database integration tests on Supabase) |
| `npm run lint` | PASS — 0 errors, 0 warnings |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| **Real Gemini call** (`gemini-3.5-flash-lite`, your key, aggregate data only) | PASS — HTTP 200 in about 11 s, valid plan, `source: gemini`, offer returned unchanged (`offer_changed: false` after the fix), message restates the 14-day expiry and nothing else |
| `use_demo: true` / invalid body / persisted plan | `demo_fallback` with reason / 400 `VALIDATION_ERROR` / "Last plan: Gemini" shown after reload |
| Headless Edge screenshot | Planner panel renders in the builder |

Not exercised against the real API: timeouts, HTTP 4xx/5xx and blocked prompts (covered with a fake `fetch` only).

### Known issues

- Planning in the browser (button, apply, retry, demo draft) was not clicked through; the panel's render and the API were verified.
- Planning needs a saved campaign; the create screen says so.
- A live Gemini call takes about 10–20 s; the button shows "Drafting…" meanwhile.

## Phase 4 — Campaign draft and validation (complete)

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

Phase 7 — Consent, eligibility, and approval: an approval summary screen (segment and treatment/control counts, offer and budget, English and localized copy with provider badges, channel, suppression counts by reason, cost assumptions, "Simulation only"); `POST /api/campaigns/:id/approve` rewritten on the campaign service to bind approval to the exact version (and a hash of every material field including `localized_message` and its provenance), require an empty readiness list, recompute eligibility server-side, and audit it; the same eligibility service reused by the send path. Tests EL-01 to EL-10 and CA-01 to CA-08. Use `effectiveMessage()` for what customers receive. The old `approve` and `simulate-send` routes are still the original rough versions.

## Phase overview

| Phase | Status |
|---|---|
| 0 — Repository reconnaissance and plan | Complete |
| 1 — Skeleton and developer workflow | Complete |
| 2 — Database and seeded demo dataset | Complete |
| 3 — Customers and risk detection | Complete |
| 4 — Campaign draft and validation | Complete |
| 5 — Gemini planner and fallback | Complete |
| 6 — Sarvam localization | Complete |
| 3–11 | Not started / existing artifacts unverified |
