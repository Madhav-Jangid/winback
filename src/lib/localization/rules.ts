/**
 * Localization rules shared by the server and the builder UI (FR-07). Pure and browser-safe.
 *
 * The English message is the source of truth. A localized message is only trusted while it was
 * written (or confirmed by the merchant) against the current English text and language;
 * otherwise it is stale and the campaign cannot be approved.
 */

export const SOURCE_LANGUAGE = 'en';

export type TranslationSource = 'sarvam' | 'demo_fallback' | 'manual';

export interface TranslationMeta {
  source: TranslationSource;
  /** Provider model id, or null for demo/manual text. */
  model: string | null;
  language: string;
  /** The exact English text this translation was made from or confirmed against. */
  source_text: string;
  /** True once the merchant has edited or confirmed the text. */
  edited: boolean;
  translated_at: string;
  warnings: string[];
  /** Why the demo fallback was used, when it was. */
  fallback_reason: string | null;
}

export type TranslationState = 'not_needed' | 'missing' | 'stale' | 'ready';

export function translationState(
  campaign: { language: string; original_message: string; localized_message: string },
  meta: TranslationMeta | null,
): TranslationState {
  if (campaign.language === SOURCE_LANGUAGE) return 'not_needed';
  if (!campaign.localized_message.trim()) return 'missing';
  if (!meta || meta.language !== campaign.language || meta.source_text !== campaign.original_message.trim()) return 'stale';
  return 'ready';
}

/** The text customers receive: English as written, or the localized message. */
export function effectiveMessage(c: { language: string; original_message: string; localized_message: string }): string {
  return (c.language === SOURCE_LANGUAGE ? c.original_message : c.localized_message).trim();
}

/** Zero digits of the Indic scripts we support (Devanagari, Bengali, Gurmukhi, Gujarati, Odia, Tamil, Telugu, Kannada, Malayalam). */
const NATIVE_ZEROS = [0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6, 0x0c66, 0x0ce6, 0x0d66];

/** Numbers in a text as normalized strings (ASCII digits, no thousands commas), sorted. */
export function extractNumbers(text: string): string[] {
  const ascii = text.replace(/\p{Nd}/gu, (digit) => {
    const cp = digit.codePointAt(0) ?? 0;
    for (const zero of NATIVE_ZEROS) if (cp >= zero && cp <= zero + 9) return String(cp - zero);
    return digit;
  });
  return (ascii.match(/\d+(?:[,.]\d+)*/g) ?? []).map((n) => n.replaceAll(',', '')).sort();
}

export interface NumberCheck {
  ok: boolean;
  /** In the English text but not in the translation. */
  missing: string[];
  /** In the translation but not in the English text. */
  extra: string[];
}

/** Offer terms live in numbers (percent, rupees, days). A translation must keep exactly those (E-16). */
export function numbersPreserved(source: string, translated: string): NumberCheck {
  const remaining = extractNumbers(translated);
  const missing: string[] = [];
  for (const n of extractNumbers(source)) {
    const at = remaining.indexOf(n);
    if (at === -1) missing.push(n);
    else remaining.splice(at, 1);
  }
  return { ok: missing.length === 0 && remaining.length === 0, missing, extra: remaining };
}

/**
 * Provenance after the merchant saves the form. Editing the localized text counts as reviewing
 * it against the current English message; an unchanged text keeps its provenance (and goes stale
 * if the English text or language moved on).
 */
export function translationAfterSave(
  previous: TranslationMeta | null,
  previousLocalized: string,
  next: { localized_message: string; original_message: string; language: string },
  now: Date,
): TranslationMeta | null {
  if (next.localized_message === previousLocalized) return previous;
  if (!next.localized_message.trim()) return null;
  return {
    source: previous?.source ?? 'manual',
    model: previous?.model ?? null,
    language: next.language,
    source_text: next.original_message.trim(),
    edited: true,
    translated_at: previous?.translated_at ?? now.toISOString(),
    warnings: [],
    fallback_reason: previous?.fallback_reason ?? null,
  };
}
