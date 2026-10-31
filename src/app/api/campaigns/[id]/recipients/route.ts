import { connection, NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCampaignRecipients } from '@/lib/approvals/service';
import { fieldErrors } from '@/lib/campaigns/schema';
import { getPool } from '@/lib/db/pool';
import { DEMO_MERCHANT_ID } from '@/lib/demo/constants';
import { SUPPRESSION_REASONS } from '@/lib/eligibility/reasons';
import { errorJson, errorResponse } from '@/lib/http';

const querySchema = z.object({
  group: z.enum(['treatment', 'control', 'none']).optional(),
  reason: z.enum([...SUPPRESSION_REASONS, 'none']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/** GET /api/campaigns/:id/recipients?group=control&reason=none — the approved snapshot and each reason. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return errorJson('NOT_FOUND', 'Campaign not found.', 404);
  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return errorJson('VALIDATION_ERROR', 'Invalid recipient query.', 400, { fields: fieldErrors(parsed.error) });
  try {
    return NextResponse.json(await getCampaignRecipients(getPool(), DEMO_MERCHANT_ID, id, parsed.data));
  } catch (err) {
    return errorResponse(err, 'Campaign recipients');
  }
}
