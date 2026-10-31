import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getPool } from '@/lib/db/pool';
import { DEMO_ACTOR_ID, DEMO_MERCHANT_ID } from '@/lib/demo/constants';
import { recordOptOut } from '@/lib/customers/consent';
import { errorJson, errorResponse } from '@/lib/http';

/**
 * POST /api/customers/:id/opt-out — record that a customer opted out. Immediate and permanent for
 * the demo (Reset demo data restores the seed). Consent is never changed from campaign screens.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return errorJson('NOT_FOUND', 'Customer not found.', 404);
  let client;
  try {
    client = await getPool().connect();
    return NextResponse.json(await recordOptOut(client, DEMO_MERCHANT_ID, id, DEMO_ACTOR_ID));
  } catch (err) {
    return errorResponse(err, 'Customer opt-out');
  } finally {
    client?.release();
  }
}
