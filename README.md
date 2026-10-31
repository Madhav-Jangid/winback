# Winback AI

Winback AI is a local demo workspace for finding customers who may be lapsing, preparing reviewed winback campaigns, and measuring simulated outcomes. All demo data and messaging outcomes are simulated.

## Requirements

- Node.js 20 or newer
- npm
- A PostgreSQL database. The project uses Supabase; any PostgreSQL 15+ works.

The app shell starts without a database or AI provider keys. Database-backed pages show a setup error until `DATABASE_URL` is configured.

## Local setup

```powershell
npm install
Copy-Item .env.example .env.local   # then fill in DATABASE_URL
npm run db:setup                    # apply migrations + load demo data
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Supabase connection

Use the **Session pooler** URI from the Supabase dashboard (Connect → Session pooler), e.g.
`postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`.
The direct `db.<project-ref>.supabase.co` host is IPv6-only and fails on most home networks with `ENOTFOUND`.
Connections to Supabase use SSL without certificate verification (MVP limitation).

The pooler behaves like transaction mode: concurrent connections can share one server session. Never rely on session state (`SET`, temp tables, named prepared statements); use transactions instead.

The app talks to Postgres only from the server. Row-level security is enabled on every table with no policies, so Supabase's REST API (and the publishable key) cannot read or write app data.

### Database commands

| Command | What it does |
|---|---|
| `npm run db:migrate` | Applies new files in `supabase/migrations/` (tracked in `schema_migrations`). |
| `npm run db:seed` | Deletes and recreates the demo workspace in one transaction. Safe to repeat. Requires `DEMO_MODE=true`. |
| `npm run db:setup` | Both of the above. |

The dashboard's **Reset demo data** link does the same as `db:seed`.

### AI planner (Gemini)

With `GEMINI_API_KEY` set, **Draft message** on a saved campaign calls Gemini (default model `gemini-3.5-flash-lite`; override with `GEMINI_MODEL`). Only aggregate facts are sent (segment counts, average visit gaps, your offer and budget rules), never customer names, ids or purchase histories. Output is validated server-side: offers must stay within limits and cost no more than your configured offer, and the copy may only state the offer's own terms (no extra percentages or amounts, placeholders, or invented urgency). The planner only suggests; you apply it in the builder and save.

Without a key the app uses a clearly labelled demo template. If Gemini fails (timeout, quota, invalid answer after one retry), nothing changes and you are offered **Use demo draft instead**.

### Localization (Sarvam)

For a non-English campaign, **Translate** on a saved campaign calls Sarvam (`POST api.sarvam.ai/translate`; default model `mayura:v1`, set `SARVAM_MODEL=sarvam-translate:v1` for the 2000-character model). Only the English message and the target language are sent. The English text and the translation sit side by side; the translation is editable, saved as a new campaign version with its provenance (Sarvam / demo fallback / manual, model, edited), and must match the current English message: if the English or the language changes, the translation is **stale** and the campaign cannot be approved until you re-translate or review and save it. Unreviewed machine output must keep the offer's numbers (10%, ₹100, 14 days), checked across scripts.

Without `SARVAM_API_KEY` the demo fallback does **not** translate: it returns the English text labelled as demo output, which must be reviewed before approval. If Sarvam fails, nothing is saved and you can retry, type the translation yourself, or choose the labelled demo draft.

### Demo data and the demo clock

The seed (`src/lib/demo/seed-data.ts`) is a fictional café with 31 synthetic customers covering at-risk, healthy, insufficient-history, opted-out, unknown/revoked consent, frequency-capped, refunded, cancelled, and duplicate-timestamp cases. Purchase dates are relative to a fixed demo date, **1 Oct 2026**, and in demo mode risk is calculated as of that date, so the demo gives the same results whenever it is run.

Authentication is not implemented: this is a single-merchant local demo and is not production-secure.

## Developer checks

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

`npm test` includes database integration tests when `DATABASE_URL` is set (from the environment or `.env.local`). They run inside a temporary schema that is dropped afterwards, so your demo data is not touched. Without a database they are skipped.

`npm run test:watch` starts Vitest in watch mode. `npm run build` creates the production build; `npm start` serves that build.

## Environment

See `.env.example` for supported values. Server configuration is parsed in `src/lib/env.ts`. The demo defaults work without AI credentials and use explicit demo provider implementations. `DATABASE_URL`, `GEMINI_API_KEY`, and `SARVAM_API_KEY` are optional for starting the shell and must remain server-only.

## Product specification

- Source of truth: [Winback AI MVP PRD](Winback_AI_MVP_PRD.md)
- Implementation copy: [docs/PRD.md](docs/PRD.md)
- Current phase, verification, and next task: [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md)
