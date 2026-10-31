/**
 * Merchant-facing campaign rules and limits. Pure and browser-safe: the builder UI and the
 * server use the same values. Documented MVP limits (PRD FR-05, E-27).
 */

export const CHANNELS = ['whatsapp', 'sms', 'email'] as const;
export type Channel = (typeof CHANNELS)[number];

export const CHANNEL_LABELS: Record<Channel, string> = { whatsapp: 'WhatsApp', sms: 'SMS', email: 'Email' };

/** Maximum message length per simulated channel. SMS allows two 160-character segments. */
export const CHANNEL_MESSAGE_LIMITS: Record<Channel, number> = { sms: 320, whatsapp: 1000, email: 2000 };

/** Hard cap on stored message text, whatever the channel. */
export const MESSAGE_MAX_STORED = 2000;

/**
 * Campaign languages. Sarvam support for each code is verified in Phase 6; until then these are
 * the languages the demo customers use.
 */
export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'hi', name: 'Hindi' },
  { code: 'bn', name: 'Bengali' },
  { code: 'gu', name: 'Gujarati' },
  { code: 'kn', name: 'Kannada' },
  { code: 'ml', name: 'Malayalam' },
  { code: 'mr', name: 'Marathi' },
  { code: 'od', name: 'Odia' },
  { code: 'pa', name: 'Punjabi' },
  { code: 'ta', name: 'Tamil' },
  { code: 'te', name: 'Telugu' },
] as const;
export const LANGUAGE_CODES = LANGUAGES.map((l) => l.code) as [string, ...string[]];

export const LIMITS = {
  percentMin: 1,
  percentMax: 50,
  /** ₹1,000: largest fixed discount, discount cap, or free-item cost per redemption. */
  perRedemptionMaxMinor: 100_000,
  minOrderMaxMinor: 10_000_000,
  expiryDaysMin: 1,
  expiryDaysMax: 90,
  /** ₹10 lakh */
  budgetMaxMinor: 100_000_000,
  frequencyCapMin: 1,
  frequencyCapMax: 5,
  cooldownDaysMin: 1,
  cooldownDaysMax: 180,
} as const;

/** Share of eligible customers held back as the control group (never messaged). */
export const CONTROL_SHARE = 0.2;

export const OFFER_TYPES = ['percentage_discount', 'fixed_discount', 'free_item', 'no_offer'] as const;
export type OfferType = (typeof OFFER_TYPES)[number];

export const OFFER_TYPE_LABELS: Record<OfferType, string> = {
  percentage_discount: 'Percentage discount',
  fixed_discount: 'Fixed amount off',
  free_item: 'Free item',
  no_offer: 'No offer (reminder only)',
};

interface OfferCommon {
  minimum_order_value_minor?: number;
  expiry_days?: number;
}
export type Offer =
  | ({ type: 'percentage_discount'; percent: number; max_discount_minor?: number } & OfferCommon)
  | ({ type: 'fixed_discount'; amount_minor: number } & OfferCommon)
  | ({ type: 'free_item'; item_name: string; item_cost_minor: number } & OfferCommon)
  | { type: 'no_offer' };

/**
 * Cost to the merchant of one redemption, in minor units. For a percentage discount without a
 * cap this depends on order size, so it uses the average order value; null if that is unknown.
 */
export function offerCostPerRedemptionMinor(offer: Offer, avgOrderValueMinor: number | null): number | null {
  switch (offer.type) {
    case 'no_offer': return 0;
    case 'fixed_discount': return offer.amount_minor;
    case 'free_item': return offer.item_cost_minor;
    case 'percentage_discount': {
      if (avgOrderValueMinor === null) return offer.max_discount_minor ?? null;
      const raw = Math.round((avgOrderValueMinor * offer.percent) / 100);
      return offer.max_discount_minor === undefined ? raw : Math.min(raw, offer.max_discount_minor);
    }
  }
}

export function formatMinor(minor: number, currency: string = 'INR'): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(minor / 100);
}

/** Plain-language offer terms. Never invents an expiry that is not configured. */
export function describeOffer(offer: Offer, currency: string = 'INR'): string {
  if (offer.type === 'no_offer') return 'No offer — a reminder message only.';
  const parts: string[] = [];
  if (offer.type === 'percentage_discount') {
    parts.push(`${offer.percent}% off`);
    if (offer.max_discount_minor !== undefined) parts.push(`(up to ${formatMinor(offer.max_discount_minor, currency)})`);
  } else if (offer.type === 'fixed_discount') {
    parts.push(`${formatMinor(offer.amount_minor, currency)} off`);
  } else {
    parts.push(`Free ${offer.item_name}`);
  }
  if (offer.minimum_order_value_minor) parts.push(`on orders of ${formatMinor(offer.minimum_order_value_minor, currency)} or more`);
  parts.push(offer.expiry_days ? `— valid for ${offer.expiry_days} day${offer.expiry_days === 1 ? '' : 's'}` : '— no expiry set');
  return parts.join(' ');
}

/** Rupees typed in a form → integer paise. Returns null for blank or invalid input. */
export function rupeesToMinor(input: string): number | null {
  const trimmed = input.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole, frac = ''] = trimmed.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

export function minorToRupeesInput(minor: number | undefined): string {
  if (minor === undefined) return '';
  return minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2);
}
