import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/errors';

type FakeFn = (...args: unknown[]) => Promise<unknown>;
const fake = vi.hoisted(() => ({
  plan: (async () => undefined) as FakeFn,
  calls: [] as unknown[][],
  released: 0,
}));

vi.mock('@/lib/db/pool', () => ({ getPool: () => ({ connect: async () => ({ release: () => { fake.released += 1; } }) }) }));
vi.mock('@/lib/clock', () => ({ getAppNow: () => new Date('2026-10-01T00:00:00Z') }));
vi.mock('@/lib/planner/service', () => ({
  generateCampaignPlan: (...args: unknown[]) => { fake.calls.push(args); return fake.plan(...args); },
}));

const route = await import('./route');
const ID = '30000000-0000-4000-8000-000000000001';
const post = (body?: string, id = ID) =>
  route.POST(
    new NextRequest(new URL(`/api/campaigns/${id}/plan`, 'http://localhost'), { method: 'POST', body, headers: { 'content-type': 'application/json' } }),
    { params: Promise.resolve({ id }) },
  );

beforeEach(() => {
  fake.calls = [];
  fake.released = 0;
  fake.plan = async () => ({ plan: { source: 'gemini' } });
});

describe('POST /api/campaigns/:id/plan', () => {
  it('treats an empty body as no options', async () => {
    const res = await post(undefined);
    expect(res.status).toBe(200);
    expect(fake.calls[0][3]).toEqual({});
    expect(fake.released).toBe(1);
  });

  it('passes use_demo through to the service', async () => {
    await post(JSON.stringify({ use_demo: true }));
    expect(fake.calls[0][3]).toEqual({ use_demo: true });
  });

  it('returns 404 for a malformed id without touching the service', async () => {
    expect((await post('{}', 'nope')).status).toBe(404);
    expect(fake.calls).toHaveLength(0);
  });

  it('returns 400 for malformed JSON and 413 for oversized bodies', async () => {
    expect((await post('{oops')).status).toBe(400);
    expect((await post(JSON.stringify({ x: 'y'.repeat(40_000) }))).status).toBe(413);
    expect(fake.calls).toHaveLength(0);
  });

  it('maps a provider failure to 502 with the fallback hint and no internals', async () => {
    fake.plan = async () => { throw new AppError('PLAN_PROVIDER_FAILED', 'Gemini returned HTTP 500.', 502, { fallback_available: true, provider_code: 'PLANNER_HTTP_ERROR' }); };
    const res = await post('{}');
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: { code: 'PLAN_PROVIDER_FAILED', message: 'Gemini returned HTTP 500.', details: { fallback_available: true, provider_code: 'PLANNER_HTTP_ERROR' } } });
    expect(fake.released).toBe(1);
  });

  it('hides unexpected errors behind a 503', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fake.plan = async () => { throw new Error('relation "provider_operations" does not exist'); };
    const res = await post('{}');
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain('relation');
  });
});
