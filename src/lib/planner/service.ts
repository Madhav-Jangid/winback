/**
 * Plan generation for a saved campaign. The planner only drafts: nothing here changes the
 * campaign's offer, message, version or approval. The merchant applies a plan in the builder
 * and saves it like any other edit, which is what versions it and invalidates approval.
 */
import { z } from 'zod';
import { describeOffer } from '@/lib/campaigns/rules';
import { getCampaignView } from '@/lib/campaigns/service';
import { writeAuditEvent } from '@/lib/audit/service';
import { inTransaction } from '@/lib/db/transaction';
import type { Queryable } from '@/lib/db/types';
import { getServerEnv } from '@/lib/env';
import { sameJson } from '@/lib/stable-json';
import { AppError } from '@/lib/errors';
import { DemoCampaignPlanner } from '@/lib/providers/demo/planner';
import { selectPlanner, type PlannerSelection } from '@/lib/providers/factory';
import { getMerchantSettings } from '@/lib/repositories/merchants';
import { fingerprint, recordProviderOperation, setCampaignPlan } from '@/lib/repositories/planning';
import { buildPlanInput } from './input';
import { PlannerError, type CampaignPlanResult, type PlanResponse } from './types';

export const planRequestSchema = z.object({ use_demo: z.boolean().optional() }).strict();

const DEMO_CHOSEN_REASON = 'You chose the demo draft instead of the live Gemini planner.';

export async function generateCampaignPlan(
  db: Queryable,
  merchantId: string,
  campaignId: string,
  request: unknown,
  now: Date,
  actorId: string,
  selection: PlannerSelection = selectPlanner(getServerEnv()),
): Promise<PlanResponse> {
  const parsed = planRequestSchema.safeParse(request);
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Invalid plan request.', 400);
  const useDemo = parsed.data.use_demo === true;

  const view = await getCampaignView(db, merchantId, campaignId, now);
  if (!view.editable) {
    throw new AppError('CAMPAIGN_LOCKED', `A ${view.campaign.status} campaign can no longer be edited, so it cannot be planned.`, 409);
  }
  const merchant = await getMerchantSettings(db, merchantId);
  if (!merchant) throw new AppError('MERCHANT_NOT_FOUND', 'Demo data is not loaded. Run npm run db:seed.', 409);

  const input = buildPlanInput(view, merchant.business_type);
  const planner = useDemo ? new DemoCampaignPlanner(DEMO_CHOSEN_REASON) : selection.planner;
  const provider = useDemo || !selection.live ? 'demo' : 'gemini';
  const requestFingerprint = fingerprint(input);

  let plan: CampaignPlanResult;
  try {
    plan = await planner.generatePlan(input);
  } catch (error) {
    if (!(error instanceof PlannerError)) throw error;
    await inTransaction(db, async () => {
      await recordProviderOperation(db, { provider, operation: 'generate_plan', status: 'error', request_fingerprint: requestFingerprint, error_code: error.code });
      await writeAuditEvent({
        merchant_id: merchantId, campaign_id: campaignId, actor_id: actorId, event_type: 'plan_failed',
        entity_type: 'campaign', entity_id: campaignId,
        metadata: { provider, error_code: error.code, campaign_version: view.campaign.version },
      }, db);
    });
    // No silent substitution: the merchant decides whether to use the demo draft.
    throw new AppError('PLAN_PROVIDER_FAILED', `${error.message} Your campaign is unchanged. You can retry, or use a demo draft (clearly labelled).`, 502, {
      fallback_available: true,
      provider_code: error.code,
    });
  }

  const offerChanged = !sameJson(plan.offer, view.campaign.offer);
  await inTransaction(db, async () => {
    await recordProviderOperation(db, { provider, operation: 'generate_plan', status: plan.source === 'gemini' ? 'ok' : 'fallback', request_fingerprint: requestFingerprint });
    await setCampaignPlan(db, merchantId, campaignId, { source: plan.source, rationale: plan.rationale });
    await writeAuditEvent({
      merchant_id: merchantId, campaign_id: campaignId, actor_id: actorId, event_type: 'plan_generated',
      entity_type: 'campaign', entity_id: campaignId,
      metadata: {
        source: plan.source, model: plan.model, fallback_reason: plan.fallback_reason,
        campaign_version: view.campaign.version, offer_type: plan.offer.type,
        offer_changed: offerChanged,
        warnings: plan.warnings.length,
      },
    }, db);
  });

  return {
    plan,
    offer_changed: offerChanged,
    offer_summary: describeOffer(plan.offer, view.currency),
    campaign_version: view.campaign.version,
  };
}
