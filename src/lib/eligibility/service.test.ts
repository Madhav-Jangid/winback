import { describe, expect, it } from 'vitest';
import { checkEligibility } from './service';

const NOW = new Date('2026-10-01T00:00:00Z');
const DAY_MS = 86_400_000;

const customer = (overrides: Record<string, unknown> = {}) =>
  ({ id: 'c1', consent_status: 'consented', opted_out_at: null, ...overrides }) as Parameters<typeof checkEligibility>[0];
const campaign = { frequency_cap: 1, cooldown_days: 30, budget_minor: 100_000 };
const check = (c = customer(), opts: Record<string, unknown> = {}, camp = campaign) =>
  checkEligibility(c, camp, { isControlGroup: false, frequencyRecord: null, remainingBudgetMinor: 100_000, offerCostMinor: 4_000, now: NOW, ...opts });
const sentDaysAgo = (days: number, count = 1) => ({ last_sent_at: new Date(NOW.getTime() - days * DAY_MS).toISOString(), count_in_window: count });

describe('eligibility rules (FR-08)', () => {
  it('EL-01: a consented, otherwise eligible customer is eligible', () => {
    expect(check()).toEqual({ eligible: true, reason: null, detail: expect.any(String) });
  });

  it('EL-02: unknown consent is suppressed (default-safe)', () => {
    expect(check(customer({ consent_status: 'unknown' }))).toMatchObject({ eligible: false, reason: 'CONSENT_UNKNOWN' });
  });

  it('EL-03: revoked consent is suppressed', () => {
    const result = check(customer({ consent_status: 'revoked' }));
    expect(result).toMatchObject({ eligible: false, reason: 'OPTED_OUT' });
    expect(result.detail).toMatch(/revoked/);
  });

  it('EL-04: an opted-out customer is suppressed, whatever their consent says', () => {
    const result = check(customer({ opted_out_at: '2026-09-01T00:00:00Z' }));
    expect(result).toMatchObject({ eligible: false, reason: 'OPTED_OUT' });
    expect(result.detail).toMatch(/2026-09-01/);
  });

  it('EL-05: a control customer is never messaged, even when everything else passes', () => {
    expect(check(customer(), { isControlGroup: true })).toMatchObject({ eligible: false, reason: 'CONTROL_GROUP' });
  });

  it('EL-06: a customer inside the cooldown is suppressed; the boundary day is allowed', () => {
    const blocked = check(customer(), { frequencyRecord: sentDaysAgo(10, 0) });
    expect(blocked).toMatchObject({ eligible: false, reason: 'FREQUENCY_CAP' });
    expect(blocked.detail).toMatch(/Cooldown period is 30 days/);
    expect(check(customer(), { frequencyRecord: sentDaysAgo(30, 0) }).eligible).toBe(true);
    expect(check(customer(), { frequencyRecord: sentDaysAgo(29.9, 0) }).eligible).toBe(false);
  });

  it('EL-07: the frequency cap blocks an extra message even after the cooldown', () => {
    const camp = { ...campaign, frequency_cap: 2, cooldown_days: 7 };
    expect(check(customer(), { frequencyRecord: sentDaysAgo(10, 2) }, camp)).toMatchObject({ eligible: false, reason: 'FREQUENCY_CAP' });
    expect(check(customer(), { frequencyRecord: sentDaysAgo(10, 2) }, camp).detail).toMatch(/cap: 2/);
    expect(check(customer(), { frequencyRecord: sentDaysAgo(10, 1) }, camp).eligible).toBe(true);
  });

  it('EL-08: an offer the remaining budget cannot cover is suppressed; exactly enough is allowed', () => {
    expect(check(customer(), { remainingBudgetMinor: 3_999 })).toMatchObject({ eligible: false, reason: 'BUDGET_EXCEEDED' });
    expect(check(customer(), { remainingBudgetMinor: 4_000 }).eligible).toBe(true);
    expect(check(customer(), { remainingBudgetMinor: 0, offerCostMinor: 0 }).eligible).toBe(true);
  });

  it('reports the most fundamental reason first: control, consent, opt-out, frequency, budget', () => {
    const everything = customer({ consent_status: 'unknown', opted_out_at: '2026-09-01T00:00:00Z' });
    const opts = { frequencyRecord: sentDaysAgo(1), remainingBudgetMinor: 0 };
    expect(check(everything, { ...opts, isControlGroup: true }).reason).toBe('CONTROL_GROUP');
    expect(check(everything, opts).reason).toBe('CONSENT_UNKNOWN');
    expect(check(customer({ opted_out_at: '2026-09-01T00:00:00Z' }), opts).reason).toBe('OPTED_OUT');
    expect(check(customer(), opts).reason).toBe('FREQUENCY_CAP');
    expect(check(customer(), { remainingBudgetMinor: 0 }).reason).toBe('BUDGET_EXCEEDED');
  });
});
