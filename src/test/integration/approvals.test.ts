import { DatabaseError } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { approveCampaign, getApprovalSummary, getCampaignRecipients, revalidateRecipients } from '@/lib/approvals/service';
import { checkSendable } from '@/lib/approvals/guard';
import { cancelCampaign, createCampaign, getCampaignView, updateCampaign } from '@/lib/campaigns/service';
import { recordOptOut } from '@/lib/customers/consent';
import { DEMO_MERCHANT_ID, DEMO_REFERENCE_DATE } from '@/lib/demo/constants';
import { resetDemoData } from '@/lib/demo/seed';
import { DEMO_CUSTOMERS } from '@/lib/demo/seed-data';
import { getCampaign } from '@/lib/repositories/campaigns';
import { listSendCandidates } from '@/lib/repositories/recipients';
import { VALID_DRAFT } from '@/test/fixtures/campaign';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '@/test/helpers/test-db';
import { buildDemoDataset, HISTORICAL_CAMPAIGN_ID } from '@/lib/demo/seed-data';

const NOW = DEMO_REFERENCE_DATE;
const M = DEMO_MERCHANT_ID;
const idOf = (name: string) => buildDemoDataset().customers[DEMO_CUSTOMERS.findIndex((c) => c.name === name)].id;

async function pgCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error instanceof DatabaseError ? error.code : 'not-a-db-error';
  }
}

describe.skipIf(!TEST_DATABASE_URL)('approval and send-time checks (integration)', () => {
  let t: TestDatabase;

  const create = (overrides: Record<string, unknown> = {}) => createCampaign(t.db, M, { ...VALID_DRAFT, ...overrides }, NOW, 'test');
  const approve = (id: string, version = 1) => approveCampaign(t.db, M, id, { expected_version: version }, NOW, 'test');
  const audit = async (id: string) =>
    (await t.db.query<{ event_type: string; metadata: Record<string, unknown> }>(
      'SELECT event_type, metadata FROM audit_events WHERE campaign_id = $1 ORDER BY created_at, id', [id])).rows;
  const recipients = (id: string, filter: Record<string, unknown> = {}) =>
    getCampaignRecipients(t.db, M, id, { limit: 200, offset: 0, ...filter });
  const rowCount = async (id: string) =>
    Number((await t.db.query<{ n: string }>('SELECT COUNT(*) AS n FROM campaign_recipients WHERE campaign_id = $1', [id])).rows[0].n);

  beforeAll(async () => {
    t = await createTestDatabase();
    await resetDemoData(t.db, 'test');
  });
  afterAll(async () => t?.cleanup());

  it('CA-03 / CA-07: approves the current version, binds it to a hash, stores the recipient snapshot, and audits it', async () => {
    const { campaign } = await create();
    expect(campaign.status).toBe('ready_for_approval');

    const summary = await approve(campaign.id);
    expect(summary.approval).toMatchObject({ state: 'approved', version: 1, by: 'test' });
    expect(summary.approval.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(summary.view.campaign).toMatchObject({ status: 'approved', approved_version: 1, approved_by: 'test' });
    expect(summary.can_approve).toBe(false); // already approved

    const stored = (await getCampaign(t.db, M, campaign.id))!;
    expect(checkSendable(stored)).toEqual({ ok: true });

    const events = await audit(campaign.id);
    const granted = events.find((e) => e.event_type === 'approval_granted')!;
    expect(granted.metadata).toMatchObject({ version: 1, language: 'hi', channel: 'whatsapp', recipients: { members: 19, contactable: 12 } });
    expect(String(granted.metadata.approval_hash)).toBe(summary.approval.hash!.slice(0, 16));
    expect(await rowCount(campaign.id)).toBe(19);
  });

  it('EL-10: every suppression reason is persisted and listed with a label', async () => {
    const { campaign } = await create();
    await approve(campaign.id);
    const capped = await recipients(campaign.id, { reason: 'FREQUENCY_CAP' });
    expect(capped.items.map((r) => r.display_name).sort()).toEqual(['Divya Menon', 'Karan Malhotra']);
    expect(capped.items[0]).toMatchObject({ group_assignment: null, eligibility_status: 'ineligible', reason_label: 'Messaged recently' });

    const optedOut = await recipients(campaign.id, { reason: 'OPTED_OUT' });
    expect(optedOut.items.map((r) => r.display_name).sort()).toEqual(['Arun Joshi', 'Dinesh Pillai', 'Fatima Sheikh']);
    expect((await recipients(campaign.id, { reason: 'CONSENT_UNKNOWN' })).total).toBe(2);

    const control = await recipients(campaign.id, { group: 'control' });
    for (const r of control.items) expect(r).toMatchObject({ suppression_reason: 'CONTROL_GROUP', eligibility_status: 'eligible' });
    const messaged = await recipients(campaign.id, { group: 'treatment', reason: 'none' });
    expect(messaged.total + control.total).toBe(12);
    expect(messaged.total).toBe((await listSendCandidates(t.db, campaign.id)).length);
  });

  it('approving again is a no-op: one approval event, same snapshot', async () => {
    const { campaign } = await create();
    const first = await approve(campaign.id);
    const second = await approve(campaign.id);
    expect(second.approval).toEqual(first.approval);
    expect((await audit(campaign.id)).filter((e) => e.event_type === 'approval_granted')).toHaveLength(1);
    expect(await rowCount(campaign.id)).toBe(19);
  });

  it('CA-01: a campaign that is not ready cannot be approved, and nothing is stored', async () => {
    const { campaign } = await create({ original_message: '' });
    expect(campaign.status).toBe('draft');
    await expect(approve(campaign.id)).rejects.toMatchObject({
      code: 'CAMPAIGN_NOT_READY', status: 409, details: { issues: [expect.objectContaining({ code: 'MESSAGE_REQUIRED' })] },
    });
    expect(await rowCount(campaign.id)).toBe(0);
    expect((await getCampaignView(t.db, M, campaign.id, NOW)).campaign).toMatchObject({ status: 'draft', approved_version: null });
  });

  it('E-17: with nobody contactable the approval is refused and says why', async () => {
    await t.db.query(`UPDATE customers SET consent_status = 'unknown' WHERE merchant_id = $1`, [M]);
    const { campaign } = await create();
    await expect(approve(campaign.id)).rejects.toMatchObject({
      code: 'CAMPAIGN_NOT_READY', details: { issues: [expect.objectContaining({ code: 'EMPTY_SEGMENT' })] },
    });
    await t.db.query(`UPDATE customers SET consent_status = 'consented' WHERE merchant_id = $1`, [M]);
    await resetDemoData(t.db, 'test');
  });

  it('rejects an approval for a version the merchant did not review, a bad body, a cancelled or unknown campaign', async () => {
    const { campaign } = await create();
    await expect(approve(campaign.id, 2)).rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 });
    await expect(approveCampaign(t.db, M, campaign.id, {}, NOW, 'test')).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    await expect(approveCampaign(t.db, M, campaign.id, { expected_version: 1, status: 'approved' }, NOW, 'test')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(approve('30000000-0000-4000-8000-0000000000ff')).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });

    await cancelCampaign(t.db, M, campaign.id, NOW, 'test');
    await expect(approve(campaign.id)).rejects.toMatchObject({ code: 'CAMPAIGN_CANCELLED', status: 409 });
    expect(await rowCount(campaign.id)).toBe(0);
  });

  it('CA-04: a material edit cancels the approval and discards its snapshot; a cosmetic edit does neither', async () => {
    const { campaign } = await create();
    await approve(campaign.id);

    await updateCampaign(t.db, M, campaign.id, { name: 'Renamed only', expected_version: 1 }, NOW, 'test');
    expect((await getCampaign(t.db, M, campaign.id))).toMatchObject({ status: 'approved', approved_version: 1 });
    expect(await rowCount(campaign.id)).toBe(19);

    const edited = await updateCampaign(t.db, M, campaign.id, { budget_minor: 400_000, expected_version: 1 }, NOW, 'test');
    expect(edited.campaign).toMatchObject({ status: 'ready_for_approval', version: 2, approved_version: null, approval_hash: null });
    expect(await rowCount(campaign.id)).toBe(0);
    expect((await audit(campaign.id)).map((e) => e.event_type)).toContain('approval_invalidated');
    expect(checkSendable((await getCampaign(t.db, M, campaign.id))!)).toMatchObject({ ok: false, code: 'CAMPAIGN_APPROVAL_REQUIRED' });

    const again = await approve(campaign.id, 2);
    expect(again.approval).toMatchObject({ state: 'approved', version: 2 });
    expect(await rowCount(campaign.id)).toBe(19);
  });

  it('E-32: cancelling an approved campaign blocks the send', async () => {
    const { campaign } = await create();
    await approve(campaign.id);
    await cancelCampaign(t.db, M, campaign.id, NOW, 'test');
    expect(checkSendable((await getCampaign(t.db, M, campaign.id))!)).toMatchObject({ ok: false, code: 'CAMPAIGN_CANCELLED' });
    await expect(revalidateRecipients(t.db, M, campaign.id, NOW)).rejects.toMatchObject({ code: 'CAMPAIGN_CANCELLED' });
  });

  it('E-09: a small budget messages only as many customers as it can pay for, and says so', async () => {
    const offer = { type: 'free_item', item_name: 'pastry', item_cost_minor: 4_000 };
    const { campaign } = await create({ offer, budget_minor: 12_500 }); // room for exactly 3 messages
    const summary = await approve(campaign.id);
    expect(summary.budget).toMatchObject({ max_messages: 3, reserved_minor: 12_000, remaining_minor: 500 });
    expect(summary.recipients.sendable).toBe(3);
    expect(summary.recipients.suppressed.BUDGET_EXCEEDED).toBe(summary.recipients.treatment - 3);
    expect(summary.warnings.join(' ')).toMatch(/budget covers only 3 messages/);
    expect((await listSendCandidates(t.db, campaign.id))).toHaveLength(3);
    expect((await recipients(campaign.id, { reason: 'BUDGET_EXCEEDED' })).items.every((r) => r.group_assignment === 'treatment')).toBe(true);
  });

  it('warns about a small audience and about running without a control group (E-18)', async () => {
    const summary = await getApprovalSummary(t.db, M, (await create()).campaign.id, NOW);
    expect(summary.warnings.join(' ')).toMatch(/Small audience \(12 customers\)/);
    expect(summary.blockers).toEqual([]);
    expect(summary.can_approve).toBe(true);
  });

  describe('immediately before sending (EL-09)', () => {
    // These tests opt customers out, add messages and purchases: start each from the seed.
    beforeEach(async () => { await resetDemoData(t.db, 'test'); });

    it('CA-08: refuses anything that is not approved at its current content', async () => {
      const { campaign } = await create();
      await expect(revalidateRecipients(t.db, M, campaign.id, NOW)).rejects.toMatchObject({ code: 'CAMPAIGN_APPROVAL_REQUIRED', status: 409 });

      await approve(campaign.id);
      await expect(revalidateRecipients(t.db, M, campaign.id, NOW)).resolves.toBeTruthy();

      // A change that bypassed the version bump (here: straight in the database) is still caught.
      await t.db.query('UPDATE campaigns SET budget_minor = 1 WHERE id = $1', [campaign.id]);
      await expect(revalidateRecipients(t.db, M, campaign.id, NOW)).rejects.toMatchObject({ code: 'CAMPAIGN_APPROVAL_STALE' });
      await t.db.query('UPDATE campaigns SET budget_minor = $2 WHERE id = $1', [campaign.id, VALID_DRAFT.budget_minor]);
      await t.db.query('UPDATE campaigns SET version = 2 WHERE id = $1', [campaign.id]);
      await expect(revalidateRecipients(t.db, M, campaign.id, NOW)).rejects.toMatchObject({ code: 'CAMPAIGN_APPROVAL_STALE' });
      await expect(revalidateRecipients(t.db, M, '30000000-0000-4000-8000-0000000000ff', NOW)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('E-06: a customer who opts out after approval is suppressed at send time, and the opt-out is audited', async () => {
      const { campaign } = await create();
      await approve(campaign.id);
      const before = await revalidateRecipients(t.db, M, campaign.id, NOW);
      expect(before.suppressed).toEqual([]);
      const victim = before.sendable[0];

      const result = await recordOptOut(t.db, M, victim, 'test');
      expect(result.already_opted_out).toBe(false);

      const after = await revalidateRecipients(t.db, M, campaign.id, NOW);
      expect(after.suppressed).toEqual([{ customer_id: victim, reason: 'OPTED_OUT' }]);
      expect(after.sendable).toEqual(before.sendable.slice(1));
      const optOuts = (await t.db.query<{ metadata: Record<string, unknown> }>(
        `SELECT metadata FROM audit_events WHERE event_type = 'opt_out_recorded' AND entity_id = $1`, [victim])).rows;
      expect(optOuts).toEqual([{ metadata: { source: 'merchant_recorded' } }]);
    });

    it('a message from another campaign since approval puts the customer inside the cooldown', async () => {
      const { campaign } = await create();
      await approve(campaign.id);
      const [victim] = (await revalidateRecipients(t.db, M, campaign.id, NOW)).sendable;
      await t.db.query(
        `INSERT INTO campaign_messages (campaign_id, customer_id, campaign_version, idempotency_key, status, sent_at, delivered_at)
         VALUES ($1, $2, 1, $3, 'delivered', $4, $4)`,
        [HISTORICAL_CAMPAIGN_ID, victim, `${HISTORICAL_CAMPAIGN_ID}:${victim}:late`, new Date(NOW.getTime() - 3 * 86_400_000)],
      );
      const after = await revalidateRecipients(t.db, M, campaign.id, NOW);
      expect(after.suppressed).toEqual([{ customer_id: victim, reason: 'FREQUENCY_CAP' }]);
    });

    it('E-05: a customer who buys again before the send is no longer in the at-risk segment', async () => {
      const { campaign } = await create();
      await approve(campaign.id);
      const [returning] = (await revalidateRecipients(t.db, M, campaign.id, NOW)).sendable;
      await t.db.query(
        `INSERT INTO purchases (merchant_id, customer_id, occurred_at, amount_minor) VALUES ($1, $2, $3, 25000)`,
        [M, returning, new Date(NOW.getTime() - 86_400_000)],
      );
      const after = await revalidateRecipients(t.db, M, campaign.id, NOW);
      expect(after.suppressed).toEqual([{ customer_id: returning, reason: 'NOT_ELIGIBLE' }]);
    });

    it('E-08: control customers and customers outside the experiment are never candidates', async () => {
      const { campaign } = await create();
      await approve(campaign.id);
      const revalidation = await revalidateRecipients(t.db, M, campaign.id, NOW);
      const held = (await recipients(campaign.id, { reason: 'CONTROL_GROUP' })).items.map((r) => r.customer_id);
      const excluded = (await recipients(campaign.id, { group: 'none' })).items.map((r) => r.customer_id);
      expect(held.length).toBeGreaterThan(0);
      expect(excluded).toHaveLength(7);
      for (const id of [...held, ...excluded]) expect(revalidation.decisions.map((d) => d.customer_id)).not.toContain(id);
      expect(revalidation.sendable).toEqual(await listSendCandidates(t.db, campaign.id));
    });
  });

  describe('opt-outs and consent (E-35)', () => {
    it('is idempotent, scoped to the merchant, and does not touch consent', async () => {
      const id = idOf('Rohit Verma');
      const first = await recordOptOut(t.db, M, id, 'test');
      const second = await recordOptOut(t.db, M, id, 'test');
      expect(first.already_opted_out).toBe(false);
      expect(second).toEqual({ customer_id: id, opted_out_at: first.opted_out_at, already_opted_out: true });
      const row = (await t.db.query<{ consent_status: string }>('SELECT consent_status FROM customers WHERE id = $1', [id])).rows[0];
      expect(row.consent_status).toBe('consented');
      expect((await t.db.query(`SELECT 1 FROM audit_events WHERE event_type = 'opt_out_recorded' AND entity_id = $1`, [id])).rows).toHaveLength(1);

      await expect(recordOptOut(t.db, M, '10000000-0000-4000-8000-0000000fffff', 'test')).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
      await expect(recordOptOut(t.db, '00000000-0000-0000-0000-0000000000ee', id, 'test')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('database rules for the recipient snapshot', () => {
    const insert = (campaignId: string, customerId: string, group: string | null, status: string, reason: string | null) =>
      t.db.query(
        `INSERT INTO campaign_recipients (campaign_id, customer_id, group_assignment, eligibility_status, suppression_reason) VALUES ($1, $2, $3, $4, $5)`,
        [campaignId, customerId, group, status, reason],
      );

    it('a control customer must always carry CONTROL_GROUP, so they can never look sendable', async () => {
      const { campaign } = await create();
      const customer = idOf('Priya Patel');
      expect(await pgCode(insert(campaign.id, customer, 'control', 'eligible', null))).toBe('23514');
      expect(await pgCode(insert(campaign.id, customer, 'control', 'eligible', 'FREQUENCY_CAP'))).toBe('23514');
      expect(await pgCode(insert(campaign.id, customer, 'control', 'eligible', 'CONTROL_GROUP'))).toBeUndefined();
    });

    it('anyone outside the experiment must say why; reason codes and groups are validated; one row per customer', async () => {
      const { campaign } = await create();
      const [a, b] = [idOf('Ananya Das'), idOf('Amrit Kaur')];
      expect(await pgCode(insert(campaign.id, a, null, 'ineligible', null))).toBe('23514');
      expect(await pgCode(insert(campaign.id, a, null, 'eligible', 'OPTED_OUT'))).toBe('23514');
      expect(await pgCode(insert(campaign.id, a, null, 'ineligible', 'MADE_UP'))).toBe('23514');
      expect(await pgCode(insert(campaign.id, a, 'everyone', 'eligible', null))).toBe('23514');
      expect(await pgCode(insert(campaign.id, a, null, 'ineligible', 'OPTED_OUT'))).toBeUndefined();
      expect(await pgCode(insert(campaign.id, a, null, 'ineligible', 'OPTED_OUT'))).toBe('23505');
      expect(await pgCode(insert(campaign.id, b, 'treatment', 'eligible', null))).toBeUndefined();
    });
  });
});
