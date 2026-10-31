import type { Queryable } from '@/lib/db/types';
import type { ConsentStatus, PurchaseStatus } from '@/types';

export interface CustomerPurchase {
  id: string;
  occurred_at: string;
  status: PurchaseStatus;
  amount_minor: number;
  currency: string;
  source: string;
}

export interface CustomerWithPurchases {
  id: string;
  display_name: string;
  preferred_language: string;
  consent_status: ConsentStatus;
  opted_out_at: string | null;
  /** Oldest first, all statuses (refunded/cancelled included). */
  purchases: CustomerPurchase[];
}

/** Campaign-message history used for frequency caps, across all of a merchant's campaigns (E-26). */
export interface MessageStats {
  last_sent_at: string;
  count_in_window: number;
}

export interface CustomerMessage {
  campaign_id: string;
  campaign_name: string;
  status: string;
  sent_at: string | null;
  delivered_at: string | null;
}

const iso = (value: Date | string | null): string | null =>
  value === null ? null : value instanceof Date ? value.toISOString() : value;

type CustomerRow = {
  id: string; display_name: string; preferred_language: string;
  consent_status: ConsentStatus; opted_out_at: Date | null;
};
type PurchaseRow = {
  id: string; customer_id: string; occurred_at: Date; status: PurchaseStatus;
  amount_minor: string; currency: string; source: string;
};

const CUSTOMER_COLUMNS = 'id, display_name, preferred_language, consent_status, opted_out_at';
const PURCHASE_COLUMNS = 'id, customer_id, occurred_at, status, amount_minor, currency, source';

function assemble(customers: CustomerRow[], purchases: PurchaseRow[]): CustomerWithPurchases[] {
  const byCustomer = new Map<string, CustomerPurchase[]>();
  for (const row of purchases) {
    const list = byCustomer.get(row.customer_id) ?? [];
    list.push({
      id: row.id,
      occurred_at: iso(row.occurred_at)!,
      status: row.status,
      // BIGINT arrives as a string; demo amounts are far below Number.MAX_SAFE_INTEGER.
      amount_minor: Number(row.amount_minor),
      currency: row.currency,
      source: row.source,
    });
    byCustomer.set(row.customer_id, list);
  }
  return customers.map((c) => ({ ...c, opted_out_at: iso(c.opted_out_at), purchases: byCustomer.get(c.id) ?? [] }));
}

/** All of a merchant's customers with their purchases, in two queries. */
export async function listCustomersWithPurchases(db: Queryable, merchantId: string): Promise<CustomerWithPurchases[]> {
  const customers = await db.query<CustomerRow>(
    `SELECT ${CUSTOMER_COLUMNS} FROM customers WHERE merchant_id = $1 ORDER BY display_name`,
    [merchantId],
  );
  const purchases = await db.query<PurchaseRow>(
    `SELECT ${PURCHASE_COLUMNS} FROM purchases WHERE merchant_id = $1 ORDER BY occurred_at, id`,
    [merchantId],
  );
  return assemble(customers.rows, purchases.rows);
}

/** One customer, scoped to the merchant. Returns null if it does not exist for this merchant. */
export async function getCustomerWithPurchases(
  db: Queryable,
  merchantId: string,
  customerId: string,
): Promise<CustomerWithPurchases | null> {
  const customers = await db.query<CustomerRow>(
    `SELECT ${CUSTOMER_COLUMNS} FROM customers WHERE merchant_id = $1 AND id = $2`,
    [merchantId, customerId],
  );
  if (customers.rows.length === 0) return null;
  const purchases = await db.query<PurchaseRow>(
    `SELECT ${PURCHASE_COLUMNS} FROM purchases WHERE merchant_id = $1 AND customer_id = $2 ORDER BY occurred_at, id`,
    [merchantId, customerId],
  );
  return assemble(customers.rows, purchases.rows)[0];
}

/**
 * Last message time and number of messages since `windowStart`, per customer.
 * Failed simulated sends do not count toward frequency caps.
 */
export async function getMessageStatsByCustomer(
  db: Queryable,
  merchantId: string,
  windowStart: Date,
  customerId?: string,
): Promise<Map<string, MessageStats>> {
  const result = await db.query<{ customer_id: string; last_sent_at: Date; count_in_window: string }>(
    `SELECT m.customer_id, MAX(m.sent_at) AS last_sent_at,
            COUNT(*) FILTER (WHERE m.sent_at >= $2) AS count_in_window
       FROM campaign_messages m JOIN campaigns c ON c.id = m.campaign_id
      WHERE c.merchant_id = $1 AND m.sent_at IS NOT NULL AND m.status <> 'failed'
        AND ($3::uuid IS NULL OR m.customer_id = $3::uuid)
      GROUP BY m.customer_id`,
    [merchantId, windowStart, customerId ?? null],
  );
  return new Map(result.rows.map((r) => [
    r.customer_id,
    { last_sent_at: iso(r.last_sent_at)!, count_in_window: Number(r.count_in_window) },
  ]));
}

export async function listCustomerMessages(db: Queryable, merchantId: string, customerId: string): Promise<CustomerMessage[]> {
  const result = await db.query<{ campaign_id: string; campaign_name: string; status: string; sent_at: Date | null; delivered_at: Date | null }>(
    `SELECT m.campaign_id, c.name AS campaign_name, m.status, m.sent_at, m.delivered_at
       FROM campaign_messages m JOIN campaigns c ON c.id = m.campaign_id
      WHERE c.merchant_id = $1 AND m.customer_id = $2
      ORDER BY m.sent_at DESC NULLS LAST`,
    [merchantId, customerId],
  );
  return result.rows.map((r) => ({ ...r, sent_at: iso(r.sent_at), delivered_at: iso(r.delivered_at) }));
}
