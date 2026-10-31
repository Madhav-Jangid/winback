/** Checks a campaign must pass before it can be approved. Browser-safe. */
import { CHANNEL_LABELS, CHANNEL_MESSAGE_LIMITS, formatMinor, offerCostPerRedemptionMinor } from './rules';
import type { CampaignDraft } from './schema';
import type { SegmentPreview } from './segments';

export interface ReadinessIssue {
  code: 'EMPTY_SEGMENT' | 'MESSAGE_REQUIRED' | 'MESSAGE_TOO_LONG' | 'OFFER_COST_UNKNOWN' | 'BUDGET_TOO_LOW';
  field: string;
  message: string;
}

export function checkReadiness(
  campaign: Pick<CampaignDraft, 'offer' | 'budget_minor' | 'channel' | 'original_message'>,
  preview: Pick<SegmentPreview, 'eligible' | 'matched' | 'excluded' | 'avg_order_value_minor'>,
  currency: string = 'INR',
): ReadinessIssue[] {
  const issues: ReadinessIssue[] = [];

  if (preview.eligible === 0) {
    const ex = preview.excluded;
    const why = preview.matched === 0
      ? 'No customers match this segment right now.'
      : `All ${preview.matched} matching customers are excluded (no consent ${ex.no_consent}, opted out ${ex.opted_out}, recently messaged ${ex.frequency_cap}, other ${ex.other}).`;
    issues.push({ code: 'EMPTY_SEGMENT', field: 'segment_type', message: `${why} Choose another segment or adjust the frequency limits.` });
  }

  const message = campaign.original_message.trim();
  const limit = CHANNEL_MESSAGE_LIMITS[campaign.channel];
  if (!message) {
    issues.push({ code: 'MESSAGE_REQUIRED', field: 'original_message', message: 'Write the campaign message (or generate one with the planner).' });
  } else if (message.length > limit) {
    issues.push({ code: 'MESSAGE_TOO_LONG', field: 'original_message', message: `${CHANNEL_LABELS[campaign.channel]} messages are limited to ${limit} characters (currently ${message.length}).` });
  }

  const cost = offerCostPerRedemptionMinor(campaign.offer, preview.avg_order_value_minor);
  if (cost === null) {
    issues.push({ code: 'OFFER_COST_UNKNOWN', field: 'offer.max_discount_minor', message: 'Set a maximum discount so the cost per redemption can be estimated.' });
  } else if (cost > campaign.budget_minor) {
    issues.push({ code: 'BUDGET_TOO_LOW', field: 'budget_minor', message: `Budget must cover at least one redemption (about ${formatMinor(cost, currency)}).` });
  }

  return issues;
}
