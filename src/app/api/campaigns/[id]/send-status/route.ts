import { connection, NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getPool } from '@/lib/db/pool';
import { DEMO_MERCHANT_ID } from '@/lib/demo/constants';
import { errorJson, errorResponse } from '@/lib/http';
import { getSendProgress } from '@/lib/messaging/service';

/** GET /api/campaigns/:id/send-status — persisted progress of the simulated send (safe to poll or refresh). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return errorJson('NOT_FOUND', 'Campaign not found.', 404);
  try {
    return NextResponse.json(await getSendProgress(getPool(), DEMO_MERCHANT_ID, id));
  } catch (err) {
    return errorResponse(err, 'Campaign send-status');
  }
}
