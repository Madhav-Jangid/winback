import { connection, NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { LIMITS } from '@/lib/campaigns/rules';
import { SEGMENT_TYPES } from '@/lib/campaigns/segments';
import { previewSegmentFor } from '@/lib/campaigns/service';
import { getAppNow } from '@/lib/clock';
import { getPool } from '@/lib/db/pool';
import { DEMO_MERCHANT_ID } from '@/lib/demo/constants';
import { errorJson, errorResponse } from '@/lib/http';
import { fieldErrors } from '@/lib/campaigns/schema';

const querySchema = z.object({
  segment: z.enum(SEGMENT_TYPES),
  cooldown_days: z.coerce.number().int().min(LIMITS.cooldownDaysMin).max(LIMITS.cooldownDaysMax),
  frequency_cap: z.coerce.number().int().min(LIMITS.frequencyCapMin).max(LIMITS.frequencyCapMax),
  campaign_id: z.string().uuid().optional(),
});

/** GET /api/segments/:segment/preview?cooldown_days=30&frequency_cap=1[&campaign_id=] */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const parsed = querySchema.safeParse({ ...Object.fromEntries(req.nextUrl.searchParams), segment: id });
  if (!parsed.success) {
    return errorJson('VALIDATION_ERROR', 'Invalid segment preview request.', 400, { fields: fieldErrors(parsed.error) });
  }
  const { segment, cooldown_days, frequency_cap, campaign_id } = parsed.data;
  try {
    const { preview, currency } = await previewSegmentFor(
      getPool(), DEMO_MERCHANT_ID, getAppNow(), segment, { cooldown_days, frequency_cap }, campaign_id,
    );
    // Aggregate counts only: the preview does not expose who is in the segment.
    const { eligible_customer_ids: _omit, ...counts } = preview;
    void _omit;
    return NextResponse.json({ ...counts, currency });
  } catch (err) {
    return errorResponse(err, 'Segment preview');
  }
}
