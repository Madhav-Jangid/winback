import { approvalHash } from '@/lib/approvals/hash';
import type { CampaignRecord } from '@/lib/repositories/campaigns';
import { VALID_DRAFT, VALID_TRANSLATION } from './campaign';

export const CAMPAIGN_ID = '30000000-0000-4000-8000-0000000000aa';

/** A stored campaign as the repository returns it: ready for approval, version 1. */
export function makeCampaignRecord(overrides: Partial<CampaignRecord> = {}): CampaignRecord {
  return {
    id: CAMPAIGN_ID,
    merchant_id: '00000000-0000-0000-0000-000000000001',
    name: VALID_DRAFT.name,
    goal: VALID_DRAFT.goal,
    segment_type: VALID_DRAFT.segment_type,
    segment_snapshot: {},
    offer: VALID_DRAFT.offer,
    budget_minor: VALID_DRAFT.budget_minor,
    frequency_cap: VALID_DRAFT.frequency_cap,
    cooldown_days: VALID_DRAFT.cooldown_days,
    language: VALID_DRAFT.language,
    channel: VALID_DRAFT.channel,
    original_message: VALID_DRAFT.original_message,
    localized_message: VALID_DRAFT.localized_message,
    translation: VALID_TRANSLATION,
    plan_rationale: null,
    plan_source: null,
    status: 'ready_for_approval',
    version: 1,
    approved_version: null,
    approved_by: null,
    approved_at: null,
    approval_hash: null,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

/** The same campaign, approved at its current version with a matching hash. */
export function makeApprovedRecord(overrides: Partial<CampaignRecord> = {}): CampaignRecord {
  const base = makeCampaignRecord(overrides);
  return { ...base, status: 'approved', approved_version: base.version, approved_by: 'demo-merchant', approved_at: '2026-10-01T00:00:00.000Z', approval_hash: approvalHash(base), ...overrides };
}
