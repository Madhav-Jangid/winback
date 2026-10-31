import { describe, expect, it } from 'vitest';
import { VALID_DRAFT } from '@/test/fixtures/campaign';
import { campaignDraftSchema, campaignUpdateSchema, fieldErrors, offerSchema } from './schema';

const offerError = (offer: unknown) => {
  const r = offerSchema.safeParse(offer);
  return r.success ? null : fieldErrors(r.error);
};

describe('offer validation', () => {
  it('accepts each offer type within bounds', () => {
    expect(offerError({ type: 'percentage_discount', percent: 50 })).toBeNull();
    expect(offerError({ type: 'fixed_discount', amount_minor: 5_000, minimum_order_value_minor: 20_000, expiry_days: 14 })).toBeNull();
    expect(offerError({ type: 'free_item', item_name: 'pastry', item_cost_minor: 4_000 })).toBeNull();
    expect(offerError({ type: 'no_offer' })).toBeNull();
  });

  it.each([
    ['0%', { type: 'percentage_discount', percent: 0 }, 'percent'],
    ['51%', { type: 'percentage_discount', percent: 51 }, 'percent'],
    ['fractional %', { type: 'percentage_discount', percent: 10.5 }, 'percent'],
    ['text value', { type: 'percentage_discount', percent: '10' }, 'percent'],
    ['negative fixed', { type: 'fixed_discount', amount_minor: -100 }, 'amount_minor'],
    ['fixed above ₹1,000', { type: 'fixed_discount', amount_minor: 100_001 }, 'amount_minor'],
    ['fractional paise', { type: 'fixed_discount', amount_minor: 99.5 }, 'amount_minor'],
    ['free item without name', { type: 'free_item', item_cost_minor: 4_000 }, 'item_name'],
    ['free item without cost', { type: 'free_item', item_name: 'pastry' }, 'item_cost_minor'],
    ['expiry over 90 days', { type: 'fixed_discount', amount_minor: 100, expiry_days: 91 }, 'expiry_days'],
    ['min order below discount', { type: 'fixed_discount', amount_minor: 5_000, minimum_order_value_minor: 1_000 }, 'minimum_order_value_minor'],
  ])('rejects %s', (_label, offer, field) => {
    expect(offerError(offer)).toHaveProperty(field);
  });

  it('rejects unknown offer types and unexpected fields', () => {
    expect(offerError({ type: 'cashback', percent: 10 })).not.toBeNull();
    expect(offerError({ type: 'no_offer', percent: 10 })).not.toBeNull();
  });
});

describe('campaign draft validation', () => {
  it('accepts a valid draft and defaults the message to empty', () => {
    expect(campaignDraftSchema.parse(VALID_DRAFT)).toEqual(VALID_DRAFT);
    const { original_message: _m, ...noMessage } = VALID_DRAFT;
    void _m;
    expect(campaignDraftSchema.parse(noMessage).original_message).toBe('');
  });

  it.each([
    ['negative budget', { budget_minor: -1 }, 'budget_minor'],
    ['fractional budget', { budget_minor: 10.5 }, 'budget_minor'],
    ['frequency cap 0', { frequency_cap: 0 }, 'frequency_cap'],
    ['frequency cap 6', { frequency_cap: 6 }, 'frequency_cap'],
    ['cooldown 0', { cooldown_days: 0 }, 'cooldown_days'],
    ['cooldown 181', { cooldown_days: 181 }, 'cooldown_days'],
    ['unsupported language', { language: 'fr' }, 'language'],
    ['unknown channel', { channel: 'fax' }, 'channel'],
    ['unknown segment', { segment_type: 'vip' }, 'segment_type'],
    ['short name', { name: 'ab' }, 'name'],
    ['message over the stored cap', { original_message: 'x'.repeat(2001) }, 'original_message'],
  ])('rejects %s', (_label, change, field) => {
    const r = campaignDraftSchema.safeParse({ ...VALID_DRAFT, ...change });
    expect(r.success).toBe(false);
    if (!r.success) expect(fieldErrors(r.error)).toHaveProperty(field);
  });

  it('rejects fields the client must not set (status, version, approval)', () => {
    expect(campaignDraftSchema.safeParse({ ...VALID_DRAFT, status: 'approved' }).success).toBe(false);
    expect(campaignUpdateSchema.safeParse({ expected_version: 1, approved_version: 1 }).success).toBe(false);
  });

  it('update requires expected_version and never fills in defaults', () => {
    expect(campaignUpdateSchema.safeParse({ name: 'New name' }).success).toBe(false);
    expect(campaignUpdateSchema.parse({ name: 'New name', expected_version: 3 })).toEqual({ name: 'New name', expected_version: 3 });
  });
});
