import { connection, NextResponse } from 'next/server';
import { getAppNow } from '@/lib/clock';
import { getPool } from '@/lib/db/pool';
import { DEMO_MERCHANT_ID } from '@/lib/demo/constants';
import { getServerEnv } from '@/lib/env';
import { getDashboardStats } from '@/lib/repositories/dashboard';

export async function GET() {
  await connection(); // always run at request time; never prerender
  try {
    const isDemo = getServerEnv().DEMO_MODE === 'true';
    const stats = await getDashboardStats(getPool(), DEMO_MERCHANT_ID, getAppNow(isDemo), isDemo);
    return NextResponse.json(stats);
  } catch (err) {
    console.error('[Dashboard API]', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: { code: 'DATABASE_ERROR', message: 'Failed to load dashboard data. Check DATABASE_URL and run npm run db:setup.' } },
      { status: 503 },
    );
  }
}
