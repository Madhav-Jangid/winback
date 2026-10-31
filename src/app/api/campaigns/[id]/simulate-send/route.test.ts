import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeApprovedRecord, makeCampaignRecord, CAMPAIGN_ID } from '@/test/fixtures/campaign-record';
import type { CampaignRecord } from '@/lib/repositories/campaigns';
import type { MessageCounts, RecipientGroupRow } from '@/lib/repositories/messages';

const fake = vi.hoisted(() => ({
  campaign: null as unknown,
  queries: 0,
  groups: [] as RecipientGroupRow[],
  counts: { queued: 0, delivered: 0, failed: 0, retryable_failed: 0, reserved_minor: 0 } as MessageCounts,
  candidates: [] as string[],
}));

// Pool returns a client that records queries; also wires up FOR UPDATE (claim step)
vi.mock('@/lib/db/pool', () => ({
  getPool: () => ({
    connect: async () => ({
      query: async () => { fake.queries += 1; return { rows: [] }; },
      release: () => undefined,
    }),
    query: async () => { fake.queries += 1; return { rows: [] }; },
  }),
}));

vi.mock('@/lib/repositories/campaigns', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/repositories/campaigns')>()),
  getCampaign: async () => fake.campaign,
  setCampaignStatus: async () => undefined,
}));

vi.mock('@/lib/repositories/recipients', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/repositories/recipients')>()),
  listSendCandidates: async () => fake.candidates,
}));

vi.mock('@/lib/repositories/messages', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/repositories/messages')>()),
  getRecipientGroups: async () => fake.groups,
  getMessageCounts: async () => fake.counts,
  listFailedDeliveries: async () => [],
  listSendTimeSuppressions: async () => [],
  listRetryableFailed: async () => [],
  listQueued: async () => [],
  insertQueuedMessages: async () => undefined,
  suppressRecipients: async () => undefined,
  applyDeliveryResults: async () => undefined,
  requeueMessages: async () => undefined,
  markSuppressedOnRetry: async () => undefined,
}));

vi.mock('@/lib/audit/service', () => ({
  writeAuditEvent: async () => undefined,
  writeAuditEvents: async () => undefined,
}));

vi.mock('@/lib/customers/service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/customers/service')>()),
  getCustomerDirectory: async () => ({ all: [] }),
}));

const route = await import('./route');
const ID = CAMPAIGN_ID;
const post = (id = ID) =>
  route.POST(new NextRequest(new URL(`/api/campaigns/${id}/simulate-send`, 'http://localhost'), { method: 'POST' }), { params: Promise.resolve({ id }) });
const errorOf = async (res: Response) => (await res.json()).error as { code: string; message: string };

beforeEach(() => {
  fake.campaign = null;
  fake.queries = 0;
  fake.groups = [];
  fake.counts = { queued: 0, delivered: 0, failed: 0, retryable_failed: 0, reserved_minor: 0 };
  fake.candidates = [];
});

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

  it('SE-01: an approved campaign with no candidates completes immediately with zero counts', async () => {
    fake.campaign = makeApprovedRecord();
    // candidates = [], so the claim writes nothing and deliver runs over an empty queued list
    const res = await post();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.simulated).toBe(true);
    expect(body.delivered).toBe(0);
    expect(body.planned).toBe(0);
  });

  it('returns 404 for an unknown or malformed campaign id', async () => {
    expect((await post('nope')).status).toBe(404);
    fake.campaign = null;
    expect((await post()).status).toBe(404);
  });

  it('SE-05: returns 200 with SendProgress shape for an approved-and-sent campaign', async () => {
    fake.campaign = { ...makeApprovedRecord(), status: 'sent' } satisfies CampaignRecord;
    fake.groups = [{ group_assignment: 'treatment', suppression_reason: null, n: 5 }];
    fake.counts = { queued: 0, delivered: 5, failed: 0, retryable_failed: 0, reserved_minor: 0 };
    const res = await post();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ delivered: 5, state: 'sent', simulated: true });
  });
});
