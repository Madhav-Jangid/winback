import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { query, withTransaction } from '@/lib/db/pool';
import { writeAuditEvent } from '@/lib/audit/service';

const DEMO_MERCHANT_ID = '00000000-0000-0000-0000-000000000001';

const UpdateCampaignSchema = z.object({
  name: z.string().min(3).max(100).optional(),
  goal: z.string().min(5).max(500).optional(),
  offer_config: z.object({
    type: z.enum(['percentage_discount', 'fixed_discount', 'free_item', 'no_offer']),
    value: z.number().optional(),
    description: z.string().optional(),
  }).optional(),
  budget_minor: z.number().int().min(0).optional(),
  frequency_cap: z.number().int().min(1).max(10).optional(),
  cooldown_days: z.number().int().min(1).max(365).optional(),
  language: z.string().optional(),
  channel: z.enum(['whatsapp', 'sms', 'email']).optional(),
  original_message: z.string().max(1000).optional(),
  localized_message: z.string().max(1500).optional(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const campaignRes = await query(
      `SELECT * FROM campaigns WHERE id = $1 AND merchant_id = $2`,
      [id, DEMO_MERCHANT_ID],
    );
    if (campaignRes.rows.length === 0) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Campaign not found.' } }, { status: 404 });
    }
    return NextResponse.json(campaignRes.rows[0]);
  } catch (err) {
    console.error('[Campaign GET]', err);
    return NextResponse.json({ error: { code: 'DATABASE_ERROR', message: 'Failed to load campaign.' } }, { status: 503 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await req.json();
    const parsed = UpdateCampaignSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid data.', details: parsed.error.flatten() } },
        { status: 400 },
      );
    }

    const campaignRes = await query(`SELECT * FROM campaigns WHERE id = $1 AND merchant_id = $2`, [id, DEMO_MERCHANT_ID]);
    if (campaignRes.rows.length === 0) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Campaign not found.' } }, { status: 404 });
    }

    const campaign = campaignRes.rows[0] as Record<string, unknown>;

    // Cannot edit a campaign that is sending or beyond
    const lockedStatuses = ['sending', 'sent', 'measuring', 'completed'];
    if (lockedStatuses.includes(campaign.status as string)) {
      return NextResponse.json(
        { error: { code: 'CAMPAIGN_LOCKED', message: 'Cannot edit a campaign that is sending or completed. Copy it to create a new campaign.' } },
        { status: 409 },
      );
    }

    const data = parsed.data;
    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (data.name !== undefined) { updates.push(`name = $${idx++}`); values.push(data.name); }
    if (data.goal !== undefined) { updates.push(`goal = $${idx++}`); values.push(data.goal); }
    if (data.offer_config !== undefined) { updates.push(`offer_config = $${idx++}`); values.push(JSON.stringify(data.offer_config)); }
    if (data.budget_minor !== undefined) { updates.push(`budget_minor = $${idx++}`); values.push(data.budget_minor); }
    if (data.frequency_cap !== undefined) { updates.push(`frequency_cap = $${idx++}`); values.push(data.frequency_cap); }
    if (data.cooldown_days !== undefined) { updates.push(`cooldown_days = $${idx++}`); values.push(data.cooldown_days); }
    if (data.language !== undefined) { updates.push(`language = $${idx++}`); values.push(data.language); }
    if (data.channel !== undefined) { updates.push(`channel = $${idx++}`); values.push(data.channel); }
    if (data.original_message !== undefined) { updates.push(`original_message = $${idx++}`); values.push(data.original_message); }
    if (data.localized_message !== undefined) { updates.push(`localized_message = $${idx++}`); values.push(data.localized_message); }

    if (updates.length === 0) {
      return NextResponse.json({ message: 'No changes provided.' });
    }

    // Increment version and invalidate approval for material changes
    updates.push(`version = version + 1`);
    updates.push(`approved_version = NULL`);
    updates.push(`approved_by = NULL`);
    updates.push(`approved_at = NULL`);
    updates.push(`updated_at = NOW()`);

    // Update status: if was approved, go back to ready_for_approval
    const materialStatusChange = campaign.status === 'approved' ? `'ready_for_approval'` : `status`;
    updates.push(`status = ${materialStatusChange}`);

    values.push(id);
    await query(`UPDATE campaigns SET ${updates.join(', ')} WHERE id = $${idx}`, values);

    await writeAuditEvent({
      merchant_id: DEMO_MERCHANT_ID,
      campaign_id: id,
      event_type: 'campaign_updated',
      entity_type: 'campaign',
      entity_id: id,
      metadata: { fields_updated: Object.keys(data) },
    });

    const updated = await query(`SELECT * FROM campaigns WHERE id = $1`, [id]);
    return NextResponse.json(updated.rows[0]);
  } catch (err) {
    console.error('[Campaign PATCH]', err);
    return NextResponse.json({ error: { code: 'DATABASE_ERROR', message: 'Failed to update campaign.' } }, { status: 503 });
  }
}
