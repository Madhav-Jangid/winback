# Winback AI — Product Requirements Document (PRD)

**Version:** 1.0  
**Status:** Implementation-ready MVP specification  
**Product:** Winback AI  
**Hackathon:** Paytm AI Hackathon, Track 3 — AI Teammates  
**Team:** Chaos Architects  
**Primary build tools:** Claude Code or Google Antigravity  
**Document purpose:** Single source of truth for implementation, automated testing, and manual acceptance testing.

---

## 1. Executive summary

Winback AI is an AI retention teammate for businesses with repeat customers. It detects customers whose purchasing activity is overdue relative to their own normal buying rhythm, proposes a targeted winback campaign, asks the merchant to approve it, simulates sending the campaign through consented channels, and measures outcomes against a control group.

The MVP adds **regional-language campaign localization using Sarvam AI**. Gemini is the campaign planner and reasoning layer; Sarvam is used to translate approved campaign copy and, optionally, generate an audio preview. The backend—not either model—enforces eligibility, consent, offer rules, approval, budget, frequency limits, and audit history.

The MVP must run end-to-end with seeded/simulated transaction data and simulated messaging. It must not require live POS, payment, CRM, WhatsApp, SMS, or email credentials.

### One-line value proposition

**Win back customers with relevant, locally understandable offers, then measure whether those offers actually caused additional visits or purchases.**

## 2. Source-of-truth constraints

The hackathon proposal establishes these product requirements:

- Detect customers overdue relative to their usual purchase rhythm.
- Segment customers and plan a message/offer within merchant-defined rules.
- Require merchant approval before campaign sending.
- Use consented channels and honor opt-out.
- Apply budget caps and frequency limits.
- Maintain an audit log.
- Measure incremental outcomes against a control group.
- Use simulated transaction data and simulated messaging in the prototype.
- Proposed stack: Next.js, TypeScript, Tailwind CSS, Gemini API, Node.js, PostgreSQL/Supabase, scheduled jobs, and integrations abstraction.
- Pilot KPIs: reactivation rate, incremental revenue, cost per reactivated customer, and unsubscribe rate.
- Sarvam is an additional localization capability: translate campaign messages and optionally generate audio previews.

Production integrations and production-level causal claims are explicitly outside the MVP.

## 3. Goals and non-goals

### 3.1 Goals

1. A merchant can open the app and understand which customers appear to be lapsing.
2. The app can detect lapsed customers using transparent, testable rules based on purchase history.
3. The merchant can create a campaign from a segment and configure an offer within guardrails.
4. Gemini can draft a campaign plan and message, but cannot directly send anything or override backend rules.
5. Sarvam can translate the campaign message into a supported language; a merchant can inspect and edit the translation.
6. No campaign can be sent until the merchant approves the exact campaign version.
7. The app can simulate delivery and customer outcomes deterministically enough to test.
8. The app can compare an eligible treatment group with a control group and report the method and limitations.
9. Automated tests and a repeatable manual test plan verify the complete workflow.
10. The application can be started locally from documented setup instructions.

### 3.2 Non-goals for MVP

- Real WhatsApp, SMS, email, phone-call, POS, payment, or CRM delivery/integration.
- Real customer PII or live merchant data.
- Automatic campaign sending without merchant approval.
- Autonomous discount creation beyond merchant-configured rules.
- Training or fine-tuning a model.
- A multi-agent framework or complicated agent memory.
- Production-grade billing, subscriptions, performance fees, or white-label licensing.
- Claims that a small demo sample proves statistically significant causal lift.
- Full voice conversations with customers.
- Complex multi-tenant enterprise administration.
- Automatic production deployment.

### 3.3 Success criteria

The MVP is accepted when all are true:

- A clean setup can run the app and migrations/seed data using the README.
- A seeded demo merchant can complete the end-to-end flow without external business integrations.
- The app can run in demo mode when AI credentials are missing or a provider fails, while clearly labelling fallback output.
- No send action is possible without approval of the current campaign version.
- Ineligible, opted-out, over-frequency, or over-budget customers cannot be sent a campaign.
- Treatment/control assignment is stable for a given campaign and customer.
- Dashboard metrics reconcile with the underlying simulated events.
- Automated tests pass and all P0 manual tests pass.
- The app displays clear errors and recovery instructions rather than silently losing work.

## 4. Target users and personas

### Persona A: Small-business owner / merchant

Owns a café, salon, local retailer, clinic, or D2C store. Has repeat customers but no dedicated lifecycle marketing team. Wants to know who is drifting away and launch a sensible offer without learning a complex marketing platform.

**Needs:** understandable customer list, simple campaign setup, control over discounts, approval before send, easy-to-understand results.

### Persona B: Store manager / campaign operator

Runs the day-to-day campaign workflow for a merchant.

**Needs:** reliable eligibility checks, previews, language choice, approval queue, clear campaign status, suppression reasons, audit history.

### Persona C: Hackathon evaluator

Needs to see the complete product working with realistic demo data.

**Needs:** guided demo path, visible AI planning, regional-language output, approval gate, simulated sending, treatment/control measurement, and transparent limitations.

For the MVP, use a single seeded demo workspace. Authentication can be implemented if it does not threaten the core workflow; otherwise clearly mark the local demo as a non-production single-merchant environment. Never pretend the demo has production-grade access control.

## 5. Product principles

1. **Action over advice:** the app carries the merchant from detection through measurement.
2. **Human approval before action:** the merchant approves the exact campaign configuration and copy.
3. **Rules over model output:** backend validation is authoritative.
4. **No unsupported claims:** simulated outcomes are labelled simulated; causal lift is an estimate.
5. **Localization is reviewable:** translated copy is visible and editable before approval.
6. **Safe failure:** provider outages must not bypass approval or validation.
7. **Explainability:** show why a customer is flagged and why a customer is suppressed.
8. **Incremental delivery:** build a working deterministic workflow before integrating external AI.

## 6. Scope and priority

### P0 — Required for a complete MVP

- Dashboard with seeded demo data and KPIs.
- Customer list and customer details.
- Transparent lapsed-customer detection.
- Segment creation / selection.
- Campaign creation with merchant-configured offer constraints.
- Gemini campaign-plan generation behind a provider interface, with deterministic fallback.
- Sarvam translation behind a provider interface, with explicit fallback status.
- Merchant review and approval of a campaign version.
- Consent, opt-out, budget, frequency, and eligibility checks enforced by backend.
- Simulated send job and delivery events.
- Stable treatment/control assignment.
- Simulated purchase/return outcomes.
- Results dashboard with transparent formulas and caveats.
- Audit log.
- Automated tests, manual test cases, seed script, and setup documentation.

### P1 — Include if P0 is stable

- Sarvam text-to-speech audio preview for the approved/localized message.
- CSV import for synthetic or user-provided non-sensitive demo data, with validation and preview.
- Better campaign comparison and filters.
- Basic merchant settings screen for frequency/budget defaults.

### P2 — Explicitly defer

- Real messaging delivery.
- Real POS/CRM/payment integrations.
- Automated calls or conversational voice agents.
- Autonomous campaign scheduling and sending.
- Billing and subscriptions.
- Multi-user roles and complex tenant isolation.
- Production-scale analytics or statistical experimentation infrastructure.

## 7. User journeys and flows

### 7.1 First-time demo flow

1. User opens the app.
2. App shows the seeded demo workspace and states that data is simulated.
3. User sees dashboard KPIs and a “Find at-risk customers” entry point.
4. User opens Customers and filters by “At risk”.
5. User opens a customer and sees recent purchases, expected return window, last purchase, and the rule that triggered the risk flag.
6. User starts a campaign for the selected segment.
7. User sets campaign goal, offer, budget cap, frequency limit, message language, and channels (simulation only).
8. User asks Gemini to draft the campaign plan.
9. App validates the proposed offer against merchant rules and shows the plan and copy.
10. User localizes copy with Sarvam and reviews the original and translated text side by side.
11. User previews treatment and control counts, estimated offer cost, and suppressed-customer counts.
12. User approves the exact campaign version.
13. User clicks “Simulate send”.
14. Backend revalidates campaign state, approved version, consent, opt-outs, eligibility, frequency, and budget.
15. App creates simulated delivery events only for eligible treatment customers. Control customers receive no campaign.
16. User runs “Simulate outcomes” or waits for the demo outcome job.
17. App shows treatment/control return rates, incremental return-rate estimate, estimated incremental revenue, cost per reactivated customer, and caveats.
18. User can inspect audit events and individual send/suppression records.

### 7.2 Campaign state machine

Allowed states:

- `draft`: editable; no send allowed.
- `planning`: optional transient state while generating a plan.
- `ready_for_approval`: plan and message pass validation.
- `approved`: merchant approved a specific immutable campaign version.
- `sending`: simulation job is processing recipients.
- `sent`: all intended recipients have a terminal simulated send outcome.
- `measuring`: outcome simulation is running.
- `completed`: results are calculated.
- `cancelled`: merchant cancelled before sending.
- `failed`: a workflow step failed; safe retry may be offered.

Rules:

- Editing campaign-critical fields after approval invalidates approval and returns campaign to `ready_for_approval` or `draft`.
- Approval records `approved_by`, `approved_at`, and `approved_version`.
- Send is allowed only when `status=approved` and `approved_version=current_version`.
- A send operation must be idempotent. Repeated clicks must not duplicate sends.
- A campaign cannot be edited once sending starts. Copy it to create a new campaign.
- Control-group customers must never receive campaign messages.
- A failed provider call may be retried, but retry must not duplicate already-created translations or simulated sends.

### 7.3 Main flow in compact form

```text
Dashboard
  -> Customers / At-risk segment
  -> Create campaign
  -> Configure goal, offer, budget, frequency, language
  -> Generate plan (Gemini or labelled demo fallback)
  -> Validate rules
  -> Translate message (Sarvam or labelled fallback)
  -> Preview + suppression summary
  -> Merchant approves exact version
  -> Simulate send (backend revalidates)
  -> Simulate customer outcomes
  -> Results + audit log
```

### 7.4 Failure and recovery flow

- If Gemini is unavailable: show provider error and offer “Use demo draft”; label it as fallback.
- If Sarvam is unavailable: retain the original language, show translation failure, and allow retry or manual copy entry. Never label fallback text as Sarvam-generated.
- If validation fails: show each rule violation and keep the campaign unsendable.
- If a campaign changes after approval: invalidate approval and require reapproval.
- If a simulated job partially fails: persist per-recipient outcomes and retry only unresolved records.
- If no customers qualify: show why and offer the next safe step; do not invent recipients.
- If a metric has no denominator: show “Not enough data” instead of dividing by zero.

## 8. Functional requirements

### FR-01: Dashboard

**Must display:**
- Total customers in the seeded dataset.
- Number currently classified as at risk.
- Draft/awaiting-approval campaigns.
- Completed campaigns.
- Simulated reactivations and estimated incremental revenue, clearly labelled as demo estimates.
- Recent campaign activity.
- A visible “Demo data” indicator.

**Acceptance criteria:**
- KPIs are calculated from persisted data/events, not hard-coded UI numbers.
- Empty and loading states are designed.
- Values update after a campaign completes.
- Clicking a KPI opens a relevant filtered view where practical.

### FR-02: Customer management

Customer fields:
- `id`
- `merchant_id`
- `display_name` (synthetic in demo)
- `preferred_language`
- `consent_status`
- `opted_out_at` (nullable)
- `created_at`
- `updated_at`

Purchase fields:
- `id`
- `merchant_id`
- `customer_id`
- `occurred_at`
- `amount_minor` (integer minor currency units, e.g. paise)
- `currency`
- `status` (`completed`, `refunded`, `cancelled`)
- `source` (demo/POS import)

**Acceptance criteria:**
- Customers can be searched and filtered.
- Customer detail shows purchase history and current eligibility.
- Refunded/cancelled purchases do not count as completed purchase events for cadence or revenue unless explicitly included in a separate refund metric.
- No real PII is required for the demo.

### FR-03: Lapsed-customer detection

Implement a deterministic, explainable baseline before using AI.

Suggested MVP rule:
1. Consider only completed purchases.
2. Require at least 2 completed purchases to estimate a customer's cadence.
3. Calculate intervals in days between consecutive completed purchases.
4. Use the median interval as the typical cadence.
5. Mark customer “at risk” when `days_since_last_purchase >= median_interval * risk_multiplier`, with a configurable default multiplier of `1.5`.
6. Apply a configurable minimum days since last purchase (default 14) to avoid flagging very frequent buyers after a tiny delay.
7. Exclude opted-out customers from campaign eligibility, but they may remain visible in analytics with a clear suppression label.
8. Customers with insufficient history receive “Insufficient history”, not an invented risk score.

The exact rule is a configurable MVP heuristic, not a claim of predictive churn accuracy.

**Acceptance criteria:**
- UI explains the last purchase date, median cadence, threshold, and reason for the status.
- Tests cover insufficient history, boundary dates, duplicate timestamps, refunds, and customers who are not overdue.
- Use a consistent injected/current clock in tests; do not make tests depend on real time.

### FR-04: Segment selection

Provide at least:
- `At-risk repeat customers`
- `All eligible customers`
- `Previously active but now overdue`
- `Manual selection` (optional P1)

Show total segment size and counts excluded for:
- no consent,
- opted out,
- insufficient history,
- frequency cap,
- other eligibility/rule reasons.

A segment preview must not reveal a customer as sendable if backend validation will reject them.

### FR-05: Campaign configuration

Campaign fields:
- `id`, `merchant_id`, `name`, `goal`
- `segment_definition` or stored segment snapshot
- `offer_type` (e.g. percentage discount, fixed discount, free item, no offer)
- `offer_value` and/or `offer_description`
- `minimum_order_value_minor` (optional)
- `max_discount_minor` (optional)
- `total_budget_minor`
- `max_messages_per_customer_in_window`
- `cooldown_days`
- `language`
- `channel` (simulation values: WhatsApp, SMS, email)
- `original_message`
- `localized_message`
- `status`, `version`
- timestamps and approval metadata.

**Acceptance criteria:**
- Merchant can edit campaign settings while draft.
- Offer values must be numeric and within configured bounds.
- Currency is explicit; use integer minor units for arithmetic.
- Message has a maximum length per simulated channel; enforce a documented MVP limit.
- Budget and frequency defaults are visible before approval.
- A campaign preview shows offer terms and any expiry date. Do not fabricate urgency or expiry if none is configured.

### FR-06: Gemini campaign planner

Use Gemini behind a typed provider interface. The model should return structured JSON matching a schema, not unvalidated free-form instructions.

Input:
- merchant type and neutral brand description,
- goal,
- segment summary (aggregate counts and cadence, not unnecessary personal data),
- allowed offer types and bounds,
- campaign budget,
- channel and language,
- required safety constraints.

Expected output:
- campaign rationale,
- target segment description,
- suggested offer chosen only from allowed options,
- message draft,
- suggested experiment duration,
- assumptions and warnings.

Rules:
- The model cannot choose customers directly; backend eligibility logic does.
- The model cannot send messages, edit consent, change budget caps, or approve campaigns.
- Reject malformed JSON, unknown offer types, invalid values, missing fields, and overlong copy.
- Validate every suggestion server-side.
- Use a deterministic demo fallback if the provider is missing or errors; show a badge explaining the fallback.
- Do not send raw customer names, phone numbers, emails, or detailed purchase histories to the LLM. Send aggregate or minimized context.

### FR-07: Sarvam localization

Use Sarvam behind a separate typed provider interface.

P0 behavior:
- Merchant chooses a supported target language.
- App submits only the campaign message and required language metadata to Sarvam.
- App displays source and translated text side by side.
- Merchant can edit the translation.
- Translation is saved against the campaign version.
- Translation failure is visible, retryable, and never silently substituted.
- Translation does not alter offer value, eligibility, terms, or consent.
- Merchant must approve the final localized text as part of the campaign version.

P1 behavior:
- Generate an audio preview from the final approved/localized text using Sarvam text-to-speech.
- Audio generation is preview-only. It does not trigger a phone call or send audio to customers.
- Show generated audio's language/model status and provide a play control.
- If TTS is unavailable, the rest of the campaign remains usable.

Language availability depends on Sarvam's current API/model support. Implement the language list as configuration and verify it against current provider documentation during setup. Never promise a language the selected model does not support.

### FR-08: Consent and suppression

Consent status must be explicit: `unknown`, `consented`, `revoked`.

Send eligibility requires:
- consent is `consented`,
- `opted_out_at` is null,
- customer meets segment eligibility,
- customer has not exceeded the frequency cap/cooldown,
- campaign budget permits the send,
- customer is not assigned to the control group,
- campaign is approved at the current version.

Default-safe behavior:
- `unknown` means do not send.
- `revoked` means do not send.
- Opt-out immediately suppresses future simulated sends.
- A control-group customer must never be sent a campaign even if all other checks pass.

Every suppression should have a stable reason code, e.g. `CONSENT_UNKNOWN`, `OPTED_OUT`, `CONTROL_GROUP`, `FREQUENCY_CAP`, `BUDGET_EXCEEDED`, `NOT_ELIGIBLE`.

### FR-09: Merchant approval

Approval screen must show:
- segment and recipient counts,
- treatment/control split,
- offer and budget,
- original and localized copy,
- selected language and simulated channel,
- suppression counts and reasons,
- expected cost assumptions,
- explicit “Simulation only” label.

On approval:
- persist approver identity or `demo-merchant` identity,
- persist timestamp,
- persist exact campaign version/hash approved,
- write audit event.

Editing any material field invalidates approval.

### FR-10: Simulated sending

- No external messages are sent.
- Simulated send is a backend job/operation.
- Revalidate approval, version, consent, opt-out, frequency, budget, eligibility, and treatment/control assignment immediately before creating send events.
- Persist one terminal send record per intended treatment recipient.
- Use idempotency keys / unique constraints to prevent duplicate sends.
- Simulate delivery states such as `queued`, `delivered`, `failed`; avoid claiming these are real provider delivery receipts.
- Show failed and suppressed recipients separately.
- Never send to control group.
- Retrying a job processes only unresolved records.

### FR-11: Simulated outcomes and measurement

For a campaign, persist a stable assignment of eligible customers into:
- treatment group, intended to receive the campaign,
- control group, which receives no campaign.

Use a deterministic hash of `(campaign_id, customer_id, experiment_salt)` or persist the random assignment at first creation. Do not recompute assignments on every page load. The assignment should be reproducible in tests.

Simulated return outcomes must be generated by a seeded deterministic mechanism. Clearly label them as simulated.

Required metrics:
- **Treatment reactivation rate** = reactivated treatment customers / treatment customers eligible for measurement.
- **Control reactivation rate** = reactivated control customers / control customers eligible for measurement.
- **Estimated incremental reactivation rate** = treatment rate − control rate.
- **Estimated incremental reactivations** = estimated incremental reactivation rate × treatment population. Display that this may be fractional as an estimate, or round only for a clearly labelled presentation value.
- **Estimated incremental revenue** = estimated incremental reactivations × configured average order value, or use a documented per-customer outcome simulation. Avoid double-counting all treatment revenue as incremental.
- **Campaign cost** = simulated delivered offer cost + any configured campaign cost. State assumptions.
- **Cost per reactivated customer** = campaign cost / treatment reactivations; if zero, show “No reactivations” / N/A.
- **Unsubscribe rate** = unsubscribes / delivered treatment messages; in simulation this is a simulated event and must be labelled.

Method caveats:
- Small samples are directional only.
- A randomized control group supports a comparison, but the demo's simulated outcomes do not prove real-world impact.
- Display group counts and denominators with every rate.
- Never show a rate for a zero denominator.
- Do not label gross revenue as incremental revenue.
- State when outcome data is insufficient.

### FR-12: Audit log

Record meaningful events:
- campaign created/edited,
- plan generated and whether provider or fallback was used,
- translation requested/completed/failed,
- approval granted/invalidated,
- send simulation started/completed/failed,
- recipient sent/delivered/failed/suppressed,
- opt-out event,
- outcome simulation and measurement completed.

Audit record fields:
- `id`, `merchant_id`, `campaign_id` nullable,
- `actor_type`, `actor_id`,
- `event_type`,
- `entity_type`, `entity_id`,
- `metadata` with no secrets or unnecessary PII,
- `created_at`.

Audit history is append-only from the UI. Do not expose API keys or raw provider error payloads containing secrets.

### FR-13: Demo data and reset

- Seed a coherent merchant, customers, purchases, campaign examples, consent states, and historical events.
- Include enough varied data to demonstrate at-risk, healthy, insufficient-history, opted-out, no-consent, and frequency-capped cases.
- Provide a clearly labelled “Reset demo data” action in development/demo mode.
- Reset must be transactional or safely repeatable and must not leave orphaned assignments/events.
- Seeded dates should be relative to a fixed seed date or generated consistently so the demo does not decay into an empty/incorrect state over time.

## 9. Data model (suggested)

Use PostgreSQL/Supabase migrations. Exact schema can change if the implementation preserves behavior and constraints.

### Tables

**merchants**
- `id UUID PK`
- `name TEXT`
- `business_type TEXT`
- `currency CHAR(3)`
- `default_budget_minor BIGINT`
- `default_cooldown_days INT`
- `default_frequency_cap INT`
- `created_at`, `updated_at`

**customers**
- `id UUID PK`
- `merchant_id UUID FK`
- `display_name TEXT`
- `preferred_language TEXT`
- `consent_status TEXT CHECK`
- `opted_out_at TIMESTAMPTZ NULL`
- `created_at`, `updated_at`

**purchases**
- `id UUID PK`
- `merchant_id UUID FK`
- `customer_id UUID FK`
- `occurred_at TIMESTAMPTZ`
- `amount_minor BIGINT CHECK amount_minor >= 0`
- `currency CHAR(3)`
- `status TEXT CHECK`
- `source TEXT`
- `created_at`

**campaigns**
- `id UUID PK`
- `merchant_id UUID FK`
- `name TEXT`
- `goal TEXT`
- `segment_snapshot JSONB`
- `offer_config JSONB`
- `budget_minor BIGINT CHECK budget_minor >= 0`
- `frequency_cap INT`
- `cooldown_days INT`
- `language TEXT`
- `channel TEXT`
- `original_message TEXT`
- `localized_message TEXT NULL`
- `status TEXT`
- `version INT`
- `approved_version INT NULL`
- `approved_by TEXT NULL`
- `approved_at TIMESTAMPTZ NULL`
- `created_at`, `updated_at`

**campaign_recipients**
- `id UUID PK`
- `campaign_id UUID FK`
- `customer_id UUID FK`
- `group_assignment TEXT CHECK ('treatment','control')`
- `eligibility_status TEXT`
- `suppression_reason TEXT NULL`
- `created_at`
- Unique `(campaign_id, customer_id)`

**campaign_messages**
- `id UUID PK`
- `campaign_id UUID FK`
- `customer_id UUID FK`
- `campaign_version INT`
- `idempotency_key TEXT UNIQUE`
- `status TEXT`
- `simulated_cost_minor BIGINT`
- `sent_at TIMESTAMPTZ NULL`
- `delivered_at TIMESTAMPTZ NULL`
- `failure_code TEXT NULL`
- `created_at`

**campaign_outcomes**
- `id UUID PK`
- `campaign_id UUID FK`
- `customer_id UUID FK`
- `group_assignment TEXT`
- `reactivated BOOLEAN`
- `revenue_minor BIGINT`
- `occurred_at TIMESTAMPTZ NULL`
- `simulation_seed TEXT`
- Unique `(campaign_id, customer_id)`

**audit_events**
- `id UUID PK`
- `merchant_id UUID FK`
- `campaign_id UUID NULL`
- `actor_type TEXT`
- `actor_id TEXT`
- `event_type TEXT`
- `entity_type TEXT`
- `entity_id TEXT`
- `metadata JSONB`
- `created_at TIMESTAMPTZ`

**provider_operations** (optional but recommended)
- `id UUID PK`
- `provider TEXT`
- `operation TEXT`
- `status TEXT`
- `request_fingerprint TEXT`
- `error_code TEXT NULL`
- `created_at TIMESTAMPTZ`

### Database constraints and indexes

- Foreign keys for merchant/customer/campaign relationships.
- Unique `(campaign_id, customer_id)` recipient and outcome records.
- Unique idempotency key for each simulated send.
- Check constraints for nonnegative monetary amounts and valid enums.
- Index customers by `(merchant_id, consent_status)`.
- Index purchases by `(customer_id, occurred_at DESC)`.
- Index campaigns by `(merchant_id, status, created_at DESC)`.
- Index recipients and messages by campaign.
- Use transactions for approval, send-job creation, and result finalization.
- Keep money as integer minor units; do not use floating point for monetary arithmetic.

## 10. API and service boundaries

Use a modular monolith for the MVP. Do not split this into microservices.

Suggested server modules:
- `customers`
- `purchase-history`
- `risk-detection`
- `segments`
- `campaigns`
- `campaign-planner` (Gemini adapter + fallback)
- `localization` (Sarvam adapter + fallback)
- `eligibility`
- `approvals`
- `simulated-messaging`
- `outcomes`
- `analytics`
- `audit`
- `demo-seed`

Suggested routes (adapt to Next.js App Router conventions):

- `GET /api/dashboard`
- `GET /api/customers`
- `GET /api/customers/:id`
- `POST /api/risk/recalculate`
- `GET /api/segments/:id/preview`
- `POST /api/campaigns`
- `GET /api/campaigns`
- `GET /api/campaigns/:id`
- `PATCH /api/campaigns/:id`
- `POST /api/campaigns/:id/plan`
- `POST /api/campaigns/:id/translate`
- `POST /api/campaigns/:id/approve`
- `POST /api/campaigns/:id/simulate-send`
- `POST /api/campaigns/:id/simulate-outcomes`
- `GET /api/campaigns/:id/results`
- `GET /api/campaigns/:id/recipients`
- `GET /api/audit`
- `POST /api/demo/reset`

All mutating routes must validate input server-side, enforce state transitions, and return typed error responses. Never trust client-supplied recipient eligibility or approval state.

### Suggested error format

```json
{
  "error": {
    "code": "CAMPAIGN_APPROVAL_REQUIRED",
    "message": "Approve the current campaign version before simulating sends.",
    "details": {}
  }
}
```

Do not return provider secrets, full environment values, stack traces, or sensitive data to the client.

## 11. Architecture and implementation choices

### Recommended default

- Next.js App Router + TypeScript.
- Tailwind CSS for UI.
- PostgreSQL through Supabase.
- Server-side route handlers / service layer in Node.js.
- Gemini API adapter for campaign planning.
- Sarvam API adapter for translation; optional TTS adapter for P1.
- Zod or equivalent runtime validation for inputs and model output.
- Vitest for unit/integration tests; Playwright for end-to-end browser tests.
- ESLint + TypeScript strict mode.
- Database migrations and deterministic seed script.
- `.env.example` with placeholders only.

If the chosen environment cannot support a hosted Supabase instance, a local PostgreSQL database is acceptable. Do not silently replace PostgreSQL with an unrelated database without updating the README and tests.

### Provider interfaces

Create interfaces such as:

```ts
interface CampaignPlanner {
  generatePlan(input: CampaignPlanInput): Promise<CampaignPlanResult>;
}

interface Translator {
  translate(input: TranslationInput): Promise<TranslationResult>;
}

interface TextToSpeechProvider {
  synthesize(input: SpeechInput): Promise<SpeechResult>;
}
```

Implement:
- `GeminiCampaignPlanner`
- `DemoCampaignPlanner`
- `SarvamTranslator`
- `DemoTranslator`
- optional `SarvamTextToSpeech`

Each result must identify its source: `provider: "gemini" | "sarvam" | "demo_fallback"`. Never misrepresent fallback content as model-generated.

### Security basics

- Keep provider API keys server-side only.
- Never prefix secret environment variables with `NEXT_PUBLIC_`.
- Validate and limit request body sizes.
- Apply timeouts to provider calls.
- Avoid logging prompts containing personal data.
- Use least-privilege database access.
- Treat all model output as untrusted input.
- Escape/render generated text safely.
- Document that local demo auth is not production security if authentication is omitted.

## 12. UX and screen requirements

### Screen A: Dashboard
- Demo-data banner.
- KPI cards with definitions/tooltips.
- Campaign activity list.
- Primary action: “Find customers to win back”.
- Clear empty/loading/error states.

### Screen B: Customers
- Search.
- Filters: at-risk, healthy, insufficient history, consented, opted out, no consent, frequency-capped.
- Customer table with last purchase, typical cadence, risk reason, language, consent.
- Detail panel with purchase history and eligibility explanation.

### Screen C: Campaign builder
- Name and objective.
- Segment selection and eligible count.
- Offer selection within allowed options.
- Budget and frequency limits.
- Language and simulated channel.
- Message generation action.
- Validation messages close to the relevant fields.

### Screen D: Localization and review
- Original and localized message side by side.
- Provider/fallback badge.
- Editable translated text.
- Character count.
- Offer terms visible.
- Optional audio preview.
- No send action on this screen before approval.

### Screen E: Approval summary
- Campaign plan.
- Exact message version.
- Offer, budget, channel, language.
- Treatment/control counts.
- Suppression counts and reasons.
- Explicit simulation-only warning.
- Approve button and cancel/back action.

### Screen F: Campaign execution
- Status/progress.
- Counts: processed, delivered, failed, suppressed.
- “Simulate send” is idempotent.
- Control group count displayed as not messaged.
- Retry only failed/unresolved records.

### Screen G: Results
- Treatment and control group counts.
- Reactivation rates with denominators.
- Estimated incremental rate and revenue.
- Campaign cost and cost per reactivated customer.
- Unsubscribe rate (simulated).
- Caveat: simulated data is illustrative and not evidence of real-world lift.
- Export results as CSV is optional P1.

### Screen H: Audit log
- Timestamp, actor, action, entity, result.
- Filter by campaign and event type.
- No secrets or unnecessary PII.

## 13. User stories and acceptance criteria

### US-01: See customers at risk
**As a merchant,** I want to see customers whose purchase rhythm has lapsed so I can intervene before losing them.

Acceptance:
- At-risk list is based on the documented deterministic rule.
- Each customer has an explanation.
- Insufficient-history customers are not falsely marked at risk.
- Tests cover cadence and threshold boundaries.

### US-02: Understand customer eligibility
**As a campaign operator,** I want to know why a customer can or cannot receive a campaign.

Acceptance:
- Eligibility reason is available for each customer.
- Unknown/revoked consent, opt-out, control assignment, cooldown, and frequency caps block sends.
- UI and backend return consistent reason codes.

### US-03: Draft a campaign
**As a merchant,** I want an AI-generated campaign suggestion within my offer and budget rules.

Acceptance:
- Gemini output is schema-validated.
- Invalid offers are rejected.
- Fallback is labelled.
- AI cannot approve or send.

### US-04: Localize campaign copy
**As a merchant,** I want campaign copy in the customer's preferred language.

Acceptance:
- Sarvam translation is requested server-side.
- Source and translation are shown together.
- Translation can be edited.
- Translation failure is visible and retryable.
- Final text change invalidates previous approval.

### US-05: Approve before sending
**As a merchant,** I want to review the exact offer and message before the system acts.

Acceptance:
- Only current approved version can be sent.
- Any material edit invalidates approval.
- Approval is audited.
- Direct API attempts to send an unapproved campaign fail.

### US-06: Run a campaign safely
**As a merchant,** I want the system to simulate campaign delivery only to eligible treatment customers.

Acceptance:
- No external messages are sent.
- No control customers are messaged.
- Opt-outs and ineligible customers are suppressed.
- Duplicate clicks do not duplicate messages.
- Per-recipient states persist.

### US-07: Measure outcomes
**As a merchant,** I want to compare campaign results with a control group.

Acceptance:
- Assignment is stable.
- Group denominators are shown.
- Zero denominators do not crash or show misleading rates.
- Revenue and cost formulas are documented.
- Simulated results are labelled.

### US-08: Inspect what happened
**As an evaluator or merchant,** I want an audit trail of decisions and actions.

Acceptance:
- Core workflow actions create audit events.
- Audit events cannot be edited through the app UI.
- Secrets are never logged.

### US-09: Recover from AI provider outage
**As a demo operator,** I want the app to remain demonstrable if a provider is unavailable.

Acceptance:
- Gemini failure offers a labelled demo draft.
- Sarvam failure allows retry or manual editing.
- Provider failures do not bypass backend rules or approval.
- User sees actionable error messages.

### US-10: Reset the demo
**As an evaluator,** I want to restore a known dataset for a repeatable demonstration.

Acceptance:
- Reset recreates known customer and purchase scenarios.
- Reset removes/rebuilds associated demo campaigns/events consistently.
- Repeated reset is safe.
- Reset is clearly marked destructive and limited to demo mode.

## 14. Edge cases and required behavior

| ID | Edge case | Required behavior |
|---|---|---|
| E-01 | Customer has zero purchases | Show insufficient history; do not classify as lapsed repeat buyer. |
| E-02 | Customer has one purchase | Insufficient cadence data; no automatic lapsed classification. |
| E-03 | Multiple purchases share same timestamp | Ignore zero/negative intervals in cadence calculation or use a documented tie-handling rule. |
| E-04 | Refund or cancellation | Exclude from completed-purchase cadence and reactivation revenue by default. |
| E-05 | Purchase happens during campaign preparation | Recalculate eligibility before approval and again before simulated send. |
| E-06 | Customer opts out after approval but before send | Suppress at send time; write audit event. |
| E-07 | Consent is unknown | Suppress. |
| E-08 | Customer is in control group | Never message, even if otherwise eligible. |
| E-09 | Budget is insufficient for all recipients | Use a deterministic ordering/selection policy, show recipients excluded by budget, and never exceed cap. |
| E-10 | Concurrent send clicks | Use idempotency and transaction/locking so sends are not duplicated. |
| E-11 | Approval exists for old campaign version | Reject send; require reapproval. |
| E-12 | Gemini returns malformed JSON | Validate, retry at most once if configured, then offer labelled fallback. |
| E-13 | Gemini suggests unapproved offer | Reject or replace with allowed offer; never silently expand the offer budget. |
| E-14 | Sarvam times out | Show retry state; preserve source message; do not mislabel fallback as translation. |
| E-15 | Unsupported target language | Disable option or return explicit unsupported-language error. |
| E-16 | Translation changes discount terms | Require human review; highlight source/target copy and preserve canonical offer fields separately. |
| E-17 | Empty segment | Prevent approval/send and explain why no customers qualify. |
| E-18 | Zero control group | Warn that comparative measurement is invalid; allow demo only if clearly labelled, but do not claim incremental lift. |
| E-19 | Zero reactivations | Show N/A for cost per reactivated customer; do not divide by zero. |
| E-20 | Duplicate purchase import | Deduplicate using source ID/idempotency key where available; warn on ambiguous duplicates. |
| E-21 | Time zone/daylight saving boundary | Store timestamps in UTC; use merchant time zone for date display and cadence-day calculations. |
| E-22 | Provider API key missing | App remains usable in demo mode with visible fallback status. |
| E-23 | Database unavailable | Show recoverable error; never report fake successful persistence. |
| E-24 | User refreshes during send | UI reloads job state from database; does not restart sends. |
| E-25 | Partial job failure | Keep successful records; retry unresolved records only. |
| E-26 | Customer has prior recent campaign | Apply frequency cap/cooldown across campaigns, not just the current campaign. |
| E-27 | Message exceeds channel limit | Block approval or require edit; show character count. |
| E-28 | No valid AOV for revenue estimate | Show revenue estimate as unavailable and explain missing assumption. |
| E-29 | Seed data becomes stale | Use stable reference date or deterministic relative dates; seed reset restores known state. |
| E-30 | Model returns unsafe or misleading copy | Validate offer terms and require merchant review; provide edit/reject action. |
| E-31 | Duplicate outcome simulation | Unique campaign/customer outcome key prevents duplicate records. |
| E-32 | Campaign cancelled after approval but before send | Block send and audit cancellation. |
| E-33 | Currency mismatch | Reject arithmetic across currencies; do not aggregate without explicit conversion. |
| E-34 | Provider response includes unexpected fields | Parse only schema-approved fields; ignore/reject unexpected data safely. |
| E-35 | User tries to change consent through campaign UI | Not allowed; consent management is a separate explicit workflow. |

## 15. Testing strategy

Testing must be developed alongside each feature, not added after implementation.

### 15.1 Test layers

1. **Unit tests:** cadence calculation, eligibility, budget allocation, frequency caps, campaign state transitions, experiment assignment, metric formulas, schema validation.
2. **Integration tests:** database repositories, API route validation, provider adapters with mocked HTTP, transactional approval/send logic, idempotency.
3. **End-to-end tests:** complete browser flow from dashboard to results; failure and reapproval paths.
4. **Manual acceptance tests:** actual local app in browser, seeded data, visual review, provider success/failure if credentials are available.
5. **Regression tests:** every bug fix gets a test reproducing the bug.

### 15.2 Test tools

Recommended:
- Vitest for unit/integration tests.
- Playwright for browser end-to-end tests.
- MSW or a small local mock server for external API responses.
- Database test schema or isolated test database.
- TypeScript strict mode and linting.

### 15.3 Required automated test cases

#### Risk detection
- RD-01: no purchases => insufficient history.
- RD-02: one purchase => insufficient history.
- RD-03: two purchases, current date below threshold => not at risk.
- RD-04: two purchases, current date exactly at threshold => at risk according to `>=` rule.
- RD-05: duplicate timestamps do not create zero-day cadence.
- RD-06: refunded/cancelled purchases are ignored.
- RD-07: median interval is calculated correctly for uneven intervals.
- RD-08: injected clock gives deterministic results.

#### Eligibility and safety
- EL-01: consented and otherwise eligible customer is eligible.
- EL-02: unknown consent is suppressed.
- EL-03: revoked consent is suppressed.
- EL-04: opted-out customer is suppressed.
- EL-05: control-group customer is suppressed from sends.
- EL-06: customer inside cooldown is suppressed.
- EL-07: frequency cap blocks extra message.
- EL-08: insufficient budget never exceeds cap.
- EL-09: eligibility is rechecked at send time.
- EL-10: suppression reason is persisted and displayed.

#### Campaign state and approval
- CA-01: draft cannot be sent.
- CA-02: ready-for-approval cannot be sent.
- CA-03: approved current version can be simulated.
- CA-04: edit after approval invalidates approval.
- CA-05: stale approved version is rejected.
- CA-06: cancelled campaign cannot be sent.
- CA-07: approval creates an audit event.
- CA-08: direct API call cannot bypass approval.

#### AI provider behavior
- AI-01: valid Gemini JSON is accepted.
- AI-02: malformed JSON is rejected.
- AI-03: unsupported offer type is rejected.
- AI-04: over-budget offer is rejected.
- AI-05: missing key invokes labelled demo fallback.
- AI-06: timeout shows recoverable error/fallback.
- AI-07: no customer PII is included in planner input.
- SA-01: Sarvam translation response maps to source/target fields.
- SA-02: provider timeout does not overwrite source copy.
- SA-03: unsupported language is rejected.
- SA-04: fallback is identified as demo output, not Sarvam.
- SA-05: edited translation increments campaign version and invalidates approval.
- SA-06 (P1): TTS output can be played; TTS failure does not block campaign workflow.

#### Sending and idempotency
- SE-01: simulated send creates records for eligible treatment recipients only.
- SE-02: control recipients never get message records.
- SE-03: opted-out recipient is suppressed after approval.
- SE-04: repeated send request does not duplicate messages.
- SE-05: partial failure retry handles unresolved recipients only.
- SE-06: refresh during send shows persisted status.
- SE-07: campaign budget is not exceeded.
- SE-08: each send/suppression outcome is auditable.

#### Measurement
- ME-01: treatment and control assignments are stable.
- ME-02: group counts match recipient records.
- ME-03: rates use the correct denominators.
- ME-04: zero denominator returns N/A, not NaN/Infinity.
- ME-05: zero reactivations yields N/A cost per reactivation.
- ME-06: incremental rate equals treatment rate minus control rate.
- ME-07: revenue estimate follows documented formula.
- ME-08: outcomes are generated deterministically from a fixed seed.
- ME-09: duplicate outcome run does not duplicate records.
- ME-10: simulated-data caveat appears in results UI.

#### Demo and reliability
- DM-01: reset can be run twice safely.
- DM-02: reset produces the known seed counts.
- DM-03: dashboard KPIs reflect persisted records.
- DM-04: database failure is shown, not hidden by fake success.
- DM-05: missing external API keys do not break demo mode.
- DM-06: no secrets appear in browser bundle or logs.

### 15.4 Manual acceptance test plan

Run these against the actual local app in a browser. Record Pass/Fail, build commit, environment, and notes.

| ID | Steps | Expected result |
|---|---|---|
| MT-01 | Start app using README from a clean checkout. | App starts; seed data is available; setup steps are sufficient. |
| MT-02 | Open dashboard. | Demo banner and data-derived KPIs are visible. |
| MT-03 | Open at-risk customer list and a customer detail. | Risk reason, purchase history, cadence, and consent are understandable. |
| MT-04 | Create a campaign with a valid offer and budget. | Draft saves and can be reopened. |
| MT-05 | Generate plan with valid Gemini key. | Structured plan appears; source badge says Gemini. |
| MT-06 | Remove Gemini key or force provider failure. | Demo fallback is labelled; workflow remains usable. |
| MT-07 | Translate message with Sarvam key. | Original and localized text appear side by side; language badge is accurate. |
| MT-08 | Force Sarvam failure. | Error and retry appear; source copy remains unchanged. |
| MT-09 | Edit localized copy after approval. | Approval is invalidated and send is blocked until reapproval. |
| MT-10 | Try to send before approval via UI. | UI prevents it. |
| MT-11 | Try to send before approval via API/test client. | Server rejects it. |
| MT-12 | Approve campaign and simulate send. | Only eligible treatment customers receive simulated message records. |
| MT-13 | Include opted-out and unknown-consent customers. | They are suppressed with visible reasons. |
| MT-14 | Inspect control group. | No control customer receives a message. |
| MT-15 | Click simulate send twice rapidly. | No duplicate send records are created. |
| MT-16 | Simulate outcomes and open results. | Treatment/control counts and formulas are visible; demo caveat is shown. |
| MT-17 | Run campaign with zero reactivations / empty denominator fixture. | No crash, NaN, or misleading percentage; N/A is displayed. |
| MT-18 | Open audit log. | Approval, translation, send, suppression, and measurement events appear. |
| MT-19 | Reset demo twice. | Same known baseline returns without duplicates/orphans. |
| MT-20 | Inspect browser devtools/network and repository. | No API keys are exposed client-side; no real messaging endpoint is called. |

**Manual testing record template:**
- Test ID:
- Date/time:
- Commit/hash:
- Environment/browser:
- Result: Pass / Fail / Blocked:
- Evidence (screenshot/log):
- Bug/issue:
- Retest result:

### 15.5 Definition of done for each feature

A feature is not done until:
- implementation is complete,
- loading/empty/error states exist,
- server-side validation exists for all mutating operations,
- automated tests cover normal and failure paths,
- lint and typecheck pass,
- manual acceptance steps are documented,
- README or developer notes are updated,
- no secrets are committed,
- the feature is verified in the running app.

## 16. Incremental development plan

Each phase must leave the app in a working state. Do not build the entire product in one giant code-generation prompt.

### Phase 0 — Repository reconnaissance and plan
**Build:** inspect existing repo; document current stack and constraints; create implementation plan and task checklist.  
**Tests:** verify available package scripts, TypeScript configuration, and test setup.  
**Gate:** no major architecture decision is made without recording it; do not overwrite existing work blindly.

### Phase 1 — Skeleton and developer workflow
**Build:** Next.js + TypeScript + Tailwind app shell, navigation, environment validation, lint/typecheck/test scripts, error boundaries.  
**Tests:** app smoke test, invalid environment test, lint/typecheck.  
**Gate:** clean local start and build succeed.

### Phase 2 — Database and seeded demo dataset
**Build:** PostgreSQL/Supabase schema, migrations, repository layer, deterministic seed/reset.  
**Tests:** constraints, foreign keys, repeatable seed/reset, repository integration tests.  
**Gate:** dashboard can read seeded data from the database.

### Phase 3 — Customers and risk detection
**Build:** customer list, detail view, purchase history, cadence engine, risk reasons, filters.  
**Tests:** RD-01 through RD-08 and customer API tests.  
**Gate:** every displayed risk classification is reproducible and explainable.

### Phase 4 — Campaign draft and validation
**Build:** campaign builder, segment preview, offer configuration, budget/frequency settings, state machine.  
**Tests:** schema validation, bounds, invalid transitions, empty segment behavior.  
**Gate:** campaign can be saved and reloaded as a valid draft.

### Phase 5 — Gemini planner and fallback
**Build:** provider interface, structured output schema, Gemini adapter, timeout handling, demo fallback.  
**Tests:** AI-01 through AI-07 with mocked provider responses.  
**Gate:** planner works with a provider key and without one; fallback is labelled.

### Phase 6 — Sarvam localization
**Build:** Sarvam adapter, language configuration, side-by-side translation editor, retry, provider badge.  
**Tests:** SA-01 through SA-05 and mocked timeout/unsupported-language cases.  
**Gate:** localized text is persisted, reviewable, and cannot bypass approval.  
**Optional P1:** add TTS audio preview only after P0 tests pass.

### Phase 7 — Consent, eligibility, and approval
**Build:** eligibility service, suppression reason codes, approval summary, version/hash approval, audit events.  
**Tests:** EL-01 through EL-10 and CA-01 through CA-08.  
**Gate:** no unapproved or ineligible send can pass server validation.

### Phase 8 — Simulated messaging
**Build:** idempotent simulated send job, recipient statuses, retry behavior, progress UI.  
**Tests:** SE-01 through SE-08, including concurrent requests and partial failure.  
**Gate:** repeated requests never duplicate messages; control group is never messaged.

### Phase 9 — Outcomes and results
**Build:** deterministic outcome simulator, control comparison, formulas, result dashboard, caveats.  
**Tests:** ME-01 through ME-10.  
**Gate:** results reconcile to persisted events and handle zero denominators safely.

### Phase 10 — Audit, reliability, and polish
**Build:** audit screen, loading/error/empty states, accessible controls, clear demo labels, security review.  
**Tests:** audit coverage, provider outage, DB outage, secret scan, responsive smoke tests.  
**Gate:** P0 end-to-end workflow passes.

### Phase 11 — Full regression and demo rehearsal
**Build:** final seed scenarios, README, `.env.example`, setup script, 3–5 minute demo runbook.  
**Tests:** full automated suite and MT-01 through MT-20.  
**Gate:** clean setup succeeds and every P0 manual test passes. Fix blockers before adding P1 features.

## 17. Claude Code / Antigravity execution protocol

Put this PRD in the repository as `docs/PRD.md`. Treat it as the product source of truth.

### Required rules for the coding agent

1. Inspect the existing repository before editing.
2. Do not replace working code or change the stack without explaining why.
3. Implement one phase at a time, in order.
4. Before coding a phase, list the files to create/change and the acceptance criteria it will satisfy.
5. After coding, run relevant automated tests, lint, and typecheck; report exact commands and outcomes.
6. If a command fails, diagnose and fix it rather than claiming completion.
7. Never mark a test passed unless it was actually run and passed.
8. Add tests with the feature, not at the end.
9. Do not use real customer data or call real messaging APIs in demo mode.
10. Keep all secrets server-side and use `.env.example` placeholders.
11. Do not fake provider success. Fallbacks must be explicit in the UI and data.
12. Do not proceed to the next phase if the current phase's gate fails.
13. Keep a `docs/IMPLEMENTATION_STATUS.md` containing phase status, completed tests, failed tests, known bugs, and next task.
14. If blocked by missing credentials, implement and test the adapter with mocks and demo fallback; document the real-provider test as blocked, not passed.
15. Ask for clarification only when a product decision is genuinely blocking; otherwise follow this PRD and document reasonable implementation details.

### Suggested phase prompt

> Read `docs/PRD.md` and `docs/IMPLEMENTATION_STATUS.md`. Inspect the repository and identify the current phase. Implement only the next incomplete phase. First summarize the acceptance criteria and files you intend to change. Then implement the feature with automated tests, run tests/lint/typecheck, fix failures, and update `docs/IMPLEMENTATION_STATUS.md`. Do not claim any test passed unless you ran it. Do not start the next phase. Report changed files, commands run, results, and remaining risks.

### Final verification prompt

> Perform a release-readiness review against every P0 requirement in `docs/PRD.md`. Run the complete automated suite, lint, typecheck, and production build. Identify any untested requirement, security issue, broken user flow, incorrect metric, missing edge case, or mismatch between UI and backend validation. Fix blockers and rerun tests. Then provide a checklist showing each P0 requirement as PASS, FAIL, or BLOCKED with evidence. Do not mark real Sarvam/Gemini API integration as tested unless it was exercised with valid credentials.

## 18. Suggested repository layout

```text
src/
  app/
    (dashboard)/
      page.tsx
      customers/
      campaigns/
      results/
      audit/
    api/
  components/
    dashboard/
    customers/
    campaigns/
    localization/
    results/
    ui/
  lib/
    db/
    validation/
    risk/
    eligibility/
    experiments/
    metrics/
    audit/
    providers/
      gemini/
      sarvam/
      demo/
    jobs/
    errors/
  types/
  test/
    fixtures/
    helpers/
    integration/
e2e/
  dashboard.spec.ts
  campaign-flow.spec.ts
  provider-failure.spec.ts
docs/
  PRD.md
  IMPLEMENTATION_STATUS.md
  MANUAL_TEST_PLAN.md
  DEMO_RUNBOOK.md
supabase/
  migrations/
  seed.sql
.env.example
README.md
```

This is a suggestion, not a reason to refactor a healthy existing repo unnecessarily.

## 19. Environment variables and setup

Expected placeholders (adapt names to the SDKs actually used):

```env
DATABASE_URL=
NEXT_PUBLIC_APP_NAME=Winback AI
GEMINI_API_KEY=
SARVAM_API_KEY=
DEMO_MODE=true
DEMO_SEED=winback-demo-v1
```

Rules:
- Never commit real keys.
- Do not expose `GEMINI_API_KEY` or `SARVAM_API_KEY` to the browser.
- If demo mode is enabled, external messaging must be impossible by construction.
- Document how to run migrations, seed data, start the app, run unit tests, run e2e tests, lint, typecheck, and build.
- Provider-specific SDK/model names must be checked against current official documentation during implementation, not guessed from this PRD.

## 20. Demo runbook (3–5 minutes)

1. Open dashboard and point out the simulated-data banner and current at-risk count.
2. Open a lapsed customer and show the cadence explanation.
3. Create a café winback campaign with a free-pastry-with-coffee offer and a bounded budget.
4. Generate the plan; show Gemini source or labelled fallback.
5. Translate to Hindi or another currently supported language using Sarvam; show both versions.
6. Review the segment, treatment/control counts, suppression reasons, and offer cost.
7. Approve the campaign.
8. Simulate sending and show that only eligible treatment customers receive messages.
9. Simulate outcomes and show treatment/control rates, estimated incremental revenue, and caveats.
10. Open audit log to show the system records approval and actions.

If a real provider key is unavailable, use the clearly labelled demo fallback. Never pretend a fallback was generated by a live API.

## 21. Risks and mitigations

- **Provider API or credentials unavailable:** provider abstraction, mocks, labelled demo fallback.
- **Model invents discount terms:** strict structured schema, allowlisted offer configuration, backend validation.
- **Translation changes meaning:** side-by-side review, canonical offer fields, human approval.
- **Metrics look impressive but are fake:** label simulated outcomes and explain denominators/formulas.
- **Duplicate sends:** idempotency keys, unique constraints, transactions.
- **Consent/opt-out race:** recheck eligibility immediately before each simulated send.
- **Scope creep:** P0/P1/P2 separation and phase gates.
- **Agent coding tool skips tests:** require actual command output and implementation status evidence.
- **Seed data changes over time:** fixed reference date/deterministic seed.
- **Time lost on UI polish:** establish working vertical slice early; prioritize end-to-end correctness.

## 22. Open implementation decisions

These can be resolved during Phase 0 without changing the product intent:
- Exact Gemini and Sarvam SDK versions and currently supported model identifiers.
- Hosted Supabase versus local PostgreSQL for the developer environment.
- Whether authentication can be omitted for the hackathon demo; if omitted, state that the app is local/demo-only.
- Exact synthetic dataset size and simulation probabilities.
- Exact message character limits for each simulated channel.
- Whether P1 TTS preview fits the remaining time.

Do not block the P0 MVP on TTS, live integrations, or billing.

## 23. Final acceptance checklist

### Product
- [ ] Seeded merchant and synthetic customers load.
- [ ] Risk detection is deterministic and explainable.
- [ ] Campaign can be created, planned, localized, reviewed, and approved.
- [ ] Approval is bound to an immutable campaign version.
- [ ] Eligibility and suppression rules are enforced server-side.
- [ ] Simulated send is idempotent and excludes control customers.
- [ ] Outcomes and metrics are persisted and reproducible.
- [ ] Audit trail covers critical actions.
- [ ] Demo mode cannot send real messages.

### Engineering
- [ ] Migrations and seed/reset are repeatable.
- [ ] Unit and integration tests pass.
- [ ] Playwright end-to-end tests pass.
- [ ] Lint, typecheck, and production build pass.
- [ ] Provider calls are server-side, timed out, and schema-validated.
- [ ] No secrets are committed or exposed to the browser.
- [ ] Error, empty, and loading states exist.
- [ ] README enables a clean setup.

### Manual verification
- [ ] All P0 manual test cases pass.
- [ ] Provider success tested if valid credentials are available.
- [ ] Provider failure and demo fallback tested.
- [ ] Full 3–5 minute demo rehearsed.
- [ ] Known limitations are disclosed in the UI and README.

**MVP definition:** A merchant can detect lapsed customers, plan a bounded campaign, localize it, approve it, safely simulate sending, and inspect measured treatment/control outcomes, with tests proving the safety rules and workflow.
