import { messageKey } from '@/lib/messaging/delivery';
import type { Queryable } from '@/lib/db/types';
import type { SuppressionReason } from '@/types';

/** Queue one message per customer. Re-running is harmless: duplicates are ignored by the unique keys. */
export async function insertQueuedMessages(
  db: Queryable, campaignId: string, version: number, customerIds: readonly string[], costMinor: number,
): Promise<void> {
  if (customerIds.length === 0) return;
  await db.query(
    `INSERT INTO campaign_messages (campaign_id, customer_id, campaign_version, idempotency_key, status, simulated_cost_minor)
     SELECT $1::uuid, t.customer_id, $2::int, t.key, 'queued', $3::bigint
       FROM unnest($4::uuid[], $5::text[]) AS t(customer_id, key)
     ON CONFLICT DO NOTHING`,
    [campaignId, version, costMinor, customerIds, customerIds.map((id) => messageKey(campaignId, id, version))],
  );
}

/** Record that treatment customers will not be messaged. They stay in the treatment group. */
export async function suppressRecipients(
  db: Queryable, campaignId: string, items: ReadonlyArray<{ customer_id: string; reason: SuppressionReason }>,
): Promise<void> {
  if (items.length === 0) return;
  await db.query(
    `UPDATE campaign_recipients r SET eligibility_status = 'ineligible', suppression_reason = v.reason
       FROM unnest($2::uuid[], $3::text[]) AS v(customer_id, reason)
      WHERE r.campaign_id = $1 AND r.customer_id = v.customer_id AND r.group_assignment = 'treatment'`,
    [campaignId, items.map((i) => i.customer_id), items.map((i) => i.reason)],
  );
}

export interface QueuedMessage { id: string; customer_id: string; attempts: number }

/** Queued messages in a fixed order, locked for this transaction. */
export async function listQueued(db: Queryable, campaignId: string): Promise<QueuedMessage[]> {
  const result = await db.query<QueuedMessage>(
    `SELECT id, customer_id, attempts FROM campaign_messages
      WHERE campaign_id = $1 AND status = 'queued' ORDER BY customer_id FOR UPDATE`,
    [campaignId],
  );
  return result.rows;
}

/** Settle queued messages. Only rows still queued are touched, so a repeat changes nothing. */
export async function applyDeliveryResults(
  db: Queryable, results: ReadonlyArray<{ id: string; status: 'delivered' | 'failed'; code: string | null }>, at: Date,
): Promise<void> {
  if (results.length === 0) return;
  await db.query(
    `UPDATE campaign_messages m SET status = v.status, attempts = m.attempts + 1, sent_at = $4::timestamptz,
            delivered_at = CASE WHEN v.status = 'delivered' THEN $4::timestamptz ELSE NULL END, failure_code = v.code
       FROM unnest($1::uuid[], $2::text[], $3::text[]) AS v(id, status, code)
      WHERE m.id = v.id AND m.status = 'queued'`,
    [results.map((r) => r.id), results.map((r) => r.status), results.map((r) => r.code), at],
  );
}

/** Failed deliveries worth retrying (not those suppressed on a previous retry), in a fixed order. */
export async function listRetryableFailed(db: Queryable, campaignId: string): Promise<string[]> {
  const result = await db.query<{ customer_id: string }>(
    `SELECT customer_id FROM campaign_messages
      WHERE campaign_id = $1 AND status = 'failed' AND (failure_code IS NULL OR failure_code NOT LIKE 'SUPPRESSED%')
      ORDER BY customer_id`,
    [campaignId],
  );
  return result.rows.map((r) => r.customer_id);
}

export async function requeueMessages(db: Queryable, campaignId: string, customerIds: readonly string[]): Promise<void> {
  if (customerIds.length === 0) return;
  await db.query(
    `UPDATE campaign_messages SET status = 'queued', failure_code = NULL, delivered_at = NULL
      WHERE campaign_id = $1 AND customer_id = ANY($2::uuid[]) AND status = 'failed'`,
    [campaignId, customerIds],
  );
}

export async function markSuppressedOnRetry(db: Queryable, campaignId: string, customerIds: readonly string[]): Promise<void> {
  if (customerIds.length === 0) return;
  await db.query(
    `UPDATE campaign_messages SET failure_code = 'SUPPRESSED_ON_RETRY'
      WHERE campaign_id = $1 AND customer_id = ANY($2::uuid[]) AND status = 'failed'`,
    [campaignId, customerIds],
  );
}

export interface MessageCounts {
  queued: number;
  delivered: number;
  failed: number;
  /** Failed and still worth retrying. */
  retryable_failed: number;
  /** Offer cost reserved by messages that are still live. */
  reserved_minor: number;
}

export async function getMessageCounts(db: Queryable, campaignId: string): Promise<MessageCounts> {
  const result = await db.query<Record<keyof MessageCounts, string>>(
    `SELECT COUNT(*) FILTER (WHERE status = 'queued') AS queued,
            COUNT(*) FILTER (WHERE status = 'delivered') AS delivered,
            COUNT(*) FILTER (WHERE status = 'failed') AS failed,
            COUNT(*) FILTER (WHERE status = 'failed' AND (failure_code IS NULL OR failure_code NOT LIKE 'SUPPRESSED%')) AS retryable_failed,
            COALESCE(SUM(simulated_cost_minor) FILTER (WHERE failure_code IS DISTINCT FROM 'SUPPRESSED_ON_RETRY'), 0) AS reserved_minor
       FROM campaign_messages WHERE campaign_id = $1`,
    [campaignId],
  );
  const r = result.rows[0];
  return {
    queued: Number(r.queued), delivered: Number(r.delivered), failed: Number(r.failed),
    retryable_failed: Number(r.retryable_failed), reserved_minor: Number(r.reserved_minor),
  };
}

export interface RecipientGroupRow {
  group_assignment: 'treatment' | 'control' | null;
  suppression_reason: SuppressionReason | null;
  n: number;
}

export async function getRecipientGroups(db: Queryable, campaignId: string): Promise<RecipientGroupRow[]> {
  const result = await db.query<{ group_assignment: RecipientGroupRow['group_assignment']; suppression_reason: SuppressionReason | null; n: string }>(
    `SELECT group_assignment, suppression_reason, COUNT(*) AS n FROM campaign_recipients
      WHERE campaign_id = $1 GROUP BY group_assignment, suppression_reason`,
    [campaignId],
  );
  return result.rows.map((r) => ({ ...r, n: Number(r.n) }));
}

export interface FailedDelivery { customer_id: string; display_name: string; failure_code: string | null; attempts: number }
export interface SendSuppression { customer_id: string; display_name: string; reason: SuppressionReason }

const DETAIL_LIMIT = 50;

export async function listFailedDeliveries(db: Queryable, campaignId: string): Promise<FailedDelivery[]> {
  const result = await db.query<FailedDelivery>(
    `SELECT m.customer_id, cu.display_name, m.failure_code, m.attempts
       FROM campaign_messages m JOIN customers cu ON cu.id = m.customer_id
      WHERE m.campaign_id = $1 AND m.status = 'failed' ORDER BY cu.display_name LIMIT $2`,
    [campaignId, DETAIL_LIMIT],
  );
  return result.rows;
}

/** Treatment customers dropped by the send-time recheck (not those cut by the budget at approval). */
export async function listSendTimeSuppressions(db: Queryable, campaignId: string): Promise<SendSuppression[]> {
  const result = await db.query<{ customer_id: string; display_name: string; suppression_reason: SuppressionReason }>(
    `SELECT r.customer_id, cu.display_name, r.suppression_reason
       FROM campaign_recipients r JOIN customers cu ON cu.id = r.customer_id
      WHERE r.campaign_id = $1 AND r.group_assignment = 'treatment'
        AND r.suppression_reason IS NOT NULL AND r.suppression_reason <> 'BUDGET_EXCEEDED'
      ORDER BY cu.display_name LIMIT $2`,
    [campaignId, DETAIL_LIMIT],
  );
  return result.rows.map((r) => ({ customer_id: r.customer_id, display_name: r.display_name, reason: r.suppression_reason }));
}
