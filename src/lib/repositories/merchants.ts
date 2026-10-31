import type { Queryable } from '@/lib/db/types';

export interface MerchantSettings {
  id: string;
  name: string;
  business_type: string;
  currency: string;
  timezone: string;
  default_cooldown_days: number;
  default_frequency_cap: number;
}

export async function getMerchantSettings(db: Queryable, merchantId: string): Promise<MerchantSettings | null> {
  const result = await db.query<MerchantSettings>(
    `SELECT id, name, business_type, currency, timezone, default_cooldown_days, default_frequency_cap
       FROM merchants WHERE id = $1`,
    [merchantId],
  );
  return result.rows[0] ?? null;
}
