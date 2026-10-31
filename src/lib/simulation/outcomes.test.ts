import { describe, expect, it } from 'vitest';
import { simulateRecipientOutcome, type OutcomeRecipient } from './outcomes';

const treatment: OutcomeRecipient = {
  customer_id: '00000000-0000-0000-0000-000000000001',
  group_assignment: 'treatment',
  eligibility_status: 'eligible',
};
const control: OutcomeRecipient = { ...treatment, group_assignment: 'control' };

describe('deterministic outcome simulation', () => {
  it('ME-01: preserves the treatment/control assignments supplied by the recipient snapshot', () => {
    expect(simulateRecipientOutcome('campaign', 3, treatment, new Set()).group_assignment).toBe('treatment');
    expect(simulateRecipientOutcome('campaign', 3, control, new Set()).group_assignment).toBe('control');
  });

  it('ME-08: generates identical outcomes for the same campaign version and seed', () => {
    const first = simulateRecipientOutcome('campaign', 3, treatment, new Set([treatment.customer_id]));
    const again = simulateRecipientOutcome('campaign', 3, treatment, new Set([treatment.customer_id]));
    expect(again).toEqual(first);
  });

  it('changes the seed when the campaign version changes', () => {
    const first = simulateRecipientOutcome('campaign', 3, treatment, new Set([treatment.customer_id]));
    const nextVersion = simulateRecipientOutcome('campaign', 4, treatment, new Set([treatment.customer_id]));
    expect(nextVersion.simulation_seed).not.toBe(first.simulation_seed);
  });

  it('does not simulate a treatment reaction or unsubscribe when no message was delivered', () => {
    const result = simulateRecipientOutcome('campaign', 1, treatment, new Set());
    expect(result.reactivated).toBe(false);
    expect(result.unsubscribed).toBe(false);
  });

  it('does not record simulated unsubscribes for control customers', () => {
    const result = simulateRecipientOutcome('campaign', 1, control, new Set([control.customer_id]));
    expect(result.unsubscribed).toBe(false);
  });

  it('ME-02: creates one outcome for each assigned recipient without changing group counts', () => {
    const recipients = [treatment, { ...treatment, customer_id: 't2' }, control, { ...control, customer_id: 'c2' }];
    const simulated = recipients.map((recipient) =>
      simulateRecipientOutcome('campaign', 1, recipient, new Set(recipients.map((row) => row.customer_id))));
    expect(simulated).toHaveLength(recipients.length);
    expect(simulated.filter((row) => row.group_assignment === 'treatment')).toHaveLength(2);
    expect(simulated.filter((row) => row.group_assignment === 'control')).toHaveLength(2);
  });
});
