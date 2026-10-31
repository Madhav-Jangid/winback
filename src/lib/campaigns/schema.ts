/** Runtime validation for campaign drafts. Browser-safe. */
import { z } from 'zod';
import { CHANNELS, LANGUAGE_CODES, LIMITS, MESSAGE_MAX_STORED, type Offer } from './rules';
import { SEGMENT_TYPES } from './segments';

const minorAmount = (max: number, min = 1) =>
  z.number({ message: 'Enter an amount' }).int('Use whole paise').min(min, `Must be at least ${min / 100}`).max(max, `Must be at most ${max / 100}`);

const common = {
  minimum_order_value_minor: minorAmount(LIMITS.minOrderMaxMinor, 0).optional(),
  expiry_days: z.number().int().min(LIMITS.expiryDaysMin).max(LIMITS.expiryDaysMax, `Expiry can be at most ${LIMITS.expiryDaysMax} days`).optional(),
};

export const offerSchema = z
  .discriminatedUnion('type', [
    z.object({
      type: z.literal('percentage_discount'),
      percent: z.number().int('Use a whole percentage').min(LIMITS.percentMin).max(LIMITS.percentMax, `Discount can be at most ${LIMITS.percentMax}%`),
      max_discount_minor: minorAmount(LIMITS.perRedemptionMaxMinor).optional(),
      ...common,
    }).strict(),
    z.object({
      type: z.literal('fixed_discount'),
      amount_minor: minorAmount(LIMITS.perRedemptionMaxMinor),
      ...common,
    }).strict(),
    z.object({
      type: z.literal('free_item'),
      item_name: z.string().trim().min(2, 'Name the free item').max(60),
      item_cost_minor: minorAmount(LIMITS.perRedemptionMaxMinor),
      ...common,
    }).strict(),
    z.object({ type: z.literal('no_offer') }).strict(),
  ])
  .superRefine((offer, ctx) => {
    if (offer.type === 'fixed_discount' && offer.minimum_order_value_minor !== undefined
      && offer.minimum_order_value_minor < offer.amount_minor) {
      ctx.addIssue({ code: 'custom', path: ['minimum_order_value_minor'], message: 'Minimum order must be at least the discount amount' });
    }
  }) satisfies z.ZodType<Offer>;

const draftFields = {
  name: z.string().trim().min(3, 'Name must be at least 3 characters').max(100),
  goal: z.string().trim().min(5, 'Describe the goal in a few words').max(500),
  segment_type: z.enum(SEGMENT_TYPES),
  offer: offerSchema,
  budget_minor: z.number().int().min(0).max(LIMITS.budgetMaxMinor, 'Budget is above the demo limit'),
  frequency_cap: z.number().int().min(LIMITS.frequencyCapMin).max(LIMITS.frequencyCapMax),
  cooldown_days: z.number().int().min(LIMITS.cooldownDaysMin).max(LIMITS.cooldownDaysMax),
  language: z.enum(LANGUAGE_CODES, { message: 'Unsupported language' }),
  channel: z.enum(CHANNELS),
  original_message: z.string().max(MESSAGE_MAX_STORED),
  /** Customer-language text. Edited by hand, or filled by a translation (which also records its provenance). */
  localized_message: z.string().max(MESSAGE_MAX_STORED),
};

export const campaignDraftSchema = z
  .object({
    ...draftFields,
    original_message: draftFields.original_message.default(''),
    localized_message: draftFields.localized_message.default(''),
  })
  .strict();
export type CampaignDraftInput = z.input<typeof campaignDraftSchema>;
export type CampaignDraft = z.output<typeof campaignDraftSchema>;

/**
 * Partial update. Built from fields without defaults: Zod 4 applies defaults inside optional
 * fields, which would silently blank an omitted message. `expected_version` guards against
 * overwriting someone else's change.
 */
export const campaignUpdateSchema = z
  .object(draftFields)
  .partial()
  .extend({ expected_version: z.number().int().min(1) })
  .strict();
export type CampaignUpdate = z.output<typeof campaignUpdateSchema>;

/** Zod issues → { 'offer.percent': 'message' } for showing errors next to fields. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    out[key] ??= issue.message;
  }
  return out;
}
