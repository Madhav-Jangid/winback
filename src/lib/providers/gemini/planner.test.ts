import { describe, expect, it } from 'vitest';
import { PlannerError } from '@/lib/planner/types';
import { DEMO_CUSTOMERS } from '@/lib/demo/seed-data';
import { makePlanInput, VALID_PLAN } from '@/test/fixtures/plan-input';
import { DEFAULT_GEMINI_MODEL, GeminiCampaignPlanner } from './planner';

const API_KEY = 'test-key-SECRET-123';
const input = makePlanInput();

const geminiReply = (text: string, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }], ...extra }), { status: 200 });

interface Call { url: string; headers: Record<string, string>; body: string }

/** A fake fetch that answers from a queue and records each call. Plain function, not vi.fn. */
function fakeFetch(answers: Array<Response | Error>) {
  const calls: Call[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), headers: init?.headers as Record<string, string>, body: String(init?.body) });
    const next = answers[Math.min(calls.length - 1, answers.length - 1)];
    if (next instanceof Error) throw next;
    return next.clone();
  }) as typeof fetch;
  return { impl, calls };
}

const planner = (answers: Array<Response | Error>, options: { timeoutMs?: number; model?: string } = {}) => {
  const f = fakeFetch(answers);
  return { planner: new GeminiCampaignPlanner({ apiKey: API_KEY, fetchImpl: f.impl, ...options }), calls: f.calls };
};

const rejection = async (p: Promise<unknown>): Promise<PlannerError> => {
  try {
    await p;
  } catch (error) {
    if (error instanceof PlannerError) return error;
    throw error;
  }
  throw new Error('expected a PlannerError');
};

describe('Gemini planner', () => {
  it('AI-01: maps a valid response to a labelled Gemini plan', async () => {
    const { planner: p, calls } = planner([geminiReply(JSON.stringify(VALID_PLAN))]);
    const plan = await p.generatePlan(input);
    expect(plan).toMatchObject({ source: 'gemini', model: DEFAULT_GEMINI_MODEL, fallback_reason: null, offer: VALID_PLAN.offer });
    expect(calls).toHaveLength(1);
  });

  it('sends the key in a header only, to the configured model', async () => {
    const { planner: p, calls } = planner([geminiReply(JSON.stringify(VALID_PLAN))], { model: 'gemini-3.8-flash' });
    await p.generatePlan(input);
    expect(calls[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
    expect(calls[0].url).not.toContain(API_KEY);
    expect(calls[0].headers['x-goog-api-key']).toBe(API_KEY);
    expect(calls[0].body).not.toContain(API_KEY);
  });

  it('AI-07: the request contains no customer data', async () => {
    const { planner: p, calls } = planner([geminiReply(JSON.stringify(VALID_PLAN))]);
    await p.generatePlan(input);
    for (const customer of DEMO_CUSTOMERS) expect(calls[0].body).not.toContain(customer.name);
    const prompt = JSON.parse(calls[0].body).contents[0].parts[0].text as string;
    expect(prompt).toContain('"eligible":12');
  });

  it('accepts JSON wrapped in a code fence', async () => {
    const { planner: p } = planner([geminiReply('```json\n' + JSON.stringify(VALID_PLAN) + '\n```')]);
    expect((await p.generatePlan(input)).source).toBe('gemini');
  });

  it('AI-02: malformed JSON is retried exactly once, then fails', async () => {
    const { planner: p, calls } = planner([geminiReply('{not json'), geminiReply('still {not json')]);
    const error = await rejection(p.generatePlan(input));
    expect(error.code).toBe('PLANNER_INVALID_RESPONSE');
    expect(calls).toHaveLength(2);
  });

  it('retries once with the rejection reason, and uses the corrected answer', async () => {
    const bad = { ...VALID_PLAN, offer: { type: 'cashback', percent: 10 } };
    const { planner: p, calls } = planner([geminiReply(JSON.stringify(bad)), geminiReply(JSON.stringify(VALID_PLAN))]);
    expect((await p.generatePlan(input)).source).toBe('gemini');
    expect(calls).toHaveLength(2);
    expect(calls[0].body).not.toContain('previous answer was rejected');
    expect(calls[1].body).toContain('previous answer was rejected');
    expect(calls[1].body).toContain('cashback');
  });

  it('AI-03 / AI-04: a plan that keeps breaking the rules is rejected after the retry', async () => {
    const unsupported = geminiReply(JSON.stringify({ ...VALID_PLAN, offer: { type: 'cashback', percent: 10 } }));
    const expensive = geminiReply(JSON.stringify({ ...VALID_PLAN, offer: { type: 'fixed_discount', amount_minor: 90_000 }, message_draft: 'Enjoy ₹900 off your next order.' }));
    expect((await rejection(planner([unsupported]).planner.generatePlan(input))).code).toBe('PLANNER_INVALID_RESPONSE');
    expect((await rejection(planner([expensive]).planner.generatePlan(input))).code).toBe('PLANNER_INVALID_RESPONSE');
  });

  it('AI-06: a timeout is a recoverable PLANNER_TIMEOUT, with no retry', async () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    const { planner: p, calls } = planner([timeout]);
    const error = await rejection(p.generatePlan(input));
    expect(error.code).toBe('PLANNER_TIMEOUT');
    expect(calls).toHaveLength(1);
  });

  it('enforces a real timeout when the provider never answers', async () => {
    const hang = (async (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      })) as typeof fetch;
    const slow = new GeminiCampaignPlanner({ apiKey: API_KEY, fetchImpl: hang, timeoutMs: 30 });
    expect((await rejection(slow.generatePlan(input))).code).toBe('PLANNER_TIMEOUT');
  });

  it.each([
    [500, /HTTP 500/],
    [429, /rate limit/],
    [403, /check GEMINI_API_KEY/],
  ])('HTTP %i is reported by status only, without the response body', async (status, message) => {
    const body = `upstream said: key ${API_KEY} was rejected`;
    const { planner: p, calls } = planner([new Response(body, { status })]);
    const error = await rejection(p.generatePlan(input));
    expect(error.code).toBe('PLANNER_HTTP_ERROR');
    expect(error.message).toMatch(message);
    expect(error.message).not.toContain(API_KEY);
    expect(error.message).not.toContain('upstream said');
    expect(calls).toHaveLength(1);
  });

  it('reports network failures without details', async () => {
    const { planner: p } = planner([new TypeError(`fetch failed for ${API_KEY}`)]);
    const error = await rejection(p.generatePlan(input));
    expect(error.code).toBe('PLANNER_NETWORK_ERROR');
    expect(error.message).not.toContain(API_KEY);
  });

  it('reports a blocked prompt and an unreadable response', async () => {
    const blocked = new Response(JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } }), { status: 200 });
    expect((await rejection(planner([blocked]).planner.generatePlan(input))).code).toBe('PLANNER_BLOCKED');
    expect((await rejection(planner([new Response('<html>', { status: 200 })]).planner.generatePlan(input))).code).toBe('PLANNER_INVALID_RESPONSE');
  });

  it('an empty answer counts as invalid and is retried once', async () => {
    const { planner: p, calls } = planner([geminiReply(''), geminiReply('')]);
    expect((await rejection(p.generatePlan(input))).code).toBe('PLANNER_INVALID_RESPONSE');
    expect(calls).toHaveLength(2);
  });
});
