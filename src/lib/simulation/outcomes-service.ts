import { assertTransition } from '@/lib/campaigns/state';
import { inTransaction } from '@/lib/db/transaction';
import type { Queryable } from '@/lib/db/types';
import { AppError, notFound } from '@/lib/errors';
import { writeAuditEvent } from '@/lib/audit/service';
import {
  AVERAGE_ORDER_VALUE_MINOR,
  CONTROL_REACTIVATION_RATE,
  OUTCOME_SEED_VERSION,
  TREATMENT_REACTIVATION_RATE,
  TREATMENT_UNSUBSCRIBE_RATE,
  simulateRecipientOutcome,
  type OutcomeRecipient,
} from './outcomes';

interface CampaignLockRow {
  id: string;
  version: number;
  status: string;
}

export interface OutcomeSimulationResult {
  status: 'completed';
  created: number;
  already_completed: boolean;
  simulated: true;
}

export async function simulateCampaignOutcomes(
  db: Queryable,
  merchantId: string,
  campaignId: string,
  actorId: string,
): Promise<OutcomeSimulationResult> {
  return inTransaction(db, async () => {
    const campaignResult = await db.query<CampaignLockRow>(
      `SELECT id, version, status FROM campaigns
        WHERE id = $1 AND merchant_id = $2 FOR UPDATE`,
      [campaignId, merchantId],
    );
    const campaign = campaignResult.rows[0];
    if (!campaign) throw notFound('Campaign');
    if (campaign.status === 'completed') {
      return { status: 'completed', created: 0, already_completed: true, simulated: true };
    }
    if (campaign.status !== 'sent' && campaign.status !== 'measuring') {
      throw new AppError('INVALID_STATE', 'Campaign must finish its simulated send before outcomes can be measured.', 409);
    }

    if (campaign.status === 'sent') {
      assertTransition('sent', 'measuring');
      await db.query(
        'UPDATE campaigns SET status = $3, updated_at = NOW() WHERE id = $1 AND merchant_id = $2',
        [campaignId, merchantId, 'measuring'],
      );
    }

    const recipients = await db.query<OutcomeRecipient>(
      `SELECT customer_id, group_assignment, eligibility_status FROM campaign_recipients
        WHERE campaign_id = $1 AND group_assignment IN ('treatment', 'control') ORDER BY customer_id`,
      [campaignId],
    );
    const deliveredRows = await db.query<{ customer_id: string }>(
      `SELECT customer_id FROM campaign_messages WHERE campaign_id = $1 AND status = 'delivered'`,
      [campaignId],
    );
    const delivered = new Set(deliveredRows.rows.map((row) => row.customer_id));
    const generated = recipients.rows.map((recipient) =>
      simulateRecipientOutcome(campaignId, campaign.version, recipient, delivered));

    let created = 0;
    if (generated.length > 0) {
      const inserted = await db.query(
        `INSERT INTO campaign_outcomes
           (campaign_id, customer_id, group_assignment, reactivated, revenue_minor, occurred_at, simulation_seed, unsubscribed)
         SELECT $1::uuid, outcomes.customer_id, outcomes.group_assignment, outcomes.reactivated,
                outcomes.revenue_minor, outcomes.occurred_at, outcomes.simulation_seed, outcomes.unsubscribed
           FROM unnest($2::uuid[], $3::text[], $4::boolean[], $5::bigint[], $6::timestamptz[], $7::text[], $8::boolean[])
             AS outcomes(customer_id, group_assignment, reactivated, revenue_minor, occurred_at, simulation_seed, unsubscribed)
         ON CONFLICT (campaign_id, customer_id) DO NOTHING`,
        [
          campaignId,
          generated.map((outcome) => outcome.customer_id),
          generated.map((outcome) => outcome.group_assignment),
          generated.map((outcome) => outcome.reactivated),
          generated.map((outcome) => outcome.revenue_minor),
          generated.map((outcome) => outcome.occurred_at),
          generated.map((outcome) => outcome.simulation_seed),
          generated.map((outcome) => outcome.unsubscribed),
        ],
      );
      created = inserted.rowCount ?? 0;
    }

    assertTransition('measuring', 'completed');
    await db.query(
      `UPDATE campaigns SET status = 'completed', results_meta = $3::jsonb, updated_at = NOW()
        WHERE id = $1 AND merchant_id = $2`,
      [
        campaignId,
        merchantId,
        JSON.stringify({
          seed_version: OUTCOME_SEED_VERSION,
          treatment_reactivation_rate: TREATMENT_REACTIVATION_RATE,
          control_reactivation_rate: CONTROL_REACTIVATION_RATE,
          treatment_unsubscribe_rate: TREATMENT_UNSUBSCRIBE_RATE,
          average_order_value_minor: AVERAGE_ORDER_VALUE_MINOR,
          revenue_formula: 'estimated incremental reactivations × average simulated order value',
        }),
      ],
    );
    await writeAuditEvent({
      merchant_id: merchantId,
      campaign_id: campaignId,
      actor_type: 'system',
      actor_id: actorId,
      event_type: 'outcome_simulation_completed',
      entity_type: 'campaign',
      entity_id: campaignId,
      metadata: {
        simulated: true,
        seed_version: OUTCOME_SEED_VERSION,
        treatment_count: generated.filter((outcome) => outcome.group_assignment === 'treatment').length,
        control_count: generated.filter((outcome) => outcome.group_assignment === 'control').length,
        created,
      },
    }, db);

    return { status: 'completed', created, already_completed: false, simulated: true };
  });
}
