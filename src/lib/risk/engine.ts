/**
 * Winback AI — Lapsed Customer Risk Detection Engine
 *
 * Deterministic, explainable rule-based detection.
 * Tests inject a clock rather than using Date.now() directly.
 */

import { RiskResult, RiskStatus, Purchase } from '@/types';

export const DEFAULT_RISK_MULTIPLIER = 1.5;
export const DEFAULT_MIN_DAYS = 14;

/**
 * Calculate intervals in days between consecutive purchases.
 * Skips zero/negative intervals (duplicate timestamps).
 */
export function calculateIntervals(sortedDates: Date[]): number[] {
  const intervals: number[] = [];
  for (let i = 1; i < sortedDates.length; i++) {
    const diffMs = sortedDates[i].getTime() - sortedDates[i - 1].getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    if (diffDays > 0) {
      intervals.push(diffDays);
    }
  }
  return intervals;
}

/**
 * Calculate median of a numeric array.
 */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

export interface RiskEngineOptions {
  riskMultiplier?: number;
  minDaysSincePurchase?: number;
  now?: Date;
}

/**
 * Assess a single customer's risk status given their completed purchases.
 */
export function assessRisk(
  customerId: string,
  completedPurchases: Pick<Purchase, 'occurred_at'>[],
  options: RiskEngineOptions = {},
): RiskResult {
  const {
    riskMultiplier = DEFAULT_RISK_MULTIPLIER,
    minDaysSincePurchase = DEFAULT_MIN_DAYS,
    now = new Date(),
  } = options;

  if (completedPurchases.length < 2) {
    const lastPurchaseAt = completedPurchases[0]?.occurred_at ?? null;
    return {
      customer_id: customerId,
      status: 'insufficient_history',
      last_purchase_at: lastPurchaseAt,
      median_cadence_days: null,
      days_since_last_purchase: null,
      threshold_days: null,
      reason:
        completedPurchases.length === 0
          ? 'No purchase history — cannot estimate buying rhythm.'
          : 'Only one purchase recorded — need at least 2 to estimate cadence.',
    };
  }

  // Sort ascending by date
  const dates = completedPurchases
    .map((p) => new Date(p.occurred_at))
    .sort((a, b) => a.getTime() - b.getTime());

  const intervals = calculateIntervals(dates);

  if (intervals.length === 0) {
    return {
      customer_id: customerId,
      status: 'insufficient_history',
      last_purchase_at: dates[dates.length - 1].toISOString(),
      median_cadence_days: null,
      days_since_last_purchase: null,
      threshold_days: null,
      reason: 'All purchases share the same timestamp — cannot estimate cadence.',
    };
  }

  const medianCadence = median(intervals);
  const lastPurchase = dates[dates.length - 1];
  const daysSinceLast = (now.getTime() - lastPurchase.getTime()) / (1000 * 60 * 60 * 24);
  const threshold = Math.max(medianCadence * riskMultiplier, minDaysSincePurchase);

  const isAtRisk = daysSinceLast >= threshold;
  const status: RiskStatus = isAtRisk ? 'at_risk' : 'healthy';

  return {
    customer_id: customerId,
    status,
    last_purchase_at: lastPurchase.toISOString(),
    median_cadence_days: Math.round(medianCadence * 10) / 10,
    days_since_last_purchase: Math.round(daysSinceLast * 10) / 10,
    threshold_days: Math.round(threshold * 10) / 10,
    reason: isAtRisk
      ? `Last visit was ${Math.round(daysSinceLast)} days ago. Typical visit: every ${Math.round(medianCadence)} days. Threshold: ${Math.round(threshold)} days.`
      : `Last visit was ${Math.round(daysSinceLast)} days ago. Typical visit: every ${Math.round(medianCadence)} days. Still within expected window.`,
  };
}

/**
 * Batch-assess risk for multiple customers.
 */
export function batchAssessRisk(
  customers: Array<{ id: string; purchases: Pick<Purchase, 'occurred_at' | 'status'>[] }>,
  options: RiskEngineOptions = {},
): RiskResult[] {
  return customers.map((c) => {
    const completedPurchases = c.purchases.filter((p) => p.status === 'completed');
    return assessRisk(c.id, completedPurchases, options);
  });
}
