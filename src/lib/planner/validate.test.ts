import { describe, expect, it } from 'vitest';
import type { Offer } from '@/lib/campaigns/rules';
import { VALID_PLAN } from '@/test/fixtures/plan-input';
import { findMessageProblems, stripNulls, validatePlan, type PlanValidationContext } from './validate';

const CTX: PlanValidationContext = {
  message_max_chars: 1000,
  budget_minor: 500_000,
  current_offer: { type: 'percentage_discount', percent: 10, max_discount_minor: 10_000 },
  avg_order_value_minor: 30_000, // 10% = ₹30 per redemption
};

const check = (overrides: Record<string, unknown> = {}, ctx: Partial<PlanValidationContext> = {}) =>
  validatePlan({ ...VALID_PLAN, ...overrides }, { ...CTX, ...ctx });
const reason = (result: ReturnType<typeof validatePlan>) => (result.ok ? null : result.reason);

describe('plan validation', () => {
  it('AI-01: accepts a valid plan', () => {
    const result = check();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.plan).toMatchObject({ offer: VALID_PLAN.offer, experiment_duration_days: 14 });
  });

  it('drops unexpected top-level fields and treats null as missing (E-34)', () => {
    const result = validatePlan({
      ...VALID_PLAN, injected: 'ignore me', offer: { type: 'percentage_discount', percent: 10, max_discount_minor: 10_000, expiry_days: null },
    }, CTX);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan).not.toHaveProperty('injected');
      expect(result.plan.offer).not.toHaveProperty('expiry_days');
    }
    expect(stripNulls({ a: null, b: { c: null, d: 1 }, e: [{ f: null }] })).toEqual({ b: { d: 1 }, e: [{}] });
  });

  it('accepts an equal-or-cheaper alternative offer with matching copy', () => {
    const result = check({ offer: { type: 'fixed_discount', amount_minor: 2_000 }, message_draft: 'We miss you! Enjoy ₹20 off your next order.' });
    expect(result.ok).toBe(true);
  });

  it.each([
    ['a string', 'not an object'],
    ['an array', []],
    ['null', null],
  ])('AI-02: rejects %s instead of an object', (_label, raw) => {
    expect(validatePlan(raw, CTX).ok).toBe(false);
  });

  it('rejects missing and malformed fields', () => {
    expect(reason(check({ rationale: undefined }))).toMatch(/rationale/);
    expect(reason(check({ experiment_duration_days: 0 }))).toMatch(/experiment_duration_days/);
    expect(reason(check({ experiment_duration_days: '14' }))).toMatch(/experiment_duration_days/);
    expect(reason(check({ assumptions: 'none' }))).toMatch(/assumptions/);
  });

  it('AI-03: rejects an unsupported offer type and says which are allowed', () => {
    expect(reason(check({ offer: { type: 'cashback', percent: 10 } }))).toMatch(/"cashback" is not allowed; use one of percentage_discount/);
  });

  it('rejects invalid offer values and extra offer fields', () => {
    expect(reason(check({ offer: { type: 'percentage_discount', percent: 80, max_discount_minor: 10_000 } }))).toMatch(/offer/);
    expect(reason(check({ offer: { type: 'fixed_discount', amount_minor: -5 } }))).toMatch(/offer/);
    expect(reason(check({ offer: { type: 'no_offer', percent: 10 } }))).toMatch(/offer/);
  });

  it('AI-04: rejects an offer costing more than the campaign budget', () => {
    const result = check({ offer: { type: 'fixed_discount', amount_minor: 2_500 }, message_draft: 'Enjoy ₹25 off your next order.' }, { budget_minor: 2_000 });
    expect(reason(result)).toMatch(/exceeds the campaign budget/);
  });

  it('E-13: never silently expands the merchant\'s configured offer', () => {
    const result = check({ offer: { type: 'fixed_discount', amount_minor: 5_000 }, message_draft: 'Enjoy ₹50 off your next order.' });
    expect(reason(result)).toMatch(/more per redemption .* than the merchant's configured offer/);
  });

  it('a "no offer" campaign cannot gain a discount', () => {
    const result = check(
      { offer: { type: 'fixed_discount', amount_minor: 1_000 }, message_draft: 'Enjoy ₹10 off your next order.' },
      { current_offer: { type: 'no_offer' } },
    );
    expect(reason(result)).toMatch(/configured offer/);
  });

  it('an uncapped percentage offer is rejected when its cost cannot be checked', () => {
    const result = check({ offer: { type: 'percentage_discount', percent: 10 } }, { avg_order_value_minor: null });
    expect(reason(result)).toMatch(/max_discount_minor/);
  });

  it('rejects overlong copy for the channel', () => {
    expect(reason(check({}, { message_max_chars: 50 }))).toMatch(/characters; the limit is 50/);
  });
});

describe('message claims (E-16, E-30)', () => {
  const percent: Offer = { type: 'percentage_discount', percent: 10, max_discount_minor: 10_000 };
  const problems = (message: string, offer: Offer = percent) => findMessageProblems(message, offer, 1000);

  it('accepts copy that states exactly the offer terms', () => {
    expect(problems('Enjoy 10% off (up to ₹100) on orders of ₹200 or more.', { ...percent, minimum_order_value_minor: 20_000 })).toEqual([]);
    expect(problems('Rs. 100 maximum, 10 percent off.')).toEqual([]);
  });

  it('rejects percentages and amounts that are not in the offer', () => {
    expect(problems('Enjoy 15% off!')).toEqual([expect.stringMatching(/15%.*not part of the offer/)]);
    expect(problems('Enjoy 10% off up to ₹500.')).toEqual([expect.stringMatching(/₹500.*not an amount/)]);
    expect(problems('Enjoy a free coffee worth ₹150.', { type: 'free_item', item_name: 'coffee', item_cost_minor: 15_000 })).toHaveLength(1);
    expect(problems('Come back soon, 20% off!', { type: 'no_offer' })).toHaveLength(1);
  });

  it('rejects placeholders and markup', () => {
    expect(problems('Hi {name}, enjoy 10% off')).toEqual([expect.stringMatching(/placeholder/)]);
    expect(problems('Hi [Name], enjoy 10% off')).toHaveLength(1);
    expect(problems('<b>Enjoy 10% off</b>')).toHaveLength(1);
  });

  it.each(['Valid this week only!', 'Limited time offer', 'Hurry, last chance', 'Offer expires soon', "Don't miss out"])(
    'rejects invented urgency without an expiry: %s',
    (phrase) => expect(problems(`Enjoy 10% off. ${phrase}`)).toEqual([expect.stringMatching(/urgency/)]),
  );

  it('allows urgency wording when the offer has an expiry', () => {
    expect(problems('Enjoy 10% off, valid this week only.', { ...percent, expiry_days: 7 })).toEqual([]);
  });
});
