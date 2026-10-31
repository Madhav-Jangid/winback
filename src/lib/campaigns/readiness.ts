/** Checks a campaign must pass before it can be approved. Browser-safe. */
import { numbersPreserved, translationState, type TranslationMeta } from '@/lib/localization/rules';
import { CHANNEL_LABELS, CHANNEL_MESSAGE_LIMITS, formatMinor, languageLabel, offerCostPerRedemptionMinor } from './rules';
import type { CampaignDraft } from './schema';
import type { SegmentPreview } from './segments';

export interface ReadinessIssue {
  code:
    | 'EMPTY_SEGMENT' | 'MESSAGE_REQUIRED' | 'MESSAGE_TOO_LONG' | 'OFFER_COST_UNKNOWN' | 'BUDGET_TOO_LOW'
    | 'TRANSLATION_REQUIRED' | 'TRANSLATION_STALE' | 'TRANSLATION_TOO_LONG' | 'TRANSLATION_NEEDS_REVIEW';
  field: string;
  message: string;
}

export type ReadinessCampaign =
  Pick<CampaignDraft, 'offer' | 'budget_minor' | 'channel' | 'original_message' | 'language' | 'localized_message'>
  & { translation: TranslationMeta | null };

export function checkReadiness(
  campaign: ReadinessCampaign,
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

  // Customers receive the localized text, so it must exist and match the current English message.
  if (message) issues.push(...translationIssues(campaign, message, limit));

  const cost = offerCostPerRedemptionMinor(campaign.offer, preview.avg_order_value_minor);
  if (cost === null) {
    issues.push({ code: 'OFFER_COST_UNKNOWN', field: 'offer.max_discount_minor', message: 'Set a maximum discount so the cost per redemption can be estimated.' });
  } else if (cost > campaign.budget_minor) {
    issues.push({ code: 'BUDGET_TOO_LOW', field: 'budget_minor', message: `Budget must cover at least one redemption (about ${formatMinor(cost, currency)}).` });
  }

  return issues;
}

function translationIssues(campaign: ReadinessCampaign, message: string, limit: number): ReadinessIssue[] {
  const state = translationState(campaign, campaign.translation);
  if (state === 'not_needed') return [];
  const name = languageLabel(campaign.language);
  const field = 'localized_message';

  if (state === 'missing') {
    return [{ code: 'TRANSLATION_REQUIRED', field, message: `Translate the message into ${name}, or write the ${name} text yourself.` }];
  }
  if (state === 'stale') {
    return [{ code: 'TRANSLATION_STALE', field, message: `The English message or language changed since the ${name} text was made. Re-translate it, or review the ${name} text and save it to confirm.` }];
  }

  const issues: ReadinessIssue[] = [];
  const text = campaign.localized_message.trim();
  if (text.length > limit) {
    issues.push({ code: 'TRANSLATION_TOO_LONG', field, message: `The ${name} text is ${text.length} characters; ${CHANNEL_LABELS[campaign.channel]} allows ${limit}. Shorten it.` });
  }
  // Unreviewed output needs the merchant's eyes (E-16). Once they have edited or confirmed the
  // text, they have taken responsibility for it.
  if (!campaign.translation?.edited) {
    if (campaign.translation?.source === 'demo_fallback') {
      issues.push({ code: 'TRANSLATION_NEEDS_REVIEW', field, message: `The ${name} text is the English message from the demo fallback, not a translation. Translate it yourself and save, or configure Sarvam and re-translate.` });
    } else {
      const numbers = numbersPreserved(message, text);
      if (!numbers.ok) {
        const parts = [
          numbers.missing.length ? `missing ${numbers.missing.join(', ')}` : null,
          numbers.extra.length ? `unexpected ${numbers.extra.join(', ')}` : null,
        ].filter(Boolean).join('; ');
        issues.push({ code: 'TRANSLATION_NEEDS_REVIEW', field, message: `The numbers in the ${name} text differ from the English message (${parts}). Check the offer terms, then edit and save the text to confirm it.` });
      }
    }
  }
  return issues;
}
