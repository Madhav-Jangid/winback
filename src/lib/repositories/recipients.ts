import type { Queryable } from '@/lib/db/types';
import type { EligibilityStatus, GroupAssignment, SuppressionReason } from '@/types';

export interface RecipientRow {
  customer_id: string;
  /** NULL: outside the experiment (suppressed before assignment). */
  group_assignment: GroupAssignment | null;
  eligibility_status: EligibilityStatus;
  /** Why this customer will not be messaged; NULL means they will be. */
  suppression_reason: SuppressionReason | null;
}

const CHUNK = 500;

/** Replace a campaign's recipient snapshot. Call inside the approval transaction. */
export async function replaceRecipients(db: Queryable, campaignId: string, version: number, rows: readonly RecipientRow[]): Promise<void> {
  await db.query('DELETE FROM campaign_recipients WHERE campaign_id = $1', [campaignId]);
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const placeholders = chunk.map((_, r) => `(${[1, 2, 3, 4, 5, 6].map((c) => `$${r * 6 + c}`).join(', ')})`).join(', ');
    await db.query(
      `INSERT INTO campaign_recipients (campaign_id, customer_id, group_assignment, eligibility_status, suppression_reason, campaign_version)
       VALUES ${placeholders}`,
      chunk.flatMap((r) => [campaignId, r.customer_id, r.group_assignment, r.eligibility_status, r.suppression_reason, version]),
    );
  }
}

/** The snapshot belongs to an approval; remove it when the approval is invalidated. */
export async function deleteRecipients(db: Queryable, campaignId: string): Promise<void> {
  await db.query('DELETE FROM campaign_recipients WHERE campaign_id = $1', [campaignId]);
}

export interface RecipientListItem extends RecipientRow {
  display_name: string;
  preferred_language: string;
  consent_status: string;
  campaign_version: number;
}

export interface RecipientFilter {
  /** 'none' selects customers outside the experiment. */
  group?: GroupAssignment | 'none';
  reason?: SuppressionReason | 'none';
  limit: number;
  offset: number;
}

export async function listRecipients(
  db: Queryable, merchantId: string, campaignId: string, filter: RecipientFilter,
): Promise<{ items: RecipientListItem[]; total: number }> {
  const where = `c.merchant_id = $1 AND r.campaign_id = $2
    AND ($3::text IS NULL OR ($3 = 'none' AND r.group_assignment IS NULL) OR r.group_assignment = $3)
    AND ($4::text IS NULL OR ($4 = 'none' AND r.suppression_reason IS NULL) OR r.suppression_reason = $4)`;
  const params = [merchantId, campaignId, filter.group ?? null, filter.reason ?? null];
  const total = await db.query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM campaign_recipients r JOIN campaigns c ON c.id = r.campaign_id WHERE ${where}`, params);
  const items = await db.query<RecipientListItem>(
    `SELECT r.customer_id, r.group_assignment, r.eligibility_status, r.suppression_reason, r.campaign_version,
            cu.display_name, cu.preferred_language, cu.consent_status
       FROM campaign_recipients r
       JOIN campaigns c ON c.id = r.campaign_id
       JOIN customers cu ON cu.id = r.customer_id
      WHERE ${where}
      ORDER BY cu.display_name, r.customer_id
      LIMIT $5 OFFSET $6`,
    [...params, filter.limit, filter.offset],
  );
  return { items: items.rows, total: Number(total.rows[0].n) };
}

/** Customers who will be messaged: treatment group with no suppression reason, in a fixed order. */
export async function listSendCandidates(db: Queryable, campaignId: string): Promise<string[]> {
  const result = await db.query<{ customer_id: string }>(
    `SELECT customer_id FROM campaign_recipients
      WHERE campaign_id = $1 AND group_assignment = 'treatment' AND suppression_reason IS NULL
      ORDER BY customer_id`,
    [campaignId],
  );
  return result.rows.map((r) => r.customer_id);
}
