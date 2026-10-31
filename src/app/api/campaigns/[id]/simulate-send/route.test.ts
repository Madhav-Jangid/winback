import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeApprovedRecord, makeCampaignRecord } from '@/test/fixtures/campaign-record';
import type { CampaignRecord } from '@/lib/repositories/campaigns';

const fake = vi.hoisted(() => ({ campaign: null as unknown, queries: 0 }));

vi.mock('@/lib/db/pool', () => ({ getPool: () => ({ query: async () => { fake.queries += 1; return { rows: [] }; } }) }));
vi.mock('@/lib/repositories/campaigns', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/repositories/campaigns')>()),
  getCampaign: async () => fake.campaign,
}));

const route = await import('./route');
const ID = '30000000-0000-4000-8000-0000000000aa';
const post = (id = ID) =>
  route.POST(new NextRequest(new URL(`/api/campaigns/${id}/simulate-send`, 'http://localhost'), { method: 'POST' }), { params: Promise.resolve({ id }) });
const errorOf = async (res: Response) => (await res.json()).error as { code: string; message: string };

beforeEach(() => { fake.campaign = null; fake.queries = 0; });

describe('POST /api/campaigns/:id/simulate-send: the send gate (CA-08)', () => {
  it('rejects a draft and a campaign awaiting approval, with the documented error', async () => {
    for (const status of ['draft', 'ready_for_approval'] as const) {
      fake.campaign = makeCampaignRecord({ status });
      const res = await post();
      expect(res.status).toBe(409);
      expect(await errorOf(res)).toEqual({ code: 'CAMPAIGN_APPROVAL_REQUIRED', message: 'Approve the current campaign version before simulating sends.' });
    }
  });

  it('rejects a stale approval and a cancelled campaign', async () => {
    fake.campaign = makeApprovedRecord({ version: 2, approved_version: 1 });
    expect((await errorOf(await post())).code).toBe('CAMPAIGN_APPROVAL_STALE');
    fake.campaign = { ...makeApprovedRecord(), status: 'cancelled' } satisfies CampaignRecord;
    expect((await errorOf(await post())).code).toBe('CAMPAIGN_CANCELLED');
  });

  it('a campaign that passes the gate is not sent: the send job is not built yet, so it gets 501', async () => {
    fake.campaign = makeApprovedRecord();
    const res = await post();
    expect(res.status).toBe(501);
    expect((await errorOf(res)).code).toBe('SEND_NOT_IMPLEMENTED');
    expect(fake.queries).toBe(0); // nothing was written
  });

  it('returns 404 for an unknown or malformed campaign id', async () => {
    expect((await post('nope')).status).toBe(404);
    fake.campaign = null;
    expect((await post()).status).toBe(404);
  });
});
