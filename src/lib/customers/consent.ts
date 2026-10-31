/**
 * Consent changes happen here, in an explicit workflow of their own, never as a side effect of a
 * campaign action (E-35). Recording an opt-out takes effect immediately: the customer is
 * suppressed from every campaign from now on, including one that is already approved (E-06).
 * `db` must be a single connection (Client/PoolClient).
 */
import { writeAuditEvent } from '@/lib/audit/service';
import { inTransaction } from '@/lib/db/transaction';
import type { Queryable } from '@/lib/db/types';
import { notFound } from '@/lib/errors';

export interface OptOutResult {
  customer_id: string;
  opted_out_at: string;
  already_opted_out: boolean;
}

export async function recordOptOut(db: Queryable, merchantId: string, customerId: string, actorId: string): Promise<OptOutResult> {
  return inTransaction(db, async () => {
    const found = await db.query<{ opted_out_at: Date | null }>(
      'SELECT opted_out_at FROM customers WHERE merchant_id = $1 AND id = $2 FOR UPDATE',
      [merchantId, customerId],
    );
    if (found.rows.length === 0) throw notFound('Customer');
    const existing = found.rows[0].opted_out_at;
    if (existing) return { customer_id: customerId, opted_out_at: existing.toISOString(), already_opted_out: true };

    const updated = await db.query<{ opted_out_at: Date }>(
      'UPDATE customers SET opted_out_at = NOW(), updated_at = NOW() WHERE merchant_id = $1 AND id = $2 RETURNING opted_out_at',
      [merchantId, customerId],
    );
    await writeAuditEvent({
      merchant_id: merchantId, actor_id: actorId, event_type: 'opt_out_recorded',
      entity_type: 'customer', entity_id: customerId, metadata: { source: 'merchant_recorded' },
    }, db);
    return { customer_id: customerId, opted_out_at: updated.rows[0].opted_out_at.toISOString(), already_opted_out: false };
  });
}
