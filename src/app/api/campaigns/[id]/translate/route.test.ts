import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/errors';

type FakeFn = (...args: unknown[]) => Promise<unknown>;
const fake = vi.hoisted(() => ({
  translate: (async () => undefined) as FakeFn,
  calls: [] as unknown[][],
  released: 0,
}));

vi.mock('@/lib/db/pool', () => ({ getPool: () => ({ connect: async () => ({ release: () => { fake.released += 1; } }) }) }));
vi.mock('@/lib/clock', () => ({ getAppNow: () => new Date('2026-10-01T00:00:00Z') }));
vi.mock('@/lib/localization/service', () => ({
  translateCampaign: (...args: unknown[]) => { fake.calls.push(args); return fake.translate(...args); },
}));

const route = await import('./route');
const ID = '30000000-0000-4000-8000-000000000001';
const post = (body?: string, id = ID) =>
  route.POST(
    new NextRequest(new URL(`/api/campaigns/${id}/translate`, 'http://localhost'), { method: 'POST', body, headers: { 'content-type': 'application/json' } }),
    { params: Promise.resolve({ id }) },
  );

beforeEach(() => {
  fake.calls = [];
  fake.released = 0;
  fake.translate = async () => ({ translation_result: { source: 'sarvam' } });
});

describe('POST /api/campaigns/:id/translate', () => {
  it('treats an empty body as no options and releases the connection', async () => {
    const res = await post(undefined);
    expect(res.status).toBe(200);
    expect(fake.calls[0][3]).toEqual({});
    expect(fake.released).toBe(1);
  });

  it('passes force and use_demo through', async () => {
    await post(JSON.stringify({ force: true, use_demo: true }));
    expect(fake.calls[0][3]).toEqual({ force: true, use_demo: true });
  });

  it('returns 404 for a malformed id, 400 for bad JSON, 413 for oversized bodies, all before the service', async () => {
    expect((await post('{}', 'nope')).status).toBe(404);
    expect((await post('{oops')).status).toBe(400);
    expect((await post(JSON.stringify({ x: 'y'.repeat(40_000) }))).status).toBe(413);
    expect(fake.calls).toHaveLength(0);
  });

  it('maps a provider failure to 502 with retry and fallback hints', async () => {
    fake.translate = async () => { throw new AppError('TRANSLATION_FAILED', 'Sarvam returned HTTP 500.', 502, { retry_available: true, fallback_available: true, provider_code: 'TRANSLATOR_HTTP_ERROR' }); };
    const res = await post('{}');
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatchObject({ code: 'TRANSLATION_FAILED', details: { retry_available: true, fallback_available: true } });
    expect(fake.released).toBe(1);
  });

  it('hides unexpected errors behind a 503', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fake.translate = async () => { throw new Error('relation "campaigns" does not exist'); };
    const res = await post('{}');
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain('relation');
  });
});
