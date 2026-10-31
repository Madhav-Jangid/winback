import { connection, NextRequest, NextResponse } from 'next/server';
import { getAppNow } from '@/lib/clock';
import { customerQuerySchema, getCustomerDirectory } from '@/lib/customers/service';
import { getPool } from '@/lib/db/pool';
import { DEMO_MERCHANT_ID } from '@/lib/demo/constants';

/** GET /api/customers?filter=at_risk&search=nair */
export async function GET(req: NextRequest) {
  await connection(); // always run at request time; never prerender
  const params = Object.fromEntries(req.nextUrl.searchParams);
  const parsed = customerQuerySchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Invalid customer query.', details: { issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) } } },
      { status: 400 },
    );
  }

  try {
    const directory = await getCustomerDirectory(getPool(), DEMO_MERCHANT_ID, getAppNow(), parsed.data);
    return NextResponse.json({
      customers: directory.customers,
      total: directory.customers.length,
      counts: directory.counts,
      policy: directory.policy,
      as_of: directory.as_of,
      query: parsed.data,
    });
  } catch (err) {
    console.error('[Customers API]', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: { code: 'DATABASE_ERROR', message: 'Failed to load customers. Check the database connection.' } },
      { status: 503 },
    );
  }
}
