import { describe, expect, it } from 'vitest';
import { AppError } from '@/lib/errors';
import { makeApprovedRecord, makeCampaignRecord } from '@/test/fixtures/campaign-record';
import { VALID_TRANSLATION } from '@/test/fixtures/campaign';
import { assertCanSend, checkSendable } from './guard';
import { approvalHash } from './hash';

const code = (c: Parameters<typeof checkSendable>[0]) => {
  const result = checkSendable(c);
  return result.ok ? 'OK' : result.code;
};

describe('send gate', () => {
  it('CA-01: a draft cannot be sent', () => {
    expect(code(makeCampaignRecord({ status: 'draft' }))).toBe('CAMPAIGN_APPROVAL_REQUIRED');
    expect(code(makeCampaignRecord({ status: 'planning' }))).toBe('CAMPAIGN_APPROVAL_REQUIRED');
  });

  it('CA-02: a campaign ready for approval, but not approved, cannot be sent', () => {
    const result = checkSendable(makeCampaignRecord({ status: 'ready_for_approval' }));
    expect(result).toMatchObject({ ok: false, code: 'CAMPAIGN_APPROVAL_REQUIRED', status: 409 });
    expect((result as { message: string }).message).toBe('Approve the current campaign version before simulating sends.');
  });

  it('CA-03: an approved campaign whose approval is for the current version can be sent', () => {
    expect(checkSendable(makeApprovedRecord())).toEqual({ ok: true });
    expect(() => assertCanSend(makeApprovedRecord())).not.toThrow();
  });

  it('CA-05: an approval for an older version is rejected (E-11)', () => {
    expect(code(makeApprovedRecord({ version: 2, approved_version: 1 }))).toBe('CAMPAIGN_APPROVAL_STALE');
    expect(code(makeApprovedRecord({ approved_version: null }))).toBe('CAMPAIGN_APPROVAL_STALE');
  });

  it('rejects approved content that no longer matches what was approved, even if the version did not move', () => {
    const approved = makeApprovedRecord();
    for (const change of [
      { localized_message: `${approved.localized_message} (changed)` },
      { original_message: 'Different English message' },
      { budget_minor: approved.budget_minor * 2 },
      { channel: 'sms' as const },
      { language: 'ta' },
      { offer: { type: 'no_offer' as const } },
    ]) {
      expect(code({ ...approved, ...change }), JSON.stringify(change)).toBe('CAMPAIGN_APPROVAL_STALE');
    }
    expect(code({ ...approved, approval_hash: null })).toBe('CAMPAIGN_APPROVAL_STALE');
  });

  it('CA-06: a cancelled campaign cannot be sent, even if it was approved first (E-32)', () => {
    expect(code({ ...makeApprovedRecord(), status: 'cancelled' })).toBe('CAMPAIGN_CANCELLED');
  });

  it('a campaign already sending, sent or finished cannot start a new send', () => {
    for (const status of ['sending', 'sent', 'measuring', 'completed', 'failed'] as const) {
      expect(code({ ...makeApprovedRecord(), status }), status).toBe('CAMPAIGN_NOT_SENDABLE');
    }
  });

  it('assertCanSend throws a typed 409 for every rejection', () => {
    try {
      assertCanSend(makeCampaignRecord({ status: 'draft' }));
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ code: 'CAMPAIGN_APPROVAL_REQUIRED', status: 409 });
    }
  });
});

describe('approval hash', () => {
  const base = makeCampaignRecord();
  const hash = approvalHash(base);

  it('is a stable SHA-256 and ignores key order', () => {
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(approvalHash({ ...base })).toBe(hash);
    const reordered = { ...base, offer: { max_discount_minor: 10_000, percent: 10, type: 'percentage_discount' as const } };
    expect(approvalHash(reordered)).toBe(hash);
  });

  it('changes with every field that changes what customers receive or what it costs', () => {
    const changes: Array<Record<string, unknown>> = [
      { version: 2 }, { segment_type: 'all_eligible' }, { offer: { type: 'no_offer' } }, { budget_minor: 1 },
      { frequency_cap: 2 }, { cooldown_days: 7 }, { language: 'ta' }, { channel: 'sms' },
      { original_message: 'x' }, { localized_message: 'y' },
      { translation: { ...VALID_TRANSLATION, edited: false } },
      { translation: { ...VALID_TRANSLATION, source: 'sarvam' } },
      { translation: { ...VALID_TRANSLATION, source_text: 'older English' } },
    ];
    for (const change of changes) expect(approvalHash({ ...base, ...change }), JSON.stringify(change)).not.toBe(hash);
    expect(new Set(changes.map((c) => approvalHash({ ...base, ...c }))).size).toBe(changes.length);
  });

  it('ignores labels and bookkeeping that do not affect what is sent', () => {
    const same = [
      { name: 'Renamed' }, { goal: 'A different goal' }, { plan_source: 'gemini' }, { plan_rationale: 'why' },
      { updated_at: '2030-01-01T00:00:00.000Z' }, { status: 'approved' as const },
      { translation: { ...VALID_TRANSLATION, warnings: ['x'], translated_at: '2030-01-01T00:00:00.000Z' } },
    ];
    for (const change of same) expect(approvalHash({ ...base, ...change }), JSON.stringify(change)).toBe(hash);
  });
});
