import { connection, NextResponse } from 'next/server';
import { query } from '@/lib/db/pool';

const DEMO_MERCHANT_ID = '00000000-0000-0000-0000-000000000001';

export async function GET() {
  await connection(); // always run at request time; never prerender
  try {
    // Total customers
    const customersRes = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM customers WHERE merchant_id = $1`,
      [DEMO_MERCHANT_ID],
    );

    // At-risk (calculated via purchases)
    const atRiskRes = await query<{ count: string }>(
      `SELECT COUNT(DISTINCT c.id) as count
       FROM customers c
       WHERE c.merchant_id = $1
         AND c.consent_status = 'consented'
         AND c.opted_out_at IS NULL`,
      [DEMO_MERCHANT_ID],
    );

    // Campaign counts by status
    const campaignStatsRes = await query<{ status: string; count: string }>(
      `SELECT status, COUNT(*) as count 
       FROM campaigns 
       WHERE merchant_id = $1 
       GROUP BY status`,
      [DEMO_MERCHANT_ID],
    );

    // Recent campaigns
    const recentCampaigns = await query(
      `SELECT id, name, status, created_at, updated_at, language, channel
       FROM campaigns 
       WHERE merchant_id = $1 
       ORDER BY updated_at DESC 
       LIMIT 5`,
      [DEMO_MERCHANT_ID],
    );

    // Total simulated reactivations
    const reactivationsRes = await query<{ count: string; revenue: string }>(
      `SELECT COUNT(*) as count, COALESCE(SUM(revenue_minor), 0) as revenue
       FROM campaign_outcomes co
       JOIN campaigns c ON c.id = co.campaign_id
       WHERE c.merchant_id = $1 AND co.reactivated = true AND co.group_assignment = 'treatment'`,
      [DEMO_MERCHANT_ID],
    );

    const statusMap: Record<string, number> = {};
    for (const row of campaignStatsRes.rows) {
      statusMap[row.status] = parseInt(row.count, 10);
    }

    const total_customers = parseInt(customersRes.rows[0]?.count ?? '0', 10);
    const reactivations = reactivationsRes.rows[0];

    return NextResponse.json({
      total_customers,
      at_risk_customers: 0, // Will be populated after risk calculation
      draft_campaigns: (statusMap['draft'] ?? 0) + (statusMap['planning'] ?? 0) + (statusMap['ready_for_approval'] ?? 0),
      completed_campaigns: statusMap['completed'] ?? 0,
      total_simulated_reactivations: parseInt(reactivations?.count ?? '0', 10),
      total_estimated_revenue_minor: parseInt(reactivations?.revenue ?? '0', 10),
      recent_campaigns: recentCampaigns.rows,
      is_demo: true,
    });
  } catch (err) {
    console.error('[Dashboard API]', err);
    return NextResponse.json(
      { error: { code: 'DATABASE_ERROR', message: 'Failed to load dashboard data. Is the database running?' } },
      { status: 503 },
    );
  }
}
