import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/errors';

type FakeFn = (...args: unknown[]) => Promise<unknown>;
const fake = vi.hoisted(() => ({ optOut: (async () => undefined) as FakeFn, calls: [] as unknown[][], released: 0 }));

vi.mock('@/lib/db/pool', () => ({ getPool: () => ({ connect: async () => ({ release: () => { fake.released += 1; } }) }) }));
vi.mock('@/lib/customers/consent', () => ({
  recordOptOut: (...args: unknown[]) => { fake.calls.push(args); return fake.optOut(...args); },
}));

const route = await import('./route');
const ID = '10000000-0000-4000-8000-000000000001';
const post = (id = ID) =>
  route.POST(new NextRequest(new URL(`/api/customers/${id}/opt-out`, 'http://localhost'), { method: 'POST' }), { params: Promise.resolve({ id }) });

beforeEach(() => { fake.calls = []; fake.released = 0; fake.optOut = async () => ({ already_opted_out: false }); });

describe('POST /api/customers/:id/opt-out', () => {
  it('records the opt-out for the demo merchant and releases the connection', async () => {
    expect((await post()).status).toBe(200);
    expect(fake.calls[0][2]).toBe(ID);
    expect(fake.released).toBe(1);
  });

  it('returns 404 for a malformed id without touching the service, and for an unknown customer', async () => {
    expect((await post('nope')).status).toBe(404);
    expect(fake.calls).toHaveLength(0);
    fake.optOut = async () => { throw new AppError('NOT_FOUND', 'Customer not found.', 404); };
    expect((await post()).status).toBe(404);
  });

  it('hides unexpected errors behind a 503', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fake.optOut = async () => { throw new Error('connection terminated'); };
    const res = await post();
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain('terminated');
  });
});
