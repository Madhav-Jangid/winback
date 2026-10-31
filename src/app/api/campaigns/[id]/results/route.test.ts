import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CAMPAIGN_ID } from '@/test/fixtures/campaign-record';
import { AppError } from '@/lib/errors';

const fake = vi.hoisted(() => ({ getResults: vi.fn(), getPool: vi.fn(() => ({})) }));

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return { ...actual, connection: async () => undefined };
});

vi.mock('@/lib/db/pool', () => ({ getPool: fake.getPool }));
vi.mock('@/lib/metrics/service', () => ({ getCampaignResults: fake.getResults }));

const route = await import('./route');

function get(id = CAMPAIGN_ID) {
  return route.GET(
    new NextRequest(new URL(`/api/campaigns/${id}/results`, 'http://localhost')),
    { params: Promise.resolve({ id }) },
  );
}

describe('GET /api/campaigns/:id/results', () => {
  beforeEach(() => {
    fake.getResults.mockReset();
    fake.getPool.mockClear();
  });

  it('returns the persisted campaign result view', async () => {
    const results = {
      campaign_id: CAMPAIGN_ID,
      campaign_name: 'September check-in',
      campaign_status: 'completed',
      is_simulated: true,
    };
    fake.getResults.mockResolvedValue(results);

    const response = await get();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(results);
    expect(fake.getResults).toHaveBeenCalledWith({}, expect.any(String), CAMPAIGN_ID);
  });

  it('returns not found for malformed campaign ids before querying', async () => {
    const response = await get('invalid');

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(fake.getPool).not.toHaveBeenCalled();
    expect(fake.getResults).not.toHaveBeenCalled();
  });

  it('returns explicit service errors when results are unavailable', async () => {
    fake.getResults.mockRejectedValue(new AppError('RESULTS_NOT_AVAILABLE', 'Complete the outcome run first.', 409));

    const response = await get();

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'RESULTS_NOT_AVAILABLE' } });
  });
});
