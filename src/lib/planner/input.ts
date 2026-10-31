import { CHANNEL_MESSAGE_LIMITS, LIMITS, OFFER_TYPES } from '@/lib/campaigns/rules';
import { SEGMENTS } from '@/lib/campaigns/segments';
import type { CampaignView } from '@/lib/campaigns/service';
import { planInputSchema, type CampaignPlanInput } from './types';

export const SAFETY_CONSTRAINTS = [
  'Never promise anything beyond the offer in current_offer, and never a costlier offer.',
  'Do not include customer names, placeholders, or personal data in the message.',
  'Do not imply urgency or a deadline unless the offer has expiry_days.',
  'State offer terms exactly as given; do not invent discounts, amounts, or conditions.',
  'The merchant reviews and approves everything; you only draft.',
];

/**
 * Build the model input from a campaign view: aggregate counts and the merchant's own rules.
 * Parsing through the strict schema guarantees no customer-level data is included.
 */
export function buildPlanInput(
  view: Pick<CampaignView, 'campaign' | 'preview' | 'currency'>,
  merchantType: string,
): CampaignPlanInput {
  const { campaign, preview } = view;
  return planInputSchema.parse({
    merchant_type: merchantType.slice(0, 40),
    goal: campaign.goal.slice(0, 200),
    segment: {
      label: SEGMENTS[campaign.segment_type].label,
      description: SEGMENTS[campaign.segment_type].description,
      eligible: preview.eligible,
      avg_cadence_days: preview.avg_cadence_days,
      avg_days_since_purchase: preview.avg_days_since_purchase,
      avg_order_value_minor: preview.avg_order_value_minor,
    },
    current_offer: campaign.offer,
    allowed_offer_types: [...OFFER_TYPES],
    limits: {
      percent_max: LIMITS.percentMax,
      per_redemption_max_minor: LIMITS.perRedemptionMaxMinor,
      expiry_days_max: LIMITS.expiryDaysMax,
    },
    budget_minor: campaign.budget_minor,
    currency: view.currency,
    channel: campaign.channel,
    message_max_chars: CHANNEL_MESSAGE_LIMITS[campaign.channel],
    safety_constraints: SAFETY_CONSTRAINTS,
  });
}
