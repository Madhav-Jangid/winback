import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type FakeFn = (...args: unknown[]) => Promise<unknown>;
const fake = vi.hoisted(() => ({ list: (async () => ({ items: [], total: 0 })) as FakeFn, calls: [] as unknown[][] }));

vi.mock('next/server', async (importOriginal) => ({ ...(await importOriginal<typeof import('next/server')>()), connection: async () => undefined }));
vi.mock('@/lib/db/pool', () => ({ getPool: () => ({}) }));
vi.mock('@/lib/approvals/service', () => ({
  getCampaignRecipients: (...args: unknown[]) => { fake.calls.push(args); return fake.list(...args); },
}));

const route = await import('./route');
const ID = '30000000-0000-4000-8000-000000000001';
const get = (qs = '', id = ID) =>
  route.GET(new NextRequest(new URL(`/api/campaigns/${id}/recipients?${qs}`, 'http://localhost')), { params: Promise.resolve({ id }) });

beforeEach(() => { fake.calls = []; });

describe('GET /api/campaigns/:id/recipients', () => {
  it('validates the filter and paging before touching the database', async () => {
    for (const qs of ['group=everyone', 'reason=MADE_UP', 'limit=0', 'limit=500', 'offset=-1']) {
      expect((await get(qs)).status, qs).toBe(400);
    }
    expect((await get('', 'nope')).status).toBe(404);
    expect(fake.calls).toHaveLength(0);
  });

  it('passes valid filters with defaults', async () => {
    expect((await get('group=control&reason=none')).status).toBe(200);
    expect(fake.calls[0][3]).toEqual({ group: 'control', reason: 'none', limit: 50, offset: 0 });
    await get('reason=FREQUENCY_CAP&limit=10&offset=20');
    expect(fake.calls[1][3]).toEqual({ reason: 'FREQUENCY_CAP', limit: 10, offset: 20 });
  });
});
