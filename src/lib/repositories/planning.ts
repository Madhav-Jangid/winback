import { createHash } from 'node:crypto';
import type { Queryable } from '@/lib/db/types';

/** Store the latest plan's source and rationale on the campaign. Not a material change: no version bump. */
export async function setCampaignPlan(
  db: Queryable,
  merchantId: string,
  id: string,
  plan: { source: string; rationale: string },
): Promise<void> {
  await db.query(
    'UPDATE campaigns SET plan_source = $3, plan_rationale = $4, updated_at = NOW() WHERE merchant_id = $1 AND id = $2',
    [merchantId, id, plan.source, plan.rationale],
  );
}

/** Hash of a request, so repeated calls are recognisable without storing prompts or personal data. */
export const fingerprint = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32);

export async function recordProviderOperation(
  db: Queryable,
  op: { provider: string; operation: string; status: 'ok' | 'error' | 'fallback'; request_fingerprint: string; error_code?: string | null },
): Promise<void> {
  await db.query(
    'INSERT INTO provider_operations (provider, operation, status, request_fingerprint, error_code) VALUES ($1, $2, $3, $4, $5)',
    [op.provider, op.operation, op.status, op.request_fingerprint, op.error_code ?? null],
  );
}
