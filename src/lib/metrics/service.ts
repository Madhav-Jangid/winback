import { AppError, notFound } from '@/lib/errors';
import { getCampaign } from '@/lib/repositories/campaigns';
import type { CampaignResults } from '@/types';
import type { Queryable } from '@/lib/db/types';
import { calculateResults, type MessageRow, type OutcomeRow } from './calculator';
import { AVERAGE_ORDER_VALUE_MINOR } from '@/lib/simulation/outcomes';

export interface CampaignResultsView extends CampaignResults {
  campaign_name: string;
  campaign_status: 'completed';
}

export async function getCampaignResults(
  db: Queryable,
  merchantId: string,
  campaignId: string,
): Promise<CampaignResultsView> {
  const campaign = await getCampaign(db, merchantId, campaignId);
  if (!campaign) throw notFound('Campaign');
  if (campaign.status !== 'completed') {
    throw new AppError('RESULTS_NOT_AVAILABLE', 'Complete the simulated outcome run before viewing results.', 409);
  }

  const [outcomes, messages, metadata] = await Promise.all([
    db.query<OutcomeRow>(
      `SELECT customer_id, group_assignment, reactivated, revenue_minor::float8 AS revenue_minor, unsubscribed
         FROM campaign_outcomes WHERE campaign_id = $1 ORDER BY customer_id`,
      [campaignId],
    ),
    db.query<MessageRow>(
      `SELECT customer_id, status, simulated_cost_minor::float8 AS simulated_cost_minor
         FROM campaign_messages WHERE campaign_id = $1 ORDER BY customer_id`,
      [campaignId],
    ),
    db.query<{ results_meta: { average_order_value_minor?: number } | null }>(
      'SELECT results_meta FROM campaigns WHERE id = $1 AND merchant_id = $2',
      [campaignId, merchantId],
    ),
  ]);
  const averageOrderValueMinor = metadata.rows[0]?.results_meta?.average_order_value_minor ?? AVERAGE_ORDER_VALUE_MINOR;

  return {
    ...calculateResults(campaignId, outcomes.rows, messages.rows, Number(averageOrderValueMinor)),
    campaign_name: campaign.name,
    campaign_status: 'completed',
  };
}
