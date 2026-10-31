import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Queryable } from '@/lib/db/types';
import { simulateCampaignOutcomes } from './outcomes-service';

const state = vi.hoisted(() => ({
  status: 'sent',
  outcomeInsertCount: 0,
  auditCount: 0,
}));

const campaignId = '00000000-0000-0000-0000-000000000001';
const merchantId = '00000000-0000-0000-0000-000000000002';

function database(): Queryable {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes('SELECT id, version, status FROM campaigns')) {
        return { rows: [{ id: campaignId, version: 2, status: state.status }], rowCount: 1 };
      }
      if (sql.includes('SELECT customer_id, group_assignment, eligibility_status')) {
        return {
          rows: [
            { customer_id: '00000000-0000-0000-0000-000000000010', group_assignment: 'treatment', eligibility_status: 'eligible' },
            { customer_id: '00000000-0000-0000-0000-000000000011', group_assignment: 'control', eligibility_status: 'eligible' },
          ],
          rowCount: 2,
        };
      }
      if (sql.includes('SELECT customer_id FROM campaign_messages')) {
        return { rows: [{ customer_id: '00000000-0000-0000-0000-000000000010' }], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO campaign_outcomes')) {
        state.outcomeInsertCount += 1;
        return { rows: [], rowCount: 2 };
      }
      if (sql.includes("SET status = 'completed'")) state.status = 'completed';
      if (sql.includes("SET status = $3")) state.status = 'measuring';
      if (sql.includes('INSERT INTO audit_events')) state.auditCount += 1;
      return { rows: [], rowCount: 0 };
    }),
  } as unknown as Queryable;
}

describe('outcome simulation persistence', () => {
  beforeEach(() => {
    state.status = 'sent';
    state.outcomeInsertCount = 0;
    state.auditCount = 0;
  });

  it('creates outcomes and writes completion audit in the same transaction', async () => {
    const result = await simulateCampaignOutcomes(database(), merchantId, campaignId, 'demo-merchant');
    expect(result).toMatchObject({ status: 'completed', created: 2, already_completed: false, simulated: true });
    expect(state.status).toBe('completed');
    expect(state.auditCount).toBe(1);
  });

  it('ME-09: a duplicate run is an idempotent no-op without another audit entry', async () => {
    const db = database();
    await simulateCampaignOutcomes(db, merchantId, campaignId, 'demo-merchant');
    const duplicate = await simulateCampaignOutcomes(db, merchantId, campaignId, 'demo-merchant');
    expect(duplicate).toMatchObject({ created: 0, already_completed: true });
    expect(state.outcomeInsertCount).toBe(1);
    expect(state.auditCount).toBe(1);
  });

  it('rejects outcome simulation until campaign sending is complete', async () => {
    state.status = 'approved';
    await expect(simulateCampaignOutcomes(database(), merchantId, campaignId, 'demo-merchant'))
      .rejects.toMatchObject({ code: 'INVALID_STATE', status: 409 });
    expect(state.outcomeInsertCount).toBe(0);
  });

  it('does not disclose or persist a simulated unsubscribe for control customers', async () => {
    const db = database();
    await simulateCampaignOutcomes(db, merchantId, campaignId, 'demo-merchant');
    const insertCall = vi.mocked(db.query).mock.calls.find(([sql]) => sql.includes('INSERT INTO campaign_outcomes'));
    expect(insertCall).toBeDefined();
    const params = insertCall?.[1] as unknown[];
    expect(params[2]).toEqual(['treatment', 'control']);
    expect(params[7]).toEqual([expect.any(Boolean), false]);
  });
});
