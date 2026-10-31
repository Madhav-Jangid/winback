import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/errors';

type FakeFn = (...args: unknown[]) => Promise<unknown>;
const fake = vi.hoisted(() => ({ approve: (async () => undefined) as FakeFn, calls: [] as unknown[][], released: 0 }));

vi.mock('@/lib/db/pool', () => ({ getPool: () => ({ connect: async () => ({ release: () => { fake.released += 1; } }) }) }));
vi.mock('@/lib/clock', () => ({ getAppNow: () => new Date('2026-10-01T00:00:00Z') }));
vi.mock('@/lib/approvals/service', () => ({
  approveCampaign: (...args: unknown[]) => { fake.calls.push(args); return fake.approve(...args); },
}));

const route = await import('./route');
const ID = '30000000-0000-4000-8000-000000000001';
const post = (body?: string, id = ID) =>
  route.POST(
    new NextRequest(new URL(`/api/campaigns/${id}/approve`, 'http://localhost'), { method: 'POST', body, headers: { 'content-type': 'application/json' } }),
    { params: Promise.resolve({ id }) },
  );

beforeEach(() => {
  fake.calls = [];
  fake.released = 0;
  fake.approve = async () => ({ approval: { state: 'approved' } });
});

describe('POST /api/campaigns/:id/approve', () => {
  it('passes the body to the service, which decides everything, and releases the connection', async () => {
    const res = await post(JSON.stringify({ expected_version: 3 }));
    expect(res.status).toBe(200);
    expect(fake.calls[0][3]).toEqual({ expected_version: 3 });
    expect(fake.released).toBe(1);
  });

  it('returns 404 for a malformed id, 400 for bad JSON, 413 for oversized bodies, all before the service', async () => {
    expect((await post('{}', 'nope')).status).toBe(404);
    expect((await post('{oops')).status).toBe(400);
    expect((await post(JSON.stringify({ x: 'y'.repeat(40_000) }))).status).toBe(413);
    expect((await post(undefined)).status).toBe(400); // approval needs an explicit body
    expect(fake.calls).toHaveLength(0);
  });

  it('maps readiness and version failures to typed 409s with details', async () => {
    fake.approve = async () => { throw new AppError('CAMPAIGN_NOT_READY', 'Fix the issues.', 409, { issues: [{ code: 'MESSAGE_REQUIRED' }] }); };
    const res = await post(JSON.stringify({ expected_version: 1 }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatchObject({ code: 'CAMPAIGN_NOT_READY', details: { issues: [{ code: 'MESSAGE_REQUIRED' }] } });
    expect(fake.released).toBe(1);
  });

  it('hides unexpected errors behind a 503', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fake.approve = async () => { throw new Error('relation "campaign_recipients" does not exist'); };
    const res = await post(JSON.stringify({ expected_version: 1 }));
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain('relation');
  });
});
