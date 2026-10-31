import { describe, expect, it } from 'vitest';
import { batchAssessRisk } from '@/lib/risk/engine';
import { DEMO_REFERENCE_DATE } from './constants';
import { buildDemoDataset, DEMO_CUSTOMERS } from './seed-data';

describe('demo seed dataset', () => {
  const data = buildDemoDataset();

  it('is deterministic', () => {
    expect(buildDemoDataset()).toEqual(data);
  });

  it('has unique ids', () => {
    const ids = [...data.customers, ...data.purchases, ...data.recipients, ...data.messages].map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every customer the risk status its scenario promises at the reference date', () => {
    const results = batchAssessRisk(
      data.customers.map((c) => ({
        id: c.id,
        purchases: data.purchases
          .filter((p) => p.customer_id === c.id)
          .map((p) => ({ occurred_at: p.occurred_at.toISOString(), status: p.status })),
      })),
      { now: DEMO_REFERENCE_DATE },
    );
    const actual = results.map((r, i) => `${DEMO_CUSTOMERS[i].name}: ${r.status}`);
    const expected = DEMO_CUSTOMERS.map((c) => `${c.name}: ${c.expectedRisk}`);
    expect(actual).toEqual(expected);
  });

  it('covers every case the PRD asks the demo to show', () => {
    const has = (fn: (c: (typeof DEMO_CUSTOMERS)[number]) => boolean) => DEMO_CUSTOMERS.some(fn);
    expect(has((c) => c.expectedRisk === 'at_risk' && c.consent === 'consented' && !c.optedOutDaysAgo && !c.messagedDaysAgo)).toBe(true);
    expect(has((c) => c.expectedRisk === 'healthy')).toBe(true);
    expect(has((c) => c.expectedRisk === 'insufficient_history')).toBe(true);
    expect(has((c) => c.optedOutDaysAgo !== undefined)).toBe(true);
    expect(has((c) => c.consent === 'unknown')).toBe(true);
    expect(has((c) => c.consent === 'revoked')).toBe(true);
    expect(has((c) => c.messagedDaysAgo !== undefined)).toBe(true);
    expect(has((c) => c.purchases.some((p) => p.status === 'refunded'))).toBe(true);
  });

  it('keeps money as nonnegative integer minor units', () => {
    for (const p of data.purchases) {
      expect(Number.isInteger(p.amount_minor)).toBe(true);
      expect(p.amount_minor).toBeGreaterThanOrEqual(0);
    }
  });
});
