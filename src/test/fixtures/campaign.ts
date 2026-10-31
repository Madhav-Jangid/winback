/** A valid campaign draft input, shared by campaign tests. */
export const VALID_DRAFT = {
  name: 'October winback',
  goal: 'Bring regulars back',
  segment_type: 'at_risk',
  offer: { type: 'percentage_discount', percent: 10, max_discount_minor: 10_000 },
  budget_minor: 500_000,
  frequency_cap: 1,
  cooldown_days: 30,
  language: 'hi',
  channel: 'whatsapp',
  original_message: 'We miss you! Show this message for 10% off (up to ₹100).',
} as const;
