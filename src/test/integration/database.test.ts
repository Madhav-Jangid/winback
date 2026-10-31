/**
 * Database integration tests (Phase 2).
 * Runs against DATABASE_URL (from the environment or .env.local) inside a throwaway schema,
 * so real demo data is never touched. Skipped when no database is configured.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, DatabaseError } from 'pg';
import { buildPgConfig } from '@/lib/db/config';
import { runMigrations } from '@/lib/db/migrate';
import type { Queryable } from '@/lib/db/types';
import { DEMO_MERCHANT_ID, DEMO_REFERENCE_DATE } from '@/lib/demo/constants';
import { resetDemoData } from '@/lib/demo/seed';
import { buildDemoDataset, DEMO_CUSTOMERS } from '@/lib/demo/seed-data';
import { getDashboardStats } from '@/lib/repositories/dashboard';
import { createTestDatabase, TEST_DATABASE_URL as DATABASE_URL, type TestDatabase } from '@/test/helpers/test-db';

const TABLES = [
  'merchants', 'customers', 'purchases', 'campaigns', 'campaign_recipients',
  'campaign_messages', 'campaign_outcomes', 'audit_events', 'provider_operations',
];

async function pgErrorCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error instanceof DatabaseError ? error.code : 'not-a-db-error';
  }
}

describe.skipIf(!DATABASE_URL)('database (integration)', () => {
  let t: TestDatabase;
  let db: Queryable;
  let schema: string;

  const counts = async () => {
    const result = await db.query<Record<string, string>>(
      `SELECT ${TABLES.map((t) => `(SELECT COUNT(*) FROM ${t}) AS ${t}`).join(', ')}`,
    );
    return Object.fromEntries(Object.entries(result.rows[0]).map(([k, v]) => [k, Number(v)]));
  };

  beforeAll(async () => {
    t = await createTestDatabase();
    db = t.db;
    schema = t.schema;
  });

  afterAll(async () => t?.cleanup());

  it('does not leak the temp schema into other connections', async () => {
    // Regression: tests once SET search_path at session level and the pooler handed that
    // session to the dev server ("relation merchants does not exist").
    await db.query('SELECT 1');
    const other = new Client(buildPgConfig(DATABASE_URL!));
    await other.connect();
    try {
      const result = await other.query<{ sp: string }>(`SELECT current_setting('search_path') AS sp`);
      expect(result.rows[0].sp).not.toContain('winback_test_');
    } finally {
      await other.end();
    }
  });

  it('records migrations and does not reapply them', async () => {
    const applied = await db.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name');
    expect(applied.rows.map((r) => r.name)).toEqual(['001_schema.sql', '002_rls_and_constraints.sql', '003_translation.sql', '004_approval_and_recipients.sql', '005_control_constraint_fix.sql']);
    expect(await runMigrations(db)).toEqual([]);
  });

  it('enables row-level security on every app table', async () => {
    const result = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relkind = 'r'`,
      [schema],
    );
    const rls = Object.fromEntries(result.rows.map((r) => [r.relname, r.relrowsecurity]));
    for (const table of [...TABLES, 'schema_migrations']) expect(rls[table], table).toBe(true);
  });

  it('DM-02: seed produces the known counts', async () => {
    const summary = await resetDemoData(db, 'test');
    const data = buildDemoDataset();
    expect(summary).toMatchObject({ customers: DEMO_CUSTOMERS.length, purchases: data.purchases.length, campaigns: 1, messages: 2 });
    expect(await counts()).toEqual({
      merchants: 1,
      customers: DEMO_CUSTOMERS.length,
      purchases: data.purchases.length,
      campaigns: 1,
      campaign_recipients: 2,
      campaign_messages: 2,
      campaign_outcomes: 0,
      audit_events: 1,
      provider_operations: 0,
    });
  });

  it('DM-01: reset can run twice and restores the same baseline without duplicates or orphans', async () => {
    // Add extra state that a reset must clear.
    await db.query(`INSERT INTO campaigns (merchant_id, name, goal) VALUES ($1, 'Scratch campaign', 'test')`, [DEMO_MERCHANT_ID]);
    await db.query(`INSERT INTO provider_operations (provider, operation, status) VALUES ('demo', 'plan', 'ok')`);
    const before = await counts();
    expect(before.campaigns).toBe(2);

    await resetDemoData(db, 'test');
    const first = await counts();
    const ids1 = (await db.query('SELECT id FROM customers ORDER BY id')).rows;
    await resetDemoData(db, 'test');
    expect(await counts()).toEqual(first);
    expect((await db.query('SELECT id FROM customers ORDER BY id')).rows).toEqual(ids1);
    expect(first.campaigns).toBe(1);
    expect(first.provider_operations).toBe(0);

    const orphans = await db.query<{ n: string }>(
      `SELECT (SELECT COUNT(*) FROM purchases p LEFT JOIN customers c ON c.id = p.customer_id WHERE c.id IS NULL)
            + (SELECT COUNT(*) FROM campaign_messages m LEFT JOIN campaigns c ON c.id = m.campaign_id WHERE c.id IS NULL) AS n`,
    );
    expect(Number(orphans.rows[0].n)).toBe(0);
  });

  it('rolls back a failed reset and leaves the previous data intact', async () => {
    const before = await counts();
    await db.query('ALTER TABLE purchases ADD CONSTRAINT test_block_seed CHECK (amount_minor < 0) NOT VALID');
    try {
      await expect(resetDemoData(db, 'test')).rejects.toThrow();
    } finally {
      await db.query('ALTER TABLE purchases DROP CONSTRAINT test_block_seed');
    }
    expect(await counts()).toEqual(before);
  });

  it('enforces foreign keys', async () => {
    const code = await pgErrorCode(db.query(
      `INSERT INTO purchases (merchant_id, customer_id, occurred_at, amount_minor) VALUES ($1, gen_random_uuid(), NOW(), 100)`,
      [DEMO_MERCHANT_ID],
    ));
    expect(code).toBe('23503');
  });

  it('enforces check constraints on money and enums', async () => {
    const customerId = buildDemoDataset().customers[0].id;
    expect(await pgErrorCode(db.query(
      `INSERT INTO purchases (merchant_id, customer_id, occurred_at, amount_minor) VALUES ($1, $2, NOW(), -1)`,
      [DEMO_MERCHANT_ID, customerId],
    ))).toBe('23514');
    expect(await pgErrorCode(db.query(
      `INSERT INTO customers (merchant_id, display_name, consent_status) VALUES ($1, 'X', 'maybe')`,
      [DEMO_MERCHANT_ID],
    ))).toBe('23514');
    expect(await pgErrorCode(db.query(
      `INSERT INTO campaigns (merchant_id, name, goal, budget_minor) VALUES ($1, 'X', 'Y', -5)`,
      [DEMO_MERCHANT_ID],
    ))).toBe('23514');
  });

  it('enforces unique recipients and send idempotency keys', async () => {
    const data = buildDemoDataset();
    const message = data.messages[0];
    expect(await pgErrorCode(db.query(
      `INSERT INTO campaign_recipients (campaign_id, customer_id, group_assignment, eligibility_status) VALUES ($1, $2, 'treatment', 'eligible')`,
      [data.campaign.id, message.customer_id],
    ))).toBe('23505');
    expect(await pgErrorCode(db.query(
      `INSERT INTO campaign_messages (campaign_id, customer_id, campaign_version, idempotency_key) VALUES ($1, $2, 1, $3)`,
      [data.campaign.id, message.customer_id, message.idempotency_key],
    ))).toBe('23505');
  });

  it('DM-03: dashboard KPIs come from persisted rows', async () => {
    await resetDemoData(db, 'test');
    const atRisk = DEMO_CUSTOMERS.filter((c) => c.expectedRisk === 'at_risk');
    const expectedAtRisk = atRisk.length;
    const expectedContactable = atRisk.filter(
      (c) => c.consent === 'consented' && c.optedOutDaysAgo === undefined && c.messagedDaysAgo === undefined,
    ).length;

    const stats = await getDashboardStats(db, DEMO_MERCHANT_ID, DEMO_REFERENCE_DATE, true);
    expect(stats).toMatchObject({
      merchant_name: 'Chai & Conversations Café',
      total_customers: DEMO_CUSTOMERS.length,
      at_risk_customers: expectedAtRisk,
      at_risk_contactable: expectedContactable,
      draft_campaigns: 0,
      completed_campaigns: 0,
      total_simulated_reactivations: 0,
    });
    expect(stats.recent_campaigns).toHaveLength(1);

    await db.query(`INSERT INTO campaigns (merchant_id, name, goal) VALUES ($1, 'New draft', 'test')`, [DEMO_MERCHANT_ID]);
    const after = await getDashboardStats(db, DEMO_MERCHANT_ID, DEMO_REFERENCE_DATE, true);
    expect(after.draft_campaigns).toBe(1);
    expect(after.recent_campaigns).toHaveLength(2);
  });
});
