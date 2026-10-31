import { describe, expect, it } from 'vitest';
import { calculateResults, safeRate, type MessageRow, type OutcomeRow } from './calculator';

const outcomes: OutcomeRow[] = [
  { customer_id: 't1', group_assignment: 'treatment', reactivated: true, revenue_minor: 25_000, unsubscribed: false },
  { customer_id: 't2', group_assignment: 'treatment', reactivated: false, revenue_minor: 0, unsubscribed: true },
  { customer_id: 'c1', group_assignment: 'control', reactivated: false, revenue_minor: 0, unsubscribed: false },
];
const messages: MessageRow[] = [
  { customer_id: 't1', status: 'delivered', simulated_cost_minor: 500 },
  { customer_id: 't2', status: 'delivered', simulated_cost_minor: 400 },
  { customer_id: 't3', status: 'failed', simulated_cost_minor: 700 },
];

describe('campaign results calculator', () => {
  it('ME-02: counts group denominators from persisted outcome rows', () => {
    const result = calculateResults('campaign', outcomes, messages, 25_000);
    expect(result).toMatchObject({ treatment_count: 2, control_count: 1 });
  });

  it('ME-03: uses each group as its own reactivation-rate denominator', () => {
    const result = calculateResults('campaign', outcomes, messages, 25_000);
    expect(result.treatment_reactivation_rate).toBe(0.5);
    expect(result.control_reactivation_rate).toBe(0);
  });

  it('ME-04: safely reports undefined rates for zero denominators', () => {
    expect(safeRate(0, 0)).toBeNull();
    const result = calculateResults('campaign', [], [], 25_000);
    expect(result.treatment_reactivation_rate).toBeNull();
    expect(result.control_reactivation_rate).toBeNull();
    expect(result.incremental_reactivation_rate).toBeNull();
    expect(result.unsubscribe_rate).toBeNull();
  });

  it('ME-05: reports no cost-per-reactivation when treatment has no reactivations', () => {
    const result = calculateResults('campaign', outcomes.map((row) => ({ ...row, reactivated: false })), messages, 25_000);
    expect(result.cost_per_reactivated_minor).toBeNull();
  });

  it('ME-06: calculates incremental rate as treatment minus control', () => {
    const result = calculateResults('campaign', outcomes, messages, 25_000);
    expect(result.incremental_reactivation_rate).toBe(
      result.treatment_reactivation_rate! - result.control_reactivation_rate!,
    );
    expect(result.estimated_incremental_reactivations).toBe(1);
  });

  it('ME-07: uses incremental reactivations times the documented average order value', () => {
    const result = calculateResults('campaign', outcomes, messages, 30_000);
    expect(result.estimated_incremental_revenue_minor).toBe(
      result.estimated_incremental_reactivations! * result.average_order_value_minor,
    );
    expect(result.estimated_incremental_revenue_minor).toBe(30_000);
  });

  it('calculates cost from delivered message cost and cost per treatment reactivation', () => {
    const result = calculateResults('campaign', outcomes, messages, 25_000);
    expect(result.campaign_cost_minor).toBe(900);
    expect(result.cost_per_reactivated_minor).toBe(900);
  });

  it('uses simulated unsubscribe outcomes over attempted treatment deliveries', () => {
    const result = calculateResults('campaign', outcomes, messages, 25_000);
    expect(result.unsubscribe_count).toBe(1);
    expect(result.unsubscribe_denominator).toBe(3);
    expect(result.unsubscribe_rate).toBe(1 / 3);
  });
});
