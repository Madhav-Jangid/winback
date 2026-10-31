import { describe, expect, it } from 'vitest';
import { AppError } from '@/lib/errors';
import type { CampaignStatus } from '@/types';
import { campaignDraftSchema } from './schema';
import { VALID_DRAFT } from '@/test/fixtures/campaign';
import { assertTransition, canTransition, changedFields, isEditable, isMaterialChange, statusAfterSave, TRANSITIONS } from './state';

const draft = campaignDraftSchema.parse(VALID_DRAFT);

describe('campaign state machine', () => {
  it('allows the documented happy path', () => {
    const path: CampaignStatus[] = ['draft', 'ready_for_approval', 'approved', 'sending', 'sent', 'measuring', 'completed'];
    for (let i = 1; i < path.length; i++) expect(canTransition(path[i - 1], path[i]), `${path[i - 1]} -> ${path[i]}`).toBe(true);
  });

  it.each([
    ['draft', 'approved'],
    ['draft', 'sending'],
    ['ready_for_approval', 'sending'],
    ['sending', 'cancelled'],
    ['sent', 'draft'],
    ['completed', 'draft'],
    ['cancelled', 'approved'],
    ['cancelled', 'sending'],
  ] as const)('rejects %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    expect(() => assertTransition(from, to)).toThrow(AppError);
    try { assertTransition(from, to); } catch (e) { expect((e as AppError).code).toBe('INVALID_TRANSITION'); }
  });

  it('terminal states have no exits', () => {
    expect(TRANSITIONS.completed).toEqual([]);
    expect(TRANSITIONS.cancelled).toEqual([]);
  });

  it('only pre-send statuses are editable', () => {
    expect(['draft', 'ready_for_approval', 'approved'].every((s) => isEditable(s as CampaignStatus))).toBe(true);
    expect(['sending', 'sent', 'measuring', 'completed', 'cancelled', 'failed'].some((s) => isEditable(s as CampaignStatus))).toBe(false);
  });

  it('detects material vs cosmetic changes', () => {
    expect(changedFields(draft, { ...draft, name: 'Renamed' })).toEqual(['name']);
    expect(isMaterialChange(['name', 'goal'])).toBe(false);
    expect(isMaterialChange(changedFields(draft, { ...draft, offer: { type: 'no_offer' } }))).toBe(true);
    expect(isMaterialChange(['original_message'])).toBe(true);
    expect(changedFields(draft, { ...draft })).toEqual([]);
  });

  it('approval survives only cosmetic edits', () => {
    expect(statusAfterSave('approved', false, true)).toBe('approved');
    expect(statusAfterSave('approved', true, true)).toBe('ready_for_approval');
    expect(statusAfterSave('approved', true, false)).toBe('draft');
    expect(statusAfterSave('draft', true, true)).toBe('ready_for_approval');
    expect(statusAfterSave('ready_for_approval', true, false)).toBe('draft');
  });
});
