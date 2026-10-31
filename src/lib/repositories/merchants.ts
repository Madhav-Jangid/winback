import type { Queryable } from '@/lib/db/types';

export interface MerchantSettings {
  id: string;
  name: string;
  business_type: string;
  currency: string;
  timezone: string;
  default_cooldown_days: number;
  default_frequency_cap: number;
  default_budget_minor: number;
}

export async function getMerchantSettings(db: Queryable, merchantId: string): Promise<MerchantSettings | null> {
  const result = await db.query<Omit<MerchantSettings, 'default_budget_minor'> & { default_budget_minor: string }>(
    `SELECT id, name, business_type, currency, timezone, default_cooldown_days, default_frequency_cap, default_budget_minor
       FROM merchants WHERE id = $1`,
    [merchantId],
  );
  const row = result.rows[0];
  // BIGINT arrives as a string.
  return row ? { ...row, default_budget_minor: Number(row.default_budget_minor) } : null;
}
