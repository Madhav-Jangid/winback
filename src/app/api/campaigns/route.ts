import { connection, NextRequest, NextResponse } from 'next/server';
import { getAppNow } from '@/lib/clock';
import { CAMPAIGN_LIST_FILTERS, createCampaign, listCampaigns, type CampaignListFilter } from '@/lib/campaigns/service';
import { getPool } from '@/lib/db/pool';
import { DEMO_ACTOR_ID, DEMO_MERCHANT_ID } from '@/lib/demo/constants';
import { errorJson, errorResponse, readJson } from '@/lib/http';

/** GET /api/campaigns?status=open */
export async function GET(req: NextRequest) {
  await connection(); // always run at request time; never prerender
  const status = req.nextUrl.searchParams.get('status') ?? 'all';
  if (!(status in CAMPAIGN_LIST_FILTERS)) {
    return errorJson('VALIDATION_ERROR', `Unknown status filter. Use one of: ${Object.keys(CAMPAIGN_LIST_FILTERS).join(', ')}.`, 400);
  }
  try {
    const campaigns = await listCampaigns(getPool(), DEMO_MERCHANT_ID, status as CampaignListFilter);
    return NextResponse.json({ campaigns });
  } catch (err) {
    return errorResponse(err, 'Campaigns GET');
  }
}

/** POST /api/campaigns — create a draft. The server decides its status from readiness checks. */
export async function POST(req: NextRequest) {
  let client;
  try {
    const body = await readJson(req);
    client = await getPool().connect();
    const view = await createCampaign(client, DEMO_MERCHANT_ID, body, getAppNow(), DEMO_ACTOR_ID);
    return NextResponse.json(view, { status: 201 });
  } catch (err) {
    return errorResponse(err, 'Campaigns POST');
  } finally {
    client?.release();
  }
}
