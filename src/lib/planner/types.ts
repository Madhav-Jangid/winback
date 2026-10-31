/** Campaign planner contract (FR-06): what the model may see, and what it may return. */
import { z } from 'zod';
import { CHANNELS, OFFER_TYPES, type Offer } from '@/lib/campaigns/rules';
import { offerSchema } from '@/lib/campaigns/schema';

export type PlanSource = 'gemini' | 'demo_fallback';

/**
 * Everything sent to the model. A strict whitelist of aggregate facts: no customer names, ids,
 * contact details, or purchase histories. `buildPlanInput` parses through this schema, so
 * nothing outside it can leak into a prompt.
 */
export const planInputSchema = z.object({
  merchant_type: z.string().max(40),
  goal: z.string().max(200),
  segment: z.object({
    label: z.string(),
    description: z.string(),
    eligible: z.number().int().min(0),
    avg_cadence_days: z.number().nullable(),
    avg_days_since_purchase: z.number().nullable(),
    avg_order_value_minor: z.number().int().nullable(),
  }).strict(),
  current_offer: offerSchema,
  allowed_offer_types: z.array(z.enum(OFFER_TYPES)),
  limits: z.object({
    percent_max: z.number(),
    per_redemption_max_minor: z.number(),
    expiry_days_max: z.number(),
  }).strict(),
  budget_minor: z.number().int().min(0),
  currency: z.string().length(3),
  channel: z.enum(CHANNELS),
  message_max_chars: z.number().int().positive(),
  safety_constraints: z.array(z.string()),
}).strict();
export type CampaignPlanInput = z.infer<typeof planInputSchema>;

/** A plan that passed validation. */
export interface ValidatedPlan {
  rationale: string;
  target_segment_description: string;
  /** Never costlier than the merchant's configured offer. */
  offer: Offer;
  /** English source copy. Translation is a separate, reviewed step. */
  message_draft: string;
  experiment_duration_days: number;
  assumptions: string[];
  warnings: string[];
}

export interface CampaignPlanResult extends ValidatedPlan {
  source: PlanSource;
  /** Model id for Gemini plans, null for the demo fallback. */
  model: string | null;
  /** Why the demo fallback was used. Null for Gemini plans. */
  fallback_reason: string | null;
}

/** Response of POST /api/campaigns/:id/plan. */
export interface PlanResponse {
  plan: CampaignPlanResult;
  offer_changed: boolean;
  offer_summary: string;
  campaign_version: number;
}

export type PlannerErrorCode =
  | 'PLANNER_TIMEOUT'
  | 'PLANNER_NETWORK_ERROR'
  | 'PLANNER_HTTP_ERROR'
  | 'PLANNER_BLOCKED'
  | 'PLANNER_INVALID_RESPONSE';

/** A provider failure with a safe, user-readable message (never raw provider payloads or keys). */
export class PlannerError extends Error {
  constructor(public readonly code: PlannerErrorCode, message: string) {
    super(message);
    this.name = 'PlannerError';
  }
}
