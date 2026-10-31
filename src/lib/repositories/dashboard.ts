import { getCustomerDirectory } from '@/lib/customers/service';
import type { Queryable } from '@/lib/db/types';

export interface DashboardStatsResult {
  merchant_name: string | null;
  total_customers: number;
  at_risk_customers: number;
  /** At-risk customers who can be messaged right now (consented, not opted out, not frequency-capped). */
  at_risk_contactable: number;
  draft_campaigns: number;
  completed_campaigns: number;
  total_simulated_reactivations: number;
  total_estimated_revenue_minor: number;
  recent_campaigns: Array<{ id: string; name: string; status: string; updated_at: string; channel: string; language: string }>;
  as_of: string;
  is_demo: boolean;
}

/** Dashboard KPIs computed from persisted rows (FR-01, DM-03). */
export async function getDashboardStats(
  db: Queryable,
  merchantId: string,
  now: Date,
  isDemo: boolean,
): Promise<DashboardStatsResult> {
  // Same computation as the customer list, so the two screens always agree.
  const directory = await getCustomerDirectory(db, merchantId, now);
  const atRisk = directory.all.filter((p) => p.risk.status === 'at_risk');

  const statusRows = await db.query<{ status: string; count: string }>(
    'SELECT status, COUNT(*) AS count FROM campaigns WHERE merchant_id = $1 GROUP BY status',
    [merchantId],
  );
  const byStatus = Object.fromEntries(statusRows.rows.map((r) => [r.status, Number(r.count)]));

  const recent = await db.query<{ id: string; name: string; status: string; updated_at: Date; channel: string; language: string }>(
    `SELECT id, name, status, updated_at, channel, language
       FROM campaigns WHERE merchant_id = $1 ORDER BY updated_at DESC LIMIT 5`,
    [merchantId],
  );

  const outcomes = await db.query<{ count: string; revenue: string }>(
    `WITH outcome_groups AS (
       SELECT campaign_id,
              COUNT(*) FILTER (WHERE group_assignment = 'treatment') AS treatment_count,
              COUNT(*) FILTER (WHERE group_assignment = 'control') AS control_count,
              COUNT(*) FILTER (WHERE group_assignment = 'treatment' AND reactivated) AS treatment_reactivations,
              COUNT(*) FILTER (WHERE group_assignment = 'control' AND reactivated) AS control_reactivations
         FROM campaign_outcomes
        GROUP BY campaign_id
     )
     SELECT COALESCE(SUM(o.treatment_reactivations), 0) AS count,
            COALESCE(SUM(
              CASE WHEN o.treatment_count > 0 AND o.control_count > 0 THEN
                ((o.treatment_reactivations::numeric / o.treatment_count) -
                 (o.control_reactivations::numeric / o.control_count)) *
                o.treatment_count *
                COALESCE(NULLIF(c.results_meta->>'average_order_value_minor', '')::numeric, 25000)
              ELSE 0 END
            ), 0) AS revenue
       FROM campaigns c
       LEFT JOIN outcome_groups o ON o.campaign_id = c.id
      WHERE c.merchant_id = $1 AND c.status = 'completed'`,
    [merchantId],
  );

  return {
    merchant_name: directory.merchant?.name ?? null,
    total_customers: directory.all.length,
    at_risk_customers: atRisk.length,
    at_risk_contactable: atRisk.filter((p) => p.contact.eligible).length,
    draft_campaigns: (byStatus.draft ?? 0) + (byStatus.planning ?? 0) + (byStatus.ready_for_approval ?? 0),
    completed_campaigns: byStatus.completed ?? 0,
    total_simulated_reactivations: Number(outcomes.rows[0]?.count ?? 0),
    total_estimated_revenue_minor: Number(outcomes.rows[0]?.revenue ?? 0),
    recent_campaigns: recent.rows.map((r) => ({ ...r, updated_at: r.updated_at.toISOString() })),
    as_of: now.toISOString(),
    is_demo: isDemo,
  };
}
