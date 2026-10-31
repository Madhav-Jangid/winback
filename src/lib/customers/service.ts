/**
 * Customer directory and detail: combines purchase-rhythm risk (FR-03) with whether the
 * customer may be contacted at all (FR-08). The two are kept separate on purpose: an opted-out
 * customer can still be lapsing, but must never be messaged.
 */
import { z } from 'zod';
import type { Queryable } from '@/lib/db/types';
import { checkEligibility, type EligibilityResult } from '@/lib/eligibility/service';
import { assessRisk } from '@/lib/risk/engine';
import {
  getCustomerWithPurchases,
  getMessageStatsByCustomer,
  listCustomerMessages,
  listCustomersWithPurchases,
  type CustomerMessage,
  type CustomerPurchase,
  type CustomerWithPurchases,
  type MessageStats,
} from '@/lib/repositories/customers';
import { getMerchantSettings, type MerchantSettings } from '@/lib/repositories/merchants';
import type { ConsentStatus, RiskResult } from '@/types';

const DAY_MS = 86_400_000;

export const CUSTOMER_FILTERS = [
  'all', 'at_risk', 'healthy', 'insufficient_history', 'consented', 'opted_out', 'no_consent', 'frequency_capped',
] as const;
export type CustomerFilter = (typeof CUSTOMER_FILTERS)[number];

export const customerQuerySchema = z.object({
  filter: z.enum(CUSTOMER_FILTERS).default('all'),
  search: z.string().trim().max(100, 'search must be 100 characters or fewer').default(''),
});
export type CustomerQuery = z.infer<typeof customerQuerySchema>;

export interface ContactPolicy {
  cooldown_days: number;
  frequency_cap: number;
}

export interface CustomerProfile {
  id: string;
  display_name: string;
  preferred_language: string;
  consent_status: ConsentStatus;
  opted_out_at: string | null;
  completed_purchase_count: number;
  /** Refunded or cancelled purchases, excluded from cadence and revenue. */
  ignored_purchase_count: number;
  total_spend_minor: number;
  last_message_at: string | null;
  risk: RiskResult;
  /** Contactability under the merchant's default frequency policy, before any campaign exists. */
  contact: EligibilityResult;
}

export function buildCustomerProfile(
  customer: CustomerWithPurchases,
  messageStats: MessageStats | undefined,
  now: Date,
  policy: ContactPolicy,
): CustomerProfile {
  const completed = customer.purchases.filter((p) => p.status === 'completed');
  const contact = checkEligibility(
    customer,
    { ...policy, budget_minor: 0 },
    { isControlGroup: false, frequencyRecord: messageStats ?? null, remainingBudgetMinor: 0, offerCostMinor: 0, now },
  );
  return {
    id: customer.id,
    display_name: customer.display_name,
    preferred_language: customer.preferred_language,
    consent_status: customer.consent_status,
    opted_out_at: customer.opted_out_at,
    completed_purchase_count: completed.length,
    ignored_purchase_count: customer.purchases.length - completed.length,
    total_spend_minor: completed.reduce((sum, p) => sum + p.amount_minor, 0),
    last_message_at: messageStats?.last_sent_at ?? null,
    risk: assessRisk(customer.id, completed, { now }),
    contact,
  };
}

export function matchesFilter(profile: CustomerProfile, filter: CustomerFilter): boolean {
  switch (filter) {
    case 'all': return true;
    case 'at_risk':
    case 'healthy':
    case 'insufficient_history': return profile.risk.status === filter;
    case 'consented': return profile.consent_status === 'consented' && !profile.opted_out_at;
    case 'opted_out': return profile.opted_out_at !== null;
    case 'no_consent': return profile.consent_status !== 'consented';
    case 'frequency_capped': return profile.contact.reason === 'FREQUENCY_CAP';
  }
}

export function countByFilter(profiles: CustomerProfile[]): Record<CustomerFilter, number> {
  return Object.fromEntries(
    CUSTOMER_FILTERS.map((f) => [f, profiles.filter((p) => matchesFilter(p, f)).length]),
  ) as Record<CustomerFilter, number>;
}

export function applyQuery(profiles: CustomerProfile[], query: CustomerQuery): CustomerProfile[] {
  const needle = query.search.toLowerCase();
  return profiles.filter(
    (p) => matchesFilter(p, query.filter) && (!needle || p.display_name.toLowerCase().includes(needle)),
  );
}

function policyOf(merchant: MerchantSettings): ContactPolicy {
  return { cooldown_days: merchant.default_cooldown_days, frequency_cap: merchant.default_frequency_cap };
}

const windowStart = (now: Date, policy: ContactPolicy) => new Date(now.getTime() - policy.cooldown_days * DAY_MS);

export interface CustomerDirectory {
  merchant: MerchantSettings | null;
  policy: ContactPolicy | null;
  as_of: string;
  /** Counts over all customers (ignores search), for filter chips and the dashboard. */
  counts: Record<CustomerFilter, number>;
  /** Customers matching the query. */
  customers: CustomerProfile[];
  /** Every customer, before filtering. */
  all: CustomerProfile[];
}

/**
 * @param policyOverride frequency policy to judge contactability with (a campaign's own limits);
 *   defaults to the merchant's defaults
 */
export async function getCustomerDirectory(
  db: Queryable,
  merchantId: string,
  now: Date,
  query: CustomerQuery = { filter: 'all', search: '' },
  policyOverride?: ContactPolicy,
): Promise<CustomerDirectory> {
  const merchant = await getMerchantSettings(db, merchantId);
  if (!merchant) {
    return { merchant: null, policy: null, as_of: now.toISOString(), counts: countByFilter([]), customers: [], all: [] };
  }
  const policy = policyOverride ?? policyOf(merchant);
  const [customers, stats] = await Promise.all([
    listCustomersWithPurchases(db, merchantId),
    getMessageStatsByCustomer(db, merchantId, windowStart(now, policy)),
  ]);
  const all = customers.map((c) => buildCustomerProfile(c, stats.get(c.id), now, policy));
  return { merchant, policy, as_of: now.toISOString(), counts: countByFilter(all), customers: applyQuery(all, query), all };
}

export interface CustomerDetail {
  merchant: MerchantSettings;
  policy: ContactPolicy;
  as_of: string;
  profile: CustomerProfile;
  /** Newest first. */
  purchases: CustomerPurchase[];
  messages: CustomerMessage[];
}

export async function getCustomerDetail(
  db: Queryable,
  merchantId: string,
  customerId: string,
  now: Date,
): Promise<CustomerDetail | null> {
  const merchant = await getMerchantSettings(db, merchantId);
  if (!merchant) return null;
  const customer = await getCustomerWithPurchases(db, merchantId, customerId);
  if (!customer) return null;
  const policy = policyOf(merchant);
  const [stats, messages] = await Promise.all([
    getMessageStatsByCustomer(db, merchantId, windowStart(now, policy), customerId),
    listCustomerMessages(db, merchantId, customerId),
  ]);
  return {
    merchant,
    policy,
    as_of: now.toISOString(),
    profile: buildCustomerProfile(customer, stats.get(customerId), now, policy),
    purchases: [...customer.purchases].reverse(),
    messages,
  };
}
