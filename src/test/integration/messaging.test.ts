/**
 * Phase 8: simulated-send integration tests (SE-01 to SE-08).
 *
 * All tests use the demo dataset seeded into a temporary schema. Each test
 * that touches messages or recipients resets from seed so the others cannot
 * interfere.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { approveCampaign } from '@/lib/approvals/service';
import { createCampaign } from '@/lib/campaigns/service';
import { DEMO_MERCHANT_ID, DEMO_REFERENCE_DATE } from '@/lib/demo/constants';
import { resetDemoData } from '@/lib/demo/seed';
import { getMessageCounts, getRecipientGroups } from '@/lib/repositories/messages';
import { getCampaign } from '@/lib/repositories/campaigns';
import { VALID_DRAFT } from '@/test/fixtures/campaign';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '@/test/helpers/test-db';
import { getSendProgress, simulateSend } from '@/lib/messaging/service';
import type { DeliverFn } from '@/lib/messaging/delivery';

const NOW = DEMO_REFERENCE_DATE;
const M = DEMO_MERCHANT_ID;

/** A deterministic deliver fn that always succeeds (no randomness). */
const alwaysOk: DeliverFn = () => ({ ok: true });
/** Always fails the first attempt of every message. */
const alwaysFail: DeliverFn = () => ({ ok: false, code: 'SIM_FAIL' });

describe.skipIf(!TEST_DATABASE_URL)('simulated send (Phase 8 integration)', () => {
  let t: TestDatabase;

  const create = (overrides: Record<string, unknown> = {}) =>
    createCampaign(t.db, M, { ...VALID_DRAFT, ...overrides }, NOW, 'test');
  const approve = (id: string, version = 1) =>
    approveCampaign(t.db, M, id, { expected_version: version }, NOW, 'test');
  const send = (id: string, deliver: DeliverFn = alwaysOk) =>
    simulateSend(t.db, M, id, {}, NOW, 'test', { deliver });
  const audit = async (id: string) =>
    (await t.db.query<{ event_type: string; metadata: Record<string, unknown> }>(
      'SELECT event_type, metadata FROM audit_events WHERE campaign_id = $1 ORDER BY created_at, id', [id],
    )).rows;
  const msgRows = async (id: string) =>
    (await t.db.query<{ customer_id: string; status: string; attempts: number; failure_code: string | null }>(
      'SELECT customer_id, status, attempts, failure_code FROM campaign_messages WHERE campaign_id = $1 ORDER BY customer_id',
      [id],
    )).rows;

  beforeAll(async () => {
    t = await createTestDatabase();
    await resetDemoData(t.db, 'test');
  });
  afterAll(async () => t?.cleanup());
  beforeEach(async () => { await resetDemoData(t.db, 'test'); });

  // ─────────────────────────────────────────────────────────────────────────────
  // SE-01: a complete, clean send delivers to every treatment member and audits it
  // ─────────────────────────────────────────────────────────────────────────────
  it('SE-01: delivers to all treatment recipients; campaign becomes `sent`; audit events recorded', async () => {
    const { campaign } = await create();
    await approve(campaign.id);

    const progress = await send(campaign.id);

    expect(progress.state).toBe('sent');
    expect(progress.delivered).toBe(progress.planned);
    expect(progress.failed).toBe(0);
    expect(progress.simulated).toBe(true);
    expect(progress.control_not_messaged).toBeGreaterThan(0);

    const stored = await getCampaign(t.db, M, campaign.id);
    expect(stored?.status).toBe('sent');

    const events = await audit(campaign.id);
    expect(events.map((e) => e.event_type)).toContain('send_simulation_started');
    expect(events.map((e) => e.event_type)).toContain('send_simulation_completed');
    expect(events.map((e) => e.event_type)).toContain('recipient_delivered');
    expect(events.map((e) => e.event_type)).not.toContain('recipient_failed');
    expect(events.map((e) => e.event_type)).not.toContain('recipient_suppressed');

    const started = events.find((e) => e.event_type === 'send_simulation_started')!;
    expect(started.metadata).toMatchObject({ simulated: true, retry: false });

    const completed = events.find((e) => e.event_type === 'send_simulation_completed')!;
    expect(Number(completed.metadata.delivered)).toBe(progress.planned);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // SE-02: idempotency — repeating the completed send changes nothing
  // ─────────────────────────────────────────────────────────────────────────────
  it('SE-02: a second POST when the campaign is already `sent` with no failures is a no-op', async () => {
    const { campaign } = await create();
    await approve(campaign.id);
    const first = await send(campaign.id);

    // Call again — nothing should change
    const second = await send(campaign.id);

    expect(second.delivered).toBe(first.delivered);
    expect(second.state).toBe('sent');

    const events = await audit(campaign.id);
    // Only one started event
    expect(events.filter((e) => e.event_type === 'send_simulation_started')).toHaveLength(1);

    const counts = await getMessageCounts(t.db, campaign.id);
    expect(counts.delivered).toBe(first.delivered);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // SE-03: partial failure → `sent_with_failures`; retry heals them
  // ─────────────────────────────────────────────────────────────────────────────
  it('SE-03: failed deliveries appear in progress; a retry re-queues and delivers them', async () => {
    const { campaign } = await create();
    await approve(campaign.id);

    // First pass: everything fails
    const first = await send(campaign.id, alwaysFail);
    expect(first.state).toBe('sent_with_failures');
    expect(first.failed).toBeGreaterThan(0);
    expect(first.retryable_failed).toBe(first.failed);
    expect(first.can_retry).toBe(true);

    // Retry: everything should now succeed
    const retry = await send(campaign.id, alwaysOk);
    expect(retry.state).toBe('sent');
    expect(retry.delivered).toBe(first.planned);
    expect(retry.retryable_failed).toBe(0);

    const events = await audit(campaign.id);
    const started = events.filter((e) => e.event_type === 'send_simulation_started');
    expect(started).toHaveLength(2);
    expect(started[1].metadata).toMatchObject({ retry: true });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // SE-04: unique key prevents a second message row for the same customer
  // ─────────────────────────────────────────────────────────────────────────────
  it('SE-04: insertQueuedMessages is idempotent — each customer has at most one message row', async () => {
    const { campaign } = await create();
    await approve(campaign.id);

    await send(campaign.id);
    const rows1 = await msgRows(campaign.id);

    // Call insertQueuedMessages again for the same set — ON CONFLICT DO NOTHING prevents duplicates
    const { listSendCandidates } = await import('@/lib/repositories/recipients');
    const { insertQueuedMessages } = await import('@/lib/repositories/messages');
    const candidates = await listSendCandidates(t.db, campaign.id);
    await insertQueuedMessages(t.db, campaign.id, 1, candidates, 0);
    const rows2 = await msgRows(campaign.id);
    expect(rows2).toHaveLength(rows1.length);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // SE-05: progress is readable before send completes (GET send-status semantics)
  // ─────────────────────────────────────────────────────────────────────────────
  it('SE-05: getSendProgress returns accurate counts at every stage', async () => {
    const { campaign } = await create();
    await approve(campaign.id);

    // Before sending
    const before = await getSendProgress(t.db, M, campaign.id);
    expect(before.state).toBe('ready');
    expect(before.delivered).toBe(0);
    expect(before.planned).toBeGreaterThan(0);
    expect(before.unresolved).toBe(before.planned);
    expect(before.queued).toBe(0);

    await send(campaign.id);

    const after = await getSendProgress(t.db, M, campaign.id);
    expect(after.state).toBe('sent');
    expect(after.delivered).toBeGreaterThan(0);
    expect(after.simulated).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // SE-06: send-time suppression — a customer who opts out after approval is skipped
  // ─────────────────────────────────────────────────────────────────────────────
  it('SE-06: a customer who opts out after approval has `recipient_suppressed` audit event', async () => {
    const { campaign } = await create();
    await approve(campaign.id);

    // Find a send-candidate and opt them out in the database
    const { listSendCandidates } = await import('@/lib/repositories/recipients');
    const candidates = await listSendCandidates(t.db, campaign.id);
    expect(candidates.length).toBeGreaterThan(0);
    const victim = candidates[0];
    await t.db.query('UPDATE customers SET opted_out_at = NOW() WHERE id = $1', [victim]);

    const progress = await send(campaign.id);
    expect(progress.suppressed_at_send).toBeGreaterThanOrEqual(1);

    const events = await audit(campaign.id);
    const suppressions = events.filter((e) => e.event_type === 'recipient_suppressed');
    expect(suppressions.some((e) => e.metadata.reason === 'OPTED_OUT')).toBe(true);
    expect(suppressions.some((e) => e.metadata.stage === 'send')).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // SE-07: concurrent requests — second call during `sending` acts as a resume,
  // never doubles deliveries
  // ─────────────────────────────────────────────────────────────────────────────
  it('SE-07: concurrent sends never create duplicate message rows', async () => {
    const { campaign } = await create();
    await approve(campaign.id);

    const [p1, p2] = await (async () => {
      const [connection1, connection2] = await Promise.all([t.connect(), t.connect()]);
      try {
        return await Promise.all([
          simulateSend(connection1.db, M, campaign.id, {}, NOW, 'test', { deliver: alwaysOk }),
          simulateSend(connection2.db, M, campaign.id, {}, NOW, 'test', { deliver: alwaysOk }),
        ]);
      } finally {
        await Promise.all([connection1.close(), connection2.close()]);
      }
    })();

    // Both should return valid progress
    expect(p1.simulated).toBe(true);
    expect(p2.simulated).toBe(true);

    // Only one message per customer
    const rows = await msgRows(campaign.id);
    const customerIds = rows.map((r) => r.customer_id);
    expect(customerIds.length).toBe(new Set(customerIds).size);

    const counts = await getMessageCounts(t.db, campaign.id);
    expect(counts.delivered + counts.failed).toBe(rows.length);
    expect(counts.queued).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // SE-08: crash-resume — campaign stays `sending` after a rolled-back delivery;
  // the next call picks it up from where it left off (simulated via a `sending`
  // campaign with pre-queued messages)
  // ─────────────────────────────────────────────────────────────────────────────
  it('SE-08: a `sending` campaign with queued messages is resumed by the next POST', async () => {
    const { campaign } = await create();
    await approve(campaign.id);

    // Simulate a partial completion: run claim (approve → sending) then abort before delivery
    // We do this by manually driving the campaign to `sending` with one queued message.
    const { listSendCandidates } = await import('@/lib/repositories/recipients');
    const candidates = await listSendCandidates(t.db, campaign.id);
    expect(candidates.length).toBeGreaterThan(0);
    const { messageKey } = await import('@/lib/messaging/delivery');

    // Insert one queued message and set campaign to sending, simulating a crash after claim
    await t.db.query(
      `INSERT INTO campaign_messages (campaign_id, customer_id, campaign_version, idempotency_key, status, simulated_cost_minor)
       VALUES ($1, $2, 1, $3, 'queued', 0)
       ON CONFLICT DO NOTHING`,
      [campaign.id, candidates[0], messageKey(campaign.id, candidates[0], 1)],
    );
    await t.db.query(`UPDATE campaigns SET status = 'sending', updated_at = NOW() WHERE id = $1`, [campaign.id]);

    // Resume sends the queued message
    const progress = await send(campaign.id, alwaysOk);
    expect(progress.state).toBe('sent');
    expect(progress.delivered).toBeGreaterThanOrEqual(1);

    const stored = await getCampaign(t.db, M, campaign.id);
    expect(stored?.status).toBe('sent');

    // The campaign_messages row is settled
    const rows = await msgRows(campaign.id);
    expect(rows.every((r) => r.status !== 'queued')).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Recipient group accounting
  // ─────────────────────────────────────────────────────────────────────────────
  it('recipient groups: control is never messaged; budget-exceeded are tracked separately', async () => {
    // Small budget: only 2 messages
    const offer = { type: 'free_item', item_name: 'pastry', item_cost_minor: 4_000 };
    const { campaign } = await create({ offer, budget_minor: 8_500 }); // 2 messages max
    await approve(campaign.id);

    const progress = await send(campaign.id);
    expect(progress.delivered + progress.failed).toBeLessThanOrEqual(2);
    expect(progress.budget_not_messaged).toBeGreaterThan(0);
    expect(progress.control_not_messaged).toBeGreaterThan(0);

    const groups = await getRecipientGroups(t.db, campaign.id);
    const control = groups.find((g) => g.group_assignment === 'control' && g.suppression_reason === 'CONTROL_GROUP');
    expect(control).toBeTruthy();
    const budget = groups.find((g) => g.suppression_reason === 'BUDGET_EXCEEDED');
    expect(budget).toBeTruthy();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // simulated_cost_minor is stored per message
  // ─────────────────────────────────────────────────────────────────────────────
  it('each queued message records the cost from the budget plan', async () => {
    const offer = { type: 'fixed_discount', amount_minor: 5_000 };
    const { campaign } = await create({ offer });
    await approve(campaign.id);
    await send(campaign.id);

    const rows = await t.db.query<{ simulated_cost_minor: string }>(
      'SELECT simulated_cost_minor FROM campaign_messages WHERE campaign_id = $1', [campaign.id],
    );
    for (const row of rows.rows) {
      expect(Number(row.simulated_cost_minor)).toBe(5_000);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // The gate is re-enforced on a retry of failed deliveries
  // ─────────────────────────────────────────────────────────────────────────────
  it('SE-03b: a customer who gets suppressed between the first fail and the retry is not re-sent', async () => {
    const { campaign } = await create();
    await approve(campaign.id);

    // First pass: all fail
    await send(campaign.id, alwaysFail);

    // Opt out one of the failed recipients
    const rows = await msgRows(campaign.id);
    const victim = rows[0].customer_id;
    await t.db.query('UPDATE customers SET opted_out_at = NOW() WHERE id = $1', [victim]);

    // Retry: victim is suppressed, others succeed
    const retry = await send(campaign.id, alwaysOk);
    expect(retry.suppressed_at_send).toBeGreaterThanOrEqual(1);

    const vRow = (await t.db.query<{ failure_code: string }>(
      `SELECT failure_code FROM campaign_messages WHERE campaign_id = $1 AND customer_id = $2`,
      [campaign.id, victim],
    )).rows[0];
    expect(vRow.failure_code).toBe('SUPPRESSED_ON_RETRY');
  });
});
