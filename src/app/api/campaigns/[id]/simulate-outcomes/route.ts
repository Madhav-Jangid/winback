import { connection, NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getPool } from '@/lib/db/pool';
import { DEMO_ACTOR_ID, DEMO_MERCHANT_ID } from '@/lib/demo/constants';
import { errorJson, errorResponse } from '@/lib/http';
import { simulateCampaignOutcomes } from '@/lib/simulation/outcomes-service';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return errorJson('NOT_FOUND', 'Campaign not found.', 404);
  let client;
  try {
    client = await getPool().connect();
    return NextResponse.json(await simulateCampaignOutcomes(client, DEMO_MERCHANT_ID, id, DEMO_ACTOR_ID));
  } catch (error) {
    return errorResponse(error, 'Simulate campaign outcomes');
  } finally {
    client?.release();
  }
}
