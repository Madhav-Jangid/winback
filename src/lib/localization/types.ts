import type { CampaignView } from '@/lib/campaigns/service';
import type { TranslationSource } from './rules';

/** Source copy is always English; the target is a campaign language code such as "hi". */
export interface TranslationInput {
  text: string;
  target_language: string;
}

export interface TranslationResult {
  translated_text: string;
  source: Exclude<TranslationSource, 'manual'>;
  model: string | null;
  fallback_reason: string | null;
}

export type TranslatorErrorCode =
  | 'TRANSLATOR_TIMEOUT'
  | 'TRANSLATOR_NETWORK_ERROR'
  | 'TRANSLATOR_HTTP_ERROR'
  | 'TRANSLATOR_INVALID_RESPONSE'
  | 'TRANSLATOR_UNSUPPORTED_LANGUAGE'
  | 'TRANSLATOR_TEXT_TOO_LONG';

/** A provider failure with a safe, user-readable message (never raw provider payloads or keys). */
export class TranslatorError extends Error {
  constructor(public readonly code: TranslatorErrorCode, message: string) {
    super(message);
    this.name = 'TranslatorError';
  }
}

export interface TranslationOutcome {
  /** True when a current translation already existed and no provider call was made. */
  cached: boolean;
  source: TranslationSource;
  model: string | null;
  fallback_reason: string | null;
  warnings: string[];
}

/** Response of POST /api/campaigns/:id/translate: the updated campaign plus what happened. */
export type TranslateResponse = CampaignView & { translation_result: TranslationOutcome };
