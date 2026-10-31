import type { Queryable } from '@/lib/db/types';
import { batchAssessRisk } from '@/lib/risk/engine';
import { listCustomersWithPurchases } from './customers';

export interface DashboardStatsResult {
  merchant_name: string | null;
  total_customers: number;
  at_risk_customers: number;
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
  const merchant = await db.query<{ name: string }>('SELECT name FROM merchants WHERE id = $1', [merchantId]);
  const customers = await listCustomersWithPurchases(db, merchantId);

  // Same rule as the customer list: opted-out customers are shown as opted out, not at risk.
  const risks = batchAssessRisk(customers.filter((c) => !c.opted_out_at), { now });
  const atRisk = risks.filter((r) => r.status === 'at_risk').length;

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

  // TODO(Phase 9): replace with treatment-minus-control incremental revenue from the metrics module.
  const outcomes = await db.query<{ count: string; revenue: string }>(
    `SELECT COUNT(*) AS count, COALESCE(SUM(co.revenue_minor), 0) AS revenue
       FROM campaign_outcomes co JOIN campaigns c ON c.id = co.campaign_id
      WHERE c.merchant_id = $1 AND co.reactivated AND co.group_assignment = 'treatment'`,
    [merchantId],
  );

  return {
    merchant_name: merchant.rows[0]?.name ?? null,
    total_customers: customers.length,
    at_risk_customers: atRisk,
    draft_campaigns: (byStatus.draft ?? 0) + (byStatus.planning ?? 0) + (byStatus.ready_for_approval ?? 0),
    completed_campaigns: byStatus.completed ?? 0,
    total_simulated_reactivations: Number(outcomes.rows[0]?.count ?? 0),
    total_estimated_revenue_minor: Number(outcomes.rows[0]?.revenue ?? 0),
    recent_campaigns: recent.rows.map((r) => ({ ...r, updated_at: r.updated_at.toISOString() })),
    as_of: now.toISOString(),
    is_demo: isDemo,
  };
}
