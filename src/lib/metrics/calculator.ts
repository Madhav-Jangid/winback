import type { CampaignResults } from '@/types';

export interface OutcomeRow {
  customer_id: string;
  group_assignment: 'treatment' | 'control';
  reactivated: boolean;
  revenue_minor: number;
  unsubscribed: boolean;
}

export interface MessageRow {
  customer_id: string;
  status: 'queued' | 'delivered' | 'failed';
  simulated_cost_minor: number;
}

export function safeRate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

/** Reconcile persisted outcome and message rows into campaign-level, explicitly simulated metrics. */
export function calculateResults(
  campaignId: string,
  outcomes: readonly OutcomeRow[],
  messages: readonly MessageRow[],
  averageOrderValueMinor: number,
): CampaignResults {
  const treatment = outcomes.filter((outcome) => outcome.group_assignment === 'treatment');
  const control = outcomes.filter((outcome) => outcome.group_assignment === 'control');
  const treatmentReactivations = treatment.filter((outcome) => outcome.reactivated).length;
  const controlReactivations = control.filter((outcome) => outcome.reactivated).length;
  const treatmentRate = safeRate(treatmentReactivations, treatment.length);
  const controlRate = safeRate(controlReactivations, control.length);
  const incrementalRate = treatmentRate !== null && controlRate !== null ? treatmentRate - controlRate : null;
  const incrementalReactivations = incrementalRate === null ? null : incrementalRate * treatment.length;
  const delivered = messages.filter((message) => message.status === 'delivered');
  const failed = messages.filter((message) => message.status === 'failed');
  const campaignCost = delivered.reduce((sum, message) => sum + message.simulated_cost_minor, 0);
  const unsubscribeCount = outcomes.filter((outcome) => outcome.unsubscribed).length;

  return {
    campaign_id: campaignId,
    treatment_count: treatment.length,
    control_count: control.length,
    treatment_reactivations: treatmentReactivations,
    control_reactivations: controlReactivations,
    treatment_reactivation_rate: treatmentRate,
    control_reactivation_rate: controlRate,
    incremental_reactivation_rate: incrementalRate,
    estimated_incremental_reactivations: incrementalReactivations,
    estimated_incremental_revenue_minor: incrementalReactivations === null
      ? null
      : Math.round(incrementalReactivations * averageOrderValueMinor),
    campaign_cost_minor: campaignCost,
    cost_per_reactivated_minor: treatmentReactivations === 0
      ? null
      : Math.round(campaignCost / treatmentReactivations),
    unsubscribe_count: unsubscribeCount,
    unsubscribe_denominator: delivered.length + failed.length,
    unsubscribe_rate: safeRate(unsubscribeCount, delivered.length + failed.length),
    average_order_value_minor: averageOrderValueMinor,
    is_simulated: true,
  };
}
