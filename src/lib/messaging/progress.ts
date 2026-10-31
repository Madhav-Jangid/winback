/**
 * What the merchant sees while and after a simulated send (FR-10, Screen F). Derived only from
 * persisted rows, so a refresh at any moment shows the true state (E-24, SE-06). Pure.
 */
import { checkSendable } from '@/lib/approvals/guard';
import type { CampaignRecord } from '@/lib/repositories/campaigns';
import type { FailedDelivery, MessageCounts, RecipientGroupRow, SendSuppression } from '@/lib/repositories/messages';
import type { CampaignStatus, SuppressionReason } from '@/types';

export type SendState = 'not_approved' | 'ready' | 'sending' | 'interrupted' | 'sent' | 'sent_with_failures' | 'finished' | 'cancelled';

export interface SendProgress {
  campaign_id: string;
  status: CampaignStatus;
  version: number;
  state: SendState;
  /** Approval still matches the campaign, so sending is allowed. */
  approval_current: boolean;
  /** Treatment customers chosen to be messaged at approval (before any send-time drops). */
  planned: number;
  delivered: number;
  failed: number;
  /** Dropped by the send-time recheck. */
  suppressed_at_send: number;
  /** delivered + failed + suppressed_at_send */
  processed: number;
  /** planned - processed: still to do. */
  unresolved: number;
  queued: number;
  retryable_failed: number;
  /** Not messaged by design. */
  control_not_messaged: number;
  budget_not_messaged: number;
  suppressed_before_approval: number;
  suppressed_before_approval_by_reason: Partial<Record<SuppressionReason, number>>;
  suppressed_at_send_by_reason: Partial<Record<SuppressionReason, number>>;
  reserved_minor: number;
  budget_minor: number;
  can_send: boolean;
  can_retry: boolean;
  failed_deliveries: FailedDelivery[];
  send_time_suppressions: SendSuppression[];
  simulated: true;
}

export function deriveProgress(
  campaign: CampaignRecord,
  groups: readonly RecipientGroupRow[],
  counts: MessageCounts,
  failedDeliveries: FailedDelivery[] = [],
  sendTimeSuppressions: SendSuppression[] = [],
): SendProgress {
  let planned = 0, control = 0, budget = 0, beforeApproval = 0, atSend = 0;
  const beforeByReason: Partial<Record<SuppressionReason, number>> = {};
  const atSendByReason: Partial<Record<SuppressionReason, number>> = {};
  const bump = (map: Partial<Record<SuppressionReason, number>>, reason: SuppressionReason, n: number) => { map[reason] = (map[reason] ?? 0) + n; };

  for (const row of groups) {
    if (row.group_assignment === null) {
      beforeApproval += row.n;
      if (row.suppression_reason) bump(beforeByReason, row.suppression_reason, row.n);
    } else if (row.group_assignment === 'control') {
      control += row.n;
    } else if (row.suppression_reason === 'BUDGET_EXCEEDED') {
      budget += row.n;
    } else {
      planned += row.n;
      if (row.suppression_reason) { atSend += row.n; bump(atSendByReason, row.suppression_reason, row.n); }
    }
  }

  const processed = counts.delivered + counts.failed + atSend;
  const approvalCurrent = checkSendable(campaign, 'resume').ok;
  const hasFailures = counts.retryable_failed > 0;

  let state: SendState;
  switch (campaign.status) {
    case 'approved': state = approvalCurrent ? 'ready' : 'not_approved'; break;
    case 'sending': state = 'sending'; break;
    case 'failed': state = 'interrupted'; break;
    case 'sent': state = hasFailures ? 'sent_with_failures' : 'sent'; break;
    case 'measuring': case 'completed': state = 'finished'; break;
    case 'cancelled': state = 'cancelled'; break;
    default: state = 'not_approved';
  }

  return {
    campaign_id: campaign.id, status: campaign.status, version: campaign.version, state,
    approval_current: approvalCurrent,
    planned, delivered: counts.delivered, failed: counts.failed, suppressed_at_send: atSend, processed,
    unresolved: Math.max(0, planned - processed), queued: counts.queued, retryable_failed: counts.retryable_failed,
    control_not_messaged: control, budget_not_messaged: budget,
    suppressed_before_approval: beforeApproval,
    suppressed_before_approval_by_reason: beforeByReason, suppressed_at_send_by_reason: atSendByReason,
    reserved_minor: counts.reserved_minor, budget_minor: campaign.budget_minor,
    can_send: approvalCurrent && (campaign.status === 'approved' || campaign.status === 'sending' || campaign.status === 'failed'),
    can_retry: approvalCurrent && campaign.status === 'sent' && hasFailures,
    failed_deliveries: failedDeliveries, send_time_suppressions: sendTimeSuppressions,
    simulated: true,
  };
}
