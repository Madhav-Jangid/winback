/**
 * Winback AI — Metrics Calculator
 * Formulas are fully documented and transparent.
 */

import { CampaignResults } from '@/types';

interface OutcomeRow {
  group_assignment: 'treatment' | 'control';
  reactivated: boolean;
  revenue_minor: number;
}

interface MessageRow {
  status: string;
}

export function safeRate(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return numerator / denominator;
}

/**
 * Calculate full campaign results metrics.
 * Never divides by zero; returns null for undefined rates.
 */
export function calculateResults(
  campaignId: string,
  outcomes: OutcomeRow[],
  messages: MessageRow[],
  campaignBudgetMinor: number,
  averageOrderValueMinor: number = 25000, // ₹250 default
): CampaignResults {
  const treatment = outcomes.filter((o) => o.group_assignment === 'treatment');
  const control = outcomes.filter((o) => o.group_assignment === 'control');

  const treatmentCount = treatment.length;
  const controlCount = control.length;

  const treatmentReactivations = treatment.filter((o) => o.reactivated).length;
  const controlReactivations = control.filter((o) => o.reactivated).length;

  const treatmentRate = safeRate(treatmentReactivations, treatmentCount);
  const controlRate = safeRate(controlReactivations, controlCount);

  const incrementalRate =
    treatmentRate !== null && controlRate !== null ? treatmentRate - controlRate : null;

  const estimatedIncrementalReactivations =
    incrementalRate !== null ? incrementalRate * treatmentCount : null;

  const estimatedIncrementalRevenue =
    estimatedIncrementalReactivations !== null
      ? estimatedIncrementalReactivations * averageOrderValueMinor
      : null;

  const deliveredMessages = messages.filter((m) => m.status === 'delivered').length;
  const campaignCost = deliveredMessages * 500; // ₹5 per simulated message

  const costPerReactivated =
    treatmentReactivations > 0
      ? Math.round((campaignBudgetMinor + campaignCost) / treatmentReactivations)
      : null;

  const failedMessages = messages.filter((m) => m.status === 'failed').length;
  const unsubscribeRate = safeRate(failedMessages, deliveredMessages + failedMessages);

  return {
    campaign_id: campaignId,
    treatment_count: treatmentCount,
    control_count: controlCount,
    treatment_reactivations: treatmentReactivations,
    control_reactivations: controlReactivations,
    treatment_reactivation_rate: treatmentRate,
    control_reactivation_rate: controlRate,
    incremental_reactivation_rate: incrementalRate,
    estimated_incremental_reactivations: estimatedIncrementalReactivations,
    estimated_incremental_revenue_minor:
      estimatedIncrementalRevenue !== null ? Math.round(estimatedIncrementalRevenue) : null,
    campaign_cost_minor: campaignCost,
    cost_per_reactivated_minor: costPerReactivated,
    unsubscribe_rate: unsubscribeRate,
    is_simulated: true,
  };
}
