import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyQuery, getCustomerDetail, getCustomerDirectory } from '@/lib/customers/service';
import { DEMO_MERCHANT_ID, DEMO_REFERENCE_DATE } from '@/lib/demo/constants';
import { resetDemoData } from '@/lib/demo/seed';
import { buildDemoDataset, DEMO_CUSTOMERS } from '@/lib/demo/seed-data';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '@/test/helpers/test-db';

const NOW = DEMO_REFERENCE_DATE;
const OTHER_MERCHANT_ID = '00000000-0000-0000-0000-000000000002';
const idOf = (name: string) => {
  const data = buildDemoDataset();
  return data.customers[DEMO_CUSTOMERS.findIndex((c) => c.name === name)].id;
};

describe.skipIf(!TEST_DATABASE_URL)('customers (integration)', () => {
  let t: TestDatabase;

  beforeAll(async () => {
    t = await createTestDatabase();
    await resetDemoData(t.db, 'test');
  });
  afterAll(async () => t?.cleanup());

  it('every customer gets the risk status its seed scenario promises', async () => {
    const directory = await getCustomerDirectory(t.db, DEMO_MERCHANT_ID, NOW);
    const actual = Object.fromEntries(directory.all.map((p) => [p.display_name, p.risk.status]));
    const expected = Object.fromEntries(DEMO_CUSTOMERS.map((c) => [c.name, c.expectedRisk]));
    expect(actual).toEqual(expected);
  });

  it('applies frequency caps from persisted campaign messages', async () => {
    const directory = await getCustomerDirectory(t.db, DEMO_MERCHANT_ID, NOW, { filter: 'frequency_capped', search: '' });
    expect(directory.customers.map((c) => c.display_name).sort()).toEqual(['Divya Menon', 'Karan Malhotra']);
    expect(directory.customers[0].contact.reason).toBe('FREQUENCY_CAP');
  });

  it('returns the same results through the query path as filtering in memory', async () => {
    const directory = await getCustomerDirectory(t.db, DEMO_MERCHANT_ID, NOW, { filter: 'at_risk', search: 'a' });
    expect(directory.customers).toEqual(applyQuery(directory.all, { filter: 'at_risk', search: 'a' }));
  });

  it('customer detail shows refunds as ignored and lists purchases newest first', async () => {
    const detail = await getCustomerDetail(t.db, DEMO_MERCHANT_ID, idOf('Harish Menon'), NOW);
    expect(detail).not.toBeNull();
    expect(detail!.profile).toMatchObject({ completed_purchase_count: 2, ignored_purchase_count: 1 });
    expect(detail!.profile.risk.status).toBe('at_risk');
    expect(detail!.purchases.map((p) => p.status)).toEqual(['refunded', 'completed', 'completed']);
  });

  it('customer detail includes simulated campaign messages', async () => {
    const detail = await getCustomerDetail(t.db, DEMO_MERCHANT_ID, idOf('Karan Malhotra'), NOW);
    expect(detail!.messages).toHaveLength(1);
    expect(detail!.messages[0]).toMatchObject({ campaign_name: 'September check-in (historical demo)', status: 'delivered' });
  });

  it('is scoped to the merchant: another merchant\'s customer is not found', async () => {
    await t.db.query(`INSERT INTO merchants (id, name, business_type) VALUES ($1, 'Other shop', 'salon')`, [OTHER_MERCHANT_ID]);
    const other = await t.db.query<{ id: string }>(
      `INSERT INTO customers (merchant_id, display_name, consent_status) VALUES ($1, 'Someone Else', 'consented') RETURNING id`,
      [OTHER_MERCHANT_ID],
    );
    expect(await getCustomerDetail(t.db, DEMO_MERCHANT_ID, other.rows[0].id, NOW)).toBeNull();
    const directory = await getCustomerDirectory(t.db, DEMO_MERCHANT_ID, NOW);
    expect(directory.all.some((c) => c.display_name === 'Someone Else')).toBe(false);
  });

  it('returns an empty directory when the merchant has no data', async () => {
    const directory = await getCustomerDirectory(t.db, '00000000-0000-0000-0000-0000000000ff', NOW);
    expect(directory).toMatchObject({ merchant: null, customers: [], all: [] });
  });
});
