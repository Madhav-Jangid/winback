import { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertCanSend } from '@/lib/approvals/guard';
import { getPool } from '@/lib/db/pool';
import { DEMO_MERCHANT_ID } from '@/lib/demo/constants';
import { AppError, notFound } from '@/lib/errors';
import { errorJson, errorResponse } from '@/lib/http';
import { getCampaign } from '@/lib/repositories/campaigns';

/**
 * POST /api/campaigns/:id/simulate-send
 * The send gate is enforced here: only an approved campaign whose approval matches its current
 * content can proceed (CA-01 to CA-08). The send job itself is built in the next phase, so a
 * campaign that passes the gate currently gets 501. Nothing is sent or changed either way.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return errorJson('NOT_FOUND', 'Campaign not found.', 404);
  try {
    const campaign = await getCampaign(getPool(), DEMO_MERCHANT_ID, id);
    if (!campaign) throw notFound('Campaign');
    assertCanSend(campaign);
    throw new AppError('SEND_NOT_IMPLEMENTED', 'The approval checks passed, but simulated sending is not built yet.', 501);
  } catch (err) {
    return errorResponse(err, 'Campaign simulate-send');
  }
}
