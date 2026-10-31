/**
 * Translation of a saved campaign's English message (FR-07). The English text is never touched.
 * A successful translation is saved as a new campaign version with its provenance; a failure
 * saves nothing and offers retry, manual editing, or an explicitly chosen, labelled demo draft.
 * Provider text is never silently substituted and never labelled as Sarvam unless Sarvam made it.
 */
import { z } from 'zod';
import { LANGUAGE_CODES } from '@/lib/campaigns/rules';
import { applyTranslation, getCampaignView } from '@/lib/campaigns/service';
import { writeAuditEvent } from '@/lib/audit/service';
import { inTransaction } from '@/lib/db/transaction';
import type { Queryable } from '@/lib/db/types';
import { getServerEnv } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { DemoTranslator } from '@/lib/providers/demo/translator';
import { selectTranslator, type TranslatorSelection } from '@/lib/providers/factory';
import { fingerprint, recordProviderOperation } from '@/lib/repositories/planning';
import { SOURCE_LANGUAGE, type TranslationMeta } from './rules';
import { TranslatorError, type TranslateResponse, type TranslationOutcome } from './types';
import { validateTranslation } from './validate';

export const translateRequestSchema = z.object({
  /** Replace a current translation, including any edits the merchant made. */
  force: z.boolean().optional(),
  /** After a failure: use the labelled demo translator instead of the live provider. */
  use_demo: z.boolean().optional(),
}).strict();

const DEMO_CHOSEN_REASON = 'You chose the demo draft instead of the live Sarvam translation.';
const DEMO_WARNING = 'Demo fallback: this is the English text, not a translation. Translate it yourself, or configure Sarvam.';

const outcomeFrom = (meta: TranslationMeta, cached: boolean): TranslationOutcome => ({
  cached, source: meta.source, model: meta.model, fallback_reason: meta.fallback_reason, warnings: meta.warnings,
});

export async function translateCampaign(
  db: Queryable,
  merchantId: string,
  campaignId: string,
  request: unknown,
  now: Date,
  actorId: string,
  selection: TranslatorSelection = selectTranslator(getServerEnv()),
): Promise<TranslateResponse> {
  const parsed = translateRequestSchema.safeParse(request);
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Invalid translation request.', 400);
  const force = parsed.data.force === true;
  const useDemo = parsed.data.use_demo === true;

  const view = await getCampaignView(db, merchantId, campaignId, now);
  if (!view.editable) {
    throw new AppError('CAMPAIGN_LOCKED', `A ${view.campaign.status} campaign can no longer be edited, so it cannot be translated.`, 409);
  }
  const campaign = view.campaign;
  if (campaign.language === SOURCE_LANGUAGE) {
    throw new AppError('TRANSLATION_NOT_NEEDED', 'This campaign is in English, so no translation is needed.', 409);
  }
  if (!(LANGUAGE_CODES as string[]).includes(campaign.language)) {
    throw new AppError('UNSUPPORTED_LANGUAGE', `Language "${campaign.language.slice(0, 10)}" is not supported.`, 400);
  }
  const source = campaign.original_message.trim();
  if (!source) throw new AppError('MESSAGE_REQUIRED', 'Write the English message first; there is nothing to translate yet.', 400);

  // A current translation exists: do not call the provider again or overwrite the merchant's edits.
  if (view.translation_state === 'ready' && campaign.translation && !force) {
    return { ...view, translation_result: outcomeFrom(campaign.translation, true) };
  }

  const translator = useDemo ? new DemoTranslator(DEMO_CHOSEN_REASON) : selection.translator;
  const provider = useDemo || !selection.live ? 'demo' : 'sarvam';
  const requestFingerprint = fingerprint({ language: campaign.language, text: source });

  await inTransaction(db, () => writeAuditEvent({
    merchant_id: merchantId, campaign_id: campaignId, actor_id: actorId, event_type: 'translation_requested',
    entity_type: 'campaign', entity_id: campaignId,
    metadata: { language: campaign.language, provider, source_length: source.length, replaces_existing: view.translation_state !== 'missing' },
  }, db));

  let meta: TranslationMeta;
  let text: string;
  try {
    const result = await translator.translate({ text: source, target_language: campaign.language });
    const checked = validateTranslation(source, result.translated_text, result.source !== 'demo_fallback');
    text = checked.text;
    meta = {
      source: result.source,
      model: result.model,
      language: campaign.language,
      source_text: source,
      edited: false,
      translated_at: new Date().toISOString(),
      warnings: result.source === 'demo_fallback' ? [DEMO_WARNING, ...checked.warnings] : checked.warnings,
      fallback_reason: result.fallback_reason,
    };
  } catch (error) {
    if (!(error instanceof TranslatorError)) throw error;
    await inTransaction(db, async () => {
      await recordProviderOperation(db, { provider, operation: 'translate', status: 'error', request_fingerprint: requestFingerprint, error_code: error.code });
      await writeAuditEvent({
        merchant_id: merchantId, campaign_id: campaignId, actor_id: actorId, event_type: 'translation_failed',
        entity_type: 'campaign', entity_id: campaignId,
        metadata: { provider, language: campaign.language, error_code: error.code, campaign_version: campaign.version },
      }, db);
    });
    if (error.code === 'TRANSLATOR_UNSUPPORTED_LANGUAGE') throw new AppError('UNSUPPORTED_LANGUAGE', error.message, 400);
    if (error.code === 'TRANSLATOR_TEXT_TOO_LONG') throw new AppError('MESSAGE_TOO_LONG_FOR_TRANSLATION', error.message, 400);
    throw new AppError(
      'TRANSLATION_FAILED',
      `${error.message} Your English message is unchanged and nothing was saved. You can retry, write the translation yourself, or use a clearly labelled demo draft.`,
      502,
      { retry_available: true, fallback_available: !useDemo, provider_code: error.code },
    );
  }

  const saved = await applyTranslation(db, merchantId, campaignId, {
    expected_version: campaign.version,
    text,
    meta,
    inTransaction: () => recordProviderOperation(db, {
      provider, operation: 'translate', status: meta.source === 'sarvam' ? 'ok' : 'fallback', request_fingerprint: requestFingerprint,
    }),
  }, now, actorId);
  return { ...saved, translation_result: outcomeFrom(meta, false) };
}
