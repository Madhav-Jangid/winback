import { connection, NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '@/lib/db/pool';
import { writeAuditEvent } from '@/lib/audit/service';

import { DEMO_MERCHANT_ID } from '@/lib/demo/constants';

const CreateCampaignSchema = z.object({
  name: z.string().min(3).max(100),
  goal: z.string().min(5).max(500),
  segment_type: z.enum(['at_risk', 'all_eligible', 'previously_active']),
  offer_config: z.object({
    type: z.enum(['percentage_discount', 'fixed_discount', 'free_item', 'no_offer']),
    value: z.number().optional(),
    description: z.string().optional(),
    minimum_order_value_minor: z.number().optional(),
    max_discount_minor: z.number().optional(),
  }),
  budget_minor: z.number().int().min(0),
  frequency_cap: z.number().int().min(1).max(10),
  cooldown_days: z.number().int().min(1).max(365),
  language: z.string().min(2).max(10),
  channel: z.enum(['whatsapp', 'sms', 'email']),
});

export async function GET(req: NextRequest) {
  await connection(); // always run at request time; never prerender
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');

    const campaigns = await query(
      `SELECT c.*, 
        (SELECT COUNT(*) FROM campaign_recipients cr WHERE cr.campaign_id = c.id AND cr.group_assignment = 'treatment') as treatment_count,
        (SELECT COUNT(*) FROM campaign_recipients cr WHERE cr.campaign_id = c.id AND cr.group_assignment = 'control') as control_count
       FROM campaigns c
       WHERE c.merchant_id = $1
         AND ($2::text IS NULL OR c.status = $2)
       ORDER BY c.updated_at DESC`,
      [DEMO_MERCHANT_ID, status],
    );

    return NextResponse.json({ campaigns: campaigns.rows });
  } catch (err) {
    console.error('[Campaigns GET]', err);
    return NextResponse.json({ error: { code: 'DATABASE_ERROR', message: 'Failed to load campaigns.' } }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = CreateCampaignSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid campaign data.', details: parsed.error.flatten() } },
        { status: 400 },
      );
    }

    const data = parsed.data;

    const result = await query<{ id: string }>(
      `INSERT INTO campaigns 
        (merchant_id, name, goal, segment_snapshot, offer_config, budget_minor, frequency_cap, cooldown_days, language, channel, status, version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'draft', 1)
       RETURNING id`,
      [
        DEMO_MERCHANT_ID,
        data.name,
        data.goal,
        JSON.stringify({ segment_type: data.segment_type }),
        JSON.stringify(data.offer_config),
        data.budget_minor,
        data.frequency_cap,
        data.cooldown_days,
        data.language,
        data.channel,
      ],
    );

    const campaignId = result.rows[0].id;

    await writeAuditEvent({
      merchant_id: DEMO_MERCHANT_ID,
      campaign_id: campaignId,
      event_type: 'campaign_created',
      entity_type: 'campaign',
      entity_id: campaignId,
      metadata: { name: data.name, goal: data.goal },
    });

    return NextResponse.json({ id: campaignId }, { status: 201 });
  } catch (err) {
    console.error('[Campaigns POST]', err);
    return NextResponse.json({ error: { code: 'DATABASE_ERROR', message: 'Failed to create campaign.' } }, { status: 503 });
  }
}
