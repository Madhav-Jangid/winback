import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cancelCampaign, createCampaign, getCampaignView, listCampaigns, updateCampaign } from '@/lib/campaigns/service';
import { DEMO_MERCHANT_ID, DEMO_REFERENCE_DATE } from '@/lib/demo/constants';
import { resetDemoData } from '@/lib/demo/seed';
import { VALID_DRAFT } from '@/test/fixtures/campaign';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '@/test/helpers/test-db';

const NOW = DEMO_REFERENCE_DATE;
const M = DEMO_MERCHANT_ID;

describe.skipIf(!TEST_DATABASE_URL)('campaign drafts (integration)', () => {
  let t: TestDatabase;

  const auditEvents = async (campaignId: string) =>
    (await t.db.query<{ event_type: string; metadata: Record<string, unknown> }>(
      'SELECT event_type, metadata FROM audit_events WHERE campaign_id = $1 ORDER BY created_at, id', [campaignId],
    )).rows;
  const create = (overrides: Record<string, unknown> = {}) => createCampaign(t.db, M, { ...VALID_DRAFT, ...overrides }, NOW, 'test');

  beforeAll(async () => {
    t = await createTestDatabase();
    await resetDemoData(t.db, 'test');
  });
  afterAll(async () => t?.cleanup());

  it('GATE: a campaign can be saved and reloaded as a valid draft', async () => {
    const created = await create();
    expect(created.campaign).toMatchObject({ ...VALID_DRAFT, status: 'ready_for_approval', version: 1, approved_version: null });
    const reloaded = await getCampaignView(t.db, M, created.campaign.id, NOW);
    expect(reloaded.campaign).toEqual(created.campaign);
    expect(reloaded.preview).toMatchObject({ matched: 19, eligible: 12, control_is_estimate: false });
    expect(reloaded.preview.treatment + reloaded.preview.control).toBe(12);
    expect(reloaded.readiness).toEqual([]);
    expect((await auditEvents(created.campaign.id)).map((e) => e.event_type)).toEqual(['campaign_created']);
  });

  it('saves incomplete work as a draft with readiness issues', async () => {
    const view = await create({ original_message: '' });
    expect(view.campaign.status).toBe('draft');
    expect(view.readiness.map((r) => r.code)).toEqual(['MESSAGE_REQUIRED']);
  });

  it('rejects invalid input with field errors and saves nothing', async () => {
    const before = (await listCampaigns(t.db, M)).length;
    await expect(create({ offer: { type: 'percentage_discount', percent: 80 } })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR', status: 400, details: { fields: { 'offer.percent': expect.any(String) } },
    });
    expect((await listCampaigns(t.db, M)).length).toBe(before);
  });

  it('cosmetic edits keep the version; material edits bump it and are audited', async () => {
    const { campaign } = await create();
    const renamed = await updateCampaign(t.db, M, campaign.id, { name: 'Renamed', expected_version: 1 }, NOW, 'test');
    expect(renamed.campaign).toMatchObject({ name: 'Renamed', version: 1 });

    const rebudgeted = await updateCampaign(t.db, M, campaign.id, { budget_minor: 250_000, expected_version: 1 }, NOW, 'test');
    expect(rebudgeted.campaign).toMatchObject({ budget_minor: 250_000, version: 2, original_message: VALID_DRAFT.original_message });

    const events = await auditEvents(campaign.id);
    expect(events.map((e) => e.event_type)).toEqual(['campaign_created', 'campaign_updated', 'campaign_updated']);
    expect(events[2].metadata).toMatchObject({ changed_fields: ['budget_minor'], material: true, version_from: 1, version_to: 2 });
  });

  it('a save with no changes writes nothing', async () => {
    const { campaign } = await create();
    const same = await updateCampaign(t.db, M, campaign.id, { budget_minor: VALID_DRAFT.budget_minor, expected_version: 1 }, NOW, 'test');
    expect(same.campaign.updated_at).toBe(campaign.updated_at);
    expect(await auditEvents(campaign.id)).toHaveLength(1);
  });

  it('rejects a stale expected_version instead of overwriting', async () => {
    const { campaign } = await create();
    await updateCampaign(t.db, M, campaign.id, { channel: 'sms', expected_version: 1 }, NOW, 'test');
    await expect(updateCampaign(t.db, M, campaign.id, { channel: 'email', expected_version: 1 }, NOW, 'test'))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 });
    expect((await getCampaignView(t.db, M, campaign.id, NOW)).campaign.channel).toBe('sms');
  });

  it('CA-04: a material edit after approval invalidates it; a cosmetic one does not', async () => {
    const { campaign } = await create();
    await t.db.query(
      `UPDATE campaigns SET status = 'approved', approved_version = 1, approved_by = 'demo-merchant', approved_at = NOW() WHERE id = $1`,
      [campaign.id],
    );
    const cosmetic = await updateCampaign(t.db, M, campaign.id, { goal: 'A clearer goal', expected_version: 1 }, NOW, 'test');
    expect(cosmetic.campaign).toMatchObject({ status: 'approved', approved_version: 1, version: 1 });

    const material = await updateCampaign(t.db, M, campaign.id, { original_message: 'New copy, 10% off (up to ₹100).', expected_version: 1 }, NOW, 'test');
    expect(material.campaign).toMatchObject({ status: 'ready_for_approval', approved_version: null, approved_by: null, approved_at: null, version: 2 });
    expect((await auditEvents(campaign.id)).map((e) => e.event_type)).toContain('approval_invalidated');
  });

  it('locks campaigns once sending has started', async () => {
    const { campaign } = await create();
    await t.db.query(`UPDATE campaigns SET status = 'sending' WHERE id = $1`, [campaign.id]);
    await expect(updateCampaign(t.db, M, campaign.id, { name: 'Too late', expected_version: 1 }, NOW, 'test'))
      .rejects.toMatchObject({ code: 'CAMPAIGN_LOCKED', status: 409 });
    await expect(cancelCampaign(t.db, M, campaign.id, NOW, 'test')).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  it('E-32: cancelling is audited, idempotent, and final', async () => {
    const { campaign } = await create();
    expect((await cancelCampaign(t.db, M, campaign.id, NOW, 'test')).campaign.status).toBe('cancelled');
    expect((await cancelCampaign(t.db, M, campaign.id, NOW, 'test')).campaign.status).toBe('cancelled');
    await expect(updateCampaign(t.db, M, campaign.id, { name: 'Revived', expected_version: 1 }, NOW, 'test'))
      .rejects.toMatchObject({ code: 'CAMPAIGN_LOCKED' });
    expect((await auditEvents(campaign.id)).filter((e) => e.event_type === 'campaign_cancelled')).toHaveLength(1);
  });

  it('treats other merchants\' campaigns and unknown ids as not found', async () => {
    await expect(getCampaignView(t.db, M, '30000000-0000-4000-8000-0000000000ff', NOW)).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    await expect(getCampaignView(t.db, '00000000-0000-0000-0000-0000000000ee', '30000000-0000-4000-8000-000000000001', NOW))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('lists campaigns by status filter', async () => {
    const open = await listCampaigns(t.db, M, 'open');
    expect(open.length).toBeGreaterThan(0);
    expect(open.every((c) => ['draft', 'planning', 'ready_for_approval'].includes(c.status))).toBe(true);
    expect((await listCampaigns(t.db, M, 'cancelled')).every((c) => c.status === 'cancelled' || c.status === 'failed')).toBe(true);
  });

  it('E-17: when nobody is eligible the campaign stays a draft and says why', async () => {
    await t.db.query(`UPDATE customers SET consent_status = 'unknown' WHERE merchant_id = $1`, [M]);
    const view = await create();
    expect(view.campaign.status).toBe('draft');
    // Consent is checked first, so the two opted-out customers also count as "no consent".
    expect(view.preview).toMatchObject({ eligible: 0, treatment: 0, control: 0, excluded: { no_consent: 19, opted_out: 0 } });
    expect(view.readiness.map((r) => r.code)).toEqual(['EMPTY_SEGMENT']);
  });
});
