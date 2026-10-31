import { describe, expect, it } from 'vitest';
import { LANGUAGES } from '@/lib/campaigns/rules';
import { TranslatorError } from '@/lib/localization/types';
import { SARVAM_LANGUAGE_CODES, SARVAM_MODEL_LIMITS } from './languages';
import { resolveModel, SARVAM_TRANSLATE_URL, SarvamTranslator } from './translator';

const API_KEY = 'test-key-SECRET-456';
const HINDI = 'नमस्ते! हम आपको याद करते हैं।';
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const ok = (translated = HINDI) => reply({ request_id: 'req-1', translated_text: translated, source_language_code: 'en-IN' });

interface Call { url: string; headers: Record<string, string>; body: Record<string, unknown> }

/** A fake fetch answering from a queue and recording calls. Plain function, not vi.fn. */
function fakeFetch(answers: Array<Response | Error>) {
  const calls: Call[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) });
    const next = answers[Math.min(calls.length - 1, answers.length - 1)];
    if (next instanceof Error) throw next;
    return next.clone();
  }) as typeof fetch;
  return { impl, calls };
}

const translator = (answers: Array<Response | Error>, options: Partial<ConstructorParameters<typeof SarvamTranslator>[0]> = {}) => {
  const f = fakeFetch(answers);
  return { t: new SarvamTranslator({ apiKey: API_KEY, fetchImpl: f.impl, ...options }), calls: f.calls };
};

const failure = async (promise: Promise<unknown>): Promise<TranslatorError> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof TranslatorError) return error;
    throw error;
  }
  throw new Error('expected a TranslatorError');
};

describe('Sarvam translator', () => {
  it('SA-01: maps the response to translated text labelled Sarvam, with the model used', async () => {
    const { t } = translator([ok()]);
    expect(await t.translate({ text: 'We miss you!', target_language: 'hi' })).toEqual({
      translated_text: HINDI, source: 'sarvam', model: 'mayura:v1', fallback_reason: null,
    });
  });

  it('sends exactly the documented request, with the key in a header only', async () => {
    const { t, calls } = translator([ok()]);
    await t.translate({ text: 'Enjoy 10% off', target_language: 'ta' });
    expect(calls[0].url).toBe(SARVAM_TRANSLATE_URL);
    expect(SARVAM_TRANSLATE_URL).toBe('https://api.sarvam.ai/translate');
    expect(calls[0].headers['api-subscription-key']).toBe(API_KEY);
    expect(calls[0].body).toEqual({
      input: 'Enjoy 10% off', source_language_code: 'en-IN', target_language_code: 'ta-IN',
      model: 'mayura:v1', mode: 'formal', numerals_format: 'international',
    });
    expect(JSON.stringify(calls[0].body)).not.toContain(API_KEY);
    expect(calls[0].url).not.toContain(API_KEY);
  });

  it('submits only the message and language: no customer or campaign data', async () => {
    const { t, calls } = translator([ok()]);
    await t.translate({ text: 'Hello', target_language: 'hi' });
    expect(Object.keys(calls[0].body).sort()).toEqual(['input', 'mode', 'model', 'numerals_format', 'source_language_code', 'target_language_code']);
  });

  it('SA-03: rejects unsupported languages and English as a target, without calling Sarvam', async () => {
    const { t, calls } = translator([ok()]);
    for (const language of ['fr', 'xx', 'en', '']) {
      expect((await failure(t.translate({ text: 'Hello', target_language: language }))).code).toBe('TRANSLATOR_UNSUPPORTED_LANGUAGE');
    }
    expect(calls).toHaveLength(0);
  });

  it('supports every non-English campaign language', () => {
    for (const { code } of LANGUAGES) expect(SARVAM_LANGUAGE_CODES[code], code).toMatch(/^[a-z]{2}-IN$/);
  });

  it('uses the larger model when the text exceeds the configured model\'s limit, and records it', async () => {
    expect(resolveModel('mayura:v1', 1000)).toBe('mayura:v1');
    expect(resolveModel('mayura:v1', 1001)).toBe('sarvam-translate:v1');
    expect(resolveModel('sarvam-translate:v1', 2000)).toBe('sarvam-translate:v1');
    expect(() => resolveModel('mayura:v1', 2001)).toThrow(TranslatorError);
    expect(SARVAM_MODEL_LIMITS).toEqual({ 'mayura:v1': 1000, 'sarvam-translate:v1': 2000 });

    const { t, calls } = translator([ok()]);
    const result = await t.translate({ text: 'x'.repeat(1500), target_language: 'hi' });
    expect(calls[0].body.model).toBe('sarvam-translate:v1');
    expect(result.model).toBe('sarvam-translate:v1');
  });

  it('rejects text longer than any model accepts, without calling Sarvam', async () => {
    const { t, calls } = translator([ok()]);
    expect((await failure(t.translate({ text: 'x'.repeat(2001), target_language: 'hi' }))).code).toBe('TRANSLATOR_TEXT_TOO_LONG');
    expect(calls).toHaveLength(0);
  });

  it('SA-02: a timeout is a recoverable TRANSLATOR_TIMEOUT', async () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    expect((await failure(translator([timeout]).t.translate({ text: 'Hello', target_language: 'hi' }))).code).toBe('TRANSLATOR_TIMEOUT');
  });

  it('enforces a real timeout when Sarvam never answers', async () => {
    const hang = (async (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      })) as typeof fetch;
    const slow = new SarvamTranslator({ apiKey: API_KEY, fetchImpl: hang, timeoutMs: 30 });
    expect((await failure(slow.translate({ text: 'Hello', target_language: 'hi' }))).code).toBe('TRANSLATOR_TIMEOUT');
  });

  it.each([
    [403, { error: { code: 'invalid_api_key_error', message: `bad key ${API_KEY}` } }, /check SARVAM_API_KEY/],
    [429, { error: { code: 'insufficient_quota_error', message: 'upstream detail' } }, /quota exhausted/],
    [429, { error: { code: 'rate_limit_exceeded_error', message: 'upstream detail' } }, /rate limit/],
    [422, { error: { code: 'unprocessable_entity_error', message: 'upstream detail' } }, /could not translate this text/],
    [500, { error: { code: 'internal_server_error', message: 'upstream detail' } }, /HTTP 500/],
  ])('HTTP %i maps to a safe message that never echoes the provider\'s text', async (status, body, expected) => {
    const { t, calls } = translator([reply(body, status)]);
    const error = await failure(t.translate({ text: 'Hello', target_language: 'hi' }));
    expect(error.code).toBe('TRANSLATOR_HTTP_ERROR');
    expect(error.message).toMatch(expected);
    expect(error.message).not.toContain(API_KEY);
    expect(error.message).not.toContain('upstream detail');
    expect(calls).toHaveLength(1); // no automatic retry: the merchant decides
  });

  it('handles an unreadable error body, network failures, and malformed success bodies', async () => {
    const html = new Response('<html>', { status: 502 });
    expect((await failure(translator([html]).t.translate({ text: 'Hello', target_language: 'hi' }))).message).toMatch(/HTTP 502\./);

    const network = await failure(translator([new TypeError(`fetch failed ${API_KEY}`)]).t.translate({ text: 'Hello', target_language: 'hi' }));
    expect(network.code).toBe('TRANSLATOR_NETWORK_ERROR');
    expect(network.message).not.toContain(API_KEY);

    for (const body of [{ nope: true }, { translated_text: 5 }, 'not json']) {
      const res = typeof body === 'string' ? new Response(body, { status: 200 }) : reply(body);
      expect((await failure(translator([res]).t.translate({ text: 'Hello', target_language: 'hi' }))).code).toBe('TRANSLATOR_INVALID_RESPONSE');
    }
  });

  it('SA-02: a failure leaves nothing behind to overwrite the source copy: it only throws', async () => {
    const { t } = translator([new Error('x')]);
    const source = 'We miss you!';
    await expect(t.translate({ text: source, target_language: 'hi' })).rejects.toBeInstanceOf(TranslatorError);
    expect(source).toBe('We miss you!');
  });
});
