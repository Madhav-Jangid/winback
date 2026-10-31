import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CAMPAIGN_ID } from '@/test/fixtures/campaign-record';
import { AppError } from '@/lib/errors';

const fake = vi.hoisted(() => ({ simulate: vi.fn(), released: 0 }));

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return { ...actual, connection: async () => undefined };
});

vi.mock('@/lib/db/pool', () => ({
  getPool: () => ({
    connect: async () => ({
      query: async () => ({ rows: [], rowCount: 0 }),
      release: () => { fake.released += 1; },
    }),
  }),
}));

vi.mock('@/lib/simulation/outcomes-service', () => ({
  simulateCampaignOutcomes: fake.simulate,
}));

const route = await import('./route');

function post(id = CAMPAIGN_ID) {
  return route.POST(
    new NextRequest(new URL(`/api/campaigns/${id}/simulate-outcomes`, 'http://localhost'), { method: 'POST' }),
    { params: Promise.resolve({ id }) },
  );
}

describe('POST /api/campaigns/:id/simulate-outcomes', () => {
  beforeEach(() => {
    fake.simulate.mockReset();
    fake.released = 0;
  });

  it('runs the deterministic simulation and releases the database connection', async () => {
    fake.simulate.mockResolvedValue({ status: 'completed', created: 12, already_completed: false, simulated: true });
    const response = await post();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ created: 12, simulated: true });
    expect(fake.simulate).toHaveBeenCalledOnce();
    expect(fake.released).toBe(1);
  });

  it('rejects malformed campaign ids before opening a database connection', async () => {
    const response = await post('invalid');
    expect(response.status).toBe(404);
    expect(fake.simulate).not.toHaveBeenCalled();
    expect(fake.released).toBe(0);
  });

  it('returns explicit service errors without a success-shaped response', async () => {
    fake.simulate.mockRejectedValue(new AppError('INVALID_STATE', 'Campaign must be sent.', 409));
    const response = await post();
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'INVALID_STATE' } });
    expect(fake.released).toBe(1);
  });
});
