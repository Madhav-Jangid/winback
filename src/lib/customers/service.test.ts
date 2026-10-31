import { describe, expect, it } from 'vitest';
import { DEMO_REFERENCE_DATE } from '@/lib/demo/constants';
import { buildDemoDataset, DEMO_CUSTOMERS } from '@/lib/demo/seed-data';
import type { CustomerWithPurchases, MessageStats } from '@/lib/repositories/customers';
import {
  applyQuery,
  buildCustomerProfile,
  countByFilter,
  customerQuerySchema,
  type CustomerProfile,
} from './service';

const DAY_MS = 86_400_000;
const NOW = DEMO_REFERENCE_DATE;
const POLICY = { cooldown_days: 30, frequency_cap: 1 };

function customer(overrides: Partial<CustomerWithPurchases> = {}): CustomerWithPurchases {
  const p = (daysAgo: number, status: 'completed' | 'refunded' = 'completed') => ({
    id: `p${daysAgo}`, occurred_at: new Date(NOW.getTime() - daysAgo * DAY_MS).toISOString(),
    status, amount_minor: 10_000, currency: 'INR', source: 'demo',
  });
  return {
    id: '10000000-0000-4000-8000-000000000999', display_name: 'Test Person', preferred_language: 'hi',
    consent_status: 'consented', opted_out_at: null,
    purchases: [p(90), p(60), p(10, 'refunded')],
    ...overrides,
  };
}

const sent = (daysAgo: number, count = 1): MessageStats => ({
  last_sent_at: new Date(NOW.getTime() - daysAgo * DAY_MS).toISOString(), count_in_window: count,
});

/** Profiles for the full demo dataset, built without a database. */
function demoProfiles(): CustomerProfile[] {
  const data = buildDemoDataset();
  return data.customers.map((c) => {
    const msg = data.messages.find((m) => m.customer_id === c.id);
    return buildCustomerProfile(
      {
        ...c,
        opted_out_at: c.opted_out_at?.toISOString() ?? null,
        purchases: data.purchases.filter((p) => p.customer_id === c.id).map((p) => ({
          ...p, occurred_at: p.occurred_at.toISOString(), currency: 'INR', source: 'demo',
        })),
      },
      msg ? { last_sent_at: msg.sent_at.toISOString(), count_in_window: 1 } : undefined,
      NOW,
      POLICY,
    );
  });
}

describe('customer profiles', () => {
  it('separates purchase-rhythm risk from contactability', () => {
    const profile = buildCustomerProfile(customer({ opted_out_at: NOW.toISOString() }), undefined, NOW, POLICY);
    expect(profile.risk.status).toBe('at_risk');
    expect(profile.contact).toMatchObject({ eligible: false, reason: 'OPTED_OUT' });
  });

  it('counts completed spend and ignored purchases', () => {
    const profile = buildCustomerProfile(customer(), undefined, NOW, POLICY);
    expect(profile).toMatchObject({ completed_purchase_count: 2, ignored_purchase_count: 1, total_spend_minor: 20_000 });
  });

  it.each([
    ['unknown consent', customer({ consent_status: 'unknown' }), undefined, 'CONSENT_UNKNOWN'],
    ['revoked consent', customer({ consent_status: 'revoked' }), undefined, 'OPTED_OUT'],
    ['messaged 10 days ago', customer(), sent(10), 'FREQUENCY_CAP'],
    ['messaged 40 days ago', customer(), sent(40, 0), null],
    ['consented, never messaged', customer(), undefined, null],
  ] as const)('contact reason: %s', (_label, input, stats, reason) => {
    const profile = buildCustomerProfile(input, stats, NOW, POLICY);
    expect(profile.contact.reason).toBe(reason);
    expect(profile.contact.eligible).toBe(reason === null);
  });
});

describe('customer filters and search', () => {
  const profiles = demoProfiles();
  const names = (list: CustomerProfile[]) => list.map((p) => p.display_name).sort();

  it('filter counts match the seeded scenarios', () => {
    const counts = countByFilter(profiles);
    const by = (fn: (c: (typeof DEMO_CUSTOMERS)[number]) => boolean) => DEMO_CUSTOMERS.filter(fn).length;
    expect(counts).toEqual({
      all: DEMO_CUSTOMERS.length,
      at_risk: by((c) => c.expectedRisk === 'at_risk'),
      healthy: by((c) => c.expectedRisk === 'healthy'),
      insufficient_history: by((c) => c.expectedRisk === 'insufficient_history'),
      consented: by((c) => c.consent === 'consented' && c.optedOutDaysAgo === undefined),
      opted_out: by((c) => c.optedOutDaysAgo !== undefined),
      no_consent: by((c) => c.consent !== 'consented'),
      frequency_capped: by((c) => c.messagedDaysAgo !== undefined),
    });
  });

  it('frequency-capped filter returns the customers messaged by the historical campaign', () => {
    expect(names(applyQuery(profiles, { filter: 'frequency_capped', search: '' }))).toEqual(['Divya Menon', 'Karan Malhotra']);
  });

  it('search is case-insensitive and combines with the filter', () => {
    expect(names(applyQuery(profiles, { filter: 'all', search: 'nair' }))).toEqual(['Deepa Nair', 'Ganesh Nair']);
    expect(names(applyQuery(profiles, { filter: 'healthy', search: 'nair' }))).toEqual([]);
  });

  it('validates query input', () => {
    expect(customerQuerySchema.parse({})).toEqual({ filter: 'all', search: '' });
    expect(customerQuerySchema.parse({ filter: 'at_risk', search: '  ravi ' })).toEqual({ filter: 'at_risk', search: 'ravi' });
    expect(customerQuerySchema.safeParse({ filter: 'everyone' }).success).toBe(false);
    expect(customerQuerySchema.safeParse({ search: 'x'.repeat(101) }).success).toBe(false);
  });
});
