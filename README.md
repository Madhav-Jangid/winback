# Winback AI

Winback AI is a local demo workspace for finding customers who may be lapsing, preparing reviewed winback campaigns, and measuring simulated outcomes. All demo data and messaging outcomes are simulated.

## Requirements

- Node.js 20 or newer
- npm
- PostgreSQL for database-backed customer and campaign workflows (Phase 2 setup)

The dashboard shell can start without PostgreSQL or AI provider credentials. Database-backed pages and actions require a configured database.

## Local setup

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Keep provider keys server-side; never use a `NEXT_PUBLIC_` prefix for them. `DATABASE_URL` may be left empty to inspect the app shell, but database features will show a connection/setup error until PostgreSQL is configured.

The current schema and seed files are in `supabase/migrations/` and `supabase/seed.ts`. Database setup and repeatable seed/reset are tracked as Phase 2 work in `docs/IMPLEMENTATION_STATUS.md`.

## Developer checks

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

`npm run test:watch` starts Vitest in watch mode. `npm run build` creates the production build; `npm start` serves that build.

## Environment

See `.env.example` for supported values. Server configuration is parsed in `src/lib/env.ts`. The demo defaults work without AI credentials and use explicit demo provider implementations. `DATABASE_URL`, `GEMINI_API_KEY`, and `SARVAM_API_KEY` are optional for starting the shell and must remain server-only.

## Product specification

- Source of truth: [Winback AI MVP PRD](Winback_AI_MVP_PRD.md)
- Implementation copy: [docs/PRD.md](docs/PRD.md)
- Current phase, verification, and next task: [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md)
