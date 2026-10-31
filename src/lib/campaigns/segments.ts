/**
 * Campaign audiences (FR-04). Pure: works on customer profiles from the customer service, and
 * uses the same eligibility check as sending, so the preview never shows someone as sendable
 * who the backend would reject.
 */
import type { CustomerProfile } from '@/lib/customers/service';
import { CONTROL_SHARE } from './rules';

export const SEGMENT_TYPES = ['at_risk', 'previously_active', 'all_eligible'] as const;
export type SegmentType = (typeof SEGMENT_TYPES)[number];

/** Completed purchases that make someone a "regular" for the previously-active segment. */
export const REGULAR_MIN_PURCHASES = 3;

export const SEGMENTS: Record<SegmentType, { label: string; description: string; usesRisk: boolean }> = {
  at_risk: {
    label: 'At-risk repeat customers',
    description: 'Overdue compared with their own usual gap between purchases.',
    usesRisk: true,
  },
  previously_active: {
    label: 'Previously active but now overdue',
    description: `At-risk regulars with ${REGULAR_MIN_PURCHASES} or more completed purchases.`,
    usesRisk: true,
  },
  all_eligible: {
    label: 'All eligible customers',
    description: 'Everyone you are allowed to message, whatever their buying rhythm.',
    usesRisk: false,
  },
};

function inSegment(profile: CustomerProfile, type: SegmentType): boolean {
  switch (type) {
    case 'at_risk': return profile.risk.status === 'at_risk';
    case 'previously_active': return profile.risk.status === 'at_risk' && profile.completed_purchase_count >= REGULAR_MIN_PURCHASES;
    case 'all_eligible': return true;
  }
}

export interface SegmentExclusions {
  no_consent: number;
  opted_out: number;
  insufficient_history: number;
  frequency_cap: number;
  other: number;
}

export interface SegmentPreview {
  segment_type: SegmentType;
  label: string;
  description: string;
  /** Customers matching the segment rule, before consent/frequency exclusions. */
  matched: number;
  eligible: number;
  excluded: SegmentExclusions;
  /** Held-back control group. Exact when computed for a saved campaign, otherwise an estimate. */
  control: number;
  treatment: number;
  control_is_estimate: boolean;
  /** Average completed order value of eligible customers (minor units), for cost estimates. */
  avg_order_value_minor: number | null;
  /** Averages over eligible customers with a measurable rhythm, in whole days. Aggregate only. */
  avg_cadence_days: number | null;
  avg_days_since_purchase: number | null;
  eligible_customer_ids: string[];
}

export type ExclusionKey = keyof SegmentExclusions;

/** Which exclusion bucket a non-eligible profile falls into. */
export function exclusionOf(profile: CustomerProfile): ExclusionKey | null {
  const { contact } = profile;
  if (contact.eligible) return null;
  if (contact.reason === 'CONSENT_UNKNOWN') return 'no_consent';
  if (contact.reason === 'OPTED_OUT') return profile.opted_out_at ? 'opted_out' : 'no_consent';
  if (contact.reason === 'FREQUENCY_CAP') return 'frequency_cap';
  return 'other';
}

/**
 * @param profiles customer profiles built with the campaign's own frequency policy
 * @param assign optional exact treatment/control assignment for a saved campaign
 */
export function previewSegment(
  profiles: CustomerProfile[],
  type: SegmentType,
  assign?: (customerId: string) => 'treatment' | 'control',
): SegmentPreview {
  const excluded: SegmentExclusions = { no_consent: 0, opted_out: 0, insufficient_history: 0, frequency_cap: 0, other: 0 };
  const eligible: CustomerProfile[] = [];
  let matched = 0;

  for (const profile of profiles) {
    if (SEGMENTS[type].usesRisk && profile.risk.status === 'insufficient_history') {
      excluded.insufficient_history += 1;
      continue;
    }
    if (!inSegment(profile, type)) continue;
    matched += 1;
    const reason = exclusionOf(profile);
    if (reason) excluded[reason] += 1;
    else eligible.push(profile);
  }

  const control = assign
    ? eligible.filter((p) => assign(p.id) === 'control').length
    : Math.round(eligible.length * CONTROL_SHARE);
  const average = (values: Array<number | null>): number | null => {
    const present = values.filter((v): v is number => v !== null);
    return present.length === 0 ? null : Math.round(present.reduce((a, b) => a + b, 0) / present.length);
  };
  const orders = eligible.reduce((n, p) => n + p.completed_purchase_count, 0);
  const spend = eligible.reduce((n, p) => n + p.total_spend_minor, 0);

  return {
    segment_type: type,
    label: SEGMENTS[type].label,
    description: SEGMENTS[type].description,
    matched,
    eligible: eligible.length,
    excluded,
    control,
    treatment: eligible.length - control,
    control_is_estimate: !assign,
    avg_order_value_minor: orders > 0 ? Math.round(spend / orders) : null,
    avg_cadence_days: average(eligible.map((p) => p.risk.median_cadence_days)),
    avg_days_since_purchase: average(eligible.map((p) => p.risk.days_since_last_purchase)),
    eligible_customer_ids: eligible.map((p) => p.id),
  };
}
