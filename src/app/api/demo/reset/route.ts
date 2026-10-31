import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db/pool';
import { DEMO_ACTOR_ID } from '@/lib/demo/constants';
import { resetDemoData } from '@/lib/demo/seed';
import { getServerEnv } from '@/lib/env';

export async function POST() {
  if (getServerEnv().DEMO_MODE !== 'true') {
    return NextResponse.json(
      { error: { code: 'DEMO_MODE_DISABLED', message: 'Demo reset is only available when DEMO_MODE=true.' } },
      { status: 403 },
    );
  }

  let client;
  try {
    client = await getPool().connect();
    const summary = await resetDemoData(client, DEMO_ACTOR_ID);
    return NextResponse.json({
      success: true,
      message: `Demo data reset: ${summary.customers} customers, ${summary.purchases} purchases.`,
      summary,
    });
  } catch (err) {
    console.error('[Demo Reset API]', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: { code: 'RESET_FAILED', message: 'Demo reset failed and was rolled back. Check the database connection.' } },
      { status: 503 },
    );
  } finally {
    client?.release();
  }
}
