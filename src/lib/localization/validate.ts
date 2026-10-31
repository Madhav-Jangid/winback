import { MESSAGE_MAX_STORED } from '@/lib/campaigns/rules';
import { numbersPreserved } from './rules';
import { TranslatorError } from './types';

const MARKUP = /\{[^}]*\}|\[[^\]]*\]|<[^>]*>/;

export interface ValidatedTranslation {
  text: string;
  warnings: string[];
}

/**
 * Provider output is untrusted. Unusable text is rejected; suspicious text is kept but flagged so
 * the merchant reviews it (E-16): offer numbers must survive translation, and no markup or
 * placeholders may appear that the English message did not have.
 *
 * @param expectTranslation false for the demo fallback, whose text is intentionally unchanged
 */
export function validateTranslation(source: string, translated: string, expectTranslation: boolean): ValidatedTranslation {
  const text = translated.trim();
  if (!text) throw new TranslatorError('TRANSLATOR_INVALID_RESPONSE', 'The translation service returned an empty result.');
  if (text.length > MESSAGE_MAX_STORED) {
    throw new TranslatorError('TRANSLATOR_INVALID_RESPONSE', `The translation is longer than the ${MESSAGE_MAX_STORED}-character limit.`);
  }

  const warnings: string[] = [];
  const numbers = numbersPreserved(source, text);
  if (!numbers.ok) {
    const parts = [
      numbers.missing.length ? `missing ${numbers.missing.join(', ')}` : null,
      numbers.extra.length ? `unexpected ${numbers.extra.join(', ')}` : null,
    ].filter(Boolean);
    warnings.push(`The numbers differ from the English message (${parts.join('; ')}). Check the offer terms.`);
  }
  if (MARKUP.test(text) && !MARKUP.test(source)) warnings.push('The translation contains markup or placeholders that are not in the English message.');
  if (expectTranslation && text === source.trim()) warnings.push('The translated text is identical to the English message.');
  return { text, warnings };
}
