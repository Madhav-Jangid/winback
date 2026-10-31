/**
 * Approval (FR-09). The merchant approves one exact version; the server decides whether that is
 * allowed. It never trusts the client's view: readiness, eligibility, the experiment split and
 * the budget are recomputed here, inside the transaction that records the approval, and the
 * recipient snapshot is stored with it. Any later material edit invalidates both.
 */
import { z } from 'zod';
import { writeAuditEvent } from '@/lib/audit/service';
import type { ReadinessIssue } from '@/lib/campaigns/readiness';
import { previewSegment, isSegmentMember } from '@/lib/campaigns/segments';
import { getCampaignView, viewOf, type CampaignView } from '@/lib/campaigns/service';
import { offerCostPerRedemptionMinor, formatMinor } from '@/lib/campaigns/rules';
import { assertTransition } from '@/lib/campaigns/state';
import { getCustomerDirectory } from '@/lib/customers/service';
import { inTransaction } from '@/lib/db/transaction';
import type { Queryable } from '@/lib/db/types';
import { SUPPRESSION_LABELS, SUPPRESSION_REASONS } from '@/lib/eligibility/reasons';
import { evaluateRecipients, planBudget, type BudgetPlan, type RecipientSummary } from '@/lib/eligibility/recipients';
import { AppError, notFound } from '@/lib/errors';
import { getCampaign, setApproval, type CampaignRecord } from '@/lib/repositories/campaigns';
import {
  listRecipients, listSendCandidates, replaceRecipients, type RecipientFilter, type RecipientListItem, type RecipientRow,
} from '@/lib/repositories/recipients';
import type { SuppressionReason } from '@/types';
import { assertCanSend, checkSendable } from './guard';
import { approvalHash } from './hash';

export interface ApprovalBlocker { code: string; field?: string; message: string }

export interface ApprovalSummary {
  view: CampaignView;
  recipients: RecipientSummary;
  budget: BudgetPlan;
  suppression: Array<{ reason: SuppressionReason; label: string; count: number }>;
  /** Customers who will not be messaged, with the reason (first 100). */
  held_back: Array<{ customer_id: string; display_name: string; reason: SuppressionReason }>;
  blockers: ApprovalBlocker[];
  warnings: string[];
  can_approve: boolean;
  approval: { state: 'not_approved' | 'approved' | 'stale'; version: number | null; by: string | null; at: string | null; hash: string | null };
}

export const approveRequestSchema = z.object({ expected_version: z.number().int().min(1) }).strict();

const HELD_BACK_LIMIT = 100;
const SMALL_AUDIENCE = 30;

interface Built { summary: ApprovalSummary; decisions: RecipientRow[] }

async function build(db: Queryable, merchantId: string, view: CampaignView, now: Date): Promise<Built> {
  const c = view.campaign;
  const directory = await getCustomerDirectory(
    db, merchantId, now, undefined, { cooldown_days: c.cooldown_days, frequency_cap: c.frequency_cap }, { excludeCampaignId: c.id },
  );
  const evaluation = evaluateRecipients(directory.all, c);
  const { summary: counts, budget } = evaluation;

  const blockers: ApprovalBlocker[] = view.readiness.map((r: ReadinessIssue) => ({ code: r.code, field: r.field, message: r.message }));
  if (counts.sendable === 0 && !view.readiness.some((r) => r.code === 'EMPTY_SEGMENT' || r.code === 'BUDGET_TOO_LOW')) {
    blockers.push({
      code: 'NO_SENDABLE_RECIPIENTS', field: 'segment_type',
      message: counts.treatment === 0
        ? 'Everyone eligible falls in the control group, so nobody would be messaged. Choose a larger audience.'
        : 'The budget is too small to message anyone. Increase it.',
    });
  }

  const warnings: string[] = [];
  if (counts.control === 0 && counts.contactable > 0) {
    warnings.push('No control group: this campaign cannot show incremental lift. Results will be descriptive only.');
  }
  if (counts.contactable > 0 && counts.contactable < SMALL_AUDIENCE) {
    warnings.push(`Small audience (${counts.contactable} customers): results will be directional only, not proof that the offer worked.`);
  }
  const overBudget = counts.suppressed.BUDGET_EXCEEDED ?? 0;
  if (overBudget > 0) {
    warnings.push(`${overBudget} eligible customer${overBudget === 1 ? '' : 's'} will not be messaged because the budget covers only ${budget.max_messages} message${budget.max_messages === 1 ? '' : 's'}.`);
  }

  const names = new Map(directory.all.map((p) => [p.id, p.display_name]));
  const held_back = evaluation.decisions
    .filter((d): d is RecipientRow & { suppression_reason: SuppressionReason } => d.suppression_reason !== null)
    .slice(0, HELD_BACK_LIMIT)
    .map((d) => ({ customer_id: d.customer_id, display_name: names.get(d.customer_id) ?? 'Unknown', reason: d.suppression_reason }));

  const suppression = SUPPRESSION_REASONS
    .map((reason) => ({ reason, label: SUPPRESSION_LABELS[reason].label, count: counts.suppressed[reason] ?? 0 }))
    .filter((row) => row.count > 0);

  const sendable = checkSendable(c).ok;
  const summary: ApprovalSummary = {
    view, recipients: counts, budget, suppression, held_back, blockers, warnings,
    can_approve: c.status === 'ready_for_approval' && blockers.length === 0,
    approval: {
      state: c.status === 'approved' ? (sendable ? 'approved' : 'stale') : 'not_approved',
      version: c.approved_version, by: c.approved_by, at: c.approved_at, hash: c.approval_hash,
    },
  };
  return { summary, decisions: evaluation.decisions };
}

export async function getApprovalSummary(db: Queryable, merchantId: string, id: string, now: Date): Promise<ApprovalSummary> {
  const view = await getCampaignView(db, merchantId, id, now);
  return (await build(db, merchantId, view, now)).summary;
}

/**
 * Approve exactly `expected_version`. `db` must be a single connection (Client/PoolClient).
 * Repeating the request for an already-approved current version is a no-op.
 */
export async function approveCampaign(
  db: Queryable, merchantId: string, id: string, request: unknown, now: Date, actorId: string,
): Promise<ApprovalSummary> {
  const parsed = approveRequestSchema.safeParse(request);
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Send the version you reviewed as expected_version.', 400);
  }
  const expectedVersion = parsed.data.expected_version;

  await inTransaction(db, async () => {
    const current = await getCampaign(db, merchantId, id, { forUpdate: true });
    if (!current) throw notFound('Campaign');
    if (current.version !== expectedVersion) {
      throw new AppError('VERSION_CONFLICT', 'The campaign changed after you reviewed it. Reload and review the current version.', 409,
        { current_version: current.version, expected_version: expectedVersion });
    }
    if (current.status === 'approved' && checkSendable(current).ok) return; // already approved: idempotent
    if (current.status === 'cancelled') throw new AppError('CAMPAIGN_CANCELLED', 'This campaign was cancelled and cannot be approved.', 409);

    const view = await viewOf(db, merchantId, current, now);
    const { summary, decisions } = await build(db, merchantId, view, now);
    if (current.status !== 'ready_for_approval' || summary.blockers.length > 0) {
      if (current.status !== 'ready_for_approval' && current.status !== 'draft' && current.status !== 'planning') {
        assertTransition(current.status, 'approved'); // throws INVALID_TRANSITION
      }
      throw new AppError('CAMPAIGN_NOT_READY', 'This campaign cannot be approved yet. Fix the listed issues first.', 409, { issues: summary.blockers });
    }

    const hash = approvalHash(current);
    await replaceRecipients(db, id, current.version, decisions);
    await setApproval(db, merchantId, id, { approved_version: current.version, approved_by: actorId, approval_hash: hash });
    await writeAuditEvent({
      merchant_id: merchantId, campaign_id: id, actor_id: actorId, event_type: 'approval_granted',
      entity_type: 'campaign', entity_id: id,
      metadata: {
        version: current.version, approval_hash: hash.slice(0, 16), language: current.language, channel: current.channel,
        translation_source: current.translation?.source ?? null, translation_edited: current.translation?.edited ?? null,
        recipients: summary.recipients, budget: summary.budget, warnings: summary.warnings.length,
      },
    }, db);
  });
  return getApprovalSummary(db, merchantId, id, now);
}

/** The stored recipient snapshot of an approved campaign, with each customer's reason (EL-10). */
export async function getCampaignRecipients(
  db: Queryable, merchantId: string, id: string, filter: RecipientFilter,
): Promise<{ items: Array<RecipientListItem & { reason_label: string | null }>; total: number; approved_version: number | null }> {
  const campaign = await getCampaign(db, merchantId, id);
  if (!campaign) throw notFound('Campaign');
  const { items, total } = await listRecipients(db, merchantId, id, filter);
  return {
    items: items.map((r) => ({ ...r, reason_label: r.suppression_reason ? SUPPRESSION_LABELS[r.suppression_reason].label : null })),
    total,
    approved_version: campaign.approved_version,
  };
}

export interface SendDecision { customer_id: string; send: boolean; reason: SuppressionReason | null }

export interface Revalidation {
  campaign: CampaignRecord;
  decisions: SendDecision[];
  /** Customers to message, in send order. */
  sendable: string[];
  suppressed: Array<{ customer_id: string; reason: SuppressionReason }>;
  budget: BudgetPlan;
}

/**
 * The server-side check immediately before sending (EL-09, E-05, E-06, E-08). Enforces the send
 * gate, then rechecks every customer the approval chose to message against current data:
 * consent, opt-out, cooldown and cap across all campaigns, segment membership, and the budget.
 * It can only remove recipients, never add them, and it never includes a control customer.
 */
export async function revalidateRecipients(db: Queryable, merchantId: string, campaignId: string, now: Date): Promise<Revalidation> {
  const campaign = await getCampaign(db, merchantId, campaignId);
  if (!campaign) throw notFound('Campaign');
  assertCanSend(campaign);

  const candidates = await listSendCandidates(db, campaignId);
  const directory = await getCustomerDirectory(
    db, merchantId, now, undefined, { cooldown_days: campaign.cooldown_days, frequency_cap: campaign.frequency_cap }, { excludeCampaignId: campaignId },
  );
  const profiles = new Map(directory.all.map((p) => [p.id, p]));
  const cost = offerCostPerRedemptionMinor(campaign.offer, previewSegment(directory.all, campaign.segment_type).avg_order_value_minor);

  const decisions: SendDecision[] = [];
  let sent = 0;
  for (const customerId of candidates) {
    const profile = profiles.get(customerId);
    let reason: SuppressionReason | null = null;
    if (!profile || !isSegmentMember(profile, campaign.segment_type)) reason = 'NOT_ELIGIBLE';
    else if (!profile.contact.eligible) reason = profile.contact.reason ?? 'NOT_ELIGIBLE';
    else if (cost === null || (cost > 0 && (sent + 1) * cost > campaign.budget_minor)) reason = 'BUDGET_EXCEEDED';
    if (reason === null) sent += 1;
    decisions.push({ customer_id: customerId, send: reason === null, reason });
  }

  return {
    campaign,
    decisions,
    sendable: decisions.filter((d) => d.send).map((d) => d.customer_id),
    suppressed: decisions.filter((d): d is SendDecision & { reason: SuppressionReason } => !d.send && d.reason !== null)
      .map((d) => ({ customer_id: d.customer_id, reason: d.reason })),
    budget: planBudget(campaign.budget_minor, cost, sent),
  };
}

/** Human-readable cost assumption shown beside the approve button. */
export function costAssumption(budget: BudgetPlan, currency: string): string {
  if (budget.cost_per_message_minor === null) return 'The cost per message cannot be estimated yet.';
  if (budget.cost_per_message_minor === 0) return 'This offer has no cost per message.';
  return `Each message reserves the cost of one redemption (${formatMinor(budget.cost_per_message_minor, currency)}), assuming everyone redeems. Costs are simulated.`;
}
