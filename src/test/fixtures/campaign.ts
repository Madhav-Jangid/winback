import type { TranslationMeta } from '@/lib/localization/rules';

const ENGLISH = 'We miss you! Show this message for 10% off (up to ₹100).';

/** Hindi for ENGLISH: keeps the offer's numbers (10, 100). */
export const VALID_LOCALIZED = 'हम आपको याद करते हैं! अपने अगले ऑर्डर पर 10% की छूट (₹100 तक) पाएं।';

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
  original_message: ENGLISH,
  localized_message: VALID_LOCALIZED,
} as const;

/** Provenance matching VALID_DRAFT: the merchant wrote the Hindi text themselves. */
export const VALID_TRANSLATION: TranslationMeta = {
  source: 'manual',
  model: null,
  language: 'hi',
  source_text: ENGLISH,
  edited: true,
  translated_at: '2026-10-01T00:00:00.000Z',
  warnings: [],
  fallback_reason: null,
};
