/**
 * Demo translator, used only when no Sarvam key is configured or the merchant explicitly chooses
 * it after a failure. It does NOT translate: arbitrary text cannot be translated without a
 * model, and canned sentences would not match the merchant's message or offer. It returns the
 * English text unchanged, labelled `demo_fallback`, for the merchant to translate by hand.
 */
import type { TranslationInput, TranslationResult } from '@/lib/localization/types';
import type { Translator } from '../interfaces';

export class DemoTranslator implements Translator {
  constructor(private readonly reason: string) {}

  async translate(input: TranslationInput): Promise<TranslationResult> {
    return { translated_text: input.text, source: 'demo_fallback', model: null, fallback_reason: this.reason };
  }
}
