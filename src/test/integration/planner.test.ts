import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCampaign, getCampaignView, cancelCampaign } from '@/lib/campaigns/service';
import { DEMO_MERCHANT_ID, DEMO_REFERENCE_DATE } from '@/lib/demo/constants';
import { resetDemoData } from '@/lib/demo/seed';
import { DEMO_CUSTOMERS } from '@/lib/demo/seed-data';
import type { CampaignPlanner } from '@/lib/providers/interfaces';
import { selectPlanner, type PlannerSelection } from '@/lib/providers/factory';
import { generateCampaignPlan } from '@/lib/planner/service';
import { PlannerError, type CampaignPlanInput, type CampaignPlanResult } from '@/lib/planner/types';
import { VALID_DRAFT } from '@/test/fixtures/campaign';
import { VALID_PLAN } from '@/test/fixtures/plan-input';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '@/test/helpers/test-db';

const NOW = DEMO_REFERENCE_DATE;
const M = DEMO_MERCHANT_ID;

const geminiPlan = (): CampaignPlanResult => ({
  ...(VALID_PLAN as unknown as Omit<CampaignPlanResult, 'source' | 'model' | 'fallback_reason'>),
  source: 'gemini', model: 'gemini-test', fallback_reason: null,
});

/** Planner stand-in that records what it was given. Plain object, not vi.fn. */
function fakePlanner(behaviour: () => Promise<CampaignPlanResult>): { selection: PlannerSelection; inputs: CampaignPlanInput[] } {
  const inputs: CampaignPlanInput[] = [];
  const planner: CampaignPlanner = { generatePlan: async (input) => { inputs.push(input); return behaviour(); } };
  return { selection: { planner, live: true }, inputs };
}

describe.skipIf(!TEST_DATABASE_URL)('campaign planning (integration)', () => {
  let t: TestDatabase;

  const create = (overrides: Record<string, unknown> = {}) => createCampaign(t.db, M, { ...VALID_DRAFT, ...overrides }, NOW, 'test');
  const plan = (id: string, body: unknown, selection: PlannerSelection) => generateCampaignPlan(t.db, M, id, body, NOW, 'test', selection);
  const audit = async (id: string) =>
    (await t.db.query<{ event_type: string; metadata: Record<string, unknown> }>(
      'SELECT event_type, metadata FROM audit_events WHERE campaign_id = $1 ORDER BY created_at, id', [id])).rows;
  const operations = async () =>
    (await t.db.query<{ provider: string; status: string; error_code: string | null; request_fingerprint: string }>(
      'SELECT provider, status, error_code, request_fingerprint FROM provider_operations ORDER BY created_at, id')).rows;

  beforeAll(async () => {
    t = await createTestDatabase();
    await resetDemoData(t.db, 'test');
  });
  afterAll(async () => t?.cleanup());

  it('a Gemini plan is returned, recorded and audited, without changing the campaign', async () => {
    const { campaign } = await create();
    const { selection, inputs } = fakePlanner(async () => geminiPlan());
    const result = await plan(campaign.id, {}, selection);

    expect(result).toMatchObject({ offer_changed: false, campaign_version: 1, plan: { source: 'gemini', model: 'gemini-test' } });
    expect(result.offer_summary).toMatch(/10% off/);

    const after = (await getCampaignView(t.db, M, campaign.id, NOW)).campaign;
    expect(after).toMatchObject({
      version: 1, status: 'ready_for_approval', original_message: campaign.original_message, offer: campaign.offer,
      plan_source: 'gemini', plan_rationale: VALID_PLAN.rationale,
    });

    const events = (await audit(campaign.id)).filter((e) => e.event_type === 'plan_generated');
    expect(events).toHaveLength(1);
    expect(events[0].metadata).toMatchObject({ source: 'gemini', model: 'gemini-test', campaign_version: 1, offer_changed: false });
    expect(JSON.stringify(events[0].metadata)).not.toContain(VALID_PLAN.message_draft);

    const ops = await operations();
    expect(ops.at(-1)).toMatchObject({ provider: 'gemini', status: 'ok', error_code: null });
    expect(ops.at(-1)!.request_fingerprint).toMatch(/^[0-9a-f]{32}$/);

    // AI-07: only aggregates reached the planner
    expect(inputs).toHaveLength(1);
    const sent = JSON.stringify(inputs[0]);
    for (const customer of DEMO_CUSTOMERS) expect(sent).not.toContain(customer.name);
    expect(inputs[0].segment.eligible).toBe(12);
  });

  it('regression: returning the stored offer unchanged is not reported as a change', async () => {
    const offer = { type: 'free_item' as const, item_name: 'pastry', item_cost_minor: 4_000, expiry_days: 14 };
    const { campaign } = await create({ offer });
    // Same offer, built in schema key order (Postgres stores keys in a different order).
    const same = { ...geminiPlan(), offer, message_draft: 'Enjoy a free pastry on your next visit. Valid for 14 days.' };
    const result = await plan(campaign.id, {}, fakePlanner(async () => same).selection);
    expect(result.offer_changed).toBe(false);
  });

  it('reports a changed offer so the merchant can choose whether to apply it', async () => {
    const { campaign } = await create();
    const cheaper = { ...geminiPlan(), offer: { type: 'fixed_discount' as const, amount_minor: 2_000 }, message_draft: 'Enjoy ₹20 off your next order.' };
    const result = await plan(campaign.id, {}, fakePlanner(async () => cheaper).selection);
    expect(result).toMatchObject({ offer_changed: true });
    expect(result.offer_summary).toMatch(/₹20\.00 off/);
    // Still not applied
    expect((await getCampaignView(t.db, M, campaign.id, NOW)).campaign.offer).toEqual(campaign.offer);
  });

  it('AI-06: a provider failure leaves the campaign untouched and offers the demo draft', async () => {
    const { campaign } = await create();
    const failing = fakePlanner(async () => { throw new PlannerError('PLANNER_TIMEOUT', 'Gemini did not respond within 20 seconds.'); });
    await expect(plan(campaign.id, {}, failing.selection)).rejects.toMatchObject({
      code: 'PLAN_PROVIDER_FAILED', status: 502,
      details: { fallback_available: true, provider_code: 'PLANNER_TIMEOUT' },
      message: expect.stringContaining('Your campaign is unchanged'),
    });

    const after = (await getCampaignView(t.db, M, campaign.id, NOW)).campaign;
    expect(after).toMatchObject({ version: 1, plan_source: null, plan_rationale: null });
    expect((await audit(campaign.id)).map((e) => e.event_type)).toContain('plan_failed');
    expect((await operations()).at(-1)).toMatchObject({ provider: 'gemini', status: 'error', error_code: 'PLANNER_TIMEOUT' });
  });

  it('use_demo returns a clearly labelled demo plan after a failure', async () => {
    const { campaign } = await create();
    const neverCalled = fakePlanner(async () => { throw new Error('the live planner must not be used'); });
    const result = await plan(campaign.id, { use_demo: true }, neverCalled.selection);
    expect(neverCalled.inputs).toHaveLength(0);
    expect(result.plan).toMatchObject({ source: 'demo_fallback', model: null });
    expect(result.plan.fallback_reason).toMatch(/chose the demo draft/);
    expect((await getCampaignView(t.db, M, campaign.id, NOW)).campaign.plan_source).toBe('demo_fallback');
    expect((await operations()).at(-1)).toMatchObject({ provider: 'demo', status: 'fallback' });
  });

  it('AI-05: with no key configured the labelled demo planner is used automatically', async () => {
    const { campaign } = await create();
    const result = await plan(campaign.id, {}, selectPlanner({ GEMINI_API_KEY: undefined, GEMINI_MODEL: undefined }));
    expect(result.plan).toMatchObject({ source: 'demo_fallback', model: null });
    expect(result.plan.fallback_reason).toMatch(/GEMINI_API_KEY is not configured/);
    expect(result.plan.message_draft).toMatch(/^Hi! We miss you/);
    expect(result.plan.warnings.join(' ')).toMatch(/not generated by Gemini/);
    expect((await operations()).at(-1)).toMatchObject({ provider: 'demo', status: 'fallback' });
  });

  it('does not touch an approval: planning is not a material edit', async () => {
    const { campaign } = await create();
    await t.db.query(`UPDATE campaigns SET status = 'approved', approved_version = 1, approved_by = 'demo-merchant', approved_at = NOW() WHERE id = $1`, [campaign.id]);
    await plan(campaign.id, {}, fakePlanner(async () => geminiPlan()).selection);
    expect((await getCampaignView(t.db, M, campaign.id, NOW)).campaign).toMatchObject({ status: 'approved', approved_version: 1, version: 1 });
  });

  it('refuses campaigns that can no longer be edited, without calling the planner', async () => {
    const { campaign } = await create();
    await cancelCampaign(t.db, M, campaign.id, NOW, 'test');
    const planner = fakePlanner(async () => geminiPlan());
    await expect(plan(campaign.id, {}, planner.selection)).rejects.toMatchObject({ code: 'CAMPAIGN_LOCKED', status: 409 });
    expect(planner.inputs).toHaveLength(0);
  });

  it('validates the request and the campaign id', async () => {
    const { campaign } = await create();
    const planner = fakePlanner(async () => geminiPlan());
    await expect(plan(campaign.id, { use_demo: 'yes' }, planner.selection)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(plan(campaign.id, { surprise: true }, planner.selection)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(plan('30000000-0000-4000-8000-0000000000ff', {}, planner.selection)).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    expect(planner.inputs).toHaveLength(0);
  });

  it('does not hide unexpected errors behind the fallback', async () => {
    const { campaign } = await create();
    const broken = fakePlanner(async () => { throw new Error('boom'); });
    await expect(plan(campaign.id, {}, broken.selection)).rejects.toThrow('boom');
  });
});
