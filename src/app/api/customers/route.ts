import { connection, NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db/pool';
import { assessRisk } from '@/lib/risk/engine';

const DEMO_MERCHANT_ID = '00000000-0000-0000-0000-000000000001';

export async function GET(req: NextRequest) {
  await connection(); // always run at request time; never prerender
  try {
    const { searchParams } = new URL(req.url);
    const filter = searchParams.get('filter') || 'all';
    const search = searchParams.get('search') || '';
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 100);
    const offset = (page - 1) * limit;

    // Get customers with purchase counts
    const customersRes = await query<{
      id: string;
      display_name: string;
      preferred_language: string;
      consent_status: string;
      opted_out_at: string | null;
      created_at: string;
      updated_at: string;
      purchase_count: string;
      last_purchase_at: string | null;
    }>(
      `SELECT c.*,
        COUNT(p.id) FILTER (WHERE p.status = 'completed') as purchase_count,
        MAX(p.occurred_at) FILTER (WHERE p.status = 'completed') as last_purchase_at
       FROM customers c
       LEFT JOIN purchases p ON p.customer_id = c.id
       WHERE c.merchant_id = $1
         AND ($2 = '' OR c.display_name ILIKE '%' || $2 || '%')
       GROUP BY c.id
       ORDER BY c.display_name
       LIMIT $3 OFFSET $4`,
      [DEMO_MERCHANT_ID, search, limit, offset],
    );

    // Get all purchases for risk calculation
    const purchasesRes = await query<{ customer_id: string; occurred_at: string; status: string }>(
      `SELECT customer_id, occurred_at, status FROM purchases WHERE merchant_id = $1`,
      [DEMO_MERCHANT_ID],
    );

    // Group purchases by customer
    const purchasesByCustomer = new Map<string, { occurred_at: string; status: string }[]>();
    for (const p of purchasesRes.rows) {
      if (!purchasesByCustomer.has(p.customer_id)) {
        purchasesByCustomer.set(p.customer_id, []);
      }
      purchasesByCustomer.get(p.customer_id)!.push(p);
    }

    // Assess risk for each customer
    const customersWithRisk = customersRes.rows.map((c) => {
      const purchases = purchasesByCustomer.get(c.id) ?? [];
      const completedPurchases = purchases.filter((p) => p.status === 'completed');
      const risk = assessRisk(c.id, completedPurchases);

      // Apply opted-out status override
      if (c.opted_out_at) {
        risk.status = 'opted_out';
        risk.reason = 'Customer has opted out of marketing communications.';
      }

      return {
        ...c,
        purchase_count: parseInt(c.purchase_count, 10),
        risk,
      };
    });

    // Apply filter
    const filtered = customersWithRisk.filter((c) => {
      if (filter === 'all') return true;
      if (filter === 'at_risk') return c.risk.status === 'at_risk';
      if (filter === 'healthy') return c.risk.status === 'healthy';
      if (filter === 'insufficient_history') return c.risk.status === 'insufficient_history';
      if (filter === 'opted_out') return c.risk.status === 'opted_out';
      if (filter === 'no_consent') return c.consent_status !== 'consented';
      return true;
    });

    return NextResponse.json({
      customers: filtered,
      total: filtered.length,
      page,
      limit,
    });
  } catch (err) {
    console.error('[Customers API]', err);
    return NextResponse.json(
      { error: { code: 'DATABASE_ERROR', message: 'Failed to load customers.' } },
      { status: 503 },
    );
  }
}
