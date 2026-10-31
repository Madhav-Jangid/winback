import { describe, expect, it } from 'vitest';
import { VALID_DRAFT, VALID_LOCALIZED, VALID_TRANSLATION } from '@/test/fixtures/campaign';
import { checkReadiness } from './readiness';
import { describeOffer, offerCostPerRedemptionMinor, rupeesToMinor } from './rules';
import { campaignDraftSchema } from './schema';

const draft = campaignDraftSchema.parse(VALID_DRAFT);
const preview = {
  matched: 19, eligible: 12, avg_order_value_minor: 30_000,
  excluded: { no_consent: 3, opted_out: 2, insufficient_history: 2, frequency_cap: 2, cooldown: 0, other: 0 },
} as Parameters<typeof checkReadiness>[1];
const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

/** Readiness with provenance that matches the (possibly changed) English message. */
const check = (changes: Record<string, unknown> = {}, p: typeof preview = preview) => {
  const campaign = { ...draft, ...changes } as typeof draft;
  return checkReadiness({ ...campaign, translation: { ...VALID_TRANSLATION, source_text: campaign.original_message.trim() } }, p);
};

describe('readiness checks', () => {
  it('a complete campaign with eligible customers is ready', () => {
    expect(check()).toEqual([]);
  });

  it('E-17: empty segment blocks approval and explains why', () => {
    const issues = check({}, { ...preview, eligible: 0 });
    expect(codes(issues)).toEqual(['EMPTY_SEGMENT']);
    expect(issues[0].message).toMatch(/All 19 matching customers are excluded/);
    expect(check({}, { ...preview, eligible: 0, matched: 0 })[0].message).toMatch(/No customers match/);
  });

  it('requires a message within the channel limit (E-27)', () => {
    expect(codes(check({ original_message: '   ' }))).toEqual(['MESSAGE_REQUIRED']);
    expect(codes(check({ channel: 'sms', original_message: 'x'.repeat(321) }))).toEqual(['MESSAGE_TOO_LONG']);
    expect(check({ channel: 'sms', original_message: 'x'.repeat(320) })).toEqual([]);
    expect(check({ channel: 'whatsapp', original_message: 'x'.repeat(321) })).toEqual([]);
  });

  it('budget must cover at least one redemption', () => {
    expect(codes(check({ budget_minor: 2_999 }))).toEqual(['BUDGET_TOO_LOW']); // 10% of ₹300 = ₹30
    expect(check({ budget_minor: 3_000 })).toEqual([]);
    expect(check({ budget_minor: 0, offer: { type: 'no_offer' } })).toEqual([]);
  });

  it('an uncapped percentage discount needs a known order value', () => {
    const uncapped = { offer: { type: 'percentage_discount' as const, percent: 10 } };
    expect(codes(check(uncapped, { ...preview, eligible: 0, avg_order_value_minor: null }))).toContain('OFFER_COST_UNKNOWN');
  });
});

describe('translation readiness (FR-07, E-16)', () => {
  const english = (changes: Record<string, unknown>) => ({ ...changes });

  it('English campaigns need no translation', () => {
    expect(check(english({ language: 'en', localized_message: '' }))).toEqual([]);
  });

  it('a non-English campaign needs a translation', () => {
    const issues = check({ localized_message: '' });
    expect(codes(issues)).toEqual(['TRANSLATION_REQUIRED']);
    expect(issues[0].message).toMatch(/Translate the message into Hindi/);
  });

  it('does not pile a translation complaint on top of a missing English message', () => {
    expect(codes(check({ original_message: '', localized_message: '' }))).toEqual(['MESSAGE_REQUIRED']);
  });

  it('a translation made for different English text or another language is stale', () => {
    const stale = (translation: typeof VALID_TRANSLATION) => codes(checkReadiness({ ...draft, translation }, preview));
    expect(stale({ ...VALID_TRANSLATION, source_text: 'An older English message' })).toEqual(['TRANSLATION_STALE']);
    expect(stale({ ...VALID_TRANSLATION, language: 'ta' })).toEqual(['TRANSLATION_STALE']);
    expect(codes(checkReadiness({ ...draft, translation: null }, preview))).toEqual(['TRANSLATION_STALE']);
  });

  it('the translated text must fit the channel', () => {
    expect(codes(check({ channel: 'sms', localized_message: 'अ'.repeat(321) }))).toEqual(['TRANSLATION_TOO_LONG']);
  });

  it('unreviewed machine output must keep the offer numbers', () => {
    const machine = { ...VALID_TRANSLATION, source: 'sarvam' as const, model: 'mayura:v1', edited: false };
    const run = (localized: string) => checkReadiness({ ...draft, localized_message: localized, translation: machine }, preview);
    expect(run(VALID_LOCALIZED)).toEqual([]);
    expect(codes(run('हम आपको याद करते हैं! 15% की छूट (₹100 तक)'))).toEqual(['TRANSLATION_NEEDS_REVIEW']);
    expect(run('हम आपको याद करते हैं! 15% की छूट')[0].message).toMatch(/missing 10, 100; unexpected 15/);
    // The same text after the merchant edited it is accepted: they took responsibility.
    expect(checkReadiness({ ...draft, localized_message: 'हम 15%', translation: { ...machine, edited: true } }, preview)).toEqual([]);
  });

  it('native-script digits count as the same numbers', () => {
    const machine = { ...VALID_TRANSLATION, source: 'sarvam' as const, edited: false };
    const native = 'अपने अगले ऑर्डर पर १०% की छूट (₹१०० तक)';
    expect(checkReadiness({ ...draft, localized_message: native, translation: machine }, preview)).toEqual([]);
  });

  it('unreviewed demo-fallback text blocks approval until the merchant reviews it', () => {
    const demo = { ...VALID_TRANSLATION, source: 'demo_fallback' as const, edited: false, fallback_reason: 'no key' };
    const issues = checkReadiness({ ...draft, localized_message: draft.original_message, translation: demo }, preview);
    expect(codes(issues)).toEqual(['TRANSLATION_NEEDS_REVIEW']);
    expect(issues[0].message).toMatch(/not a translation/);
    expect(checkReadiness({ ...draft, localized_message: draft.original_message, translation: { ...demo, edited: true } }, preview)).toEqual([]);
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
