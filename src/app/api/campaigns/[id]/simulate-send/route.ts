import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAppNow } from '@/lib/clock';
import { getPool } from '@/lib/db/pool';
import { DEMO_ACTOR_ID, DEMO_MERCHANT_ID } from '@/lib/demo/constants';
import { errorJson, errorResponse, readOptionalJson } from '@/lib/http';
import { simulateSend } from '@/lib/messaging/service';

/**
 * POST /api/campaigns/:id/simulate-send
 * Runs, resumes, or retries the simulated send. Nothing real is sent. Only an approved campaign
 * whose approval matches its current content can be sent; control customers are never messaged;
 * every recipient is rechecked against current consent, cooldown and budget first. Repeating the
 * request is safe: it never creates a second message for a customer.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return errorJson('NOT_FOUND', 'Campaign not found.', 404);
  let client;
  try {
    const body = await readOptionalJson(req);
    client = await getPool().connect();
    return NextResponse.json(await simulateSend(client, DEMO_MERCHANT_ID, id, body, getAppNow(), DEMO_ACTOR_ID));
  } catch (err) {
    return errorResponse(err, 'Campaign simulate-send');
  } finally {
    client?.release();
  }
}
