import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/errors';

// Plain stand-ins rather than vi.fn(): see src/app/api/customers/route.test.ts.
type FakeFn = (...args: unknown[]) => Promise<unknown>;
const fake = vi.hoisted(() => ({
  create: (async () => undefined) as FakeFn,
  preview: (async () => undefined) as FakeFn,
  calls: [] as unknown[][],
  released: 0,
}));

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  connection: async () => undefined,
}));
vi.mock('@/lib/db/pool', () => ({ getPool: () => ({ connect: async () => ({ release: () => { fake.released += 1; } }) }) }));
vi.mock('@/lib/clock', () => ({ getAppNow: () => new Date('2026-10-01T00:00:00Z') }));
vi.mock('@/lib/campaigns/service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/campaigns/service')>()),
  createCampaign: (...args: unknown[]) => { fake.calls.push(args); return fake.create(...args); },
  previewSegmentFor: (...args: unknown[]) => { fake.calls.push(args); return fake.preview(...args); },
}));

const campaigns = await import('./route');
const campaign = await import('./[id]/route');
const segmentPreview = await import('../segments/[id]/preview/route');

const post = (body: string, headers: Record<string, string> = {}) =>
  new NextRequest(new URL('/api/campaigns', 'http://localhost'), { method: 'POST', body, headers: { 'content-type': 'application/json', ...headers } });

beforeEach(() => {
  fake.calls = [];
  fake.released = 0;
  fake.create = async () => ({ campaign: { id: 'new' } });
  fake.preview = async () => ({ preview: { eligible: 3, eligible_customer_ids: ['a', 'b', 'c'] }, currency: 'INR' });
});

describe('POST /api/campaigns', () => {
  it('creates a campaign and releases the connection', async () => {
    const res = await campaigns.POST(post(JSON.stringify({ name: 'x' })));
    expect(res.status).toBe(201);
    expect(fake.calls[0][2]).toEqual({ name: 'x' });
    expect(fake.released).toBe(1);
  });

  it('returns a typed 400 for malformed JSON', async () => {
    const res = await campaigns.POST(post('{not json'));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('INVALID_JSON');
  });

  it('rejects oversized bodies with 413', async () => {
    const res = await campaigns.POST(post(JSON.stringify({ original_message: 'x'.repeat(40_000) })));
    expect(res.status).toBe(413);
    expect(fake.calls).toHaveLength(0);
  });

  it('passes validation errors through with field details', async () => {
    fake.create = async () => { throw new AppError('VALIDATION_ERROR', 'Some campaign fields are invalid.', 400, { fields: { 'offer.percent': 'Too high' } }); };
    const res = await campaigns.POST(post('{}'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: 'VALIDATION_ERROR', message: 'Some campaign fields are invalid.', details: { fields: { 'offer.percent': 'Too high' } } } });
    expect(fake.released).toBe(1);
  });

  it('hides unexpected errors behind a 503', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fake.create = async () => { throw new Error('relation "campaigns" does not exist'); };
    const res = await campaigns.POST(post('{}'));
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain('relation');
  });
});

describe('campaign routes: input checks', () => {
  it('GET /api/campaigns rejects an unknown status filter', async () => {
    const res = await campaigns.GET(new NextRequest(new URL('/api/campaigns?status=everything', 'http://localhost')));
    expect(res.status).toBe(400);
  });

  it('PATCH with a malformed id is a 404 without touching the database', async () => {
    const res = await campaign.PATCH(
      new NextRequest(new URL('/api/campaigns/nope', 'http://localhost'), { method: 'PATCH', body: '{}' }),
      { params: Promise.resolve({ id: 'nope' }) },
    );
    expect(res.status).toBe(404);
  });
});

describe('GET /api/segments/:segment/preview', () => {
  const call = (segment: string, qs: string) =>
    segmentPreview.GET(new NextRequest(new URL(`/api/segments/${segment}/preview?${qs}`, 'http://localhost')), { params: Promise.resolve({ id: segment }) });

  it('validates the segment and limits', async () => {
    expect((await call('vip', 'cooldown_days=30&frequency_cap=1')).status).toBe(400);
    expect((await call('at_risk', 'cooldown_days=0&frequency_cap=1')).status).toBe(400);
    expect((await call('at_risk', 'cooldown_days=30&frequency_cap=9')).status).toBe(400);
    expect(fake.calls).toHaveLength(0);
  });

  it('returns aggregate counts only, never customer ids', async () => {
    const res = await call('at_risk', 'cooldown_days=30&frequency_cap=1');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ eligible: 3, currency: 'INR' });
    expect(fake.calls[0][4]).toEqual({ cooldown_days: 30, frequency_cap: 1 });
  });
});
