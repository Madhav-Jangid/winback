/** Customer profiles for the full demo dataset, built in memory (no database). */
import { frequencyWindowDays } from '@/lib/campaigns/rules';
import { buildCustomerProfile, type ContactPolicy, type CustomerProfile } from '@/lib/customers/service';
import { DEMO_REFERENCE_DATE } from '@/lib/demo/constants';
import { buildDemoDataset } from '@/lib/demo/seed-data';

const DAY_MS = 86_400_000;

export function demoProfiles(
  policy: ContactPolicy = { cooldown_days: 30, frequency_cap: 1 },
  now: Date = DEMO_REFERENCE_DATE,
): CustomerProfile[] {
  const data = buildDemoDataset();
  const windowStart = now.getTime() - frequencyWindowDays(policy.cooldown_days) * DAY_MS;
  return data.customers.map((c) => {
    const messages = data.messages.filter((m) => m.customer_id === c.id);
    const last = messages.map((m) => m.sent_at.getTime()).sort((a, b) => b - a)[0];
    return buildCustomerProfile(
      {
        ...c,
        opted_out_at: c.opted_out_at?.toISOString() ?? null,
        purchases: data.purchases.filter((p) => p.customer_id === c.id).map((p) => ({
          ...p, occurred_at: p.occurred_at.toISOString(), currency: 'INR', source: 'demo',
        })),
      },
      last === undefined ? undefined : {
        last_sent_at: new Date(last).toISOString(),
        count_in_window: messages.filter((m) => m.sent_at.getTime() >= windowStart).length,
      },
      now,
      policy,
    );
  });
}
