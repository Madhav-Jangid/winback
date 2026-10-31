import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomerDetail, CustomerDirectory } from '@/lib/customers/service';

// Plain stand-in functions rather than vi.fn(): Vitest 5 reports an error thrown by a vi.fn
// as a test failure in some setups, even when the route under test catches it.
type FakeFn = (...args: unknown[]) => Promise<unknown>;
const fake = vi.hoisted(() => ({
  directory: (async () => undefined) as FakeFn,
  detail: (async () => undefined) as FakeFn,
  calls: [] as unknown[][],
}));

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  connection: async () => undefined,
}));
vi.mock('@/lib/db/pool', () => ({ getPool: () => ({}) }));
vi.mock('@/lib/clock', () => ({ getAppNow: () => new Date('2026-10-01T00:00:00Z') }));
vi.mock('@/lib/customers/service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/customers/service')>()),
  getCustomerDirectory: (...args: unknown[]) => { fake.calls.push(args); return fake.directory(...args); },
  getCustomerDetail: (...args: unknown[]) => { fake.calls.push(args); return fake.detail(...args); },
}));

const service = await import('@/lib/customers/service');
const listRoute = await import('./route');
const detailRoute = await import('./[id]/route');

const get = (url: string) => new NextRequest(new URL(url, 'http://localhost'));
const detail = (id: string) => detailRoute.GET(get(`/api/customers/${id}`), { params: Promise.resolve({ id }) });

const emptyDirectory: CustomerDirectory = {
  merchant: null, policy: null, as_of: '2026-10-01T00:00:00.000Z', counts: service.countByFilter([]), customers: [], all: [],
};

beforeEach(() => {
  fake.calls = [];
  fake.directory = async () => emptyDirectory;
  fake.detail = async (): Promise<CustomerDetail | null> => null;
});

describe('GET /api/customers', () => {
  it('rejects an unknown filter with a typed 400', async () => {
    const res = await listRoute.GET(get('/api/customers?filter=everyone'));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
    expect(fake.calls).toHaveLength(0);
  });

  it('rejects an overlong search', async () => {
    const res = await listRoute.GET(get(`/api/customers?search=${'x'.repeat(101)}`));
    expect(res.status).toBe(400);
  });

  it('passes the validated query to the service', async () => {
    const res = await listRoute.GET(get('/api/customers?filter=at_risk&search=%20nair%20'));
    expect(res.status).toBe(200);
    expect(fake.calls[0][3]).toEqual({ filter: 'at_risk', search: 'nair' });
    expect(await res.json()).toMatchObject({ total: 0, query: { filter: 'at_risk', search: 'nair' } });
  });

  it('returns 503 without leaking database error details', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fake.directory = async () => {
      throw new Error('password authentication failed for user postgres');
    };
    const res = await listRoute.GET(get('/api/customers'));
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(text).toContain('DATABASE_ERROR');
    expect(text).not.toContain('password');
  });
});

describe('GET /api/customers/:id', () => {
  it('returns 404 for a malformed id without querying the database', async () => {
    const res = await detail('not-a-uuid');
    expect(res.status).toBe(404);
    expect(fake.calls).toHaveLength(0);
  });

  it('returns 404 when the customer does not exist for this merchant', async () => {
    const res = await detail('10000000-0000-4000-8000-000000000999');
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('NOT_FOUND');
    expect(fake.calls).toHaveLength(1);
  });
});
