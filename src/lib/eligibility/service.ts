/**
 * Winback AI — Eligibility Service
 * Determines whether a customer can receive a simulated campaign message.
 */

import { Customer, Campaign, SuppressionReason } from '@/types';

export interface EligibilityResult {
  eligible: boolean;
  reason: SuppressionReason | null;
  detail: string;
}

export interface FrequencyRecord {
  last_sent_at: string;
  count_in_window: number;
}

export function checkEligibility(
  customer: Pick<Customer, 'id' | 'consent_status' | 'opted_out_at'>,
  campaign: Pick<Campaign, 'frequency_cap' | 'cooldown_days' | 'budget_minor'>,
  opts: {
    isControlGroup: boolean;
    frequencyRecord: FrequencyRecord | null;
    remainingBudgetMinor: number;
    offerCostMinor: number;
    now?: Date;
  },
): EligibilityResult {
  const now = opts.now ?? new Date();

  // 1. Control group — never sent to
  if (opts.isControlGroup) {
    return { eligible: false, reason: 'CONTROL_GROUP', detail: 'Customer is in the control group and will not receive messages.' };
  }

  // 2. Consent check
  if (customer.consent_status === 'unknown') {
    return { eligible: false, reason: 'CONSENT_UNKNOWN', detail: 'No explicit marketing consent on file.' };
  }
  if (customer.consent_status === 'revoked') {
    return { eligible: false, reason: 'OPTED_OUT', detail: 'Customer has revoked marketing consent.' };
  }

  // 3. Opt-out check
  if (customer.opted_out_at) {
    return { eligible: false, reason: 'OPTED_OUT', detail: `Customer opted out on ${new Date(customer.opted_out_at).toISOString().slice(0, 10)}.` };
  }

  // 4. Frequency / cooldown check
  if (opts.frequencyRecord) {
    const daysSinceLastSend =
      (now.getTime() - new Date(opts.frequencyRecord.last_sent_at).getTime()) / (1000 * 60 * 60 * 24);

    if (daysSinceLastSend < campaign.cooldown_days) {
      return {
        eligible: false,
        reason: 'FREQUENCY_CAP',
        detail: `Last campaign was ${Math.round(daysSinceLastSend)} days ago. Cooldown period is ${campaign.cooldown_days} days.`,
      };
    }

    if (opts.frequencyRecord.count_in_window >= campaign.frequency_cap) {
      return {
        eligible: false,
        reason: 'FREQUENCY_CAP',
        detail: `Customer has received ${opts.frequencyRecord.count_in_window} message(s) in the cooldown window (cap: ${campaign.frequency_cap}).`,
      };
    }
  }

  // 5. Budget check
  if (opts.remainingBudgetMinor < opts.offerCostMinor) {
    return {
      eligible: false,
      reason: 'BUDGET_EXCEEDED',
      detail: `Remaining budget (₹${(opts.remainingBudgetMinor / 100).toFixed(2)}) is insufficient for this offer (₹${(opts.offerCostMinor / 100).toFixed(2)}).`,
    };
  }

  return { eligible: true, reason: null, detail: 'Customer is eligible to receive this campaign.' };
}
