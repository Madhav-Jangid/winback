/**
 * Sarvam translator (FR-07). Calls POST https://api.sarvam.ai/translate directly with fetch (the
 * same request the `sarvamai` SDK makes), so the timeout and error handling are ours and the key
 * travels only in a header. Failures throw TranslatorError with safe messages; the caller never
 * substitutes other text silently.
 *
 * Numerals are requested as `international` so digits in offer terms (10%, ₹100, 14 days) stay
 * verifiable. The mode is `formal`, supported by both models.
 */
import { z } from 'zod';
import { SOURCE_LANGUAGE } from '@/lib/localization/rules';
import { TranslatorError, type TranslationInput, type TranslationResult } from '@/lib/localization/types';
import type { Translator } from '../interfaces';
import { DEFAULT_SARVAM_MODEL, SARVAM_LANGUAGE_CODES, SARVAM_MODEL_LIMITS, type SarvamModel } from './languages';

export const SARVAM_TRANSLATE_URL = 'https://api.sarvam.ai/translate';
export const SARVAM_TIMEOUT_MS = 20_000;

const responseSchema = z.object({
  translated_text: z.string(),
  request_id: z.string().nullish(),
  source_language_code: z.string().optional(),
});
const errorSchema = z.object({ error: z.object({ code: z.string().optional() }) });

export interface SarvamTranslatorOptions {
  apiKey: string;
  model?: SarvamModel;
  timeoutMs?: number;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

/**
 * Use the configured model, or the larger-limit model when the text does not fit. The model that
 * was actually used is recorded with the translation.
 */
export function resolveModel(configured: SarvamModel, length: number): SarvamModel {
  if (length <= SARVAM_MODEL_LIMITS[configured]) return configured;
  if (length <= SARVAM_MODEL_LIMITS['sarvam-translate:v1']) return 'sarvam-translate:v1';
  throw new TranslatorError(
    'TRANSLATOR_TEXT_TOO_LONG',
    `The message is ${length} characters; Sarvam accepts at most ${SARVAM_MODEL_LIMITS['sarvam-translate:v1']}. Shorten the English message.`,
  );
}

/** A fixed hint per Sarvam error code: the provider's own message text is never echoed. */
function hintFor(status: number, code: string | undefined): string {
  switch (code) {
    case 'insufficient_quota_error': return ' (Sarvam quota exhausted)';
    case 'invalid_api_key_error':
    case 'authentication_error': return ' (check SARVAM_API_KEY)';
    case 'rate_limit_exceeded_error': return ' (rate limit)';
    case 'unprocessable_entity_error': return ' (Sarvam could not translate this text)';
  }
  if (status === 401 || status === 403) return ' (check SARVAM_API_KEY)';
  if (status === 429) return ' (rate limit or quota)';
  if (status === 422) return ' (Sarvam could not translate this text)';
  return '';
}

export class SarvamTranslator implements Translator {
  private readonly apiKey: string;
  private readonly model: SarvamModel;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: SarvamTranslatorOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_SARVAM_MODEL;
    this.timeoutMs = options.timeoutMs ?? SARVAM_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async translate(input: TranslationInput): Promise<TranslationResult> {
    const target = SARVAM_LANGUAGE_CODES[input.target_language];
    if (!target || input.target_language === SOURCE_LANGUAGE) {
      throw new TranslatorError('TRANSLATOR_UNSUPPORTED_LANGUAGE', `Sarvam translation is not available for language "${input.target_language.slice(0, 10)}".`);
    }
    const model = resolveModel(this.model, input.text.length);

    let response: Response;
    try {
      response = await this.fetchImpl(SARVAM_TRANSLATE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-subscription-key': this.apiKey },
        body: JSON.stringify({
          input: input.text,
          source_language_code: SARVAM_LANGUAGE_CODES[SOURCE_LANGUAGE],
          target_language_code: target,
          model,
          mode: 'formal',
          numerals_format: 'international',
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new TranslatorError('TRANSLATOR_TIMEOUT', `Sarvam did not respond within ${Math.max(1, Math.round(this.timeoutMs / 1000))} seconds.`);
      }
      throw new TranslatorError('TRANSLATOR_NETWORK_ERROR', 'Could not reach Sarvam. Check the network connection.');
    }

    if (!response.ok) {
      let code: string | undefined;
      try {
        code = errorSchema.parse(await response.json()).error.code;
      } catch {
        // Unreadable error body: fall back to the status alone.
      }
      throw new TranslatorError('TRANSLATOR_HTTP_ERROR', `Sarvam returned HTTP ${response.status}${hintFor(response.status, code)}.`);
    }

    let translated: string;
    try {
      translated = responseSchema.parse(await response.json()).translated_text;
    } catch {
      throw new TranslatorError('TRANSLATOR_INVALID_RESPONSE', 'Sarvam returned an unreadable response.');
    }
    return { translated_text: translated, source: 'sarvam', model, fallback_reason: null };
  }
}
