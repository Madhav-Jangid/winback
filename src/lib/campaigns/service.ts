import type { z } from 'zod';
/**
 * Campaign drafts (Phase 4). The backend is authoritative: it validates input, recomputes the
 * segment preview and readiness itself, applies the state machine, and audits every change.
 */
import { writeAuditEvent } from '@/lib/audit/service';
import { getCustomerDirectory, type ContactPolicy } from '@/lib/customers/service';
import type { Queryable } from '@/lib/db/types';
import { AppError, notFound } from '@/lib/errors';
import { assignGroup } from '@/lib/experiments/assignment';
import {
  getCampaign,
  insertCampaign,
  listCampaigns as listCampaignRows,
  setCampaignStatus,
  updateCampaignRow,
  type CampaignRecord,
} from '@/lib/repositories/campaigns';
import type { CampaignStatus } from '@/types';
import { checkReadiness, type ReadinessIssue } from './readiness';
import { describeOffer, offerCostPerRedemptionMinor } from './rules';
import { campaignDraftSchema, campaignUpdateSchema, fieldErrors, type CampaignDraft } from './schema';
import { previewSegment, type SegmentPreview, type SegmentType } from './segments';
import { assertTransition, changedFields, isEditable, isMaterialChange, statusAfterSave } from './state';

export interface CampaignView {
  campaign: CampaignRecord;
  preview: SegmentPreview;
  readiness: ReadinessIssue[];
  editable: boolean;
  offer_summary: string;
  cost_per_redemption_minor: number | null;
  currency: string;
}

async function inTransaction<T>(db: Queryable, fn: () => Promise<T>): Promise<T> {
  await db.query('BEGIN');
  try {
    const result = await fn();
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

function parseOrThrow<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Some campaign fields are invalid.', 400, { fields: fieldErrors(parsed.error) });
  }
  return parsed.data;
}

/** Segment preview using the campaign's own frequency limits. Pass campaignId for the exact control split. */
export async function previewSegmentFor(
  db: Queryable,
  merchantId: string,
  now: Date,
  segmentType: SegmentType,
  policy: ContactPolicy,
  campaignId?: string,
): Promise<{ preview: SegmentPreview; currency: string }> {
  const directory = await getCustomerDirectory(db, merchantId, now, undefined, policy);
  if (!directory.merchant) throw new AppError('MERCHANT_NOT_FOUND', 'Demo data is not loaded. Run npm run db:seed.', 409);
  const assign = campaignId ? (customerId: string) => assignGroup(campaignId, customerId) : undefined;
  return { preview: previewSegment(directory.all, segmentType, assign), currency: directory.merchant.currency };
}

const toDraft = (c: CampaignRecord): CampaignDraft => ({
  name: c.name, goal: c.goal, segment_type: c.segment_type, offer: c.offer, budget_minor: c.budget_minor,
  frequency_cap: c.frequency_cap, cooldown_days: c.cooldown_days, language: c.language, channel: c.channel,
  original_message: c.original_message,
});

function snapshotOf(draft: CampaignDraft, preview: SegmentPreview, now: Date) {
  // Counts only: the customer list is recomputed whenever it is needed.
  const counts: Partial<SegmentPreview> = { ...preview };
  delete counts.eligible_customer_ids;
  return { segment_type: draft.segment_type, previewed_at: now.toISOString(), preview: counts };
}

async function evaluate(db: Queryable, merchantId: string, now: Date, draft: CampaignDraft, campaignId?: string) {
  const { preview, currency } = await previewSegmentFor(
    db, merchantId, now, draft.segment_type,
    { cooldown_days: draft.cooldown_days, frequency_cap: draft.frequency_cap }, campaignId,
  );
  return { preview, currency, readiness: checkReadiness(draft, preview, currency) };
}

export async function getCampaignView(db: Queryable, merchantId: string, id: string, now: Date): Promise<CampaignView> {
  const campaign = await getCampaign(db, merchantId, id);
  if (!campaign) throw notFound('Campaign');
  const { preview, currency, readiness } = await evaluate(db, merchantId, now, toDraft(campaign), campaign.id);
  return {
    campaign,
    preview,
    readiness,
    editable: isEditable(campaign.status),
    offer_summary: describeOffer(campaign.offer, currency),
    cost_per_redemption_minor: offerCostPerRedemptionMinor(campaign.offer, preview.avg_order_value_minor),
    currency,
  };
}

/** db must be a single connection (Client/PoolClient): the write and its audit event share a transaction. */
export async function createCampaign(
  db: Queryable, merchantId: string, input: unknown, now: Date, actorId: string,
): Promise<CampaignView> {
  const draft = parseOrThrow(campaignDraftSchema, input);
  const { preview, readiness } = await evaluate(db, merchantId, now, draft);
  const status: CampaignStatus = readiness.length === 0 ? 'ready_for_approval' : 'draft';

  const id = await inTransaction(db, async () => {
    const newId = await insertCampaign(db, merchantId, { ...draft, segment_snapshot: snapshotOf(draft, preview, now), status });
    await writeAuditEvent({
      merchant_id: merchantId, campaign_id: newId, actor_id: actorId, event_type: 'campaign_created',
      entity_type: 'campaign', entity_id: newId,
      metadata: { name: draft.name, segment_type: draft.segment_type, status, version: 1, readiness_issues: readiness.map((r) => r.code) },
    }, db);
    return newId;
  });
  return getCampaignView(db, merchantId, id, now);
}

export async function updateCampaign(
  db: Queryable, merchantId: string, id: string, input: unknown, now: Date, actorId: string,
): Promise<CampaignView> {
  const { expected_version, ...changes } = parseOrThrow(campaignUpdateSchema, input);

  await inTransaction(db, async () => {
    const current = await getCampaign(db, merchantId, id, { forUpdate: true });
    if (!current) throw notFound('Campaign');
    if (!isEditable(current.status)) {
      throw new AppError('CAMPAIGN_LOCKED', `A ${current.status} campaign can no longer be edited. Create a new campaign instead.`, 409);
    }
    if (current.version !== expected_version) {
      throw new AppError('VERSION_CONFLICT', 'This campaign was changed elsewhere. Reload to see the latest version.', 409,
        { current_version: current.version, expected_version });
    }

    const before = toDraft(current);
    const after = parseOrThrow(campaignDraftSchema, { ...before, ...changes });
    const fields = changedFields(before, after);
    if (fields.length === 0) return;

    const material = isMaterialChange(fields);
    const { preview, readiness } = await evaluate(db, merchantId, now, after, id);
    const status = statusAfterSave(current.status, material, readiness.length === 0);
    const version = material ? current.version + 1 : current.version;
    const clearApproval = material && current.approved_version !== null;

    await updateCampaignRow(db, merchantId, id, {
      ...after, segment_snapshot: snapshotOf(after, preview, now), status, version, clear_approval: clearApproval,
    });
    await writeAuditEvent({
      merchant_id: merchantId, campaign_id: id, actor_id: actorId, event_type: 'campaign_updated',
      entity_type: 'campaign', entity_id: id,
      metadata: { changed_fields: fields, material, version_from: current.version, version_to: version, status_from: current.status, status_to: status },
    }, db);
    if (clearApproval) {
      await writeAuditEvent({
        merchant_id: merchantId, campaign_id: id, actor_id: actorId, event_type: 'approval_invalidated',
        entity_type: 'campaign', entity_id: id,
        metadata: { approved_version: current.approved_version, new_version: version, changed_fields: fields },
      }, db);
    }
  });
  return getCampaignView(db, merchantId, id, now);
}

/** Cancel before sending (E-32). */
export async function cancelCampaign(
  db: Queryable, merchantId: string, id: string, now: Date, actorId: string,
): Promise<CampaignView> {
  await inTransaction(db, async () => {
    const current = await getCampaign(db, merchantId, id, { forUpdate: true });
    if (!current) throw notFound('Campaign');
    if (current.status === 'cancelled') return;
    assertTransition(current.status, 'cancelled');
    await setCampaignStatus(db, merchantId, id, 'cancelled');
    await writeAuditEvent({
      merchant_id: merchantId, campaign_id: id, actor_id: actorId, event_type: 'campaign_cancelled',
      entity_type: 'campaign', entity_id: id, metadata: { status_from: current.status, version: current.version },
    }, db);
  });
  return getCampaignView(db, merchantId, id, now);
}

export const CAMPAIGN_LIST_FILTERS = {
  all: undefined,
  open: ['draft', 'planning', 'ready_for_approval'],
  approved: ['approved'],
  in_progress: ['sending', 'sent', 'measuring'],
  completed: ['completed'],
  cancelled: ['cancelled', 'failed'],
} as const satisfies Record<string, readonly CampaignStatus[] | undefined>;
export type CampaignListFilter = keyof typeof CAMPAIGN_LIST_FILTERS;

export async function listCampaigns(db: Queryable, merchantId: string, filter: CampaignListFilter = 'all') {
  const rows = await listCampaignRows(db, merchantId, CAMPAIGN_LIST_FILTERS[filter]);
  return rows.map((c) => ({
    ...c,
    offer_summary: describeOffer(c.offer),
    eligible: typeof c.segment_snapshot.preview === 'object' && c.segment_snapshot.preview !== null
      ? (c.segment_snapshot.preview as { eligible?: number }).eligible ?? null
      : null,
  }));
}
