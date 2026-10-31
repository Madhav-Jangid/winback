/**
 * Server-side validation of model output (FR-06). Model output is untrusted: anything that
 * fails here is rejected, never "fixed up". Rejections carry a short reason that is also
 * shown to the model on the one allowed retry (E-12).
 */
import { z } from 'zod';
import { OFFER_TYPES, offerCostPerRedemptionMinor, rupeesToMinor, type Offer } from '@/lib/campaigns/rules';
import { offerSchema } from '@/lib/campaigns/schema';
import type { CampaignPlanInput, ValidatedPlan } from './types';

export type PlanValidationContext = Pick<CampaignPlanInput, 'message_max_chars' | 'budget_minor' | 'current_offer'> & {
  avg_order_value_minor: number | null;
};

export const contextFromInput = (input: CampaignPlanInput): PlanValidationContext => ({
  message_max_chars: input.message_max_chars,
  budget_minor: input.budget_minor,
  current_offer: input.current_offer,
  avg_order_value_minor: input.segment.avg_order_value_minor,
});

export type ValidationResult = { ok: true; plan: ValidatedPlan } | { ok: false; reason: string };

/** Models often emit null for "absent". Treat null as missing before strict validation. */
export function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNulls);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== null).map(([k, v]) => [k, stripNulls(v)]),
    );
  }
  return value;
}

const textList = z.array(z.string().trim().min(1).max(240)).max(6);

// Unknown top-level fields are dropped (E-34); the offer itself is strict.
const planSchema = z.object({
  rationale: z.string().trim().min(10, 'rationale is too short').max(800, 'rationale is too long'),
  target_segment_description: z.string().trim().min(5).max(300),
  offer: offerSchema,
  message_draft: z.string().trim().min(10, 'message_draft is too short'),
  experiment_duration_days: z.number().int().min(1).max(90),
  assumptions: textList.default([]),
  warnings: textList.default([]),
});

const URGENCY = /\b(today only|this (?:week|weekend|month) only|limited[- ]time|hurry|last chance|expires?|expiring|ends? (?:soon|today|tonight|tomorrow)|offer ends|only \d+ (?:days?|hours?) (?:left|remain)|don'?t miss out|act now|while (?:stocks|supplies) last)\b/i;
const PLACEHOLDER = /\{[^}]*\}|\[[^\]]*\]|<[^>]*>/;
const PERCENT = /(\d+(?:\.\d+)?)\s*(?:%|per ?cent\b)/gi;
const RUPEES = /(?:₹|\bRs\.?|\bINR)\s*([\d,]+(?:\.\d{1,2})?)/gi;

function allowedAmounts(offer: Offer): Set<number> {
  const amounts = new Set<number>();
  if (offer.type === 'no_offer') return amounts;
  if (offer.type === 'fixed_discount') amounts.add(offer.amount_minor);
  if (offer.type === 'percentage_discount' && offer.max_discount_minor !== undefined) amounts.add(offer.max_discount_minor);
  if (offer.minimum_order_value_minor !== undefined) amounts.add(offer.minimum_order_value_minor);
  return amounts;
}

/**
 * Checks that the copy only states what the offer says: no extra percentages or amounts, no
 * placeholders, and no urgency when no expiry is configured (E-16, E-30).
 */
export function findMessageProblems(message: string, offer: Offer, maxChars: number): string[] {
  const problems: string[] = [];
  if (message.length > maxChars) problems.push(`message_draft is ${message.length} characters; the limit is ${maxChars}`);
  if (PLACEHOLDER.test(message)) problems.push('message_draft contains a placeholder or markup; write plain text with no placeholders');

  const allowedPercent = offer.type === 'percentage_discount' ? offer.percent : null;
  for (const match of message.matchAll(PERCENT)) {
    if (allowedPercent === null || Number(match[1]) !== allowedPercent) {
      problems.push(`message_draft mentions "${match[0].trim()}", which is not part of the offer`);
    }
  }

  const amounts = allowedAmounts(offer);
  for (const match of message.matchAll(RUPEES)) {
    const minor = rupeesToMinor(match[1].replaceAll(',', ''));
    if (minor === null || !amounts.has(minor)) {
      problems.push(`message_draft mentions "${match[0].trim()}", which is not an amount in the offer`);
    }
  }

  const hasExpiry = offer.type !== 'no_offer' && offer.expiry_days !== undefined;
  if (!hasExpiry && URGENCY.test(message)) {
    problems.push('message_draft implies urgency or a deadline, but the offer has no expiry');
  }
  return problems;
}

function describeIssues(error: z.ZodError): string {
  return error.issues.slice(0, 3).map((i) => `${i.path.join('.') || 'response'}: ${i.message}`).join('; ');
}

export function validatePlan(raw: unknown, ctx: PlanValidationContext): ValidationResult {
  const cleaned = stripNulls(raw);
  if (typeof cleaned !== 'object' || cleaned === null || Array.isArray(cleaned)) {
    return { ok: false, reason: 'the response must be a single JSON object' };
  }

  const offerType = (cleaned as { offer?: { type?: unknown } }).offer?.type;
  if (typeof offerType === 'string' && !(OFFER_TYPES as readonly string[]).includes(offerType)) {
    return { ok: false, reason: `offer.type "${offerType.slice(0, 40)}" is not allowed; use one of ${OFFER_TYPES.join(', ')}` };
  }

  const parsed = planSchema.safeParse(cleaned);
  if (!parsed.success) return { ok: false, reason: describeIssues(parsed.error) };
  const plan = parsed.data;

  // Never silently expand the offer or the budget (E-13).
  const cost = offerCostPerRedemptionMinor(plan.offer, ctx.avg_order_value_minor);
  if (cost === null) {
    return { ok: false, reason: 'a percentage offer needs max_discount_minor so its cost can be checked' };
  }
  if (cost > ctx.budget_minor) {
    return { ok: false, reason: `the offer costs about ${cost} paise per redemption, which exceeds the campaign budget of ${ctx.budget_minor} paise` };
  }
  const currentCost = offerCostPerRedemptionMinor(ctx.current_offer, ctx.avg_order_value_minor);
  if (currentCost !== null && cost > currentCost) {
    return { ok: false, reason: `the offer costs more per redemption (${cost} paise) than the merchant's configured offer (${currentCost} paise); keep it equal or cheaper` };
  }

  const problems = findMessageProblems(plan.message_draft, plan.offer, ctx.message_max_chars);
  if (problems.length > 0) return { ok: false, reason: problems.join('; ') };

  return { ok: true, plan };
}
