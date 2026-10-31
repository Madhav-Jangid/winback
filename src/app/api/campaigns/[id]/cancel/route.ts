import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAppNow } from '@/lib/clock';
import { cancelCampaign } from '@/lib/campaigns/service';
import { getPool } from '@/lib/db/pool';
import { DEMO_ACTOR_ID, DEMO_MERCHANT_ID } from '@/lib/demo/constants';
import { errorJson, errorResponse } from '@/lib/http';

/** POST /api/campaigns/:id/cancel — allowed before sending starts. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return errorJson('NOT_FOUND', 'Campaign not found.', 404);
  let client;
  try {
    client = await getPool().connect();
    return NextResponse.json(await cancelCampaign(client, DEMO_MERCHANT_ID, id, getAppNow(), DEMO_ACTOR_ID));
  } catch (err) {
    return errorResponse(err, 'Campaign cancel');
  } finally {
    client?.release();
  }
}
