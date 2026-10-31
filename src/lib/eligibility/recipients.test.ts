import { describe, expect, it } from 'vitest';
import { VALID_DRAFT } from '@/test/fixtures/campaign';
import { demoProfiles } from '@/test/helpers/demo-profiles';
import { assignGroup } from '@/lib/experiments/assignment';
import { evaluateRecipients, planBudget, type RecipientCampaign } from './recipients';

const CAMPAIGN: RecipientCampaign = {
  id: '30000000-0000-4000-8000-0000000000aa',
  segment_type: 'at_risk',
  budget_minor: 500_000,
  offer: { type: 'free_item', item_name: 'pastry', item_cost_minor: 4_000 },
};
const profiles = demoProfiles();
const evaluate = (overrides: Partial<RecipientCampaign> = {}) => evaluateRecipients(profiles, { ...CAMPAIGN, ...overrides });

describe('recipient evaluation', () => {
  const result = evaluate();
  const { summary } = result;

  it('covers every segment member exactly once, in a fixed order', () => {
    expect(result.decisions).toHaveLength(19);
    expect(new Set(result.decisions.map((d) => d.customer_id)).size).toBe(19);
    expect(summary).toMatchObject({ members: 19, contactable: 12, insufficient_history: 2 });
  });

  it('records why each suppressed customer will not be messaged (EL-10)', () => {
    expect(summary.suppressed).toMatchObject({ OPTED_OUT: 3, CONSENT_UNKNOWN: 2, FREQUENCY_CAP: 2 });
    for (const d of result.decisions.filter((x) => x.group_assignment === null)) {
      expect(d.eligibility_status).toBe('ineligible');
      expect(d.suppression_reason).not.toBeNull();
    }
  });

  it('splits contactable customers into treatment and control by the stable hash', () => {
    expect(summary.treatment + summary.control).toBe(12);
    for (const d of result.decisions.filter((x) => x.group_assignment !== null)) {
      expect(d.group_assignment).toBe(assignGroup(CAMPAIGN.id, d.customer_id));
    }
    expect(evaluate().decisions).toEqual(result.decisions); // reproducible
  });

  it('EL-05: control customers are held back with CONTROL_GROUP and are never sendable', () => {
    const control = result.decisions.filter((d) => d.group_assignment === 'control');
    expect(control).toHaveLength(summary.control);
    for (const d of control) expect(d).toMatchObject({ eligibility_status: 'eligible', suppression_reason: 'CONTROL_GROUP' });
    const sendable = result.decisions.filter((d) => d.group_assignment === 'treatment' && d.suppression_reason === null);
    expect(sendable).toHaveLength(summary.sendable);
    expect(sendable.some((d) => control.some((c) => c.customer_id === d.customer_id))).toBe(false);
  });

  it('a different campaign gets a different (but equally stable) split', () => {
    const other = evaluate({ id: '30000000-0000-4000-8000-0000000000bb' });
    expect(other.summary.treatment + other.summary.control).toBe(12);
    expect(other.decisions.map((d) => d.group_assignment)).not.toEqual(result.decisions.map((d) => d.group_assignment));
  });

  it('E-09: the budget caps how many are messaged, in a deterministic order, and is never exceeded', () => {
    const capped = evaluate({ budget_minor: 4_000 * 3 + 3_999 }); // room for exactly 3 messages
    expect(capped.budget).toMatchObject({ cost_per_message_minor: 4_000, max_messages: 3, reserved_minor: 12_000 });
    expect(capped.budget.reserved_minor).toBeLessThanOrEqual(capped.budget.budget_minor);
    expect(capped.summary.sendable).toBe(3);
    expect(capped.summary.suppressed.BUDGET_EXCEEDED).toBe(capped.summary.treatment - 3);

    // The first three treatment customers by id are served; the rest are named as over budget.
    const treatment = capped.decisions.filter((d) => d.group_assignment === 'treatment').map((d) => d.customer_id);
    expect(treatment).toEqual([...treatment].sort());
    expect(capped.decisions.filter((d) => d.group_assignment === 'treatment' && d.suppression_reason === null).map((d) => d.customer_id))
      .toEqual(treatment.slice(0, 3));
    expect(evaluate({ budget_minor: 15_999 }).decisions).toEqual(capped.decisions);
  });

  it('a budget below one message messages nobody; a zero-cost offer is unlimited', () => {
    expect(evaluate({ budget_minor: 3_999 }).summary.sendable).toBe(0);
    const free = evaluate({ budget_minor: 0, offer: { type: 'no_offer' } });
    expect(free.budget).toMatchObject({ cost_per_message_minor: 0, max_messages: null });
    expect(free.summary.sendable).toBe(free.summary.treatment);
  });

  it('other segments use the same rules', () => {
    const all = evaluate({ segment_type: 'all_eligible' });
    expect(all.summary.members).toBe(31);
    expect(all.summary.contactable).toBe(24);
    expect(evaluate({ segment_type: 'previously_active' }).summary).toMatchObject({ members: 9, contactable: 7 });
  });

  it('an audience nobody can be contacted in yields no recipients to message', () => {
    const blocked = evaluateRecipients(profiles.map((p) => ({ ...p, contact: { eligible: false, reason: 'CONSENT_UNKNOWN' as const, detail: '' } })), CAMPAIGN);
    expect(blocked.summary).toMatchObject({ contactable: 0, treatment: 0, control: 0, sendable: 0 });
  });

  it('uses the sample draft\'s segment type name', () => {
    expect(VALID_DRAFT.segment_type).toBe(CAMPAIGN.segment_type);
  });
});

describe('budget planning', () => {
  it('reserves one redemption per message and never more than the budget', () => {
    expect(planBudget(1_000, 300, 5)).toEqual({ budget_minor: 1_000, cost_per_message_minor: 300, max_messages: 3, reserved_minor: 900, remaining_minor: 100 });
    expect(planBudget(1_000, 300, 2)).toMatchObject({ reserved_minor: 600, remaining_minor: 400 });
    expect(planBudget(1_000, 0, 5)).toMatchObject({ max_messages: null, reserved_minor: 0 });
    expect(planBudget(1_000, null, 5)).toMatchObject({ cost_per_message_minor: null, max_messages: 0, reserved_minor: 0 });
    expect(planBudget(100, 300, 5)).toMatchObject({ max_messages: 0, reserved_minor: 0, remaining_minor: 100 });
  });
});
