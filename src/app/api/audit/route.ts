import { connection, NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { AUDIT_EVENT_TYPES } from '@/lib/audit/events';
import { getPool } from '@/lib/db/pool';
import { DEMO_MERCHANT_ID } from '@/lib/demo/constants';
import { errorJson, errorResponse } from '@/lib/http';

const querySchema = z.object({
  campaign_id: z.string().uuid().optional(),
  event_type: z.enum(AUDIT_EVENT_TYPES).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export async function GET(req: NextRequest) {
  await connection();
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return errorJson('INVALID_QUERY', 'One or more audit filters are invalid.', 400);

  const { campaign_id: campaignId, event_type: eventType, page, limit } = parsed.data;
  const offset = (page - 1) * limit;
  try {
    const [events, count] = await Promise.all([
      getPool().query(
        `SELECT ae.id, ae.created_at, ae.actor_type, ae.event_type, ae.entity_type, ae.metadata,
                c.name AS campaign_name
           FROM audit_events ae
           LEFT JOIN campaigns c ON c.id = ae.campaign_id AND c.merchant_id = ae.merchant_id
          WHERE ae.merchant_id = $1
            AND ($2::uuid IS NULL OR ae.campaign_id = $2::uuid)
            AND ($3::text IS NULL OR ae.event_type = $3)
          ORDER BY ae.created_at DESC, ae.id DESC
          LIMIT $4 OFFSET $5`,
        [DEMO_MERCHANT_ID, campaignId ?? null, eventType ?? null, limit, offset],
      ),
      getPool().query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM audit_events
          WHERE merchant_id = $1
            AND ($2::uuid IS NULL OR campaign_id = $2::uuid)
            AND ($3::text IS NULL OR event_type = $3)`,
        [DEMO_MERCHANT_ID, campaignId ?? null, eventType ?? null],
      ),
    ]);

    return NextResponse.json({
      events: events.rows,
      total: Number(count.rows[0]?.count ?? 0),
      page,
      limit,
    });
  } catch (error) {
    return errorResponse(error, 'Audit API');
  }
}
