/**
 * The send gate (FR-09, FR-10, E-11, E-32). Sending is allowed only for a campaign that is
 * approved, whose approval is for the current version, and whose material fields still hash to
 * what was approved. Pure: Phase 8's send job calls this before it touches anything, and again
 * for every retry.
 */
import type { CampaignRecord } from '@/lib/repositories/campaigns';
import { AppError } from '@/lib/errors';
import { approvalHash } from './hash';

export type SendCheck =
  | { ok: true }
  | { ok: false; code: string; message: string; status: number };

/**
 * `start`: a new send, only from `approved`. `resume`: also continue an interrupted send
 * (`sending`), retry after an interrupted job (`failed`), or retry failed deliveries (`sent`).
 * Either way the approval must still match the campaign's current content.
 */
export type SendIntent = 'start' | 'resume';

export function checkSendable(
  c: Pick<CampaignRecord, 'status' | 'version' | 'approved_version' | 'approval_hash'> & Partial<CampaignRecord>,
  intent: SendIntent = 'start',
): SendCheck {
  switch (c.status) {
    case 'approved': break;
    case 'sending':
    case 'sent':
    case 'failed':
      if (intent === 'resume') break;
      return { ok: false, code: 'CAMPAIGN_NOT_SENDABLE', message: `A ${c.status} campaign cannot start a new send.`, status: 409 };
    case 'cancelled':
      return { ok: false, code: 'CAMPAIGN_CANCELLED', message: 'This campaign was cancelled and cannot be sent.', status: 409 };
    case 'draft':
    case 'planning':
    case 'ready_for_approval':
      return { ok: false, code: 'CAMPAIGN_APPROVAL_REQUIRED', message: 'Approve the current campaign version before simulating sends.', status: 409 };
    default:
      return { ok: false, code: 'CAMPAIGN_NOT_SENDABLE', message: `A ${c.status} campaign cannot start a new send.`, status: 409 };
  }

  if (c.approved_version === null || c.approved_version !== c.version) {
    return { ok: false, code: 'CAMPAIGN_APPROVAL_STALE', message: 'The campaign changed after it was approved. Review and approve the current version.', status: 409 };
  }
  // Defense in depth: a change that did not bump the version still cannot be sent.
  if (!c.approval_hash || ('offer' in c && approvalHash(c as CampaignRecord) !== c.approval_hash)) {
    return { ok: false, code: 'CAMPAIGN_APPROVAL_STALE', message: 'The approved content no longer matches the campaign. Review and approve it again.', status: 409 };
  }
  return { ok: true };
}

export function assertCanSend(c: CampaignRecord, intent: SendIntent = 'start'): void {
  const check = checkSendable(c, intent);
  if (!check.ok) throw new AppError(check.code, check.message, check.status);
}
