import { connection, NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db/pool';

const DEMO_MERCHANT_ID = '00000000-0000-0000-0000-000000000001';

export async function GET(req: NextRequest) {
  await connection(); // always run at request time; never prerender
  try {
    const { searchParams } = new URL(req.url);
    const campaignId = searchParams.get('campaign_id');
    const eventType = searchParams.get('event_type');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const offset = (page - 1) * limit;

    const events = await query(
      `SELECT ae.*, c.name as campaign_name
       FROM audit_events ae
       LEFT JOIN campaigns c ON c.id = ae.campaign_id
       WHERE ae.merchant_id = $1
         AND ($2::uuid IS NULL OR ae.campaign_id = $2::uuid)
         AND ($3::text IS NULL OR ae.event_type = $3)
       ORDER BY ae.created_at DESC
       LIMIT $4 OFFSET $5`,
      [DEMO_MERCHANT_ID, campaignId, eventType, limit, offset],
    );

    const countRes = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM audit_events WHERE merchant_id = $1
         AND ($2::uuid IS NULL OR campaign_id = $2::uuid)`,
      [DEMO_MERCHANT_ID, campaignId],
    );

    return NextResponse.json({
      events: events.rows,
      total: parseInt(countRes.rows[0]?.count ?? '0', 10),
      page,
      limit,
    });
  } catch (err) {
    console.error('[Audit API]', err);
    return NextResponse.json({ error: { code: 'DATABASE_ERROR', message: 'Failed to load audit log.' } }, { status: 503 });
  }
}
