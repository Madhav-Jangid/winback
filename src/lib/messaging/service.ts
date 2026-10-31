/**
 * The simulated send job (FR-10). Nothing is sent anywhere: messages are records, and their
 * delivery is a seeded simulation.
 *
 * Two steps, each its own transaction, each re-runnable:
 *  1. Claim: under a lock on the campaign, enforce the send gate, recheck every recipient against
 *     current data, queue one message per customer (unique keys make duplicates impossible),
 *     record who was dropped and why, and move the campaign to `sending`.
 *  2. Deliver: under the same lock, settle only the messages still queued, then mark the
 *     campaign `sent`. A crash between the steps leaves `sending` with queued messages, which
 *     the next request resumes; repeated or concurrent requests find nothing left to do.
 * A retry requeues only failed deliveries, rechecked again, and never touches delivered ones.
 */
import { z } from 'zod';
import { assertCanSend } from '@/lib/approvals/guard';
import { revalidateRecipients } from '@/lib/approvals/service';
import { writeAuditEvent, writeAuditEvents, type AuditInput } from '@/lib/audit/service';
import { assertTransition } from '@/lib/campaigns/state';
import { inTransaction } from '@/lib/db/transaction';
import type { Queryable } from '@/lib/db/types';
import { getServerEnv } from '@/lib/env';
import { AppError, notFound } from '@/lib/errors';
import { getCampaign, setCampaignStatus } from '@/lib/repositories/campaigns';
import {
  applyDeliveryResults, getMessageCounts, getRecipientGroups, insertQueuedMessages, listFailedDeliveries, listQueued,
  listRetryableFailed, listSendTimeSuppressions, markSuppressedOnRetry, requeueMessages, suppressRecipients,
} from '@/lib/repositories/messages';
import type { SuppressionReason } from '@/types';
import { simulatedDelivery, type DeliverFn } from './delivery';
import { deriveProgress, type SendProgress } from './progress';

export const sendRequestSchema = z.object({}).strict();

export interface SendDeps {
  /** Override the delivery simulation (tests). */
  deliver?: DeliverFn;
  seed?: string;
}

const SYSTEM = { actor_type: 'system', actor_id: 'simulator' } as const;

export async function getSendProgress(db: Queryable, merchantId: string, campaignId: string): Promise<SendProgress> {
  const campaign = await getCampaign(db, merchantId, campaignId);
  if (!campaign) throw notFound('Campaign');
  const [groups, counts, failed, suppressed] = await Promise.all([
    getRecipientGroups(db, campaignId),
    getMessageCounts(db, campaignId),
    listFailedDeliveries(db, campaignId),
    listSendTimeSuppressions(db, campaignId),
  ]);
  return deriveProgress(campaign, groups, counts, failed, suppressed);
}

const suppressionEvent = (merchantId: string, campaignId: string, customerId: string, reason: SuppressionReason, atRetry: boolean): AuditInput => ({
  merchant_id: merchantId, campaign_id: campaignId, ...SYSTEM, event_type: 'recipient_suppressed',
  entity_type: 'customer', entity_id: customerId, metadata: { reason, stage: atRetry ? 'retry' : 'send' },
});

/** Step 1. Returns whether there is anything to deliver. */
async function claim(db: Queryable, merchantId: string, campaignId: string, now: Date, actorId: string): Promise<boolean> {
  return inTransaction(db, async () => {
    const campaign = await getCampaign(db, merchantId, campaignId, { forUpdate: true });
    if (!campaign) throw notFound('Campaign');
    assertCanSend(campaign, 'resume'); // approved, current, not cancelled
    if (campaign.status === 'sending') return true; // resume: messages are already queued

    const retrying = campaign.status === 'sent';
    const failedBefore = retrying ? await listRetryableFailed(db, campaignId) : [];
    if (retrying && failedBefore.length === 0) return false; // nothing failed: a repeated request changes nothing

    const check = await revalidateRecipients(db, merchantId, campaignId, now, campaign.status === 'approved' ? 'start' : 'resume');
    const verdicts = new Map(check.decisions.map((d) => [d.customer_id, d]));

    let suppressed: Array<{ customer_id: string; reason: SuppressionReason }>;
    let queued: number;
    if (retrying) {
      const retry = failedBefore.filter((id) => verdicts.get(id)?.send === true);
      suppressed = failedBefore
        .filter((id) => verdicts.get(id)?.send !== true)
        .map((id) => ({ customer_id: id, reason: verdicts.get(id)?.reason ?? 'NOT_ELIGIBLE' }));
      await requeueMessages(db, campaignId, retry);
      await markSuppressedOnRetry(db, campaignId, suppressed.map((s) => s.customer_id));
      queued = retry.length;
    } else {
      suppressed = check.suppressed;
      await insertQueuedMessages(db, campaignId, campaign.version, check.sendable, check.budget.cost_per_message_minor ?? 0);
      queued = check.sendable.length;
    }
    await suppressRecipients(db, campaignId, suppressed);

    assertTransition(campaign.status, 'sending');
    await setCampaignStatus(db, merchantId, campaignId, 'sending');
    await writeAuditEvents([
      {
        merchant_id: merchantId, campaign_id: campaignId, actor_id: actorId, event_type: 'send_simulation_started',
        entity_type: 'campaign', entity_id: campaignId,
        metadata: { version: campaign.version, retry: retrying, queued, suppressed: suppressed.length, simulated: true },
      },
      ...suppressed.map((s) => suppressionEvent(merchantId, campaignId, s.customer_id, s.reason, retrying)),
    ], db);
    return true;
  });
}

/** Step 2. Settles only what is still queued. */
async function deliverQueued(
  db: Queryable, merchantId: string, campaignId: string, deliver: DeliverFn, now: Date, actorId: string,
): Promise<void> {
  try {
    await inTransaction(db, async () => {
      const campaign = await getCampaign(db, merchantId, campaignId, { forUpdate: true });
      if (!campaign) throw notFound('Campaign');
      if (campaign.status !== 'sending') return; // another request already finished it

      const queued = await listQueued(db, campaignId);
      const settled = queued.map((m) => ({ ...m, result: deliver({ campaign_id: campaignId, customer_id: m.customer_id, attempt: m.attempts + 1 }) }));
      await applyDeliveryResults(db, settled.map((s) => ({
        id: s.id, status: s.result.ok ? 'delivered' as const : 'failed' as const, code: s.result.ok ? null : s.result.code,
      })), now);

      assertTransition('sending', 'sent');
      await setCampaignStatus(db, merchantId, campaignId, 'sent');
      const counts = await getMessageCounts(db, campaignId);
      await writeAuditEvents([
        ...settled.map((s): AuditInput => ({
          merchant_id: merchantId, campaign_id: campaignId, ...SYSTEM,
          event_type: s.result.ok ? 'recipient_delivered' : 'recipient_failed',
          entity_type: 'customer', entity_id: s.customer_id,
          metadata: { simulated: true, attempt: s.attempts + 1, ...(s.result.ok ? {} : { failure_code: s.result.code }) },
        })),
        {
          merchant_id: merchantId, campaign_id: campaignId, actor_id: actorId, event_type: 'send_simulation_completed',
          entity_type: 'campaign', entity_id: campaignId,
          metadata: { delivered: counts.delivered, failed: counts.failed, retryable_failed: counts.retryable_failed, simulated: true },
        },
      ], db);
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('[Send]', error instanceof Error ? error.message : error);
    // The transaction rolled back: the campaign is still `sending` with its messages queued.
    await writeAuditEvent({
      merchant_id: merchantId, campaign_id: campaignId, actor_id: actorId, event_type: 'send_simulation_failed',
      entity_type: 'campaign', entity_id: campaignId, metadata: { stage: 'delivery', resumable: true },
    }, db).catch(() => undefined);
    throw new AppError('SEND_INTERRUPTED', 'Sending was interrupted. Nothing was duplicated; run Simulate send again to resume.', 503);
  }
}

/**
 * Run (or resume, or retry) the simulated send. `db` must be a single connection (Client/PoolClient).
 * Safe to call repeatedly and concurrently: it never creates a second message for a customer.
 */
export async function simulateSend(
  db: Queryable, merchantId: string, campaignId: string, request: unknown, now: Date, actorId: string, deps: SendDeps = {},
): Promise<SendProgress> {
  if (!sendRequestSchema.safeParse(request).success) throw new AppError('VALIDATION_ERROR', 'Invalid send request.', 400);
  const deliver = deps.deliver ?? simulatedDelivery(deps.seed ?? getServerEnv().DEMO_SEED);

  if (await claim(db, merchantId, campaignId, now, actorId)) {
    await deliverQueued(db, merchantId, campaignId, deliver, now, actorId);
  }
  return getSendProgress(db, merchantId, campaignId);
}
