/**
 * Winback AI — Sarvam AI Translator
 * Uses Sarvam's translate API for Indian languages.
 */

import { z } from 'zod';
import { Translator } from '../interfaces';
import { TranslationInput, TranslationResult } from '@/types';
import { DemoTranslator } from '../demo';

export const SUPPORTED_LANGUAGES: Record<string, string> = {
  en: 'English',
  hi: 'Hindi',
  ta: 'Tamil',
  te: 'Telugu',
  ml: 'Malayalam',
  kn: 'Kannada',
  bn: 'Bengali',
  gu: 'Gujarati',
  mr: 'Marathi',
  pa: 'Punjabi',
  od: 'Odia',
};

const SARVAM_TRANSLATE_URL = 'https://api.sarvam.ai/translate';
const PROVIDER_TIMEOUT_MS = 10000;

const SarvamResponseSchema = z.object({
  translated_text: z.string(),
  source_language_code: z.string().optional(),
  target_language_code: z.string().optional(),
});

export class SarvamTranslator implements Translator {
  private apiKey: string;
  private fallback: DemoTranslator;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.fallback = new DemoTranslator();
  }

  async translate(input: TranslationInput): Promise<TranslationResult> {
    if (!SUPPORTED_LANGUAGES[input.target_language]) {
      return {
        original: input.text,
        translated: '',
        source: 'demo_fallback',
        status: 'failed',
        error: `Language '${input.target_language}' is not supported by Sarvam.`,
      };
    }

    if (input.target_language === 'en') {
      return {
        original: input.text,
        translated: input.text,
        source: 'sarvam',
        status: 'success',
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);

    try {
      const response = await fetch(SARVAM_TRANSLATE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-subscription-key': this.apiKey,
        },
        body: JSON.stringify({
          input: input.text,
          source_language_code: input.source_language === 'en' ? 'en-IN' : input.source_language,
          target_language_code: `${input.target_language}-IN`,
          speaker_gender: 'Male',
          mode: 'formal',
          model: 'mayura:v1',
          enable_preprocessing: false,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(`Sarvam API error ${response.status}: ${errorText.slice(0, 200)}`);
      }

      const data = await response.json();
      const validated = SarvamResponseSchema.parse(data);

      return {
        original: input.text,
        translated: validated.translated_text,
        source: 'sarvam',
        status: 'success',
      };
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof Error && err.name === 'AbortError') {
        return {
          original: input.text,
          translated: '',
          source: 'demo_fallback',
          status: 'failed',
          error: 'Sarvam translation timed out. Please retry.',
        };
      }
      console.error('[Sarvam] Translation failed:', err instanceof Error ? err.message : err);
      return {
        original: input.text,
        translated: '',
        source: 'demo_fallback',
        status: 'failed',
        error: err instanceof Error ? err.message : 'Translation failed',
      };
    }
  }
}
