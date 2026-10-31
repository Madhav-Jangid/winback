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

  // TODO(Phase 9): replace with treatment-minus-control incremental revenue from the metrics module.
  const outcomes = await db.query<{ count: string; revenue: string }>(
    `SELECT COUNT(*) AS count, COALESCE(SUM(co.revenue_minor), 0) AS revenue
       FROM campaign_outcomes co JOIN campaigns c ON c.id = co.campaign_id
      WHERE c.merchant_id = $1 AND co.reactivated AND co.group_assignment = 'treatment'`,
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
