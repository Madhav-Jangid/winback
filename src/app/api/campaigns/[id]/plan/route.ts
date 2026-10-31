import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAppNow } from '@/lib/clock';
import { getPool } from '@/lib/db/pool';
import { DEMO_ACTOR_ID, DEMO_MERCHANT_ID } from '@/lib/demo/constants';
import { errorJson, errorResponse, readOptionalJson } from '@/lib/http';
import { generateCampaignPlan } from '@/lib/planner/service';

/**
 * POST /api/campaigns/:id/plan — draft a plan with Gemini (or the labelled demo planner when no
 * key is configured). Body: optional { use_demo: true } after a Gemini failure. Read-only for the
 * campaign's offer and message; the merchant applies a plan in the builder.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return errorJson('NOT_FOUND', 'Campaign not found.', 404);
  let client;
  try {
    const body = await readOptionalJson(req);
    client = await getPool().connect();
    const result = await generateCampaignPlan(client, DEMO_MERCHANT_ID, id, body, getAppNow(), DEMO_ACTOR_ID);
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err, 'Campaign plan');
  } finally {
    client?.release();
  }
}
