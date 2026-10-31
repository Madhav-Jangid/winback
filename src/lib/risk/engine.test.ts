import { afterEach, describe, expect, it, vi } from 'vitest';
import { assessRisk, batchAssessRisk, median } from './engine';

const DAY_MS = 86_400_000;
const NOW = new Date('2026-10-01T00:00:00Z');
const at = (daysAgo: number) => ({ occurred_at: new Date(NOW.getTime() - daysAgo * DAY_MS).toISOString() });
const purchases = (...days: number[]) => days.map(at);

describe('risk engine', () => {
  afterEach(() => vi.useRealTimers());

  it('RD-01: no purchases => insufficient history', () => {
    const r = assessRisk('c', [], { now: NOW });
    expect(r).toMatchObject({ status: 'insufficient_history', last_purchase_at: null, median_cadence_days: null, threshold_days: null });
    expect(r.reason).toMatch(/No purchase history/);
  });

  it('RD-02: one purchase => insufficient history, but last purchase is shown', () => {
    const r = assessRisk('c', purchases(300), { now: NOW });
    expect(r.status).toBe('insufficient_history');
    expect(r.last_purchase_at).toBe(at(300).occurred_at);
    expect(r.reason).toMatch(/at least 2/);
  });

  it('RD-03: two purchases, below threshold => not at risk', () => {
    // gap 30 days -> threshold 45; last purchase 30 days ago
    const r = assessRisk('c', purchases(60, 30), { now: NOW });
    expect(r).toMatchObject({ status: 'healthy', median_cadence_days: 30, days_since_last_purchase: 30, threshold_days: 45 });
  });

  it('RD-04: exactly at threshold => at risk (>= rule); just under => healthy', () => {
    expect(assessRisk('c', purchases(75, 45), { now: NOW }).status).toBe('at_risk');
    const justUnder = new Date(NOW.getTime() - 60_000); // one minute before day 45
    expect(assessRisk('c', purchases(75, 45), { now: justUnder }).status).toBe('healthy');
  });

  it('RD-05: duplicate timestamps do not create a zero-day cadence', () => {
    const r = assessRisk('c', purchases(60, 60, 30), { now: NOW });
    expect(r.median_cadence_days).toBe(30);
    expect(r.status).toBe('healthy');

    const allSame = assessRisk('c', purchases(40, 40, 40), { now: NOW });
    expect(allSame.status).toBe('insufficient_history');
    expect(allSame.reason).toMatch(/same timestamp/);
  });

  it('RD-06: refunded and cancelled purchases are ignored', () => {
    const [result] = batchAssessRisk([{
      id: 'c',
      purchases: [
        { ...at(90), status: 'completed' },
        { ...at(60), status: 'completed' },
        { ...at(10), status: 'refunded' },
        { ...at(5), status: 'cancelled' },
      ],
    }], { now: NOW });
    expect(result).toMatchObject({ status: 'at_risk', last_purchase_at: at(60).occurred_at, median_cadence_days: 30 });

    const [onlyOneCompleted] = batchAssessRisk([{
      id: 'c',
      purchases: [{ ...at(90), status: 'completed' }, { ...at(60), status: 'refunded' }],
    }], { now: NOW });
    expect(onlyOneCompleted.status).toBe('insufficient_history');
  });

  it('RD-07: median interval handles uneven intervals (odd and even counts)', () => {
    expect(median([10, 50, 20])).toBe(20);
    expect(median([40, 10, 30, 20])).toBe(25);
    expect(assessRisk('c', purchases(100, 90, 70, 20), { now: NOW }).median_cadence_days).toBe(20);
    expect(assessRisk('c', purchases(100, 90, 70, 40, 0), { now: NOW }).median_cadence_days).toBe(25);
    // Input order does not matter
    expect(assessRisk('c', purchases(20, 100, 70, 90), { now: NOW }).median_cadence_days).toBe(20);
  });

  it('RD-08: an injected clock gives deterministic results, independent of real time', () => {
    const input = purchases(130, 100, 70);
    const first = assessRisk('c', input, { now: NOW });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2031-01-01T00:00:00Z'));
    expect(assessRisk('c', input, { now: NOW })).toEqual(first);
    expect(first.status).toBe('at_risk');
  });

  it('applies the 14-day minimum for very frequent buyers', () => {
    // every 5 days; 10 days late is past 1.5x but under the 14-day minimum
    const r = assessRisk('c', purchases(20, 15, 10), { now: NOW });
    expect(r).toMatchObject({ status: 'healthy', median_cadence_days: 5, threshold_days: 14 });
    expect(assessRisk('c', purchases(24, 19, 14), { now: NOW }).status).toBe('at_risk');
  });

  it('honours a configured multiplier and minimum', () => {
    const r = assessRisk('c', purchases(60, 30), { now: NOW, riskMultiplier: 1, minDaysSincePurchase: 0 });
    expect(r).toMatchObject({ status: 'at_risk', threshold_days: 30 });
  });
});
