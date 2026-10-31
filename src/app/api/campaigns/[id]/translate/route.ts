import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAppNow } from '@/lib/clock';
import { getPool } from '@/lib/db/pool';
import { DEMO_ACTOR_ID, DEMO_MERCHANT_ID } from '@/lib/demo/constants';
import { errorJson, errorResponse, readOptionalJson } from '@/lib/http';
import { translateCampaign } from '@/lib/localization/service';

/**
 * POST /api/campaigns/:id/translate — translate the English message into the campaign language
 * with Sarvam (or the labelled demo translator when no key is configured). Body, all optional:
 * { force: true } to replace a current translation, { use_demo: true } after a failure.
 * Saves the result as a new campaign version; on failure nothing is saved.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return errorJson('NOT_FOUND', 'Campaign not found.', 404);
  let client;
  try {
    const body = await readOptionalJson(req);
    client = await getPool().connect();
    return NextResponse.json(await translateCampaign(client, DEMO_MERCHANT_ID, id, body, getAppNow(), DEMO_ACTOR_ID));
  } catch (err) {
    return errorResponse(err, 'Campaign translate');
  } finally {
    client?.release();
  }
}
