import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db/pool';
import { calculateResults } from '@/lib/metrics/calculator';

const DEMO_MERCHANT_ID = '00000000-0000-0000-0000-000000000001';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const campaignRes = await query(`SELECT * FROM campaigns WHERE id = $1 AND merchant_id = $2`, [id, DEMO_MERCHANT_ID]);
    if (campaignRes.rows.length === 0) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Campaign not found.' } }, { status: 404 });
    }

    const campaign = campaignRes.rows[0] as Record<string, unknown>;

    if (!['measuring', 'completed'].includes(campaign.status as string)) {
      return NextResponse.json(
        { error: { code: 'NO_RESULTS', message: 'Results are not yet available. Run "Simulate Outcomes" first.' } },
        { status: 409 },
      );
    }

    const outcomesRes = await query<{ group_assignment: string; reactivated: boolean; revenue_minor: number }>(
      `SELECT group_assignment, reactivated, revenue_minor FROM campaign_outcomes WHERE campaign_id = $1`,
      [id],
    );

    const messagesRes = await query<{ status: string }>(
      `SELECT status FROM campaign_messages WHERE campaign_id = $1`,
      [id],
    );

    const results = calculateResults(
      id,
      outcomesRes.rows.map((o) => ({ ...o, group_assignment: o.group_assignment as 'treatment' | 'control' })),
      messagesRes.rows,
      campaign.budget_minor as number,
    );

    return NextResponse.json({ ...results, campaign_name: campaign.name, campaign_status: campaign.status });
  } catch (err) {
    console.error('[Results API]', err);
    return NextResponse.json({ error: { code: 'DATABASE_ERROR', message: 'Failed to load results.' } }, { status: 503 });
  }
}
