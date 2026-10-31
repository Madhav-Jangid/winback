/** Campaign state machine (PRD 7.2). */
import { AppError } from '@/lib/errors';
import { sameJson } from '@/lib/stable-json';
import type { CampaignStatus } from '@/types';
import type { CampaignDraft } from './schema';

export const TRANSITIONS: Record<CampaignStatus, readonly CampaignStatus[]> = {
  draft: ['ready_for_approval', 'planning', 'cancelled'],
  planning: ['draft', 'ready_for_approval', 'failed'],
  ready_for_approval: ['draft', 'planning', 'approved', 'cancelled'],
  approved: ['draft', 'ready_for_approval', 'sending', 'cancelled'],
  sending: ['sent', 'failed'],
  // A finished send with failed deliveries may be retried until outcomes are simulated.
  sent: ['measuring', 'sending'],
  measuring: ['completed', 'failed'],
  completed: [],
  cancelled: [],
  // A failed job may be retried safely (only unresolved records are processed).
  failed: ['sending', 'measuring'],
};

export function canTransition(from: CampaignStatus, to: CampaignStatus): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

export function assertTransition(from: CampaignStatus, to: CampaignStatus): void {
  if (!canTransition(from, to)) {
    throw new AppError('INVALID_TRANSITION', `A campaign cannot move from "${from}" to "${to}".`, 409, { from, to });
  }
}

/** Statuses where the merchant may still edit the campaign. Once sending starts, copy it instead. */
export const EDITABLE_STATUSES: readonly CampaignStatus[] = ['draft', 'ready_for_approval', 'approved'];
export const isEditable = (status: CampaignStatus) => EDITABLE_STATUSES.includes(status);

/**
 * Fields that change what customers receive or what it costs. Changing any of them bumps the
 * version and invalidates approval. Name and goal are internal labels.
 */
export const MATERIAL_FIELDS = [
  'segment_type', 'offer', 'budget_minor', 'frequency_cap', 'cooldown_days', 'language', 'channel', 'original_message',
  'localized_message',
] as const satisfies readonly (keyof CampaignDraft)[];

export function changedFields(before: CampaignDraft, after: CampaignDraft): (keyof CampaignDraft)[] {
  return (Object.keys(after) as (keyof CampaignDraft)[]).filter(
    (key) => !sameJson(before[key], after[key]),
  );
}

export const isMaterialChange = (fields: (keyof CampaignDraft)[]) =>
  fields.some((f) => (MATERIAL_FIELDS as readonly string[]).includes(f));

/**
 * Status after saving an editable campaign: approval survives only non-material edits; otherwise
 * the campaign is ready for approval if it passes every readiness check, else a draft.
 */
export function statusAfterSave(current: CampaignStatus, material: boolean, ready: boolean): CampaignStatus {
  if (current === 'approved' && !material) return 'approved';
  return ready ? 'ready_for_approval' : 'draft';
}
