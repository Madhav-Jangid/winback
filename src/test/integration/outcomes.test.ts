import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { approveCampaign } from '@/lib/approvals/service';
import { createCampaign } from '@/lib/campaigns/service';
import { DEMO_MERCHANT_ID, DEMO_REFERENCE_DATE } from '@/lib/demo/constants';
import { resetDemoData } from '@/lib/demo/seed';
import { getCampaignResults } from '@/lib/metrics/service';
import { getCampaign } from '@/lib/repositories/campaigns';
import { simulateSend } from '@/lib/messaging/service';
import { simulateCampaignOutcomes } from '@/lib/simulation/outcomes-service';
import { VALID_DRAFT } from '@/test/fixtures/campaign';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '@/test/helpers/test-db';
import type { DeliverFn } from '@/lib/messaging/delivery';

const alwaysDelivered: DeliverFn = () => ({ ok: true });

describe.skipIf(!TEST_DATABASE_URL)('campaign outcome measurement (Phase 9 integration)', () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    await resetDemoData(testDb.db, 'test');
  });
  afterAll(async () => testDb?.cleanup());
  beforeEach(async () => { await resetDemoData(testDb.db, 'test'); });

  async function sendCampaign() {
    const { campaign } = await createCampaign(testDb.db, DEMO_MERCHANT_ID, VALID_DRAFT, DEMO_REFERENCE_DATE, 'test');
    await approveCampaign(testDb.db, DEMO_MERCHANT_ID, campaign.id, { expected_version: 1 }, DEMO_REFERENCE_DATE, 'test');
    await simulateSend(testDb.db, DEMO_MERCHANT_ID, campaign.id, {}, DEMO_REFERENCE_DATE, 'test', { deliver: alwaysDelivered });
    return campaign.id;
  }

  it('ME-01/02: persists exactly one stable outcome per assigned treatment/control recipient', async () => {
    const campaignId = await sendCampaign();
    const run = await simulateCampaignOutcomes(testDb.db, DEMO_MERCHANT_ID, campaignId, 'test');
    expect(run.created).toBeGreaterThan(0);

    const assigned = await testDb.db.query<{ group_assignment: string; count: string }>(
      `SELECT group_assignment, COUNT(*) AS count FROM campaign_recipients
        WHERE campaign_id = $1 AND group_assignment IN ('treatment', 'control') GROUP BY group_assignment`,
      [campaignId],
    );
    const outcomes = await testDb.db.query<{ group_assignment: string; count: string }>(
      `SELECT group_assignment, COUNT(*) AS count FROM campaign_outcomes
        WHERE campaign_id = $1 GROUP BY group_assignment`,
      [campaignId],
    );
    expect(outcomes.rows).toEqual(expect.arrayContaining(assigned.rows.map((row) =>
      expect.objectContaining({ group_assignment: row.group_assignment, count: row.count }))));
    expect(await getCampaign(testDb.db, DEMO_MERCHANT_ID, campaignId)).toMatchObject({ status: 'completed' });

    const first = await testDb.db.query(
      'SELECT customer_id, group_assignment, reactivated, revenue_minor, simulation_seed, unsubscribed FROM campaign_outcomes WHERE campaign_id = $1 ORDER BY customer_id',
      [campaignId],
    );
    expect(new Set(first.rows.map((row) => row.customer_id)).size).toBe(first.rows.length);
    expect(first.rows.every((row) => typeof row.simulation_seed === 'string')).toBe(true);
    expect(first.rows.filter((row) => row.group_assignment === 'control' && row.unsubscribed)).toHaveLength(0);
  });

  it('ME-09: duplicate and concurrent outcome requests remain idempotent and audit once', async () => {
    const campaignId = await sendCampaign();
    const [connectionA, connectionB] = await Promise.all([testDb.connect(), testDb.connect()]);
    try {
      const results = await Promise.all([
        simulateCampaignOutcomes(connectionA.db, DEMO_MERCHANT_ID, campaignId, 'test'),
        simulateCampaignOutcomes(connectionB.db, DEMO_MERCHANT_ID, campaignId, 'test'),
      ]);
      expect(results.filter((result) => result.already_completed)).toHaveLength(1);
    } finally {
      await Promise.all([connectionA.close(), connectionB.close()]);
    }

    const repeated = await simulateCampaignOutcomes(testDb.db, DEMO_MERCHANT_ID, campaignId, 'test');
    expect(repeated).toMatchObject({ created: 0, already_completed: true });
    const [outcomes, events] = await Promise.all([
      testDb.db.query<{ count: string }>('SELECT COUNT(*) AS count FROM campaign_outcomes WHERE campaign_id = $1', [campaignId]),
      testDb.db.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM audit_events WHERE campaign_id = $1 AND event_type = 'outcome_simulation_completed'`,
        [campaignId],
      ),
    ]);
    expect(Number(outcomes.rows[0].count)).toBeGreaterThan(0);
    expect(Number(events.rows[0].count)).toBe(1);
  });

  it('ME-03/06/07: result metrics reconcile persisted rows and documented formulas', async () => {
    const campaignId = await sendCampaign();
    await simulateCampaignOutcomes(testDb.db, DEMO_MERCHANT_ID, campaignId, 'test');
    const results = await getCampaignResults(testDb.db, DEMO_MERCHANT_ID, campaignId);
    expect(results.treatment_count + results.control_count).toBeGreaterThan(0);
    expect(results.unsubscribe_denominator).toBeGreaterThan(0);
    expect(results.incremental_reactivation_rate).toBeCloseTo(
      (results.treatment_reactivations / results.treatment_count) -
      (results.control_reactivations / results.control_count),
    );
    expect(results.estimated_incremental_revenue_minor).toBe(
      Math.round(results.estimated_incremental_reactivations! * results.average_order_value_minor),
    );

    const messageCost = await testDb.db.query<{ cost: string }>(
      `SELECT COALESCE(SUM(simulated_cost_minor), 0) AS cost FROM campaign_messages
        WHERE campaign_id = $1 AND status = 'delivered'`,
      [campaignId],
    );
    expect(results.campaign_cost_minor).toBe(Number(messageCost.rows[0].cost));
  });
});
