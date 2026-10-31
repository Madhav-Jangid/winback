import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return { ...actual, connection: async () => undefined };
});

vi.mock('@/lib/db/pool', () => ({ getPool: () => ({ query: fake.query }) }));

const route = await import('./route');

function get(url: string) {
  return route.GET(new NextRequest(new URL(url, 'http://localhost')));
}

describe('GET /api/audit', () => {
  beforeEach(() => {
    fake.query.mockReset();
    fake.query.mockImplementation(async (sql: string) => sql.includes('COUNT(*)')
      ? { rows: [{ count: '1' }], rowCount: 1 }
      : { rows: [{ id: 'event-1', event_type: 'campaign_created', entity_type: 'campaign' }], rowCount: 1 });
  });

  it('returns paged audit rows without exposing entity ids or arbitrary personal metadata', async () => {
    const response = await get('/api/audit?page=1&limit=25&event_type=campaign_created');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      events: [{ id: 'event-1', event_type: 'campaign_created' }],
      total: 1,
      page: 1,
      limit: 25,
    });
    expect(fake.query).toHaveBeenCalledTimes(2);
    expect(fake.query.mock.calls[0][0]).toContain('ae.event_type = $3');
    expect(fake.query.mock.calls[1][0]).toContain('event_type = $3');
  });

  it('rejects invalid event filters, campaign ids, and pagination before querying', async () => {
    for (const url of [
      '/api/audit?event_type=not_a_real_event',
      '/api/audit?campaign_id=not-a-uuid',
      '/api/audit?page=0',
      '/api/audit?limit=500',
    ]) {
      const response = await get(url);
      expect(response.status).toBe(400);
    }
    expect(fake.query).not.toHaveBeenCalled();
  });
});
