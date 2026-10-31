import { campaignDraftSchema } from '@/lib/campaigns/schema';
import { previewSegment } from '@/lib/campaigns/segments';
import type { CampaignView } from '@/lib/campaigns/service';
import { buildPlanInput } from '@/lib/planner/input';
import type { CampaignPlanInput } from '@/lib/planner/types';
import { demoProfiles } from '@/test/helpers/demo-profiles';
import { VALID_DRAFT } from './campaign';

/** A realistic planner input built from the demo dataset and the sample campaign. */
export function makePlanInput(overrides: Record<string, unknown> = {}): CampaignPlanInput {
  const draft = campaignDraftSchema.parse({ ...VALID_DRAFT, ...overrides });
  const preview = previewSegment(demoProfiles(), draft.segment_type);
  return buildPlanInput(
    { campaign: { ...draft } as unknown as CampaignView['campaign'], preview, currency: 'INR' },
    'cafe',
  );
}

/** A plan answer that passes validation for `makePlanInput()`. */
export const VALID_PLAN = {
  rationale: 'Regulars have drifted past their usual gap, so a gentle reminder with your offer should help.',
  target_segment_description: 'Repeat customers who are overdue for a visit',
  offer: { type: 'percentage_discount', percent: 10, max_discount_minor: 10_000 },
  message_draft: 'Hi! We miss you. Enjoy 10% off your next order (up to ₹100). Just show this message when you visit.',
  experiment_duration_days: 14,
  assumptions: ['Customers read the message within a day'],
  warnings: [],
};
