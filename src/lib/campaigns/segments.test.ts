import { describe, expect, it } from 'vitest';
import { demoProfiles } from '@/test/helpers/demo-profiles';
import { previewSegment } from './segments';

describe('segment preview', () => {
  const profiles = demoProfiles();

  it('at-risk segment: counts each exclusion reason', () => {
    const p = previewSegment(profiles, 'at_risk');
    expect(p).toMatchObject({
      matched: 19,
      eligible: 12,
      excluded: { no_consent: 3, opted_out: 2, insufficient_history: 2, frequency_cap: 2, other: 0 },
    });
    expect(p.matched).toBe(p.eligible + p.excluded.no_consent + p.excluded.opted_out + p.excluded.frequency_cap + p.excluded.other);
  });

  it('never lists a customer as eligible whom the eligibility check rejects', () => {
    const p = previewSegment(profiles, 'all_eligible');
    const byId = new Map(profiles.map((x) => [x.id, x]));
    for (const id of p.eligible_customer_ids) expect(byId.get(id)!.contact.eligible).toBe(true);
  });

  it('previously-active segment: at-risk regulars with 3+ purchases', () => {
    const p = previewSegment(profiles, 'previously_active');
    expect(p).toMatchObject({ matched: 9, eligible: 7, excluded: { frequency_cap: 2 } });
  });

  it('all-eligible segment includes healthy and new customers', () => {
    expect(previewSegment(profiles, 'all_eligible')).toMatchObject({
      matched: 31, eligible: 24, excluded: { no_consent: 3, opted_out: 2, insufficient_history: 0, frequency_cap: 2 },
    });
  });

  it("uses the campaign's own cooldown: a 5-day cooldown no longer blocks customers messaged 10 days ago", () => {
    const p = previewSegment(demoProfiles({ cooldown_days: 5, frequency_cap: 1 }), 'at_risk');
    expect(p).toMatchObject({ eligible: 14, excluded: { frequency_cap: 0 } });
  });

  it('splits treatment and control: estimated without a campaign, exact with one', () => {
    const estimate = previewSegment(profiles, 'at_risk');
    expect(estimate).toMatchObject({ control_is_estimate: true, control: 2, treatment: 10 });

    const control = new Set(estimate.eligible_customer_ids.slice(0, 5));
    const exact = previewSegment(profiles, 'at_risk', (id) => (control.has(id) ? 'control' : 'treatment'));
    expect(exact).toMatchObject({ control_is_estimate: false, control: 5, treatment: 7 });
  });

  it('E-17: empty segment reports zero eligible without inventing recipients', () => {
    const p = previewSegment(profiles.map((x) => ({ ...x, contact: { eligible: false, reason: 'CONSENT_UNKNOWN', detail: '' } })), 'at_risk');
    expect(p).toMatchObject({ eligible: 0, treatment: 0, control: 0, eligible_customer_ids: [], avg_order_value_minor: null });
  });

  it('reports aggregate rhythm for planning, without identifying anyone', () => {
    const p = previewSegment(profiles, 'at_risk');
    expect(p.avg_cadence_days).toBeGreaterThan(0);
    expect(p.avg_days_since_purchase).toBeGreaterThan(p.avg_cadence_days!);
    expect(previewSegment([], 'at_risk')).toMatchObject({ avg_cadence_days: null, avg_days_since_purchase: null });
  });

  it('average order value comes from eligible customers\' completed purchases', () => {
    const p = previewSegment(profiles, 'at_risk');
    expect(Number.isInteger(p.avg_order_value_minor)).toBe(true);
    expect(p.avg_order_value_minor).toBeGreaterThan(0);
  });
});
