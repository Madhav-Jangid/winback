import type { ConsentStatus, PurchaseStatus, RiskStatus } from '@/types';
import { DEMO_ACTOR_ID, DEMO_MERCHANT_ID, DEMO_REFERENCE_DATE } from './constants';

const DAY_MS = 86_400_000;

export function daysBeforeReference(days: number): Date {
  return new Date(DEMO_REFERENCE_DATE.getTime() - days * DAY_MS);
}

/** Stable, readable UUIDs so a reset always recreates the same IDs. */
function demoUuid(prefix: string, n: number): string {
  return `${prefix}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

export interface DemoCustomerScenario {
  name: string;
  language: string;
  consent: ConsentStatus;
  /** Days before the reference date that the customer opted out. */
  optedOutDaysAgo?: number;
  purchases: Array<{ daysAgo: number; status?: PurchaseStatus }>;
  /** Status the risk engine must produce at the reference date (verified by a unit test). */
  expectedRisk: RiskStatus;
  /** Days before the reference date this customer was messaged by the historical campaign. */
  messagedDaysAgo?: number;
  scenario: string;
}

const p = (...days: number[]) => days.map((daysAgo) => ({ daysAgo }));

/**
 * Synthetic customers covering every case the PRD asks the demo to show (FR-13).
 * Names are fictional. "Days" are relative to DEMO_REFERENCE_DATE.
 */
export const DEMO_CUSTOMERS: DemoCustomerScenario[] = [
  // At risk, consented, sendable
  { name: 'Arjun Sharma', language: 'hi', consent: 'consented', purchases: p(130, 100, 70), expectedRisk: 'at_risk', scenario: 'At risk: every ~30 days, last seen 70 days ago' },
  { name: 'Ravi Kumar', language: 'ta', consent: 'consented', purchases: p(150, 120), expectedRisk: 'at_risk', scenario: 'At risk: two visits 30 days apart, then 120 days quiet' },
  { name: 'Sunita Rao', language: 'te', consent: 'consented', purchases: p(100, 80, 60), expectedRisk: 'at_risk', scenario: 'At risk: every ~20 days, last seen 60 days ago' },
  { name: 'Deepa Nair', language: 'ml', consent: 'consented', purchases: p(90, 60), expectedRisk: 'at_risk', scenario: 'At risk: 60 days since last visit vs 45-day threshold' },
  { name: 'Vikram Singh', language: 'hi', consent: 'consented', purchases: p(200, 150, 100), expectedRisk: 'at_risk', scenario: 'At risk: slow buyer (every ~50 days), now 100 days' },
  { name: 'Sanjay Mehta', language: 'mr', consent: 'consented', purchases: p(95, 75, 55, 35), expectedRisk: 'at_risk', scenario: 'At risk: every ~20 days, now 35 days' },
  { name: 'Kavitha Reddy', language: 'te', consent: 'consented', purchases: p(160, 130, 110), expectedRisk: 'at_risk', scenario: 'At risk: uneven intervals (median 25 days)' },
  { name: 'Nisha Mishra', language: 'hi', consent: 'consented', purchases: p(110, 85), expectedRisk: 'at_risk', scenario: 'At risk: 85 days since last visit' },
  { name: 'Ganesh Nair', language: 'ml', consent: 'consented', purchases: p(140, 110, 80), expectedRisk: 'at_risk', scenario: 'At risk: every ~30 days, now 80 days' },
  { name: 'Rekha Choudhary', language: 'hi', consent: 'consented', purchases: p(70, 50, 30), expectedRisk: 'at_risk', scenario: 'Boundary: exactly at the 30-day threshold (>= rule)' },
  {
    name: 'Harish Menon', language: 'hi', consent: 'consented',
    purchases: [{ daysAgo: 90 }, { daysAgo: 60 }, { daysAgo: 10, status: 'refunded' }],
    expectedRisk: 'at_risk', scenario: 'Refund ignored: recent refunded order does not count as a visit',
  },
  {
    name: 'Imran Qureshi', language: 'hi', consent: 'consented',
    purchases: [{ daysAgo: 80 }, { daysAgo: 50 }, { daysAgo: 5, status: 'cancelled' }],
    expectedRisk: 'at_risk', scenario: 'Cancellation ignored: recent cancelled order does not count',
  },

  // At risk but recently messaged by another campaign (frequency cap / cooldown)
  { name: 'Karan Malhotra', language: 'hi', consent: 'consented', purchases: p(120, 90, 60), messagedDaysAgo: 10, expectedRisk: 'at_risk', scenario: 'Frequency-capped: messaged 10 days ago by a previous campaign' },
  { name: 'Divya Menon', language: 'ta', consent: 'consented', purchases: p(100, 75, 50), messagedDaysAgo: 10, expectedRisk: 'at_risk', scenario: 'Frequency-capped: messaged 10 days ago by a previous campaign' },

  // At-risk pattern but not sendable
  { name: 'Arun Joshi', language: 'hi', consent: 'consented', optedOutDaysAgo: 20, purchases: p(120, 90), expectedRisk: 'at_risk', scenario: 'Opted out' },
  { name: 'Fatima Sheikh', language: 'hi', consent: 'consented', optedOutDaysAgo: 20, purchases: p(100, 70), expectedRisk: 'at_risk', scenario: 'Opted out' },
  { name: 'Ramesh Gupta', language: 'hi', consent: 'unknown', purchases: p(120, 90), expectedRisk: 'at_risk', scenario: 'No consent recorded (unknown)' },
  { name: 'Sushma Iyer', language: 'ta', consent: 'unknown', purchases: p(100, 70), expectedRisk: 'at_risk', scenario: 'No consent recorded (unknown)' },
  { name: 'Dinesh Pillai', language: 'ml', consent: 'revoked', purchases: p(150, 100), expectedRisk: 'at_risk', scenario: 'Consent revoked' },

  // Healthy
  { name: 'Priya Patel', language: 'gu', consent: 'consented', purchases: p(80, 40, 10), expectedRisk: 'healthy', scenario: 'Healthy: visited 10 days ago' },
  { name: 'Mohammed Ali', language: 'hi', consent: 'consented', purchases: p(70, 35, 5), expectedRisk: 'healthy', scenario: 'Healthy: visited 5 days ago' },
  { name: 'Ananya Das', language: 'bn', consent: 'consented', purchases: p(55, 25, 3), expectedRisk: 'healthy', scenario: 'Healthy: visited 3 days ago' },
  { name: 'Amrit Kaur', language: 'pa', consent: 'consented', purchases: p(30, 15, 2), expectedRisk: 'healthy', scenario: 'Healthy: visited 2 days ago' },
  { name: 'Vikas Tiwari', language: 'hi', consent: 'consented', purchases: p(40, 20, 4), expectedRisk: 'healthy', scenario: 'Healthy: visited 4 days ago' },
  { name: 'Pooja Bhat', language: 'kn', consent: 'consented', purchases: p(35, 18, 1), expectedRisk: 'healthy', scenario: 'Healthy: visited yesterday' },
  { name: 'Suresh Pandey', language: 'hi', consent: 'consented', purchases: p(50, 25, 6), expectedRisk: 'healthy', scenario: 'Healthy: visited 6 days ago' },
  { name: 'Lakshmi Venkat', language: 'te', consent: 'consented', purchases: p(45, 22, 5), expectedRisk: 'healthy', scenario: 'Healthy: visited 5 days ago' },
  { name: 'Neha Kapoor', language: 'hi', consent: 'consented', purchases: p(60, 60, 30), expectedRisk: 'healthy', scenario: 'Duplicate timestamps: same-time orders ignored for cadence' },
  { name: 'Tara Bose', language: 'bn', consent: 'consented', purchases: p(20, 15, 10), expectedRisk: 'healthy', scenario: 'Frequent buyer: 10 days late vs 5-day rhythm, but under 14-day minimum' },

  // Insufficient history
  { name: 'Rohit Verma', language: 'hi', consent: 'consented', purchases: p(30), expectedRisk: 'insufficient_history', scenario: 'Only one purchase' },
  { name: 'Meena Krishnan', language: 'ta', consent: 'consented', purchases: [], expectedRisk: 'insufficient_history', scenario: 'No purchases' },
];

export const HISTORICAL_CAMPAIGN_ID = demoUuid('30000000', 1);

export interface DemoDataset {
  merchant: { id: string; name: string; business_type: string; currency: string; default_budget_minor: number; default_cooldown_days: number; default_frequency_cap: number; timezone: string };
  customers: Array<{ id: string; display_name: string; preferred_language: string; consent_status: ConsentStatus; opted_out_at: Date | null; created_at: Date }>;
  purchases: Array<{ id: string; customer_id: string; occurred_at: Date; amount_minor: number; status: PurchaseStatus }>;
  campaign: Record<string, unknown>;
  recipients: Array<{ id: string; customer_id: string }>;
  messages: Array<{ id: string; customer_id: string; idempotency_key: string; sent_at: Date; delivered_at: Date }>;
}

/** Build the full demo dataset in memory. Pure and deterministic. */
export function buildDemoDataset(): DemoDataset {
  const customers: DemoDataset['customers'] = [];
  const purchases: DemoDataset['purchases'] = [];
  const recipients: DemoDataset['recipients'] = [];
  const messages: DemoDataset['messages'] = [];
  let purchaseN = 0;

  DEMO_CUSTOMERS.forEach((c, i) => {
    const id = demoUuid('10000000', i + 1);
    customers.push({
      id,
      display_name: c.name,
      preferred_language: c.language,
      consent_status: c.consent,
      opted_out_at: c.optedOutDaysAgo === undefined ? null : daysBeforeReference(c.optedOutDaysAgo),
      created_at: daysBeforeReference(365),
    });
    c.purchases.forEach((purchase, j) => {
      purchaseN += 1;
      purchases.push({
        id: demoUuid('20000000', purchaseN),
        customer_id: id,
        occurred_at: daysBeforeReference(purchase.daysAgo),
        // ₹120–₹710 in paise, deterministic per customer/purchase
        amount_minor: 12_000 + ((i * 37 + j * 53) % 60) * 1_000,
        status: purchase.status ?? 'completed',
      });
    });
    if (c.messagedDaysAgo !== undefined) {
      const n = recipients.length + 1;
      const sentAt = daysBeforeReference(c.messagedDaysAgo);
      recipients.push({ id: demoUuid('40000000', n), customer_id: id });
      messages.push({
        id: demoUuid('50000000', n),
        customer_id: id,
        idempotency_key: `${HISTORICAL_CAMPAIGN_ID}:${id}:v1`,
        sent_at: sentAt,
        delivered_at: new Date(sentAt.getTime() + 60_000),
      });
    }
  });

  return {
    merchant: {
      id: DEMO_MERCHANT_ID,
      name: 'Chai & Conversations Café',
      business_type: 'cafe',
      currency: 'INR',
      default_budget_minor: 500_000,
      default_cooldown_days: 30,
      default_frequency_cap: 1,
      timezone: 'Asia/Kolkata',
    },
    customers,
    purchases,
    campaign: {
      id: HISTORICAL_CAMPAIGN_ID,
      name: 'September check-in (historical demo)',
      goal: 'Remind lapsing regulars to visit',
      segment_snapshot: JSON.stringify({ segment_type: 'at_risk', note: 'Seeded historical campaign used to demonstrate cross-campaign frequency caps.' }),
      offer_config: JSON.stringify({ type: 'no_offer' }),
      budget_minor: 0,
      frequency_cap: 1,
      cooldown_days: 30,
      language: 'en',
      channel: 'whatsapp',
      original_message: 'Hi! We miss you at Chai & Conversations. Drop by this week — your usual table is waiting.',
      plan_source: 'demo_fallback',
      status: 'sent',
      version: 1,
      approved_version: 1,
      approved_by: DEMO_ACTOR_ID,
      approved_at: daysBeforeReference(12),
      created_at: daysBeforeReference(14),
      updated_at: daysBeforeReference(10),
    },
    recipients,
    messages,
  };
}
