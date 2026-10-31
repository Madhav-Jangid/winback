import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '@/lib/db/pool';
import { getTranslator } from '@/lib/providers/factory';
import { writeAuditEvent } from '@/lib/audit/service';

const DEMO_MERCHANT_ID = '00000000-0000-0000-0000-000000000001';

const TranslateSchema = z.object({
  target_language: z.string().min(2).max(10),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await req.json();
    const parsed = TranslateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request.' } }, { status: 400 });
    }

    const campaignRes = await query(`SELECT * FROM campaigns WHERE id = $1 AND merchant_id = $2`, [id, DEMO_MERCHANT_ID]);
    if (campaignRes.rows.length === 0) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Campaign not found.' } }, { status: 404 });
    }

    const campaign = campaignRes.rows[0] as Record<string, unknown>;
    if (!campaign.original_message) {
      return NextResponse.json({ error: { code: 'NO_MESSAGE', message: 'Generate a campaign plan first.' } }, { status: 409 });
    }

    await writeAuditEvent({
      merchant_id: DEMO_MERCHANT_ID,
      campaign_id: id,
      event_type: 'translation_requested',
      entity_type: 'campaign',
      entity_id: id,
      metadata: { target_language: parsed.data.target_language },
    });

    const translator = getTranslator();
    const result = await translator.translate({
      text: campaign.original_message as string,
      source_language: 'en',
      target_language: parsed.data.target_language,
    });

    if (result.status === 'success' || result.status === 'fallback') {
      // Save translation and update version/language
      await query(
        `UPDATE campaigns SET
          localized_message = $1,
          language = $2,
          translation_source = $3,
          version = version + 1,
          approved_version = NULL,
          approved_by = NULL,
          approved_at = NULL,
          status = CASE WHEN status = 'approved' THEN 'ready_for_approval' ELSE status END,
          updated_at = NOW()
         WHERE id = $4`,
        [result.translated, parsed.data.target_language, result.source, id],
      );

      await writeAuditEvent({
        merchant_id: DEMO_MERCHANT_ID,
        campaign_id: id,
        event_type: 'translation_completed',
        entity_type: 'campaign',
        entity_id: id,
        metadata: { source: result.source, language: parsed.data.target_language, status: result.status },
      });
    } else {
      await writeAuditEvent({
        merchant_id: DEMO_MERCHANT_ID,
        campaign_id: id,
        event_type: 'translation_failed',
        entity_type: 'campaign',
        entity_id: id,
        metadata: { error: result.error, language: parsed.data.target_language },
      });
    }

    const updated = await query(`SELECT * FROM campaigns WHERE id = $1`, [id]);
    return NextResponse.json({ campaign: updated.rows[0], translation: result });
  } catch (err) {
    console.error('[Translate API]', err);
    return NextResponse.json({ error: { code: 'TRANSLATION_ERROR', message: 'Translation request failed.' } }, { status: 500 });
  }
}
