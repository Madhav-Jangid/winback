import { connection, NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAppNow } from '@/lib/clock';
import { getCustomerDetail } from '@/lib/customers/service';
import { getPool } from '@/lib/db/pool';
import { DEMO_MERCHANT_ID } from '@/lib/demo/constants';

const notFound = () =>
  NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Customer not found.' } }, { status: 404 });

/** GET /api/customers/:id — purchase history, risk explanation, and contact status. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return notFound();

  try {
    const detail = await getCustomerDetail(getPool(), DEMO_MERCHANT_ID, id, getAppNow());
    return detail ? NextResponse.json(detail) : notFound();
  } catch (err) {
    console.error('[Customer Detail API]', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: { code: 'DATABASE_ERROR', message: 'Failed to load customer. Check the database connection.' } },
      { status: 503 },
    );
  }
}
