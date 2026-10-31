import { describe, expect, it } from 'vitest';
import { checkReadiness } from './readiness';
import { describeOffer, offerCostPerRedemptionMinor, rupeesToMinor } from './rules';
import { campaignDraftSchema } from './schema';
import { VALID_DRAFT } from '@/test/fixtures/campaign';

const draft = campaignDraftSchema.parse(VALID_DRAFT);
const preview = {
  matched: 19, eligible: 12, avg_order_value_minor: 30_000,
  excluded: { no_consent: 3, opted_out: 2, insufficient_history: 2, frequency_cap: 2, other: 0 },
};
const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

describe('readiness checks', () => {
  it('a complete campaign with eligible customers is ready', () => {
    expect(checkReadiness(draft, preview)).toEqual([]);
  });

  it('E-17: empty segment blocks approval and explains why', () => {
    const issues = checkReadiness(draft, { ...preview, eligible: 0 });
    expect(codes(issues)).toEqual(['EMPTY_SEGMENT']);
    expect(issues[0].message).toMatch(/All 19 matching customers are excluded/);
    expect(checkReadiness(draft, { ...preview, eligible: 0, matched: 0 })[0].message).toMatch(/No customers match/);
  });

  it('requires a message within the channel limit (E-27)', () => {
    expect(codes(checkReadiness({ ...draft, original_message: '   ' }, preview))).toEqual(['MESSAGE_REQUIRED']);
    expect(codes(checkReadiness({ ...draft, channel: 'sms', original_message: 'x'.repeat(321) }, preview))).toEqual(['MESSAGE_TOO_LONG']);
    expect(checkReadiness({ ...draft, channel: 'sms', original_message: 'x'.repeat(320) }, preview)).toEqual([]);
    expect(checkReadiness({ ...draft, channel: 'whatsapp', original_message: 'x'.repeat(321) }, preview)).toEqual([]);
  });

  it('budget must cover at least one redemption', () => {
    expect(codes(checkReadiness({ ...draft, budget_minor: 2_999 }, preview))).toEqual(['BUDGET_TOO_LOW']); // 10% of ₹300 = ₹30
    expect(checkReadiness({ ...draft, budget_minor: 3_000 }, preview)).toEqual([]);
    expect(checkReadiness({ ...draft, budget_minor: 0, offer: { type: 'no_offer' } }, preview)).toEqual([]);
  });

  it('an uncapped percentage discount needs a known order value', () => {
    const uncapped = { ...draft, offer: { type: 'percentage_discount' as const, percent: 10 } };
    expect(codes(checkReadiness(uncapped, { ...preview, eligible: 0, avg_order_value_minor: null }))).toContain('OFFER_COST_UNKNOWN');
  });
});

describe('offer cost and terms', () => {
  it('cost per redemption follows each offer type, capped where configured', () => {
    expect(offerCostPerRedemptionMinor({ type: 'percentage_discount', percent: 20 }, 50_000)).toBe(10_000);
    expect(offerCostPerRedemptionMinor({ type: 'percentage_discount', percent: 20, max_discount_minor: 5_000 }, 50_000)).toBe(5_000);
    expect(offerCostPerRedemptionMinor({ type: 'percentage_discount', percent: 20 }, null)).toBeNull();
    expect(offerCostPerRedemptionMinor({ type: 'fixed_discount', amount_minor: 7_500 }, null)).toBe(7_500);
    expect(offerCostPerRedemptionMinor({ type: 'free_item', item_name: 'pastry', item_cost_minor: 4_000 }, null)).toBe(4_000);
    expect(offerCostPerRedemptionMinor({ type: 'no_offer' }, null)).toBe(0);
  });

  it('terms never invent an expiry', () => {
    expect(describeOffer({ type: 'fixed_discount', amount_minor: 5_000 })).toMatch(/no expiry set/);
    expect(describeOffer({ type: 'fixed_discount', amount_minor: 5_000, expiry_days: 7 })).toMatch(/valid for 7 days/);
  });

  it('converts typed rupees to integer paise without floating-point error', () => {
    expect(rupeesToMinor('150')).toBe(15_000);
    expect(rupeesToMinor('99.5')).toBe(9_950);
    expect(rupeesToMinor('0.29')).toBe(29);
    expect(rupeesToMinor('1.005')).toBeNull();
    expect(rupeesToMinor('-5')).toBeNull();
    expect(rupeesToMinor('abc')).toBeNull();
  });
});
