import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { approveCampaign } from '@/lib/approvals/service';
import { getAppNow } from '@/lib/clock';
import { getPool } from '@/lib/db/pool';
import { DEMO_ACTOR_ID, DEMO_MERCHANT_ID } from '@/lib/demo/constants';
import { errorJson, errorResponse, readJson } from '@/lib/http';

/**
 * POST /api/campaigns/:id/approve  { expected_version }
 * Approves exactly the version the merchant reviewed. Readiness, eligibility, the control split
 * and the budget are recomputed on the server; the client's view is never trusted.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return errorJson('NOT_FOUND', 'Campaign not found.', 404);
  let client;
  try {
    const body = await readJson(req);
    client = await getPool().connect();
    return NextResponse.json(await approveCampaign(client, DEMO_MERCHANT_ID, id, body, getAppNow(), DEMO_ACTOR_ID));
  } catch (err) {
    return errorResponse(err, 'Campaign approve');
  } finally {
    client?.release();
  }
}
