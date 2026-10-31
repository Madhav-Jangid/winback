/** Stable suppression reason codes with their display text. Browser-safe: the UI and the backend share them. */
import type { SuppressionReason } from '@/types';

export const SUPPRESSION_REASONS = [
  'CONSENT_UNKNOWN', 'OPTED_OUT', 'CONTROL_GROUP', 'FREQUENCY_CAP', 'BUDGET_EXCEEDED', 'NOT_ELIGIBLE', 'INSUFFICIENT_HISTORY',
] as const satisfies readonly SuppressionReason[];

export const SUPPRESSION_LABELS: Record<SuppressionReason, { label: string; description: string }> = {
  CONSENT_UNKNOWN: { label: 'No consent', description: 'No explicit marketing consent on file.' },
  OPTED_OUT: { label: 'Opted out or consent revoked', description: 'The customer opted out or revoked consent. Never messaged.' },
  CONTROL_GROUP: { label: 'Control group', description: 'Held back as the comparison group. Never messaged.' },
  FREQUENCY_CAP: { label: 'Messaged recently', description: 'Inside the cooldown, or at the message cap, across all campaigns.' },
  BUDGET_EXCEEDED: { label: 'Over budget', description: 'The budget covers only part of the group; the rest are not messaged.' },
  NOT_ELIGIBLE: { label: 'No longer in the segment', description: 'The customer no longer matches the audience rule.' },
  INSUFFICIENT_HISTORY: { label: 'Not enough history', description: 'Too few purchases to estimate a buying rhythm.' },
};
