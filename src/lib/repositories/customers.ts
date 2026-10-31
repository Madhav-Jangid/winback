import type { Queryable } from '@/lib/db/types';
import type { ConsentStatus, PurchaseStatus } from '@/types';

export interface CustomerPurchase {
  occurred_at: string;
  status: PurchaseStatus;
  amount_minor: number;
}

export interface CustomerWithPurchases {
  id: string;
  display_name: string;
  preferred_language: string;
  consent_status: ConsentStatus;
  opted_out_at: string | null;
  purchases: CustomerPurchase[];
}

const iso = (value: Date | string | null): string | null =>
  value === null ? null : value instanceof Date ? value.toISOString() : value;

/** All of a merchant's customers with their purchases (oldest first), in two queries. */
export async function listCustomersWithPurchases(db: Queryable, merchantId: string): Promise<CustomerWithPurchases[]> {
  const customers = await db.query<{
    id: string; display_name: string; preferred_language: string;
    consent_status: ConsentStatus; opted_out_at: Date | null;
  }>(
    `SELECT id, display_name, preferred_language, consent_status, opted_out_at
       FROM customers WHERE merchant_id = $1 ORDER BY display_name`,
    [merchantId],
  );
  const purchases = await db.query<{ customer_id: string; occurred_at: Date; status: PurchaseStatus; amount_minor: string }>(
    `SELECT customer_id, occurred_at, status, amount_minor
       FROM purchases WHERE merchant_id = $1 ORDER BY occurred_at`,
    [merchantId],
  );

  const byCustomer = new Map<string, CustomerPurchase[]>();
  for (const row of purchases.rows) {
    const list = byCustomer.get(row.customer_id) ?? [];
    // BIGINT arrives as a string; demo amounts are far below Number.MAX_SAFE_INTEGER.
    list.push({ occurred_at: iso(row.occurred_at)!, status: row.status, amount_minor: Number(row.amount_minor) });
    byCustomer.set(row.customer_id, list);
  }

  return customers.rows.map((c) => ({
    ...c,
    opted_out_at: iso(c.opted_out_at),
    purchases: byCustomer.get(c.id) ?? [],
  }));
}
