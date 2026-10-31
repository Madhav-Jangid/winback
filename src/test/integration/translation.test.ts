import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cancelCampaign, createCampaign, getCampaignView, updateCampaign } from '@/lib/campaigns/service';
import { DEMO_MERCHANT_ID, DEMO_REFERENCE_DATE } from '@/lib/demo/constants';
import { resetDemoData } from '@/lib/demo/seed';
import { translateCampaign } from '@/lib/localization/service';
import { TranslatorError, type TranslationInput, type TranslationResult } from '@/lib/localization/types';
import { selectTranslator, type TranslatorSelection } from '@/lib/providers/factory';
import { VALID_DRAFT, VALID_LOCALIZED } from '@/test/fixtures/campaign';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '@/test/helpers/test-db';

const NOW = DEMO_REFERENCE_DATE;
const M = DEMO_MERCHANT_ID;
const ENGLISH = VALID_DRAFT.original_message;

const sarvamResult = (text = VALID_LOCALIZED): TranslationResult => ({ translated_text: text, source: 'sarvam', model: 'mayura:v1', fallback_reason: null });

/** Translator stand-in that records its input. Plain object, not vi.fn. */
function fakeTranslator(behaviour: (input: TranslationInput) => Promise<TranslationResult>): { selection: TranslatorSelection; inputs: TranslationInput[] } {
  const inputs: TranslationInput[] = [];
  return { inputs, selection: { live: true, translator: { translate: async (input) => { inputs.push(input); return behaviour(input); } } } };
}

describe.skipIf(!TEST_DATABASE_URL)('campaign translation (integration)', () => {
  let t: TestDatabase;

  /** A Hindi campaign with an English message and no Hindi text yet. */
  const create = (overrides: Record<string, unknown> = {}) => createCampaign(t.db, M, { ...VALID_DRAFT, localized_message: '', ...overrides }, NOW, 'test');
  const translate = (id: string, body: unknown, selection: TranslatorSelection) => translateCampaign(t.db, M, id, body, NOW, 'test', selection);
  const view = (id: string) => getCampaignView(t.db, M, id, NOW);
  const audit = async (id: string) =>
    (await t.db.query<{ event_type: string; metadata: Record<string, unknown> }>(
      'SELECT event_type, metadata FROM audit_events WHERE campaign_id = $1 ORDER BY created_at, id', [id])).rows.map((r) => r.event_type);
  const lastOperation = async () =>
    (await t.db.query<{ provider: string; operation: string; status: string; error_code: string | null }>(
      'SELECT provider, operation, status, error_code FROM provider_operations ORDER BY created_at DESC, id DESC LIMIT 1')).rows[0];

  beforeAll(async () => {
    t = await createTestDatabase();
    await resetDemoData(t.db, 'test');
  });
  afterAll(async () => t?.cleanup());

  it('SA-01: translates, saves the text with its provenance as a new version, and leaves the English untouched', async () => {
    const draft = await create();
    expect(draft.campaign.status).toBe('draft');
    expect(draft.readiness.map((r) => r.code)).toEqual(['TRANSLATION_REQUIRED']);

    const { selection, inputs } = fakeTranslator(async () => sarvamResult());
    const result = await translate(draft.campaign.id, {}, selection);

    expect(inputs).toEqual([{ text: ENGLISH, target_language: 'hi' }]); // only the message and the language
    expect(result.translation_result).toMatchObject({ cached: false, source: 'sarvam', model: 'mayura:v1', warnings: [] });
    expect(result.campaign).toMatchObject({
      original_message: ENGLISH, localized_message: VALID_LOCALIZED, version: 2, status: 'ready_for_approval',
      translation: { source: 'sarvam', model: 'mayura:v1', language: 'hi', source_text: ENGLISH, edited: false },
    });
    expect(result.translation_state).toBe('ready');
    expect(result.readiness).toEqual([]);
    expect(await audit(draft.campaign.id)).toEqual(['campaign_created', 'translation_requested', 'translation_completed']);
    expect(await lastOperation()).toEqual({ provider: 'sarvam', operation: 'translate', status: 'ok', error_code: null });
  });

  it('SA-02: a provider failure saves nothing, keeps the English, and offers retry and the demo draft', async () => {
    const draft = await create();
    const failing = fakeTranslator(async () => { throw new TranslatorError('TRANSLATOR_TIMEOUT', 'Sarvam did not respond within 20 seconds.'); });
    await expect(translate(draft.campaign.id, {}, failing.selection)).rejects.toMatchObject({
      code: 'TRANSLATION_FAILED', status: 502,
      details: { retry_available: true, fallback_available: true, provider_code: 'TRANSLATOR_TIMEOUT' },
      message: expect.stringContaining('nothing was saved'),
    });
    const after = await view(draft.campaign.id);
    expect(after.campaign).toMatchObject({ version: 1, original_message: ENGLISH, localized_message: '', translation: null });
    expect(await audit(draft.campaign.id)).toEqual(['campaign_created', 'translation_requested', 'translation_failed']);
    expect(await lastOperation()).toMatchObject({ provider: 'sarvam', status: 'error', error_code: 'TRANSLATOR_TIMEOUT' });

    // The retry is a plain second request.
    const retry = await translate(draft.campaign.id, {}, fakeTranslator(async () => sarvamResult()).selection);
    expect(retry.campaign).toMatchObject({ localized_message: VALID_LOCALIZED, version: 2 });
  });

  it('SA-04: with no key a labelled demo translation is saved, never labelled Sarvam, and needs review', async () => {
    const draft = await create();
    const result = await translate(draft.campaign.id, {}, selectTranslator({ SARVAM_API_KEY: undefined, SARVAM_MODEL: undefined }));
    expect(result.translation_result).toMatchObject({ source: 'demo_fallback', model: null });
    expect(result.translation_result.fallback_reason).toMatch(/SARVAM_API_KEY is not configured/);
    expect(result.translation_result.warnings[0]).toMatch(/not a translation/);
    expect(result.campaign.localized_message).toBe(ENGLISH);
    expect(result.campaign.translation).toMatchObject({ source: 'demo_fallback', edited: false });
    expect(result.readiness.map((r) => r.code)).toEqual(['TRANSLATION_NEEDS_REVIEW']);
    expect(result.campaign.status).toBe('draft');
    expect(await lastOperation()).toMatchObject({ provider: 'demo', status: 'fallback' });
  });

  it('use_demo after a failure returns the labelled demo draft without calling the live provider', async () => {
    const draft = await create();
    const neverCalled = fakeTranslator(async () => { throw new Error('the live translator must not be used'); });
    const result = await translate(draft.campaign.id, { use_demo: true }, neverCalled.selection);
    expect(neverCalled.inputs).toHaveLength(0);
    expect(result.translation_result).toMatchObject({ source: 'demo_fallback' });
    expect(result.translation_result.fallback_reason).toMatch(/chose the demo draft/);
  });

  it('E-16: a translation that changes the offer numbers is saved but blocked until the merchant reviews it', async () => {
    const draft = await create();
    const wrong = 'हम आपको याद करते हैं! अपने अगले ऑर्डर पर 15% की छूट (₹100 तक) पाएं।';
    const result = await translate(draft.campaign.id, {}, fakeTranslator(async () => sarvamResult(wrong)).selection);
    expect(result.translation_result.warnings).toEqual([expect.stringMatching(/missing 10; unexpected 15/)]);
    expect(result.campaign.status).toBe('draft');
    expect(result.readiness.map((r) => r.code)).toEqual(['TRANSLATION_NEEDS_REVIEW']);

    // SA-05: the merchant corrects the text. The edit is a new version, marks it reviewed, keeps its origin.
    const fixed = await updateCampaign(t.db, M, draft.campaign.id, { localized_message: VALID_LOCALIZED, expected_version: 2 }, NOW, 'test');
    expect(fixed.campaign).toMatchObject({ version: 3, status: 'ready_for_approval', translation: { source: 'sarvam', model: 'mayura:v1', edited: true } });
    expect(fixed.readiness).toEqual([]);
  });

  it('SA-05: editing the translated text bumps the version and invalidates a previous approval', async () => {
    const created = await create({ localized_message: VALID_LOCALIZED });
    await t.db.query(`UPDATE campaigns SET status = 'approved', approved_version = 1, approved_by = 'demo-merchant', approved_at = NOW() WHERE id = $1`, [created.campaign.id]);
    const edited = await updateCampaign(t.db, M, created.campaign.id, { localized_message: `${VALID_LOCALIZED} धन्यवाद!`, expected_version: 1 }, NOW, 'test');
    expect(edited.campaign).toMatchObject({ version: 2, status: 'ready_for_approval', approved_version: null, approved_by: null });
    expect(await audit(created.campaign.id)).toContain('approval_invalidated');
  });

  it('a current translation is not requested again, and re-translating needs force', async () => {
    const draft = await create();
    await translate(draft.campaign.id, {}, fakeTranslator(async () => sarvamResult()).selection);

    const second = fakeTranslator(async () => sarvamResult('दूसरा अनुवाद 10% ₹100'));
    const cached = await translate(draft.campaign.id, {}, second.selection);
    expect(second.inputs).toHaveLength(0);
    expect(cached.translation_result).toMatchObject({ cached: true, source: 'sarvam' });
    expect(cached.campaign.version).toBe(2);

    const forced = await translate(draft.campaign.id, { force: true }, second.selection);
    expect(second.inputs).toHaveLength(1);
    expect(forced.campaign).toMatchObject({ version: 3, localized_message: 'दूसरा अनुवाद 10% ₹100' });
  });

  it('changing the English message makes the translation stale, and translating again refreshes it', async () => {
    const draft = await create();
    await translate(draft.campaign.id, {}, fakeTranslator(async () => sarvamResult()).selection);
    const newEnglish = 'Come back soon! Enjoy 10% off (up to ₹100).';
    const stale = await updateCampaign(t.db, M, draft.campaign.id, { original_message: newEnglish, expected_version: 2 }, NOW, 'test');
    expect(stale.translation_state).toBe('stale');
    expect(stale.campaign.status).toBe('draft');
    expect(stale.readiness.map((r) => r.code)).toEqual(['TRANSLATION_STALE']);

    const fresh = fakeTranslator(async () => sarvamResult('जल्दी आइए! 10% छूट (₹100 तक)'));
    const result = await translate(draft.campaign.id, {}, fresh.selection); // stale is not "ready": no force needed
    expect(fresh.inputs).toEqual([{ text: newEnglish, target_language: 'hi' }]);
    expect(result.campaign.translation).toMatchObject({ source_text: newEnglish, edited: false });
    expect(result.translation_state).toBe('ready');
  });

  it('saving the translated text after the English changed confirms it, ending the stale state', async () => {
    const draft = await create({ localized_message: VALID_LOCALIZED });
    const stale = await updateCampaign(t.db, M, draft.campaign.id, { original_message: 'A different English message with 10% and ₹100', expected_version: 1 }, NOW, 'test');
    expect(stale.translation_state).toBe('stale');
    const confirmed = await updateCampaign(t.db, M, draft.campaign.id, { localized_message: `${VALID_LOCALIZED} `, expected_version: 2 }, NOW, 'test');
    expect(confirmed.translation_state).toBe('ready');
    expect(confirmed.campaign.translation).toMatchObject({ source_text: 'A different English message with 10% and ₹100', edited: true });
  });

  it('clearing the translated text removes its provenance', async () => {
    const draft = await create({ localized_message: VALID_LOCALIZED });
    const cleared = await updateCampaign(t.db, M, draft.campaign.id, { localized_message: '', expected_version: 1 }, NOW, 'test');
    expect(cleared.campaign).toMatchObject({ localized_message: '', translation: null });
    expect(cleared.translation_state).toBe('missing');
  });

  it('translating invalidates an existing approval, like any other material edit', async () => {
    const draft = await create({ localized_message: VALID_LOCALIZED });
    await t.db.query(`UPDATE campaigns SET status = 'approved', approved_version = 1, approved_by = 'demo-merchant', approved_at = NOW() WHERE id = $1`, [draft.campaign.id]);
    const result = await translate(draft.campaign.id, { force: true }, fakeTranslator(async () => sarvamResult()).selection);
    expect(result.campaign).toMatchObject({ version: 2, approved_version: null, status: 'ready_for_approval' });
    expect(await audit(draft.campaign.id)).toContain('approval_invalidated');
  });

  it('saves nothing if the campaign changed while the provider was working', async () => {
    const draft = await create();
    const racing = fakeTranslator(async () => {
      await updateCampaign(t.db, M, draft.campaign.id, { budget_minor: 250_000, expected_version: 1 }, NOW, 'test');
      return sarvamResult();
    });
    await expect(translate(draft.campaign.id, {}, racing.selection)).rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 });
    expect((await view(draft.campaign.id)).campaign).toMatchObject({ version: 2, localized_message: '', translation: null });
  });

  it('refuses English campaigns, missing messages, unsupported languages, and locked campaigns', async () => {
    const planner = fakeTranslator(async () => sarvamResult());
    const english = await create({ language: 'en' });
    await expect(translate(english.campaign.id, {}, planner.selection)).rejects.toMatchObject({ code: 'TRANSLATION_NOT_NEEDED', status: 409 });

    const empty = await create({ original_message: '' });
    await expect(translate(empty.campaign.id, {}, planner.selection)).rejects.toMatchObject({ code: 'MESSAGE_REQUIRED', status: 400 });

    const french = await create();
    await t.db.query(`UPDATE campaigns SET language = 'fr' WHERE id = $1`, [french.campaign.id]);
    await expect(translate(french.campaign.id, {}, planner.selection)).rejects.toMatchObject({ code: 'UNSUPPORTED_LANGUAGE', status: 400 });

    const locked = await create();
    await cancelCampaign(t.db, M, locked.campaign.id, NOW, 'test');
    await expect(translate(locked.campaign.id, {}, planner.selection)).rejects.toMatchObject({ code: 'CAMPAIGN_LOCKED', status: 409 });

    expect(planner.inputs).toHaveLength(0);
  });

  it('maps provider-side input problems to 400s without offering the fallback', async () => {
    const draft = await create();
    const tooLong = fakeTranslator(async () => { throw new TranslatorError('TRANSLATOR_TEXT_TOO_LONG', 'The message is 2100 characters.'); });
    await expect(translate(draft.campaign.id, {}, tooLong.selection)).rejects.toMatchObject({ code: 'MESSAGE_TOO_LONG_FOR_TRANSLATION', status: 400 });
    const unsupported = fakeTranslator(async () => { throw new TranslatorError('TRANSLATOR_UNSUPPORTED_LANGUAGE', 'Not available.'); });
    await expect(translate(draft.campaign.id, {}, unsupported.selection)).rejects.toMatchObject({ code: 'UNSUPPORTED_LANGUAGE', status: 400 });
  });

  it('rejects an empty provider answer without saving it', async () => {
    const draft = await create();
    await expect(translate(draft.campaign.id, {}, fakeTranslator(async () => sarvamResult('   ')).selection))
      .rejects.toMatchObject({ code: 'TRANSLATION_FAILED', details: { provider_code: 'TRANSLATOR_INVALID_RESPONSE' } });
    expect((await view(draft.campaign.id)).campaign.localized_message).toBe('');
  });

  it('validates the request, and does not hide unexpected errors', async () => {
    const draft = await create();
    const planner = fakeTranslator(async () => sarvamResult());
    await expect(translate(draft.campaign.id, { force: 'yes' }, planner.selection)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(translate(draft.campaign.id, { surprise: 1 }, planner.selection)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(translate('30000000-0000-4000-8000-0000000000ff', {}, planner.selection)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(planner.inputs).toHaveLength(0);
    const broken = fakeTranslator(async () => { throw new Error('boom'); });
    await expect(translate(draft.campaign.id, {}, broken.selection)).rejects.toThrow('boom');
  });
});
