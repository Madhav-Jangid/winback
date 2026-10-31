import type { Queryable } from '@/lib/db/types';
import { DEMO_ACTOR_ID, DEMO_MERCHANT_ID, DEMO_REFERENCE_DATE } from './constants';
import { buildDemoDataset, HISTORICAL_CAMPAIGN_ID } from './seed-data';

export interface DemoSeedSummary {
  customers: number;
  purchases: number;
  campaigns: number;
  messages: number;
  reference_date: string;
}

async function insertRows(db: Queryable, table: string, columns: string[], rows: unknown[][]): Promise<void> {
  if (rows.length === 0) return;
  const placeholders = rows
    .map((row, r) => `(${row.map((_, c) => `$${r * columns.length + c + 1}`).join(', ')})`)
    .join(', ');
  await db.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES ${placeholders}`, rows.flat());
}

/**
 * Delete and recreate the demo workspace in one transaction (FR-13, US-10).
 * Safe to run repeatedly and concurrently: an advisory lock serializes resets, and deleting
 * the merchant cascades to every customer, purchase, campaign, recipient, message, outcome,
 * and audit event, so nothing is orphaned.
 * `db` must be a single connection (Client or PoolClient).
 */
export async function resetDemoData(db: Queryable, actorId: string = DEMO_ACTOR_ID): Promise<DemoSeedSummary> {
  const data = buildDemoDataset();

  await db.query('BEGIN');
  try {
    await db.query(`SELECT pg_advisory_xact_lock(hashtext('winback-demo-reset'))`);
    await db.query('DELETE FROM merchants WHERE id = $1', [DEMO_MERCHANT_ID]);
    await db.query('DELETE FROM provider_operations');

    const m = data.merchant;
    await insertRows(db, 'merchants',
      ['id', 'name', 'business_type', 'currency', 'default_budget_minor', 'default_cooldown_days', 'default_frequency_cap', 'timezone'],
      [[m.id, m.name, m.business_type, m.currency, m.default_budget_minor, m.default_cooldown_days, m.default_frequency_cap, m.timezone]]);

    await insertRows(db, 'customers',
      ['id', 'merchant_id', 'display_name', 'preferred_language', 'consent_status', 'opted_out_at', 'created_at', 'updated_at'],
      data.customers.map((c) => [c.id, m.id, c.display_name, c.preferred_language, c.consent_status, c.opted_out_at, c.created_at, c.created_at]));

    await insertRows(db, 'purchases',
      ['id', 'merchant_id', 'customer_id', 'occurred_at', 'amount_minor', 'currency', 'status', 'source', 'created_at'],
      data.purchases.map((p) => [p.id, m.id, p.customer_id, p.occurred_at, p.amount_minor, m.currency, p.status, 'demo', p.occurred_at]));

    const campaignColumns = Object.keys(data.campaign);
    await insertRows(db, 'campaigns', ['merchant_id', ...campaignColumns], [[m.id, ...campaignColumns.map((k) => data.campaign[k])]]);

    await insertRows(db, 'campaign_recipients',
      ['id', 'campaign_id', 'customer_id', 'group_assignment', 'eligibility_status'],
      data.recipients.map((r) => [r.id, HISTORICAL_CAMPAIGN_ID, r.customer_id, 'treatment', 'eligible']));

    await insertRows(db, 'campaign_messages',
      ['id', 'campaign_id', 'customer_id', 'campaign_version', 'idempotency_key', 'status', 'simulated_cost_minor', 'sent_at', 'delivered_at', 'created_at'],
      data.messages.map((x) => [x.id, HISTORICAL_CAMPAIGN_ID, x.customer_id, 1, x.idempotency_key, 'delivered', 0, x.sent_at, x.delivered_at, x.sent_at]));

    const summary: DemoSeedSummary = {
      customers: data.customers.length,
      purchases: data.purchases.length,
      campaigns: 1,
      messages: data.messages.length,
      reference_date: DEMO_REFERENCE_DATE.toISOString(),
    };

    await insertRows(db, 'audit_events',
      ['merchant_id', 'actor_type', 'actor_id', 'event_type', 'entity_type', 'entity_id', 'metadata'],
      [[m.id, 'merchant', actorId, 'demo_reset', 'merchant', m.id, JSON.stringify(summary)]]);

    await db.query('COMMIT');
    return summary;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}
