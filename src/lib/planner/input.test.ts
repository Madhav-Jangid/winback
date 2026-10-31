import { describe, expect, it } from 'vitest';
import { DEMO_CUSTOMERS } from '@/lib/demo/seed-data';
import { makePlanInput } from '@/test/fixtures/plan-input';
import { planInputSchema } from './types';

describe('planner input', () => {
  const input = makePlanInput();
  const serialized = JSON.stringify(input);

  it('AI-07: contains no customer names or ids', () => {
    for (const customer of DEMO_CUSTOMERS) {
      expect(serialized).not.toContain(customer.name);
      expect(serialized).not.toContain(customer.name.split(' ')[0]);
    }
    expect(serialized).not.toMatch(/10000000-0000-4000-8000/); // seeded customer id prefix
    expect(serialized).not.toMatch(/[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}/i); // email-like
    expect(serialized).not.toMatch(/\+?\d{10,}/); // phone-like
  });

  it('AI-07: has only the whitelisted aggregate fields', () => {
    expect(Object.keys(input).sort()).toEqual([
      'allowed_offer_types', 'budget_minor', 'channel', 'currency', 'current_offer', 'goal', 'limits',
      'merchant_type', 'message_max_chars', 'safety_constraints', 'segment',
    ]);
    expect(Object.keys(input.segment).sort()).toEqual([
      'avg_cadence_days', 'avg_days_since_purchase', 'avg_order_value_minor', 'description', 'eligible', 'label',
    ]);
    // Extra fields would be rejected, so nothing can be smuggled in by a later change.
    expect(planInputSchema.safeParse({ ...input, customers: ['Arjun Sharma'] }).success).toBe(false);
    expect(planInputSchema.safeParse({ ...input, segment: { ...input.segment, names: [] } }).success).toBe(false);
  });

  it('describes the segment with aggregates and the merchant\'s own rules', () => {
    expect(input).toMatchObject({
      merchant_type: 'cafe',
      channel: 'whatsapp',
      message_max_chars: 1000,
      budget_minor: 500_000,
      segment: { label: 'At-risk repeat customers', eligible: 12 },
      current_offer: { type: 'percentage_discount', percent: 10 },
    });
    expect(input.segment.avg_cadence_days).toBeGreaterThan(0);
    expect(input.segment.avg_days_since_purchase).toBeGreaterThan(input.segment.avg_cadence_days!);
  });

  it('uses the channel\'s message limit and truncates an overlong goal', () => {
    expect(makePlanInput({ channel: 'sms' }).message_max_chars).toBe(320);
    expect(makePlanInput({ goal: 'g'.repeat(500) }).goal).toHaveLength(200);
  });
});
