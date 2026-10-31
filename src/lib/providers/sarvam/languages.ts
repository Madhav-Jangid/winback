/**
 * Sarvam translation configuration, verified against docs.sarvam.ai/api-reference-docs/text/translate
 * on 2026-10-31. Language support depends on Sarvam's current models: re-check this file when
 * adding a language to LANGUAGES in src/lib/campaigns/rules.ts.
 */
export const SARVAM_MODELS = ['mayura:v1', 'sarvam-translate:v1'] as const;
export type SarvamModel = (typeof SARVAM_MODELS)[number];
export const DEFAULT_SARVAM_MODEL: SarvamModel = 'mayura:v1';

/** Maximum input characters per model. */
export const SARVAM_MODEL_LIMITS: Record<SarvamModel, number> = { 'mayura:v1': 1000, 'sarvam-translate:v1': 2000 };

/** Campaign language code → Sarvam language code. Both models support all of these. */
export const SARVAM_LANGUAGE_CODES: Record<string, string> = {
  en: 'en-IN',
  hi: 'hi-IN',
  bn: 'bn-IN',
  gu: 'gu-IN',
  kn: 'kn-IN',
  ml: 'ml-IN',
  mr: 'mr-IN',
  od: 'od-IN',
  pa: 'pa-IN',
  ta: 'ta-IN',
  te: 'te-IN',
};
