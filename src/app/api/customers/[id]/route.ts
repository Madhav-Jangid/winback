import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db/pool';
import { assessRisk } from '@/lib/risk/engine';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const customerRes = await query(
      `SELECT * FROM customers WHERE id = $1`,
      [id],
    );
    if (customerRes.rows.length === 0) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Customer not found.' } }, { status: 404 });
    }

    const customer = customerRes.rows[0] as Record<string, unknown>;

    const purchasesRes = await query(
      `SELECT * FROM purchases WHERE customer_id = $1 ORDER BY occurred_at DESC`,
      [id],
    );

    const completedPurchases = purchasesRes.rows.filter((p: Record<string, unknown>) => p.status === 'completed') as { occurred_at: string }[];
    const risk = assessRisk(id, completedPurchases);

    if (customer.opted_out_at) {
      risk.status = 'opted_out';
      risk.reason = 'Customer has opted out of marketing communications.';
    }

    return NextResponse.json({
      ...customer,
      purchases: purchasesRes.rows,
      risk,
    });
  } catch (err) {
    console.error('[Customer Detail API]', err);
    return NextResponse.json(
      { error: { code: 'DATABASE_ERROR', message: 'Failed to load customer.' } },
      { status: 503 },
    );
  }
}
