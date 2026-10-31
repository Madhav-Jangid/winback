/**
 * Winback AI — Gemini Campaign Planner
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { z } from 'zod';
import { CampaignPlanner } from '../interfaces';
import { CampaignPlanInput, CampaignPlanResult, OfferType } from '@/types';
import { DemoCampaignPlanner } from '../demo';

const CAMPAIGN_PLAN_SCHEMA = z.object({
  rationale: z.string().min(10),
  target_segment_description: z.string().min(5),
  offer_type: z.enum(['percentage_discount', 'fixed_discount', 'free_item', 'no_offer']),
  offer_value: z.number().nullable(),
  offer_description: z.string().min(3),
  message_draft: z.string().min(10).max(500),
  experiment_duration_days: z.number().int().min(1).max(90),
  assumptions: z.array(z.string()),
  warnings: z.array(z.string()),
});

const PROVIDER_TIMEOUT_MS = 15000;

export class GeminiCampaignPlanner implements CampaignPlanner {
  private apiKey: string;
  private fallback: DemoCampaignPlanner;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.fallback = new DemoCampaignPlanner();
  }

  async generatePlan(input: CampaignPlanInput): Promise<CampaignPlanResult> {
    const prompt = this.buildPrompt(input);

    try {
      const genAI = new GoogleGenerativeAI(this.apiKey);
      const model = genAI.getGenerativeModel({
        model: 'gemini-1.5-flash',
        generationConfig: { responseMimeType: 'application/json' },
      });

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);

      let rawText: string;
      try {
        const result = await model.generateContent(prompt);
        rawText = result.response.text();
      } finally {
        clearTimeout(timeout);
      }

      const parsed = JSON.parse(rawText);
      const validated = CAMPAIGN_PLAN_SCHEMA.parse(parsed);

      // Validate offer type is allowed
      if (!input.allowed_offer_types.includes(validated.offer_type as OfferType)) {
        throw new Error(`Gemini suggested disallowed offer type: ${validated.offer_type}`);
      }

      // Validate offer value within bounds
      if (validated.offer_type === 'percentage_discount' && validated.offer_value !== null) {
        if (validated.offer_value > 50) {
          throw new Error(`Gemini suggested ${validated.offer_value}% discount exceeding 50% max.`);
        }
      }

      return {
        ...validated,
        offer_type: validated.offer_type as OfferType,
        source: 'gemini',
      };
    } catch (err) {
      console.error('[Gemini] Plan generation failed:', err instanceof Error ? err.message : err);
      // Return labelled fallback
      const fallbackResult = await this.fallback.generatePlan(input);
      return {
        ...fallbackResult,
        warnings: [
          `⚠️ Gemini unavailable: ${err instanceof Error ? err.message : 'Unknown error'}. Using demo fallback.`,
          ...fallbackResult.warnings,
        ],
      };
    }
  }

  private buildPrompt(input: CampaignPlanInput): string {
    return `You are a campaign planning assistant for a small business. Generate a winback campaign plan.

Return ONLY valid JSON matching this schema exactly:
{
  "rationale": string (explain why this campaign makes sense),
  "target_segment_description": string,
  "offer_type": one of ${JSON.stringify(input.allowed_offer_types)},
  "offer_value": number or null,
  "offer_description": string (human-readable offer description),
  "message_draft": string (max 300 chars, use {name} placeholder for customer name),
  "experiment_duration_days": number (1-90),
  "assumptions": string[],
  "warnings": string[]
}

Context:
- Business type: ${input.merchant_type}
- Campaign goal: ${input.goal}
- Customers in segment: ${input.segment_summary.total_eligible}
- Typical purchase cadence: ${Math.round(input.segment_summary.median_cadence_days)} days
- Avg days overdue: ${Math.round(input.segment_summary.days_since_typical_purchase)}
- Campaign budget: ₹${(input.budget_minor / 100).toFixed(2)}
- Channel: ${input.channel}
- Language: ${input.language}
- Allowed offer types: ${input.allowed_offer_types.join(', ')}
- Max offer value: ${input.max_offer_value}
- Safety constraints: ${input.safety_constraints.join('; ')}

Rules:
- Choose ONLY from the allowed offer types listed above
- Keep message_draft under 300 characters
- percentage_discount must not exceed 50%
- fixed_discount must not exceed budget per customer
- Do not include real customer names or PII
- Be honest about limitations`;
  }
}
