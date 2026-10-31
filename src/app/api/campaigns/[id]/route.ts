import { connection, NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAppNow } from '@/lib/clock';
import { getCampaignView, updateCampaign } from '@/lib/campaigns/service';
import { getPool } from '@/lib/db/pool';
import { DEMO_ACTOR_ID, DEMO_MERCHANT_ID } from '@/lib/demo/constants';
import { errorJson, errorResponse, readJson } from '@/lib/http';

type Ctx = { params: Promise<{ id: string }> };
const isUuid = (id: string) => z.string().uuid().safeParse(id).success;
const notFound = () => errorJson('NOT_FOUND', 'Campaign not found.', 404);

/** GET /api/campaigns/:id — campaign, live segment preview, and readiness issues. */
export async function GET(_req: NextRequest, { params }: Ctx) {
  await connection();
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  try {
    return NextResponse.json(await getCampaignView(getPool(), DEMO_MERCHANT_ID, id, getAppNow()));
  } catch (err) {
    return errorResponse(err, 'Campaign GET');
  }
}

/** PATCH /api/campaigns/:id — partial update; requires expected_version. */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  let client;
  try {
    const body = await readJson(req);
    client = await getPool().connect();
    return NextResponse.json(await updateCampaign(client, DEMO_MERCHANT_ID, id, body, getAppNow(), DEMO_ACTOR_ID));
  } catch (err) {
    return errorResponse(err, 'Campaign PATCH');
  } finally {
    client?.release();
  }
}
